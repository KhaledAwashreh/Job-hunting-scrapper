// Preload module (used via NODE_OPTIONS=--require) that replaces
// src/utils/resumeCache.js in the require cache with an in-memory fake
// *before* server.js ever requires it.
//
// Why this exists: server.js's RESUMES_DIR env var (see its own comment at
// server.js:40) only controls where uploads land and the traversal-check
// base for downloads. startup() calls `resumeCache.refresh()` with no
// directory argument, so it always reads from resumeParser.js's hardcoded
// default (`<repo>/data/resumes`) — a pre-existing gap unrelated to
// #23/#24/#25, out of scope to fix here. A neighboring test
// (resume-delete-traversal.e2e.js) asserts as a hard invariant that the
// repo's real data/resumes/ never exists during the e2e run, so tests here
// must not write a fixture there either. Replacing the module in the
// require cache lets #23's rate-limit test and #25's graceful-shutdown test
// exercise a real tailor request (reaching a mocked LLM call) without ever
// touching the filesystem for resumes.
const path = require('node:path');
const Module = require('node:module');

const REPO_ROOT = path.join(__dirname, '../../..');
const resumeCachePath = require.resolve(path.join(REPO_ROOT, 'src/utils/resumeCache.js'));

const filename = process.env.E2E_FAKE_RESUME_FILENAME;
const text = process.env.E2E_FAKE_RESUME_TEXT || '';

const fakeResumes = filename
  ? [{ index: 1, filename, text, isTruncated: false, originalLength: text.length }]
  : [];

const fakeModule = new Module(resumeCachePath, null);
fakeModule.filename = resumeCachePath;
fakeModule.loaded = true;
fakeModule.exports = {
  refresh: async () => fakeResumes,
  get: () => fakeResumes,
  getSummary: () => ({
    resumes: fakeResumes,
    summary: { total: fakeResumes.length, truncated: 0, warning: null },
  }),
};

require.cache[resumeCachePath] = fakeModule;
