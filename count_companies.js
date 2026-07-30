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
  const companies = db.exec('SELECT id, name, career_url, platform, active FROM companies');
  if (companies.length === 0) {
    console.log('No companies table or no rows');
  } else {
    console.log('Companies count:', companies[0].values.length);
    console.log('Rows:');
    companies[0].values.forEach(row => console.log(row));
  }
})();