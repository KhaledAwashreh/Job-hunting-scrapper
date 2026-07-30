// Seeds a single profile with a real (non-empty) resume_file, so tests can
// prove an edit that never touches the file input still saves and keeps the
// resume on record (issue #14).
//
// The shared seed.js fixture seeds its two profiles with resume_file: '' —
// useless here, since the server's validateProfileInput (server.js) rejects
// an empty resume_file with 400 regardless of what the frontend sends, so a
// test built on those profiles could pass or fail for the wrong reason.
//
// Run as a child process with JOBS_DB_PATH pointing at the temp file, same
// contract as seed.js (see that file's header comment).

const path = require('path');

const PROFILE = {
  name: 'Backend Profile',
  resume_file: 'existing-resume.pdf',
  job_types: ['Backend'],
  secondary_category: null,
  seniority_level: 'Mid',
  years_of_experience: ['3-5'],
  work_location_preference: ['Remote'],
};

async function seed() {
  const { initializeDatabase } = require(path.join(__dirname, '../../../src/db/schema'));
  await initializeDatabase();

  const q = require(path.join(__dirname, '../../../src/db/queries'));

  const profileId = q.addProfile(
    PROFILE.name, PROFILE.resume_file, PROFILE.job_types, PROFILE.secondary_category,
    PROFILE.seniority_level, PROFILE.years_of_experience, PROFILE.work_location_preference
  );

  return { profiles: 1, profileId };
}

if (require.main === module) {
  seed()
    .then(r => { console.log(JSON.stringify(r)); process.exit(0); })
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { seed, PROFILE };
