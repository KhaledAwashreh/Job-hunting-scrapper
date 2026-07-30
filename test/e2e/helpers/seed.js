// Seeds a deterministic dataset into an isolated database.
//
// Run as a child process with JOBS_DB_PATH pointing at the temp file, so the
// seeding happens in the same process that owns that database — sql.js holds the
// whole DB in memory and serializes on write, so a second process writing the
// same file would clobber it.

const path = require('path');

const COMPANIES = [
  { name: 'Nimbus Data BV', country: 'Netherlands', url: 'https://nimbus.example/careers', platform: 'greenhouse' },
  { name: 'Shannon Systems', country: 'Ireland', url: 'https://shannon.example/jobs', platform: 'lever' },
];

// One position per target country, one deliberately non-target, and one awkward
// row (no score, empty location) to exercise the empty-state rendering.
const POSITIONS = [
  { hash: 'e2e-1', company: 0, country: 'Netherlands', title: 'Java Backend Engineer',  link: 'https://nimbus.example/jobs/1',  score: 88, jobType: 'Backend' },
  { hash: 'e2e-2', company: 0, country: 'Portugal',    title: 'Platform Engineer',      link: 'https://nimbus.example/jobs/2',  score: 74, jobType: 'Platform' },
  { hash: 'e2e-3', company: 1, country: 'Ireland',     title: 'Backend Engineer',       link: 'https://shannon.example/jobs/3', score: 61, jobType: 'Backend' },
  { hash: 'e2e-4', company: 1, country: 'Spain',       title: 'AI/ML Engineer',         link: 'https://shannon.example/jobs/4', score: 45, jobType: 'AI' },
  { hash: 'e2e-5', company: 1, country: 'United States', title: 'Sales Engineer',       link: 'https://shannon.example/jobs/5', score: 12, jobType: 'Sales' },
];

async function seed() {
  const { initializeDatabase } = require(path.join(__dirname, '../../../src/db/schema'));
  await initializeDatabase();

  const q = require(path.join(__dirname, '../../../src/db/queries'));

  const companyIds = COMPANIES.map(c => q.addCompany(c.name, c.country, c.url, c.platform));

  for (const p of POSITIONS) {
    q.addPosition(
      p.hash, companyIds[p.company], p.country, p.title,
      `Description for ${p.title}`, 'Some qualifications', '2026-07-01',
      p.link, p.jobType, ['Remote'], ['3-5'], ['Mid'], p.score, 1
    );
  }

  const runId = q.createScrapeRun('2026-07-29T10:00:00.000Z');
  q.updateScrapeRun(runId, '2026-07-29T10:04:00.000Z', COMPANIES.length, POSITIONS.length, POSITIONS.length, null);

  q.addProfile('Java Backend Engineer', '', ['Java Backend Engineer'], null, 'Mid', [], ['Remote']);
  q.addProfile('Platform Engineer', '', ['Platform Engineer'], null, null, [], []);

  return { companies: COMPANIES.length, positions: POSITIONS.length };
}

if (require.main === module) {
  seed()
    .then(r => { console.log(JSON.stringify(r)); process.exit(0); })
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { seed, COMPANIES, POSITIONS };
