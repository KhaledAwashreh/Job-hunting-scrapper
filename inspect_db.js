const initSqlJs = require('sql.js');
const fs = require('fs');
// Reuse schema.js's dbPath instead of re-deriving the path here, so this
// script honours JOBS_DB_PATH with exactly the same precedence as the rest
// of the app — one source of truth for "where is the database", not two.
const { dbPath } = require('./src/db/schema');
(async () => {
  const SQL = await initSqlJs();
  if (!fs.existsSync(dbPath)) {
    console.log('Database not found');
    return;
  }
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);
  const pos = db.exec('SELECT COUNT(*) as cnt FROM positions');
  const runs = db.exec('SELECT COUNT(*) as cnt FROM scrape_runs');
  console.log('Positions count:', pos[0].values[0][0]);
  console.log('Scrape runs count:', runs[0].values[0][0]);
})();