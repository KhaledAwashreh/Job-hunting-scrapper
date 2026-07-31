// Regression tests for #29 — companies had no UNIQUE constraint, so
// bulk-add-companies.js (and POST /api/companies) inserted a fresh
// duplicate row every time it ran with the same company list. The reported
// symptom was "two runs -> 98 rows, every company doubled".
//
// The fix:
//   1. src/db/schema.js — companies now has UNIQUE(name, career_url), both
//      inline in CREATE TABLE (new databases) and via a best-effort
//      CREATE UNIQUE INDEX IF NOT EXISTS (existing databases, retroactively).
//   2. src/db/queries.js — addCompany() uses INSERT OR IGNORE and re-selects
//      the existing row's id on a collision instead of throwing, so a
//      caller never sees an unhandled UNIQUE-constraint exception.
//   3. bulk-add-companies.js — pre-checks with the new companyExists()
//      before inserting, so a second run reports "skipped" instead of
//      quietly doubling every row (or crashing).
//
// JOBS_DB_PATH is set to a fresh temp file, BEFORE src/db/schema.js is
// required anywhere (including transitively), so the real jobs.db is never
// opened.

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-companies-unique-test-'));
process.env.JOBS_DB_PATH = path.join(tmpDir, 'test-jobs.db');

const schema = require('../src/db/schema');
const queries = require('../src/db/queries');

before(async () => {
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

describe('#29 — companies(name, career_url) UNIQUE constraint', () => {
  test('the schema actually enforces uniqueness, not just the app layer', () => {
    const db = schema.getDatabase();
    db.run(
      `INSERT INTO companies (name, country, career_url) VALUES ('Raw Insert Co', 'US', 'https://raw-insert.example')`
    );
    assert.throws(
      () => db.run(
        `INSERT INTO companies (name, country, career_url) VALUES ('Raw Insert Co', 'US', 'https://raw-insert.example')`
      ),
      /UNIQUE constraint failed/,
      'a second raw INSERT with the same (name, career_url) must be rejected by the schema itself'
    );

    const rows = queries.getAllCompanies().filter(c => c.name === 'Raw Insert Co');
    assert.equal(rows.length, 1, 'only one row should exist for the duplicate pair');
  });

  test('addCompany() does not throw on a duplicate — it returns the existing row\'s id', () => {
    const firstId = queries.addCompany('Acme Corp', 'Netherlands', 'https://acme.example/careers', 'greenhouse');

    assert.doesNotThrow(() => {
      const secondId = queries.addCompany('Acme Corp', 'Netherlands', 'https://acme.example/careers', 'greenhouse');
      assert.equal(secondId, firstId, 'the duplicate call should return the SAME id, not a new one');
    });

    const rows = queries.getAllCompanies().filter(c => c.name === 'Acme Corp');
    assert.equal(rows.length, 1, 'inserting the same company twice must not create a second row');
  });

  test('companyExists() reports true only after the company has actually been added', () => {
    assert.equal(queries.companyExists('Nimbus Data', 'https://nimbus.example/jobs'), false);
    queries.addCompany('Nimbus Data', 'Ireland', 'https://nimbus.example/jobs');
    assert.equal(queries.companyExists('Nimbus Data', 'https://nimbus.example/jobs'), true);
  });

  test('same name but different career_url is NOT treated as a duplicate', () => {
    const id1 = queries.addCompany('Multi Site Co', 'US', 'https://multisite.example/us-careers');
    const id2 = queries.addCompany('Multi Site Co', 'US', 'https://multisite.example/eu-careers');
    assert.notEqual(id1, id2, 'different career_url values are different companies, not duplicates');

    const rows = queries.getAllCompanies().filter(c => c.name === 'Multi Site Co');
    assert.equal(rows.length, 2);
  });

  test('bulk-add-companies.js\'s insert logic run twice against the same data produces no duplicate rows', () => {
    const BULK_COMPANIES = [
      { name: 'Bulk Co One', country: 'Netherlands', career_url: 'https://bulk-one.example/careers' },
      { name: 'Bulk Co Two', country: 'Ireland', career_url: 'https://bulk-two.example/careers' },
      { name: 'Bulk Co Three', country: 'Portugal', career_url: 'https://bulk-three.example/careers' },
    ];

    // Mirrors bulk-add-companies.js's per-company logic: check companyExists()
    // first (skip if so), otherwise addCompany() (detectPlatformAndSlug is
    // skipped here — it hits the network and is orthogonal to the dedup fix).
    function runBulkAddOnce() {
      const results = { added: 0, skipped: 0 };
      for (const company of BULK_COMPANIES) {
        if (queries.companyExists(company.name, company.career_url)) {
          results.skipped++;
          continue;
        }
        queries.addCompany(company.name, company.country, company.career_url, 'custom');
        results.added++;
      }
      return results;
    }

    const firstRun = runBulkAddOnce();
    assert.deepEqual(firstRun, { added: 3, skipped: 0 }, 'first run should add all three companies');

    let secondRun;
    assert.doesNotThrow(() => {
      secondRun = runBulkAddOnce();
    }, 'a second run against the same data must not throw an unhandled UNIQUE-constraint error');
    assert.deepEqual(secondRun, { added: 0, skipped: 3 }, 'second run should skip all three, not re-add them');

    for (const company of BULK_COMPANIES) {
      const rows = queries.getAllCompanies().filter(
        c => c.name === company.name && c.career_url === company.career_url
      );
      assert.equal(rows.length, 1, `"${company.name}" must have exactly one row after two bulk-add runs, got ${rows.length}`);
    }
  });
});
