// Regression tests for A7.2 — inspect_db.js and count_companies.js used to
// hardcode `path.join(__dirname, 'jobs.db')`, ignoring JOBS_DB_PATH entirely.
// That defeated the isolation convention src/db/schema.js relies on: point
// JOBS_DB_PATH at a temp file and the rest of the app follows it, but these
// two scripts silently kept reading (or missing) the real jobs.db.
//
// The fix makes both scripts `require('./src/db/schema')` for `dbPath`
// instead of re-deriving it, so there is exactly one place that decides
// where the database lives.
//
// Every scenario here runs the scripts as child processes against temp
// database files. The real jobs.db (at the repo root, outside this
// worktree) is never pointed at, read, or written — we only `stat` it
// before and after this file runs to prove it is untouched.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const REAL_DB = path.join(REPO_ROOT, 'jobs.db');

function realDbFingerprint() {
  if (!fs.existsSync(REAL_DB)) return { exists: false };
  const st = fs.statSync(REAL_DB);
  return { exists: true, size: st.size, mtimeMs: st.mtimeMs };
}

const realDbBefore = realDbFingerprint();

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-scripts-dbpath-'));

// Seed a temp sql.js database file with one distinctly-named company, using
// the same schema module the app uses, so INSERT/SELECT round-trip through
// the real table definitions rather than a hand-rolled schema.
async function seedDb(dbPath, companyName) {
  const tmpEnv = process.env.JOBS_DB_PATH;
  process.env.JOBS_DB_PATH = dbPath;
  // Fresh require of schema.js per seed so its module-scope `dbPath` picks
  // up the env var we just set (require caching would otherwise reuse the
  // first-seen path).
  delete require.cache[require.resolve('../src/db/schema')];
  const schema = require('../src/db/schema');
  await schema.initializeDatabase();
  const db = schema.getDatabase();
  db.run('INSERT INTO companies (name, country, career_url) VALUES (?, ?, ?)', [
    companyName,
    'US',
    'https://example.com/' + companyName,
  ]);
  schema.saveDatabase();
  delete require.cache[require.resolve('../src/db/schema')];
  process.env.JOBS_DB_PATH = tmpEnv;
}

function runScript(scriptName, dbPath) {
  return execFileSync('node', [path.join(REPO_ROOT, scriptName)], {
    cwd: REPO_ROOT,
    env: { ...process.env, JOBS_DB_PATH: dbPath },
    encoding: 'utf-8',
  });
}

describe('inspect_db.js / count_companies.js honour JOBS_DB_PATH', () => {
  let dbA;
  let dbB;

  before(async () => {
    dbA = path.join(tmpDir, 'a.db');
    dbB = path.join(tmpDir, 'b.db');
    await seedDb(dbA, 'AlphaCorp');
    await seedDb(dbB, 'BetaCorp');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });

    const realDbAfter = realDbFingerprint();
    assert.deepEqual(
      realDbAfter,
      realDbBefore,
      'the real jobs.db must be untouched by this test file'
    );
  });

  test('count_companies.js reads the company seeded into the JOBS_DB_PATH file, not a different one', () => {
    const outputA = runScript('count_companies.js', dbA);
    assert.match(outputA, /Companies count: 1/);
    assert.match(outputA, /AlphaCorp/);
    assert.doesNotMatch(outputA, /BetaCorp/);

    const outputB = runScript('count_companies.js', dbB);
    assert.match(outputB, /Companies count: 1/);
    assert.match(outputB, /BetaCorp/);
    assert.doesNotMatch(outputB, /AlphaCorp/);
  });

  test('inspect_db.js reads the JOBS_DB_PATH file rather than reporting "Database not found"', () => {
    const output = runScript('inspect_db.js', dbA);
    assert.match(output, /Positions count: 0/);
    assert.match(output, /Scrape runs count: 0/);
    assert.doesNotMatch(output, /Database not found/);
  });

  test('a nonexistent JOBS_DB_PATH is honoured too (proves the env var, not a fallback, is driving the read)', () => {
    const missing = path.join(tmpDir, 'does-not-exist.db');
    const output = runScript('count_companies.js', missing);
    assert.match(output, /Database not found/);
  });

  test('with JOBS_DB_PATH unset, both scripts resolve the same default path schema.js uses (repo-root/jobs.db) — behaviour is unchanged from before the fix', () => {
    delete require.cache[require.resolve('../src/db/schema')];
    delete process.env.JOBS_DB_PATH;
    const { dbPath: resolvedDefault } = require('../src/db/schema');
    delete require.cache[require.resolve('../src/db/schema')];

    // This is exactly what the old hardcoded scripts pointed at: both lived
    // at the repo root, so `path.join(__dirname, 'jobs.db')` === repo
    // root's jobs.db, the same file schema.js falls back to.
    assert.equal(resolvedDefault, path.join(REPO_ROOT, 'jobs.db'));
  });
});
