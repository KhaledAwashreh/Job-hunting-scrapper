// Issue #24 — static assets served by express.static (styles.css,
// countries.json, and anything else under public/) shipped without the
// Content-Security-Policy / X-Frame-Options / X-Content-Type-Options
// headers that every other response carries, because express.static was
// registered before the security-header middleware and short-circuited the
// response first.
//
// The fix moves the security-header middleware ahead of express.static.
// This suite proves, against a real running server, that static assets now
// carry the same three headers as '/' and '/api/health'.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, realDbFingerprint, assertRealDbUntouched } = require('./helpers/harness');

const SECURITY_HEADERS = ['content-security-policy', 'x-frame-options', 'x-content-type-options'];

describe('static assets carry the same security headers as other routes (#24)', () => {
  let server;
  let dbBefore;

  before(async () => {
    dbBefore = realDbFingerprint();
    server = await startServer();
  });

  after(async () => {
    if (server) await server.stop();
  });

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('/ carries all three security headers (baseline)', async () => {
    const res = await fetch(`${server.baseUrl}/`);
    assert.equal(res.status, 200);
    for (const header of SECURITY_HEADERS) {
      assert.ok(res.headers.get(header), `expected / to carry ${header}`);
    }
  });

  test('/styles.css (served by express.static) carries all three security headers', async () => {
    const res = await fetch(`${server.baseUrl}/styles.css`);
    assert.equal(res.status, 200);
    for (const header of SECURITY_HEADERS) {
      assert.ok(res.headers.get(header), `expected /styles.css to carry ${header}`);
    }
  });

  test('/countries.json (served by express.static) carries all three security headers', async () => {
    const res = await fetch(`${server.baseUrl}/countries.json`);
    assert.equal(res.status, 200);
    for (const header of SECURITY_HEADERS) {
      assert.ok(res.headers.get(header), `expected /countries.json to carry ${header}`);
    }
  });
});
