// Seeds a small dataset with DIVERSE job_type/location_type/seniority_level
// values, one per axis pair, so tests can prove selecting a filter actually
// narrows the rendered list rather than merely being present.
//
// test/e2e/helpers/seed.js (the shared fixture) seeds every position with the
// same location_type (['Remote']) and seniority_level (['Mid']), which is
// fine for proving Location/Level render correctly (positions-parse-array.e2e.js)
// but useless for proving a filter actually narrows anything on those two
// axes — selecting the one value present would never exclude a row. This
// fixture varies all three axes independently so a real before/after
// narrowing assertion is possible.
//
// Run as a child process with JOBS_DB_PATH pointing at the temp file, same
// contract as seed.js (see that file's header comment).

const path = require('path');

const COMPANIES = [
  { name: 'Filteredge Labs', country: 'Netherlands', url: 'https://filteredge.example/careers', platform: 'greenhouse' },
];

const POSITIONS = [
  { hash: 'filter-1', company: 0, country: 'Netherlands', title: 'Remote Backend Engineer',        link: 'https://filteredge.example/jobs/1', score: 80, jobType: 'Backend',  location: ['Remote'], years: ['3-5'], level: ['Mid'] },
  { hash: 'filter-2', company: 0, country: 'Netherlands', title: 'Onsite Platform Engineer',       link: 'https://filteredge.example/jobs/2', score: 70, jobType: 'Platform', location: ['Onsite'], years: ['5-8'], level: ['Senior'] },
  { hash: 'filter-3', company: 0, country: 'Netherlands', title: 'Remote Senior Backend Engineer', link: 'https://filteredge.example/jobs/3', score: 65, jobType: 'Backend',  location: ['Remote'], years: ['5-8'], level: ['Senior'] },
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
      p.link, p.jobType, p.location, p.years, p.level, p.score, 1
    );
  }

  return { companies: COMPANIES.length, positions: POSITIONS.length };
}

if (require.main === module) {
  seed()
    .then(r => { console.log(JSON.stringify(r)); process.exit(0); })
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { seed, COMPANIES, POSITIONS };
