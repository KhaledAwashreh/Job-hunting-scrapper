// Regression tests for A3 — last_insert_rowid() clobbered by saveDatabase().
//
// saveDatabase() (src/db/schema.js) calls database.export(), which resets the
// sql.js connection's `last_insert_rowid()` counter to 0. Any insert helper that
// reads `last_insert_rowid()` AFTER a save has already run will get 0 back, not
// the row it just inserted.
//
// This file:
//   1. Proves createScrapeRun (the function actually named in the bug report)
//      now returns distinct, correct ids across sequential calls, and that
//      updateScrapeRun subsequently updates the right row.
//   2. Provides evidence for the sibling audit the brief asked for: addCompany,
//      addProfile and addTailoredResume all already return correct sequential
//      ids today, because addCompany/addProfile read last_insert_rowid() BEFORE
//      saveDatabase() runs, and addTailoredResume never calls
//      last_insert_rowid() at all — it re-selects on its UNIQUE(position_id,
//      profile_id, version) constraint, the same pattern addPosition already
//      uses for its UNIQUE hash column.
//
// JOBS_DB_PATH is set to a fresh temp file, BEFORE src/db/schema.js is required
// anywhere (including transitively), so the real jobs.db is never opened.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const REAL_DB = path.join(REPO_ROOT, 'jobs.db');

function realDbFingerprint() {
  if (!fs.existsSync(REAL_DB)) return { exists: false };
  const st = fs.statSync(REAL_DB);
  return { exists: true, size: st.size, mtimeMs: st.mtimeMs };
}

const realDbBefore = realDbFingerprint();

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-rowid-test-'));
process.env.JOBS_DB_PATH = path.join(tmpDir, 'test-jobs.db');

// Required only after JOBS_DB_PATH is set, so schema.js's module-level
// `dbPath` picks up the temp file instead of falling back to the real db.
const schema = require('../src/db/schema');
const queries = require('../src/db/queries');

before(async () => {
  assert.notEqual(
    process.env.JOBS_DB_PATH, undefined,
    'JOBS_DB_PATH must be set before initializing the database'
  );
  assert.equal(schema.dbPath, process.env.JOBS_DB_PATH, 'schema.js must be pointed at the temp db, not the real one');
  await schema.initializeDatabase();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const realDbAfter = realDbFingerprint();
  assert.deepEqual(
    realDbAfter,
    realDbBefore,
    'the real jobs.db must not be created, opened, or modified by this test run'
  );
});

describe('createScrapeRun — A3.1 fix', () => {
  test('three sequential calls return three distinct ids matching the actual rows', () => {
    const a = queries.createScrapeRun('2026-01-01T00:00:00Z');
    const b = queries.createScrapeRun('2026-01-01T00:01:00Z');
    const c = queries.createScrapeRun('2026-01-01T00:02:00Z');

    assert.deepEqual([a, b, c], [1, 2, 3], 'ids must be sequential and distinct, not stuck at 1');

    const rows = queries.getAllScrapeRuns();
    const actualIds = rows.map(r => r.id).sort((x, y) => x - y);
    assert.deepEqual(actualIds, [1, 2, 3]);
  });

  test('updateScrapeRun updates the correct row, not row 1', () => {
    const a = queries.createScrapeRun('2026-02-01T00:00:00Z');
    const b = queries.createScrapeRun('2026-02-01T00:01:00Z');
    const c = queries.createScrapeRun('2026-02-01T00:02:00Z');

    queries.updateScrapeRun(b, '2026-02-01T01:00:00Z', 5, 10, 3, '[]');

    const runA = queries.getScrapeRunById(a);
    const runB = queries.getScrapeRunById(b);
    const runC = queries.getScrapeRunById(c);

    assert.equal(runB.finished_at, '2026-02-01T01:00:00Z', 'the targeted run must be finished');
    assert.equal(runA.finished_at, null, 'row before the target must be untouched');
    assert.equal(runC.finished_at, null, 'row after the target must be untouched');
  });
});

describe('sibling insert-id audit (A3 follow-up)', () => {
  test('addCompany: already reads last_insert_rowid() before saveDatabase() — unaffected', () => {
    const c1 = queries.addCompany('Acme', 'US', 'https://acme.example');
    const c2 = queries.addCompany('Beta', 'US', 'https://beta.example');
    const c3 = queries.addCompany('Gamma', 'US', 'https://gamma.example');

    assert.deepEqual([c1, c2, c3], [c1, c1 + 1, c1 + 2], 'ids must be sequential, not repeated');

    const rows = queries.getAllCompanies();
    assert.deepEqual(
      rows.map(r => r.id).sort((x, y) => x - y),
      [c1, c2, c3].sort((x, y) => x - y)
    );
  });

  test('addProfile: already reads last_insert_rowid() before saveDatabase() — unaffected', () => {
    const p1 = queries.addProfile('Profile1', 'r1.pdf', ['eng'], 'cat', 'mid');
    const p2 = queries.addProfile('Profile2', 'r2.pdf', ['eng'], 'cat', 'mid');
    const p3 = queries.addProfile('Profile3', 'r3.pdf', ['eng'], 'cat', 'mid');

    assert.deepEqual([p1, p2, p3], [p1, p1 + 1, p1 + 2], 'ids must be sequential, not repeated');

    const rows = queries.getAllProfiles();
    assert.deepEqual(
      rows.map(r => r.id).sort((x, y) => x - y),
      [p1, p2, p3].sort((x, y) => x - y)
    );
  });

  test('addTailoredResume: never reads last_insert_rowid() (re-selects by UNIQUE constraint) — unaffected', () => {
    const companyId = queries.addCompany('Delta', 'US', 'https://delta.example');
    const profileId = queries.addProfile('Profile4', 'r4.pdf', ['eng'], 'cat', 'mid');
    const position = queries.addPosition(
      'rowid-test-hash', companyId, 'US', 'Eng', 'desc', 'quals',
      '2026-01-01', 'link', 'full', [], [], [], 5, null
    );

    const t1 = queries.addTailoredResume(position.id, profileId, 'base', 'tailored v1', 1);
    const t2 = queries.addTailoredResume(position.id, profileId, 'base', 'tailored v2', 2);
    const t3 = queries.addTailoredResume(position.id, profileId, 'base', 'tailored v3', 3);

    assert.equal(t1.isDuplicate, false);
    assert.equal(t2.isDuplicate, false);
    assert.equal(t3.isDuplicate, false);
    assert.deepEqual(
      [t1.id, t2.id, t3.id],
      [t1.id, t1.id + 1, t1.id + 2],
      'ids must be sequential, not repeated'
    );

    const rows = queries.getTailoredResumesForPosition(position.id);
    assert.deepEqual(
      rows.map(r => r.id).sort((x, y) => x - y),
      [t1.id, t2.id, t3.id].sort((x, y) => x - y)
    );
  });
});
