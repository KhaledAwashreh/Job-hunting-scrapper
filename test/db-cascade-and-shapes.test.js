// Regression tests for #30, #31, #32 (Group C, batch 3).
//
// #30 — ON DELETE CASCADE was declared in schema.js but never enforced: sql.js
// (like SQLite generally) has foreign-key enforcement OFF by default per
// connection, and PRAGMA foreign_keys = ON was never executed. Worse, sql.js's
// Database.export() (called by saveDatabase() after nearly every write) closes
// and reopens the underlying connection internally, which resets the pragma
// right back to OFF — so simply setting it once at startup was not enough;
// schema.js's writeToDisk() must re-assert it after every export(). These
// tests prove cascade deletes actually remove dependent rows, not just that
// the pragma reads back as 1 once.
//
// #31 — linkPositionToProfile() must silently no-op on a duplicate link
// (UNIQUE(position_id, profile_id) collision) but let a genuinely different
// error (e.g. a NOT NULL violation from bad ids) propagate instead of
// swallowing it identically.
//
// #32 — not-found query functions must consistently return null (not
// undefined, not a raw unparsed JSON string).
//
// JOBS_DB_PATH is set to a fresh temp file BEFORE src/db/schema.js is required
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-cascade-test-'));
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

// Helper: count rows in a dependent table via the raw connection, since we
// want ground truth, not a query function's own (possibly buggy) filtering.
function rawCount(query, params) {
  const db = schema.getDatabase();
  const result = db.exec(query, params);
  return result.length === 0 ? 0 : result[0].values.length;
}

describe('#30 — ON DELETE CASCADE actually fires', () => {
  test('deleteCompany cascades through positions to position_profiles and tailored_resumes', () => {
    const companyId = queries.addCompany('CascadeCoA', 'US', 'https://cascade-a.example');
    const profileId = queries.addProfile('CascadeProfileA', 'ra.pdf', ['eng'], 'cat', 'mid');
    const position = queries.addPosition(
      'cascade-a-hash', companyId, 'US', 'Eng', 'desc', 'quals',
      '2026-01-01', 'link', 'full', [], [], [], 5, null
    );
    assert.equal(position.isDuplicate, false);

    const linked = queries.linkPositionToProfile(position.id, profileId, 3);
    assert.equal(linked, true);

    const tr = queries.addTailoredResume(position.id, profileId, 'base', 'tailored', 1);
    assert.equal(tr.isDuplicate, false);

    // Sanity: dependent rows exist before delete.
    assert.equal(rawCount('SELECT id FROM position_profiles WHERE position_id = ?', [position.id]), 1);
    assert.equal(rawCount('SELECT id FROM tailored_resumes WHERE position_id = ?', [position.id]), 1);

    queries.deleteCompany(companyId);

    assert.equal(
      rawCount('SELECT id FROM positions WHERE id = ?', [position.id]), 0,
      'position must be gone'
    );
    assert.equal(
      rawCount('SELECT id FROM position_profiles WHERE position_id = ?', [position.id]), 0,
      'position_profiles row must be cascade-deleted, not orphaned'
    );
    assert.equal(
      rawCount('SELECT id FROM tailored_resumes WHERE position_id = ?', [position.id]), 0,
      'tailored_resumes row must be cascade-deleted, not orphaned'
    );
  });

  test('deleteProfile cascades to tailored_resumes (not just the manually-deleted position_profiles link)', () => {
    const companyId = queries.addCompany('CascadeCoB', 'US', 'https://cascade-b.example');
    const profileId = queries.addProfile('CascadeProfileB', 'rb.pdf', ['eng'], 'cat', 'mid');
    const position = queries.addPosition(
      'cascade-b-hash', companyId, 'US', 'Eng', 'desc', 'quals',
      '2026-01-01', 'link', 'full', [], [], [], 5, null
    );

    queries.linkPositionToProfile(position.id, profileId, 3);
    const tr = queries.addTailoredResume(position.id, profileId, 'base', 'tailored', 1);
    assert.equal(tr.isDuplicate, false);

    assert.equal(rawCount('SELECT id FROM tailored_resumes WHERE profile_id = ?', [profileId]), 1);

    queries.deleteProfile(profileId);

    assert.equal(
      rawCount('SELECT id FROM position_profiles WHERE profile_id = ?', [profileId]), 0,
      'position_profiles row must be gone'
    );
    assert.equal(
      rawCount('SELECT id FROM tailored_resumes WHERE profile_id = ?', [profileId]), 0,
      'tailored_resumes row must be cascade-deleted, not orphaned (deleteProfile never deletes this table itself)'
    );
  });

  test('foreign_keys enforcement survives multiple saveDatabase() round-trips, not just the first', () => {
    // Regression guard for the specific trap this fix hit: sql.js's
    // Database.export() (called on every saveDatabase()) closes and reopens
    // the connection internally, silently resetting PRAGMA foreign_keys back
    // to OFF. A fix that only sets the pragma once in initializeDatabase()
    // would pass a "delete right after startup" test but fail here, after
    // several intervening writes/saves have each reopened the connection.
    const companyId = queries.addCompany('CascadeCoC', 'US', 'https://cascade-c.example');
    queries.addCompany('Unrelated1', 'US', 'https://unrelated1.example'); // extra saveDatabase() round-trips
    const profileId = queries.addProfile('CascadeProfileC', 'rc.pdf', ['eng'], 'cat', 'mid');
    queries.addProfile('Unrelated2', 'ru.pdf', ['eng'], 'cat', 'mid');
    const position = queries.addPosition(
      'cascade-c-hash', companyId, 'US', 'Eng', 'desc', 'quals',
      '2026-01-01', 'link', 'full', [], [], [], 5, null
    );
    queries.linkPositionToProfile(position.id, profileId, 3);
    queries.addTailoredResume(position.id, profileId, 'base', 'tailored', 1);
    queries.updatePositionStatus(position.id, 'viewed'); // another save round-trip

    queries.deleteCompany(companyId);

    assert.equal(rawCount('SELECT id FROM position_profiles WHERE position_id = ?', [position.id]), 0);
    assert.equal(rawCount('SELECT id FROM tailored_resumes WHERE position_id = ?', [position.id]), 0);
  });
});

