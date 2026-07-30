// Issue #18 — wildcard CORS + no authentication let any website silently
// mutate or delete data.
//
// Before the fix, `Access-Control-Allow-Origin: *` was sent on every
// response and nothing on the server required authentication, so a page an
// attacker got the user's browser to open could DELETE/PATCH/POST against
// this server (typically running on localhost) with no signal to the user.
//
// The fix makes both protections opt-in via env vars:
//   - ALLOWED_ORIGIN: unset by default, so no Access-Control-Allow-Origin
//     header is ever sent and a cross-origin browser request fails CORS.
//   - API_TOKEN: unset by default (a console warning is logged), so the
//     common single-local-user case keeps working with zero friction; when
//     set, every POST/PATCH/DELETE must carry a matching X-API-Token header
//     or is rejected with 401.
//
// This suite proves both defaults and both opt-in behaviors against a real
// running server, never by reading source.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, realDbFingerprint, assertRealDbUntouched } = require('./helpers/harness');

describe('CORS is opt-in via ALLOWED_ORIGIN (#18)', () => {
  let server;
  let dbBefore;

  before(async () => {
    dbBefore = realDbFingerprint();
    server = await startServer(); // ALLOWED_ORIGIN intentionally left unset
  });

  after(async () => {
    if (server) await server.stop();
  });

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('a plain GET from a foreign Origin gets no Access-Control-Allow-Origin header', async () => {
    const res = await fetch(`${server.baseUrl}/api/positions`, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(res.status, 200); // same-origin/non-browser callers still work
    assert.equal(res.headers.get('access-control-allow-origin'), null,
      'no ALLOWED_ORIGIN configured, so no Access-Control-Allow-Origin header should ever be sent');
  });

  test('a CORS preflight (OPTIONS) from a foreign Origin gets no Access-Control-Allow-Origin header', async () => {
    const res = await fetch(`${server.baseUrl}/api/companies/2`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'DELETE',
      },
    });
    // Without the header a real browser refuses to send the follow-up
    // DELETE at all, regardless of the status code this preflight gets.
    assert.equal(res.headers.get('access-control-allow-origin'), null,
      'a cross-origin DELETE preflight must not be granted without ALLOWED_ORIGIN configured');
  });
});

describe('CORS grants only the configured ALLOWED_ORIGIN', () => {
  let server;

  before(async () => {
    server = await startServer({ ALLOWED_ORIGIN: 'https://trusted.example' });
  });

  after(async () => {
    if (server) await server.stop();
  });

  test('a request from the configured origin gets the matching header', async () => {
    const res = await fetch(`${server.baseUrl}/api/positions`, {
      headers: { Origin: 'https://trusted.example' },
    });
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://trusted.example');
  });

  test('a request from a different origin still gets no header', async () => {
    const res = await fetch(`${server.baseUrl}/api/positions`, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});

describe('mutating routes require X-API-Token when API_TOKEN is set (#18)', () => {
  let server;
  let dbBefore;

  before(async () => {
    dbBefore = realDbFingerprint();
    server = await startServer({ API_TOKEN: 'super-secret-token' });
  });

  after(async () => {
    if (server) await server.stop();
  });

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('a mutating request with no X-API-Token header is rejected with 401', async () => {
    const res = await fetch(`${server.baseUrl}/api/scrape/time-window`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time_window: '30' }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.ok(body.error, 'expected an error message in the 401 body');
  });

  test('a mutating request with the wrong X-API-Token is rejected with 401', async () => {
    const res = await fetch(`${server.baseUrl}/api/scrape/time-window`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'not-the-secret' },
      body: JSON.stringify({ time_window: '30' }),
    });
    assert.equal(res.status, 401);
  });

  test('a mutating request with the correct X-API-Token succeeds', async () => {
    const res = await fetch(`${server.baseUrl}/api/scrape/time-window`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': 'super-secret-token' },
      body: JSON.stringify({ time_window: '30' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.time_window, '30');
  });

  test('a non-mutating GET request is never blocked, even without a token', async () => {
    const res = await fetch(`${server.baseUrl}/api/positions`);
    assert.equal(res.status, 200);
  });
});

describe('mutating routes stay backward compatible when API_TOKEN is unset (default)', () => {
  let server;
  let dbBefore;

  before(async () => {
    dbBefore = realDbFingerprint();
    server = await startServer(); // API_TOKEN intentionally left unset
  });

  after(async () => {
    if (server) await server.stop();
  });

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('a mutating request with no X-API-Token header still succeeds', async () => {
    const res = await fetch(`${server.baseUrl}/api/scrape/time-window`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time_window: '90' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.time_window, '90');
  });

  test('server logs a warning that API_TOKEN is unset', () => {
    assert.match(server.logs.join(''), /API_TOKEN is not set/);
  });
});
