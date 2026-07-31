const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// src/server.js runs `startup()` at module scope, which unconditionally calls
// `initializeDatabase()` against the repo-root jobs.db. There is no jobs.db in
// this worktree (it is gitignored and was never created), and importing the
// module — even behind a `require.main === module` guard on `app.listen` —
// would still execute `startup()` and create one. Separately, every route
// other than /health is gated by a `dbInitialized` middleware (src/server.js
// ~104-110) that returns 503 until `startup()` finishes, so even a guarded
// listener would only ever exercise the 503 branch in a request driven by
// supertest, not real handler behavior. Both are independent reasons this
// file can't drive the app over HTTP; see task-4-report.md for the full
// writeup. This file targets the level the defect actually lives at: the
// source file text, confirming the single registration and the wiring from
// both mutating handlers into the resume cache. The actual cache *behavior*
// (does refresh really pick up new/removed files, does the summary shape
// match) is covered by real, file-driven tests in
// test/resume-cache.test.js against src/utils/resumeCache.js directly.
const serverSource = fs.readFileSync(
  path.join(__dirname, '../src/server.js'),
  'utf-8'
);

describe('server.js — GET /api/resumes duplicate registration', () => {
  test('registers GET /api/resumes exactly once', () => {
    const matches = serverSource.match(/app\.get\('\/api\/resumes'/g) || [];
    assert.equal(matches.length, 1);
  });

  test('the surviving handler serves resumeCache.getSummary()', () => {
    const handlerIndex = serverSource.indexOf("app.get('/api/resumes'");
    assert.notEqual(handlerIndex, -1);
    const handlerSlice = serverSource.slice(handlerIndex, handlerIndex + 200);
    assert.match(handlerSlice, /resumeCache\.getSummary\(\)/);
  });
});

describe('server.js — upload and delete handlers refresh the resume cache', () => {
  test('POST /api/resumes/upload handler calls resumeCache.refresh()', () => {
    const handlerIndex = serverSource.indexOf("app.post('/api/resumes/upload'");
    assert.notEqual(handlerIndex, -1);
    const nextRouteIndex = serverSource.indexOf("app.", handlerIndex + 1);
    const handlerSlice = serverSource.slice(handlerIndex, nextRouteIndex);
    assert.match(handlerSlice, /resumeCache\.refresh\(\)/);
  });

  test('DELETE /api/resumes/:filename handler calls resumeCache.refresh()', () => {
    const handlerIndex = serverSource.indexOf("app.delete('/api/resumes/:filename'");
    assert.notEqual(handlerIndex, -1);
    const nextRouteIndex = serverSource.indexOf("app.", handlerIndex + 1);
    const handlerSlice = serverSource.slice(handlerIndex, nextRouteIndex);
    assert.match(handlerSlice, /resumeCache\.refresh\(\)/);
  });

  test('handlers are async (so they can await resumeCache.refresh())', () => {
    const uploadIndex = serverSource.indexOf("app.post('/api/resumes/upload'");
    const uploadLine = serverSource.slice(uploadIndex, uploadIndex + 200);
    assert.match(uploadLine, /async \(req, res\)/);

    const deleteIndex = serverSource.indexOf("app.delete('/api/resumes/:filename'");
    const deleteLine = serverSource.slice(deleteIndex, deleteIndex + 200);
    assert.match(deleteLine, /async \(req, res\)/);
  });

  test('the delete handler refreshes the cache after fs.unlinkSync, before responding', () => {
    const handlerIndex = serverSource.indexOf("app.delete('/api/resumes/:filename'");
    const nextRouteIndex = serverSource.indexOf("app.", handlerIndex + 1);
    const handlerSlice = serverSource.slice(handlerIndex, nextRouteIndex);

    const unlinkIndex = handlerSlice.indexOf('fs.unlinkSync');
    const refreshIndex = handlerSlice.indexOf('resumeCache.refresh()');
    const responseIndex = handlerSlice.indexOf('res.json({ success: true, deleted: filename })');

    assert.ok(unlinkIndex !== -1 && refreshIndex !== -1 && responseIndex !== -1);
    assert.ok(unlinkIndex < refreshIndex, 'refresh must happen after unlink');
    assert.ok(refreshIndex < responseIndex, 'refresh must happen before the response is sent');
  });
});

describe('server.js — resume cache logic lives in its own module', () => {
  test('src/server.js has no leftover direct references to resumeParser (moved to resumeCache)', () => {
    assert.doesNotMatch(serverSource, /require\('\.\/utils\/resumeParser'\)/);
  });

  test('resumeCache is required exactly once, at module scope', () => {
    const requireMatches = [...serverSource.matchAll(/require\('\.\/utils\/resumeCache'\)/g)];
    assert.equal(requireMatches.length, 1);

    const moduleScopeImportIndex = serverSource.indexOf("const resumeCache = require('./utils/resumeCache')");
    assert.notEqual(moduleScopeImportIndex, -1);
  });

  test('no leftover module-scope loadedResumes variable (state now lives in resumeCache)', () => {
    assert.doesNotMatch(serverSource, /let loadedResumes/);
  });
});

// #46: validateProfileInput (manual profile create/edit via the UI) must reject an
// unrecognized seniority_level rather than silently accepting it — the same defect
// class as the CSV path, covered behaviorally in test/csv-parser.test.js. server.js
// can't be require()'d in tests (see file-level comment above), so this is verified
// at the source level: the VALID_SENIORITY list is imported from csvParser and the
// validator rejects values not in it.
describe('server.js — validateProfileInput rejects invalid seniority_level (#46)', () => {
  test('imports VALID_SENIORITY from csvParser', () => {
    assert.match(serverSource, /VALID_SENIORITY\s*}\s*=\s*require\('\.\/utils\/csvParser'\)/);
  });

  test('validateProfileInput checks seniority_level against VALID_SENIORITY and 400s on mismatch', () => {
    const fnIndex = serverSource.indexOf('const validateProfileInput');
    assert.notEqual(fnIndex, -1);
    const endIndex = serverSource.indexOf('\n};', fnIndex) + 3;
    const fnSlice = serverSource.slice(fnIndex, endIndex);
    assert.match(fnSlice, /VALID_SENIORITY\.includes\(seniority_level\.trim\(\)\.toLowerCase\(\)\)/);
    assert.match(fnSlice, /status\(400\)/);
  });
});
