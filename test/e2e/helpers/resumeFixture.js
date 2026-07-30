// Builds the env vars a spawned server needs to have resumeCache.get()
// return a fixed, in-memory fake resume — see fakeResumeCachePreload.js for
// why this doesn't just write a file into RESUMES_DIR (that env var isn't
// actually wired into resumeCache.refresh() at startup, and a sibling test
// asserts the repo's real data/resumes/ must never exist during e2e runs).
const path = require('node:path');

const PRELOAD_PATH = path.join(__dirname, 'fakeResumeCachePreload.js');

// Returns env vars to merge into a spawned server's `env`. `filename` must
// match the `resume_file` of whatever profile the test seeds.
function resumeFixtureEnv(filename, text) {
  return {
    NODE_OPTIONS: `--require ${PRELOAD_PATH}`,
    E2E_FAKE_RESUME_FILENAME: filename,
    E2E_FAKE_RESUME_TEXT: text,
  };
}

module.exports = { resumeFixtureEnv };
