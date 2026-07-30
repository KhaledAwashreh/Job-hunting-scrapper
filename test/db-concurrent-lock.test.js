// Regression tests for #26 — concurrent writers against the same jobs.db
// could silently lose rows. sql.js holds the whole database in memory and
// does a full export() + writeFileSync() on every write with no locking: if
// a second OS process opens the same file (e.g. bulk-add-companies.js run
// while the server is already up, or an accidental second server instance),
// whichever process saves last wins in full and the other process's entire
// session of writes disappears without any error.
//
// The fix (src/db/schema.js: acquireLock/releaseLock, an fs.mkdirSync-based
// advisory lock held for the whole life of a process's database session)
// can't repair the "lost update" itself — by the time a second process would
// take a lock, it may already have read a stale snapshot into memory — so
// instead it turns the failure mode from "silent data loss" into "fails
// loudly at startup". These tests spawn a REAL second Node process against
// the same database file (not an in-process simulation) to prove that:
//   1. a second writer is refused with a clear error, and the first
//      process's data survives untouched;
//   2. the lock is released when its holder exits normally, so a well
//      behaved second process (e.g. run after the first one stops) is not
//      permanently blocked;
//   3. a lock abandoned by a crashed/killed process (whose pid is no longer
//      running) is detected as stale and reclaimed rather than wedging the
//      database forever.
//
// JOBS_DB_PATH is set to a fresh temp file, BEFORE src/db/schema.js is
// required anywhere (including transitively), so the real jobs.db is never
// opened.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const REAL_DB = path.join(REPO_ROOT, 'jobs.db');
const SCHEMA_PATH = path.join(REPO_ROOT, 'src/db/schema');

function realDbFingerprint() {
  if (!fs.existsSync(REAL_DB)) return { exists: false };
  const st = fs.statSync(REAL_DB);
  return { exists: true, size: st.size, mtimeMs: st.mtimeMs };
}

const realDbBefore = realDbFingerprint();

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-lock-test-'));
const dbPath = path.join(tmpDir, 'test-jobs.db');
process.env.JOBS_DB_PATH = dbPath;

const schema = require('../src/db/schema');
const queries = require('../src/db/queries');

// Runs a small script in a fresh Node process with its own JOBS_DB_PATH, so
// it goes through schema.js's module-scope lock/dbPath setup independently
// of this test process (which already holds the lock on `dbPath` for most of
// this file — see `before()` below).
function runChild(childDbPath, body) {
  const script = `
    process.env.JOBS_DB_PATH = ${JSON.stringify(childDbPath)};
    const schema = require(${JSON.stringify(SCHEMA_PATH)});
    (async () => {
      ${body}
    })().catch(err => { console.error(err.message); process.exit(1); });
  `;
  return execFileSync(process.execPath, ['-e', script], { cwd: REPO_ROOT, encoding: 'utf8' });
}

before(async () => {
  assert.equal(schema.dbPath, dbPath, 'schema.js must be pointed at the temp db, not the real one');
  await schema.initializeDatabase();
  queries.addCompany('LockTestCo', 'US', 'https://locktest.example');
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

describe('#26 — cross-process database lock', () => {
  test('a second process cannot open the same database while this one holds it, and no data is lost', () => {
    let threw = false;
    let stderrOutput = '';
    try {
      runChild(dbPath, `
        await schema.initializeDatabase();
        console.log('UNEXPECTED_SUCCESS');
        process.exit(0);
      `);
    } catch (err) {
      threw = true;
      stderrOutput = String(err.stderr || '');
    }

    assert.ok(threw, 'a second process opening the same database file while the first still holds it must fail loudly, not silently succeed');
    assert.match(
      stderrOutput,
      /already in use by another process/,
      `expected a clear "already in use" error, got: ${stderrOutput}`
    );

    // The clobber this issue describes never gets a chance to happen: the
    // second process's initializeDatabase() throws inside the lock check,
    // before it ever reads the file or opens a sql.js connection. Confirm
    // the first process's data is exactly what it inserted — nothing lost,
    // nothing duplicated.
    const companies = queries.getAllCompanies();
    assert.equal(companies.length, 1);
    assert.equal(companies[0].name, 'LockTestCo');
  });

  test('the lock is released when its holder process exits normally', () => {
    const releaseDbPath = path.join(tmpDir, 'release-test.db');

    runChild(releaseDbPath, `
      await schema.initializeDatabase();
      process.exit(0);
    `);

    assert.equal(
      fs.existsSync(`${releaseDbPath}.lock`),
      false,
      'the lock directory must be removed once the process that held it exits normally'
    );

    // A well behaved second run against the same path afterwards must
    // succeed — the lock is not permanently held just because a process
    // once opened this database.
    const output = runChild(releaseDbPath, `
      await schema.initializeDatabase();
      console.log('SECOND_RUN_OK');
      process.exit(0);
    `);
    assert.match(output, /SECOND_RUN_OK/);
  });

  test('a lock abandoned by a process that is no longer running (e.g. kill -9) is detected as stale and reclaimed', () => {
    const staleDbPath = path.join(tmpDir, 'stale-test.db');
    const staleLockDir = `${staleDbPath}.lock`;

    // A pid that is guaranteed to have already exited, to simulate a lock
    // left behind by a crashed/killed process — SIGKILL skips schema.js's
    // `process.on('exit', releaseLock)` cleanup entirely, so this is the
    // realistic shape of an orphaned lock.
    const deadProcess = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    const deadPid = deadProcess.pid;

    fs.mkdirSync(staleLockDir);
    fs.writeFileSync(path.join(staleLockDir, 'pid'), String(deadPid));

    const output = runChild(staleDbPath, `
      await schema.initializeDatabase();
      console.log('STALE_LOCK_RECLAIMED');
      process.exit(0);
    `);

    assert.match(
      output,
      /STALE_LOCK_RECLAIMED/,
      'a lock whose holder pid is no longer alive must be reclaimed, not treated as a live conflict'
    );
  });
});