describe('#31 — linkPositionToProfile distinguishes duplicate links from real errors', () => {
  test('linking the same position-profile pair twice is a silent no-op (no throw)', () => {
    const companyId = queries.addCompany('LinkCo', 'US', 'https://link-co.example');
    const profileId = queries.addProfile('LinkProfile', 'rl.pdf', ['eng'], 'cat', 'mid');
    const position = queries.addPosition(
      'link-dup-hash', companyId, 'US', 'Eng', 'desc', 'quals',
      '2026-01-01', 'link', 'full', [], [], [], 5, null
    );

    const first = queries.linkPositionToProfile(position.id, profileId, 4);
    assert.equal(first, true, 'first link must succeed');

    assert.doesNotThrow(() => {
      const second = queries.linkPositionToProfile(position.id, profileId, 4);
      assert.equal(second, false, 'duplicate link must return false, not throw');
    });

    // Exactly one row must exist — the duplicate attempt did not insert a
    // second link.
    assert.equal(
      rawCount('SELECT id FROM position_profiles WHERE position_id = ? AND profile_id = ?', [position.id, profileId]),
      1
    );
  });

  test('a genuinely different DB error (bad ids) still surfaces instead of being swallowed', () => {
    assert.throws(
      () => queries.linkPositionToProfile(null, null, 1),
      (err) => {
        assert.match(err.message, /NOT NULL constraint failed/i);
        return true;
      },
      'a non-UNIQUE constraint violation must propagate, not be treated as a harmless duplicate'
    );
  });
});

describe('#32 — consistent not-found shapes and parsed JSON columns', () => {
  test('getCompanyById, getProfileById, getScrapeRunById, getPositionById, getTailoredResumeById all return null for a missing row', () => {
    const missingId = 999999;
    assert.equal(queries.getCompanyById(missingId), null);
    assert.equal(queries.getProfileById(missingId), null);
    assert.equal(queries.getScrapeRunById(missingId), null);
    assert.equal(queries.getPositionById(missingId), null);
    assert.equal(queries.getTailoredResumeById(missingId), null);
  });

  test('getCompanyById/getProfileById/getScrapeRunById return undefined for nothing — strictly null, not undefined', () => {
    const missingId = 999999;
    assert.notEqual(typeof queries.getCompanyById(missingId), 'undefined');
    assert.notEqual(typeof queries.getProfileById(missingId), 'undefined');
    assert.notEqual(typeof queries.getScrapeRunById(missingId), 'undefined');
  });

  test('getPositionById returns fully parsed array fields, never raw JSON strings, whether found or not', () => {
    const companyId = queries.addCompany('JsonCo', 'US', 'https://json-co.example');
    const position = queries.addPosition(
      'json-shape-hash', companyId, 'US', 'Eng', 'desc', 'quals',
      '2026-01-01', 'link', 'full', ['remote'], ['3-5'], ['mid'], 5, null
    );

    const found = queries.getPositionById(position.id);
    assert.ok(Array.isArray(found.location_type), 'location_type must be a parsed array');
    assert.ok(Array.isArray(found.years_experience), 'years_experience must be a parsed array');
    assert.ok(Array.isArray(found.seniority_level), 'seniority_level must be a parsed array');
    assert.deepEqual(found.location_type, ['remote']);
    assert.deepEqual(found.years_experience, ['3-5']);
    assert.deepEqual(found.seniority_level, ['mid']);
  });

  test('getPositionsForProfile (dead code, unparsed JSON, zero callers) was removed rather than patched', () => {
    assert.equal(
      typeof queries.getPositionsForProfile, 'undefined',
      'getPositionsForProfile must no longer be exported'
    );
  });
});
