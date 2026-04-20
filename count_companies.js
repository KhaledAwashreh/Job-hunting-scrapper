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
  const companies = db.exec('SELECT id, name, career_url, platform, active FROM companies');
  if (companies.length === 0) {
    console.log('No companies table or no rows');
  } else {
    console.log('Companies count:', companies[0].values.length);
    console.log('Rows:');
    companies[0].values.forEach(row => console.log(row));
  }
})();