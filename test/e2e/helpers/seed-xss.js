// Seeds a database with hostile payload strings, mirroring exactly the kind
// of value a scraped third-party careers page can put in a job title or
// company name (issue #9 / U1.1). Run as a child process, same pattern as
// seed.js — sql.js keeps the whole DB in memory and rewrites the file on
// save, so this must finish and exit before the server opens the file.

const path = require('path');

// Each payload fires a distinct global flag if it ever executes as markup.
const COMPANY_PAYLOAD = '<img src=x onerror="window.__companyXss=true">Payload Co';
const POSITION_TITLE_PAYLOAD = '<img src=x onerror="window.__positionXss=true">Payload Engineer';
const POSITION_LINK_PAYLOAD = 'javascript:window.__hrefXss=true';
const PROFILE_NAME_PAYLOAD = '<img src=x onerror="window.__profileXss=true">Payload Profile';

async function seed() {
  const { initializeDatabase } = require(path.join(__dirname, '../../../src/db/schema'));
  await initializeDatabase();

  const q = require(path.join(__dirname, '../../../src/db/queries'));

  const companyId = q.addCompany(COMPANY_PAYLOAD, 'Netherlands', 'https://payload.example/careers', 'custom');

  q.addPosition(
    'e2e-xss-1', companyId, 'Netherlands', POSITION_TITLE_PAYLOAD,
    'Description', 'Qualifications', '2026-07-01',
    POSITION_LINK_PAYLOAD, 'Backend', ['Remote'], ['3-5'], ['Mid'], 77, 1
  );

  q.addProfile(PROFILE_NAME_PAYLOAD, 'resume.pdf', ['Backend'], null, 'Mid', [], ['Remote']);

  return { companyId };
}

if (require.main === module) {
  seed()
    .then(r => { console.log(JSON.stringify(r)); process.exit(0); })
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = {
  seed,
  COMPANY_PAYLOAD,
  POSITION_TITLE_PAYLOAD,
  POSITION_LINK_PAYLOAD,
  PROFILE_NAME_PAYLOAD,
};
