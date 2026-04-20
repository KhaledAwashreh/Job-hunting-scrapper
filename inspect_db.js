const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
(async () => {
  const SQL = await initSqlJs();
  const dbPath = path.join(__dirname, 'jobs.db');
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