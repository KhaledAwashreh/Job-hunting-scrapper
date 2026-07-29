const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// src/server.js runs `startup()` at module scope, which unconditionally calls
// `initializeDatabase()` against the repo-root jobs.db. There is no jobs.db in
// this worktree (it is gitignored and was never created), and importing the
// module — even behind a `require.main === module` guard on `app.listen` —
// would still execute `startup()` and create one. That is a hard stop per
// this task's constraints ("do NOT create a jobs.db to make tests pass"), so
// this test targets the level the defect actually lives at: the source file
// text, plus the resumeParser cache behavior the handlers depend on.
const serverSource = fs.readFileSync(
  path.join(__dirname, '../src/server.js'),
  'utf-8'
);

const { parseResumes, clearResumeCache } = require('../src/utils/resumeParser');

describe('server.js — GET /api/resumes duplicate registration', () => {
  test('registers GET /api/resumes exactly once', () => {
    const matches = serverSource.match(/app\.get\('\/api\/resumes'/g) || [];
    assert.equal(matches.length, 1);
  });

  test('the surviving handler builds the {resumes, summary} response shape', () => {
    const handlerIndex = serverSource.indexOf("app.get('/api/resumes'");
    assert.notEqual(handlerIndex, -1);
    const handlerSlice = serverSource.slice(handlerIndex, handlerIndex + 400);
    assert.match(handlerSlice, /resumes:\s*loadedResumes/);
    assert.match(handlerSlice, /summary:\s*\{/);
    assert.match(handlerSlice, /total:\s*loadedResumes\.length/);
  });
});

describe('server.js — upload and delete handlers refresh the resume cache', () => {
  test('POST /api/resumes/upload handler references refreshLoadedResumes', () => {
    const handlerIndex = serverSource.indexOf("app.post('/api/resumes/upload'");
    assert.notEqual(handlerIndex, -1);
    const nextRouteIndex = serverSource.indexOf("app.", handlerIndex + 1);
    const handlerSlice = serverSource.slice(handlerIndex, nextRouteIndex);
    assert.match(handlerSlice, /refreshLoadedResumes/);
  });

  test("DELETE /api/resumes/:filename handler references refreshLoadedResumes", () => {
    const handlerIndex = serverSource.indexOf("app.delete('/api/resumes/:filename'");
    assert.notEqual(handlerIndex, -1);
    const nextRouteIndex = serverSource.indexOf("app.", handlerIndex + 1);
    const handlerSlice = serverSource.slice(handlerIndex, nextRouteIndex);
    assert.match(handlerSlice, /refreshLoadedResumes/);
  });

  test('handlers are async (so they can await refreshLoadedResumes)', () => {
    const uploadIndex = serverSource.indexOf("app.post('/api/resumes/upload'");
    const uploadLine = serverSource.slice(uploadIndex, uploadIndex + 200);
    assert.match(uploadLine, /async \(req, res\)/);

    const deleteIndex = serverSource.indexOf("app.delete('/api/resumes/:filename'");
    const deleteLine = serverSource.slice(deleteIndex, deleteIndex + 200);
    assert.match(deleteLine, /async \(req, res\)/);
  });

  test('resumeParser is required exactly once, at module scope (not inline in handlers)', () => {
    // The brief requires the inline `require('./utils/resumeParser')` calls
    // that used to sit inside the upload/GET handler bodies to move to the
    // single module-scope import at the top of the file.
    const requireMatches = [...serverSource.matchAll(/require\('\.\/utils\/resumeParser'\)/g)];
    assert.equal(requireMatches.length, 1);

    const moduleScopeImportIndex = serverSource.indexOf("const { parseResumes, clearResumeCache } = require('./utils/resumeParser')");
    assert.notEqual(moduleScopeImportIndex, -1);
    assert.equal(requireMatches[0].index, moduleScopeImportIndex + "const { parseResumes, clearResumeCache } = ".length);
  });
});

describe('resumeParser — cache repopulates after clearResumeCache (what refreshLoadedResumes relies on)', () => {
  test('parseResumes returns equivalent results before and after a cache clear', async () => {
    const before = await parseResumes();
    clearResumeCache();
    const after = await parseResumes();

    assert.deepEqual(
      after.map(r => r.filename),
      before.map(r => r.filename)
    );
    assert.deepEqual(
      after.map(r => r.text),
      before.map(r => r.text)
    );
    assert.equal(after.length, before.length);
  });
});
