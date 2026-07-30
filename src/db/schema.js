const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// sql.js is a pure JavaScript implementation of SQLite
// No native compilation required - works on all platforms
// Defaults to the app's real database. JOBS_DB_PATH overrides it so tests can
// point at an isolated temp file — the real jobs.db must never be opened,
// written or created by a test run.
const dbPath = process.env.JOBS_DB_PATH || path.join(__dirname, '../../jobs.db');
let database = null;

// ---------------------------------------------------------------------------
// #26 — cross-process write lock
//
// sql.js has no concept of a shared file: every write is a full in-memory
// `export()` + `fs.writeFileSync()` of the whole database, with no locking,
// merge, or version check. If a second OS process (e.g. bulk-add-companies.js
// run while the server is up, or an accidental second server instance) also
// opens the same file, whichever process saves last wins in full and the
// other process's entire session of writes disappears silently.
//
// A per-write lock would not actually fix this: process B may have already
// read a stale snapshot into memory before process A's lock is ever taken, so
// locking only the `writeFileSync` step cannot prevent the lost update. What
// it CAN do is turn the failure mode from "silent data loss" into "fails
// loudly at startup" — so instead we hold one advisory lock for the whole
// lifetime of the process's database session (acquired in
// initializeDatabase(), released on process exit), implemented with
// `fs.mkdirSync`, which is atomic on every platform Node supports (no new
// dependency, per the MVP constraint that ruled out proper-lockfile). A
// second process trying to open the same database while the lock is held
// gets a clear error instead of silently clobbering the first process's
// writes.
//
// The lock directory stores the holder's pid so a crashed process (e.g.
// `kill -9`, which skips our `process.on('exit', ...)` cleanup) doesn't wedge
// the database forever: the next process to try locking it checks whether
// that pid is still alive (`process.kill(pid, 0)`, a built-in Node primitive
// — no dependency) and reclaims the lock if not.
const lockPath = `${dbPath}.lock`;
let lockAcquired = false;

function isPidAlive(pid) {
  if (!pid || Number.isNaN(pid)) return false;
  try {
    process.kill(pid, 0); // signal 0: existence check only, sends nothing
    return true;
  } catch (err) {
    // EPERM means the pid exists but is owned by another user — treat that
    // as "alive" (we can't prove it's dead, so don't steal the lock).
    return err.code === 'EPERM';
  }
}

function acquireLock() {
  if (lockAcquired) return; // already held by this process (e.g. re-init in tests)
  try {
    fs.mkdirSync(lockPath);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;

    const pidFile = path.join(lockPath, 'pid');
    let holderPid = null;
    try {
      holderPid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
    } catch (_) {
      // missing/corrupt pid file — treat as an orphaned lock below
    }

    if (isPidAlive(holderPid)) {
      throw new Error(
        `Database "${dbPath}" is already in use by another process (pid ${holderPid}). ` +
        `sql.js rewrites the whole database file on every save with no merge, so two ` +
        `writers can silently clobber each other's changes. Stop the other process ` +
        `before starting this one, or if it is not actually running, delete "${lockPath}" and retry.`
      );
    }

    // Orphaned lock (holder process is gone) — reclaim it.
    fs.rmSync(lockPath, { recursive: true, force: true });
    fs.mkdirSync(lockPath);
  }
  fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid));
  lockAcquired = true;
}

function releaseLock() {
  if (!lockAcquired) return;
  try {
    fs.rmSync(lockPath, { recursive: true, force: true });
  } catch (_) {
    // best effort — process is exiting anyway
  }
  lockAcquired = false;
}

// Sync fs calls are safe inside an 'exit' handler; this is the safety net for
// graceful shutdowns and process.exit() calls (SIGKILL cannot be caught by
// design — that's what the pid-liveness check in acquireLock() is for).
process.on('exit', releaseLock);

// ---------------------------------------------------------------------------
// #28 — batched saves
//
// runWrite() used to call saveDatabase() after every single INSERT/UPDATE,
// and saveDatabase() serializes the ENTIRE in-memory database on every call.
// During a scrape, addPosition() runs once per scraped job in a tight loop,
// so save cost (and therefore scrape time) grew with the square of the
// database size, not linearly with new positions.
//
// saveDatabase() now respects an in-memory "batching" flag: while a batch is
// open, calls just mark the database dirty instead of writing, and the
// actual export()+writeFileSync() is deferred to flushDatabase() (or the
// automatic flush endBatch() performs). Outside a batch (the default —
// covers every existing caller: server request handlers, addCompany,
// createScrapeRun, etc.) saveDatabase() writes immediately, exactly as
// before, so nothing about normal single-write durability changes.
// Bulk-write callers (see runScraper() in orchestrator.js) opt in with
// beginBatch()/endBatch() around their write loop.
let batching = false;
let dirty = false;

