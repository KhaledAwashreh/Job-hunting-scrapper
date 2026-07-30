// Seeds a single company/position/profile combo suitable for exercising
// POST /api/positions/:positionId/tailor. Mirrors the reasoning in
// tailored-resume-pdf-download.e2e.js: sql.js keeps the whole database in
// memory and rewrites the file on save, so seeding must run to completion
// (and the process exit) before the server under test opens the same file.
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '../../..');

// `resumeFile` must match a filename the server will actually load from its
// resumes directory (see resumeParser.js), so the caller is responsible for
// writing that file first.
//
// `positionCount` seeds that many distinct positions sharing one profile
// (each with its own hash/link so addPosition's UNIQUE(hash) is happy).
// Concurrency tests (e.g. #23's rate-limit hammering) need one position per
// concurrent request: tailored_resumes has a UNIQUE(position_id, profile_id,
// version) constraint, and getNextVersionForPositionProfile()/
// addTailoredResume() are not atomic, so N concurrent requests against the
// *same* position+profile race to compute "next version" and collide — a
// real but separate/pre-existing concurrency bug, out of scope for
// #23/#24/#25, which a rate-limit test must simply avoid tripping over.
function seedTailorFixture(dbPath, { resumeFile, positionCount = 1 } = {}) {
  const schemaPath = path.join(REPO_ROOT, 'src/db/schema.js');
  const queriesPath = path.join(REPO_ROOT, 'src/db/queries.js');
  const script = `
    const { initializeDatabase } = require(${JSON.stringify(schemaPath)});
    const q = require(${JSON.stringify(queriesPath)});
    (async () => {
      await initializeDatabase();
      const companyId = q.addCompany('Acme BV', 'Netherlands', 'https://acme.example/careers', 'custom');
      const positionIds = [];
      for (let i = 0; i < ${positionCount}; i++) {
        const posResult = q.addPosition(
          'tailor-e2e-' + i, companyId, 'Netherlands', 'Backend Engineer',
          'desc', 'quals', '2026-07-01', 'https://acme.example/jobs/' + i,
          'Backend', ['Remote'], ['3-5'], ['Mid'], 80, null
        );
        positionIds.push(posResult.id);
      }
      const profileId = q.addProfile('Tailor Test Profile', ${JSON.stringify(resumeFile)}, ['Backend Engineer'], null, 'Mid', [], []);
      process.stdout.write(JSON.stringify({ positionId: positionIds[0], positionIds, profileId }));
      process.exit(0);
    })().catch(err => { console.error(err); process.exit(1); });
  `;

  return new Promise((resolve, reject) => {
    const seeder = spawn(process.execPath, ['-e', script], {
      cwd: REPO_ROOT,
      env: { ...process.env, JOBS_DB_PATH: dbPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    seeder.stdout.on('data', d => { out += d; });
    seeder.stderr.on('data', d => { err += d; });
    seeder.on('exit', code => {
      if (code === 0) return resolve(JSON.parse(out.trim() || '{}'));
      reject(new Error(`seeding failed (exit ${code}):\n${err}`));
    });
  });
}

module.exports = { seedTailorFixture };
