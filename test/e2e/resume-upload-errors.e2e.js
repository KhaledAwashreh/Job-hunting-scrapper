// Issue #16 — resume upload failures (wrong file type, too large, real server
// error) all collapsed onto the same generic toast, and the upload modal
// advertised `.doc` even though multer's fileFilter (src/server.js) has never
// accepted it.
//
// Before the fix: both a rejected file type and an oversized file fell
// through express's catch-all error handler (`app.use((err, req, res, next)
// => ...)`) as a bare `500 {"error":"Internal server error"}`, and the
// frontend (profiles-tab.js) showed the identical "Failed to upload resume"
// toast for every failure mode — wrong type, too large, or a genuine server
// error were indistinguishable to the user.
//
// This suite drives the real server over HTTP (and, for the toast-visibility
// half, a real browser) against a RESUMES_DIR pointed at a throwaway temp
// directory — never the repo's data/resumes/ — the same isolation pattern as
// resume-delete-traversal.e2e.js.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  startServer,
  findBrowser,
  realDbFingerprint,
  assertRealDbUntouched,
  realResumesFingerprint,
  assertRealResumesUntouched
} = require('./helpers/harness');

const browserEnv = findBrowser();

function uploadFormData(filename, mimeType, content) {
  const fd = new FormData();
  fd.append('resume', new Blob([content], { type: mimeType }), filename);
  return fd;
}

describe('POST /api/resumes/upload — distinguishable failure reasons (issue #16)', () => {
  let server;
  let dbBefore;
  let resumesBefore;
  let resumesDir;

  before(async () => {
    dbBefore = realDbFingerprint();
    resumesBefore = realResumesFingerprint();

    resumesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-resumes-'));
    server = await startServer({ RESUMES_DIR: resumesDir });
  });

  after(async () => {
    if (server) await server.stop();
    fs.rmSync(resumesDir, { recursive: true, force: true });
  });

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('the repo\'s real data/resumes/ is never created or written to', () => {
    assertRealResumesUntouched(resumesBefore, assert);
  });

  test('a .doc upload is rejected with 400 and a specific reason, not a generic 500', async () => {
    const res = await fetch(`${server.baseUrl}/api/resumes/upload`, {
      method: 'POST',
      body: uploadFormData('resume.doc', 'application/msword', 'fake doc content'),
    });

    assert.equal(res.status, 400, '.doc must be rejected as a client error, not fall through to the 500 handler');
    const body = await res.json();
    assert.match(body.error, /invalid file type/i);
    assert.doesNotMatch(body.error, /internal server error/i);

    assert.deepEqual(fs.readdirSync(resumesDir), [], 'a rejected file type must never be written to disk');
  });

  test('an oversized upload is rejected with 400 and a size-specific reason, not a generic 500', async () => {
    const oversized = Buffer.alloc(11 * 1024 * 1024, 'x'); // over the 10MB multer limit
    const res = await fetch(`${server.baseUrl}/api/resumes/upload`, {
      method: 'POST',
      body: uploadFormData('huge-resume.txt', 'text/plain', oversized),
    });

    assert.equal(res.status, 400, 'an oversized file must be rejected as a client error, not fall through to the 500 handler');
    const body = await res.json();
    assert.match(body.error, /too large|10\s*MB/i);
    assert.doesNotMatch(body.error, /internal server error/i);
  });

  test('the .doc reason and the oversized reason are distinguishable from each other', async () => {
    const docRes = await fetch(`${server.baseUrl}/api/resumes/upload`, {
      method: 'POST',
      body: uploadFormData('another.doc', 'application/msword', 'x'),
    });
    const sizeRes = await fetch(`${server.baseUrl}/api/resumes/upload`, {
      method: 'POST',
      body: uploadFormData('another-huge.txt', 'text/plain', Buffer.alloc(11 * 1024 * 1024, 'y')),
    });

    const docBody = await docRes.json();
    const sizeBody = await sizeRes.json();
    assert.notEqual(docBody.error, sizeBody.error, 'wrong-type and too-large must produce different messages');
  });

  test('a valid, correctly-sized upload still succeeds (regression guard)', async () => {
    const res = await fetch(`${server.baseUrl}/api/resumes/upload`, {
      method: 'POST',
      body: uploadFormData('good-resume.txt', 'text/plain', 'a perfectly fine resume'),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(fs.existsSync(path.join(resumesDir, body.filename)));
  });
});

describe('Add Profile modal — upload UI (issue #16)', { skip: browserEnv.available ? false : browserEnv.reason }, () => {
  let server;
  let browser;
  let page;
  let dbBefore;
  let resumesDir;

  before(async () => {
    dbBefore = realDbFingerprint();
    resumesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-resumes-ui-'));
    server = await startServer({ RESUMES_DIR: resumesDir });
    browser = await browserEnv.chromium.launch(browserEnv.launchOptions);
    page = await browser.newPage();
    await page.goto(server.baseUrl, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="tab-profiles"]').click();
    await page.locator('[data-testid="profile-add"]').click();
    await page.waitForFunction(() => document.getElementById('profileModal').classList.contains('open'));
  });

  after(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop();
    fs.rmSync(resumesDir, { recursive: true, force: true });
  });

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('the file input only advertises types the server actually accepts', async () => {
    const accept = await page.locator('#profileResume').getAttribute('accept');
    assert.equal(accept, '.pdf,.docx,.txt', 'accept must match multer\'s fileFilter exactly — no .doc');

    const hint = await page.locator('.field-hint').first().textContent();
    assert.doesNotMatch(hint, /\bDOC\b(?!X)/, 'the hint text must not advertise .doc, which the server rejects');
  });

  test('uploading a .doc file surfaces the specific rejection reason in the toast', async () => {
    await page.locator('#profileName').fill('Toast Reason Profile');
    await page.locator('#profileJobTypes').selectOption(['Backend']);
    await page.locator('#profileResume').setInputFiles({
      name: 'resume.doc',
      mimeType: 'application/msword',
      buffer: Buffer.from('fake doc content'),
    });

    await page.locator('#profileForm button[type="submit"]').click();
    await page.waitForSelector('.error');
    const toastText = await page.locator('.error').first().textContent();

    assert.match(toastText, /invalid file type/i);
    assert.notEqual(toastText.trim(), 'Failed to upload resume',
      'the old generic message must not survive as the shown text');

    // Modal stays open on failure — clean state for the next test.
    assert.equal(await page.locator('#profileModal').evaluate(el => el.classList.contains('open')), true);
  });

  test('uploading an oversized file surfaces a different, size-specific reason in the toast', async () => {
    await page.locator('#profileResume').setInputFiles({
      name: 'huge.txt',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(11 * 1024 * 1024, 'z'),
    });

    await page.locator('#profileForm button[type="submit"]').click();
    await page.waitForFunction(() => {
      const toasts = document.querySelectorAll('.error');
      return toasts.length > 0 && /too large|10\s*MB/i.test(toasts[toasts.length - 1].textContent);
    });

    const toastText = await page.locator('.error').last().textContent();
    assert.match(toastText, /too large|10\s*MB/i);
  });
});
