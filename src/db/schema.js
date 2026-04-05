const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../../jobs.db');
let database = null;

async function initializeDatabase() {
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
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      country     TEXT NOT NULL,
      career_url  TEXT NOT NULL,
      platform    TEXT DEFAULT 'custom',
      active      INTEGER DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS positions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      hash            TEXT UNIQUE NOT NULL,
      company_id      INTEGER REFERENCES companies(id),
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
      match_score     INTEGER DEFAULT 0,
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
      secondary_category TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );
  `);

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

  database = db;
  saveDatabase();
}

function getDatabase() {
  if (!database) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return database;
}

function saveDatabase() {
  if (database) {
    const data = database.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
}

module.exports = {
  initializeDatabase,
  getDatabase,
  saveDatabase,
  dbPath
};
