// A4.1 — DELETE /api/resumes/:filename must not allow path traversal.
//
// Before the fix, server.js built the target path with
// `path.join(__dirname, '../data/resumes', filename)` and unlinked it with no
// containment check at all. A single URL-encoded '../' segment let a caller
// delete any file the Node process could reach — reproduced in the review
// against a canary nine directories outside the repo.
//
// This suite drives the real server over HTTP against a RESUMES_DIR pointed
// at a throwaway temp directory (never the repo's data/resumes/), with a
// canary file living in a second, unrelated temp directory that a successful
// traversal would be able to reach.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const {
  startServer,
  realDbFingerprint,
  assertRealDbUntouched,
  realResumesFingerprint,
  assertRealResumesUntouched
} = require('./helpers/harness');

// fetch()/curl both normalise a literal '..' path segment away client-side
// (per the WHATWG URL spec's dot-segment removal) before the request ever
// hits the wire, which would hide whether the server itself rejects it. A
// raw http.request with a hand-built `path` string bypasses that and sends
// the literal bytes, the way a non-browser client (curl --path-as-is, a
// script, another service) legitimately could.
function rawRequest(port, rawPath, method = 'DELETE') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('DELETE /api/resumes/:filename — path traversal containment (A4.1)', () => {
  let server;
  let dbBefore;
  let resumesBefore;
  let resumesDir;
  let canaryDir;
  let canaryFile;
  const canaryContent = 'do not delete me';

  before(async () => {
    dbBefore = realDbFingerprint();
    resumesBefore = realResumesFingerprint();

    resumesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-resumes-'));
    fs.writeFileSync(path.join(resumesDir, 'resume.txt'), 'legit resume content');

    // Deliberately outside resumesDir, simulating the "canary nine directories
    // outside the repo" from the review's reproduction.
    canaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-canary-'));
    canaryFile = path.join(canaryDir, 'target.txt');
    fs.writeFileSync(canaryFile, canaryContent);

    server = await startServer({ RESUMES_DIR: resumesDir });
  });

  after(async () => {
    if (server) await server.stop();
    fs.rmSync(resumesDir, { recursive: true, force: true });
    fs.rmSync(canaryDir, { recursive: true, force: true });
  });

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('the repo\'s real data/resumes/ is never created or written to', () => {
    assertRealResumesUntouched(resumesBefore, assert);
  });

  test('encoded ../ traversal to a file outside the resumes dir is rejected with 400, and the file survives', async () => {
    const relTraversal = path.relative(resumesDir, canaryFile); // e.g. ../../tmp/xyz/target.txt
    const encoded = relTraversal.split(path.sep).map(encodeURIComponent).join('%2F');

    const res = await fetch(`${server.baseUrl}/api/resumes/${encoded}`, { method: 'DELETE' });
    assert.equal(res.status, 400, 'traversal must be rejected with 400, not 404 (would be indistinguishable from a missing file) or 200');
    const body = await res.json();
    assert.match(body.error, /invalid/i);

    assert.equal(fs.existsSync(canaryFile), true, 'canary file outside the resumes dir must survive');
    assert.equal(fs.readFileSync(canaryFile, 'utf8'), canaryContent);
  });

  test('a raw (unencoded) ".." path segment is rejected with 400', async () => {
    const { status, body } = await rawRequest(server.port, '/api/resumes/..');
    assert.equal(status, 400);
    assert.match(JSON.parse(body).error, /invalid/i);
  });

  test('an absolute path (encoded into the single :filename segment) is rejected with 400, and the file survives', async () => {
    const segments = canaryFile.split(path.sep).filter(Boolean).map(encodeURIComponent).join('%2F');
    const res = await fetch(`${server.baseUrl}/api/resumes/%2F${segments}`, { method: 'DELETE' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /invalid/i);
    assert.equal(fs.existsSync(canaryFile), true, 'canary file must survive an absolute-path attempt');
  });

  test('a null byte in the filename is rejected with 400, not an uncaught exception', async () => {
    const res = await fetch(`${server.baseUrl}/api/resumes/resume.txt%00.jpg`, { method: 'DELETE' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /invalid/i);
  });

  test('a traversal attempt (400) is distinguishable from a genuinely missing file (404)', async () => {
    const missing = await fetch(`${server.baseUrl}/api/resumes/does-not-exist.txt`, { method: 'DELETE' });
    assert.equal(missing.status, 404);
  });

  test('a legitimate filename still deletes (200) and is actually removed from disk', async () => {
    const target = path.join(resumesDir, 'resume.txt');
    assert.equal(fs.existsSync(target), true, 'setup sanity: legit file should exist before delete');

    const res = await fetch(`${server.baseUrl}/api/resumes/resume.txt`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.deleted, 'resume.txt');

    assert.equal(fs.existsSync(target), false, 'the legitimate file must actually be gone from disk');
  });
});
