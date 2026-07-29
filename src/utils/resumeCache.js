// In-memory cache of parsed resumes, backing GET /api/resumes and the tailor
// endpoints. Pulled out of src/server.js so it has no database dependency
// and no HTTP listener, which lets it be imported directly in tests.
const { parseResumes, clearResumeCache } = require('./resumeParser');

let loadedResumes = [];

// Re-parse resumes from disk and replace the cached list. Callers (startup,
// and the upload/delete handlers) should call this any time the resume files
// on disk change, so there is exactly one code path that populates the
// cache. `dir` is optional and defaults to resumeParser's real resumes
// directory; tests can pass a temp directory instead.
async function refresh(dir) {
  clearResumeCache();
  loadedResumes = await parseResumes(dir);
  return loadedResumes;
}

// The current cached list, without re-reading from disk.
function get() {
  return loadedResumes;
}

// The {resumes, summary} shape served by GET /api/resumes.
function getSummary() {
  const truncatedCount = loadedResumes.filter(r => r.isTruncated).length;
  return {
    resumes: loadedResumes,
    summary: {
      total: loadedResumes.length,
      truncated: truncatedCount,
      warning: truncatedCount > 0 ? `${truncatedCount} resume(s) truncated` : null
    }
  };
}

module.exports = { refresh, get, getSummary };