async function initializeDatabase() {
  acquireLock();
  const SQL = await initSqlJs();

  let db;
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS companies (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      country       TEXT NOT NULL,
      career_url    TEXT NOT NULL,
      platform      TEXT DEFAULT 'custom',
      platform_slug TEXT,
      api_url       TEXT,
      active        INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now'))
    );
  `);

  // Add platform_slug and api_url columns to existing companies tables
  try { db.run(`ALTER TABLE companies ADD COLUMN platform_slug TEXT`); } catch (e) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
      console.error('Error adding platform_slug column:', e.message);
    }
  }
  try { db.run(`ALTER TABLE companies ADD COLUMN api_url TEXT`); } catch (e) {
    if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
      console.error('Error adding api_url column:', e.message);
    }
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS positions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      hash            TEXT UNIQUE NOT NULL,
      company_id      INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      country         TEXT,
      title           TEXT,
      description     TEXT,
      qualifications  TEXT,
      publish_date    TEXT,
      link            TEXT,
      job_type        TEXT,
      location_type   TEXT DEFAULT '[]',
      years_experience TEXT DEFAULT '[]',
      seniority_level TEXT DEFAULT '[]',
      match_score     REAL DEFAULT 0,
      matched_resume  INTEGER,
      status          TEXT DEFAULT 'new',
      created_at      TEXT DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      resume_file     TEXT NOT NULL,
      job_types       TEXT NOT NULL,
      seniority_level TEXT,
      secondary_category TEXT,
      years_of_experience TEXT DEFAULT '[]',
      work_location_preference TEXT DEFAULT '[]',
      created_at      TEXT DEFAULT (datetime('now'))
    );
  `);

    // Add seniority_level column to existing profiles table (for databases created before this column existed)
    try {
      db.run(`ALTER TABLE profiles ADD COLUMN seniority_level TEXT`);
    } catch (e) {
      // Only suppress "column already exists" errors, log others
      if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
        console.error('Error adding seniority_level column:', e.message);
      }
    }
    // Add years_of_experience column if missing
    try {
      db.run(`ALTER TABLE profiles ADD COLUMN years_of_experience TEXT DEFAULT '[]'`);
    } catch (e) {
      // Only suppress "column already exists" errors, log others
      if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
        console.error('Error adding years_of_experience column:', e.message);
      }
    }

  db.run(`
    CREATE TABLE IF NOT EXISTS position_profiles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
      profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      match_score INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(position_id, profile_id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS scrape_runs (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at          TEXT,
      finished_at         TEXT,
      companies_visited   INTEGER DEFAULT 0,
      positions_found     INTEGER DEFAULT 0,
      positions_new       INTEGER DEFAULT 0,
      errors_json         TEXT DEFAULT '[]'
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS app_preferences (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Tailored resumes table for resume customization feature
  db.run(`
    CREATE TABLE IF NOT EXISTS tailored_resumes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id     INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
      profile_id      INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      base_resume_text TEXT NOT NULL,
      tailored_text   TEXT NOT NULL,
      version         INTEGER DEFAULT 1,
      created_at      TEXT DEFAULT (datetime('now')),
      UNIQUE(position_id, profile_id, version)
    );
  `);

  database = db;
  saveDatabase();
}

function getDatabase() {
  if (!database) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return database;
}

function writeToDisk() {
  if (database) {
    const data = database.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
  dirty = false;
}

function saveDatabase() {
  if (!database) return;
  dirty = true;
  if (batching) return; // deferred — flushDatabase()/endBatch() will write it
  writeToDisk();
}

// Forces any pending batched write to disk right now. Safe to call whether or
// not a batch is open, and a no-op if nothing is dirty.
function flushDatabase() {
  if (dirty) writeToDisk();
}

// Enter batched-write mode: saveDatabase() calls become cheap (just set the
// dirty flag) until endBatch() (or an explicit flushDatabase()) runs. Meant
// for bulk write loops — see runScraper() in orchestrator.js, which also
// calls flushDatabase() at natural checkpoints (once per company) so a crash
// mid-run only loses that company's unsaved positions, not the whole run.
// Not reentrant — callers pair it with a try/finally endBatch().
function beginBatch() {
  batching = true;
}

// Leaves batched-write mode and flushes any pending write, guaranteeing
// nothing is left silently deferred once the batch caller returns.
function endBatch() {
  batching = false;
  flushDatabase();
}

module.exports = {
  initializeDatabase,
  getDatabase,
  saveDatabase,
  flushDatabase,
  beginBatch,
  endBatch,
  dbPath
};
