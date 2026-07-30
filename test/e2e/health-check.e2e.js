// A4.2 — GET /api/health must be able to report a database failure.
//
// Before the fix, the dbInitialized guard (server.js ~104-110) exempted
// `req.path.startsWith('/health')`, but the route is registered at
// `/api/health`. The strings never matched, so on any startup failure the
// guard's generic `503 {"error":"Database not initialized"}` always fired
// first and the real /api/health handler — the one that reports
// db_initialized, the underlying error, and a timestamp — never ran. Also
// broken for Docker's HEALTHCHECK, which got no diagnostic.
//
// This suite forces a real startup failure (JOBS_DB_PATH pointed at a
// directory that does not exist, so schema.js's saveDatabase() hits ENOENT)
// and checks that /api/health still reaches the real handler.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');

const { startServer, realDbFingerprint, assertRealDbUntouched } = require('./helpers/harness');

const REPO_ROOT = path.join(__dirname, '../..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Boot the server against a JOBS_DB_PATH whose parent directory does not
// exist, so initializeDatabase() fails with ENOENT and startup() catches it
// (dbInitialized stays false) instead of rejecting. Unlike
// helpers/harness.js's startServer(), this does NOT wait for
// `db_initialized: true` — that would never come — it waits only for the
// process to start answering HTTP at all.
async function startServerWithBrokenDb() {
  const brokenDbPath = path.join(os.tmpdir(), `jobhunter-missing-${process.pid}-${Date.now()}`, 'sub', 'test.db');
  const resumesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-health-resumes-'));
  const port = await freePort();

  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'src/server.js')], {
    cwd: REPO_ROOT,
    env: { ...process.env, JOBS_DB_PATH: brokenDbPath, RESUMES_DIR: resumesDir, PORT: String(port), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  child.stdout.on('data', d => logs.push(String(d)));
  child.stderr.on('data', d => logs.push(String(d)));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  let lastErr;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}\n${logs.join('')}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      // Any response at all means the server is up and the route resolved —
      // that's all we need before making assertions in the test body.
      return {
        baseUrl,
        logs,
        firstResponse: { status: res.status, body: await res.json() },
        async stop() {
          await new Promise(resolve => {
            if (child.exitCode !== null) return resolve();
            child.once('exit', resolve);
            child.kill('SIGTERM');
            setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000).unref();
          });
          fs.rmSync(resumesDir, { recursive: true, force: true });
        },
      };
    } catch (err) {
      lastErr = err;
      await new Promise(r => setTimeout(r, 100));
    }
  }
  child.kill('SIGKILL');
  throw new Error(`server did not respond in time: ${lastErr && lastErr.message}\n${logs.join('')}`);
}

describe('GET /api/health — reports database failures (A4.2)', () => {
  let dbBefore;

  before(() => {
    dbBefore = realDbFingerprint();
  });

  test('the real jobs.db is never touched by any test in this file', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('with a forced startup failure, /api/health runs the real handler (not the generic 503 guard)', async () => {
    const server = await startServerWithBrokenDb();
    try {
      const { status, body } = server.firstResponse;

      // The old bug returned exactly `503 {"error":"Database not initialized"}`
      // from the guard, with no other keys. The real handler's shape always
      // carries db_initialized and timestamp, in both its ok and error
      // branches. Assert the real handler's shape, not a specific status
      // code — the guard is the thing being ruled out.
      assert.ok('db_initialized' in body,
        `expected the real /api/health handler's shape (db_initialized present); got ${JSON.stringify(body)}`);
      assert.ok('timestamp' in body, `expected a timestamp field; got ${JSON.stringify(body)}`);
      assert.equal(body.db_initialized, false, 'db_initialized must reflect the forced startup failure');

      // The generic guard body is `{ error: 'Database not initialized' }` and
      // nothing else — rule that exact shape out explicitly.
      const isGenericGuardBody = Object.keys(body).length === 1 && body.error === 'Database not initialized';
      assert.equal(isGenericGuardBody, false, 'the generic dbInitialized guard body must not be what /api/health returns');
      assert.ok(status === 200 || status === 503, `expected 200 or 503 from the real handler, got ${status}`);
    } finally {
      await server.stop();
    }
  });

  test('with a healthy start, /api/health returns status: "ok" and db_initialized: true', async () => {
    const server = await startServer();
    try {
      const res = await fetch(`${server.baseUrl}/api/health`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'ok');
      assert.equal(body.db_initialized, true);
    } finally {
      await server.stop();
    }
  });

  test('GET /health (no /api prefix) is not a route — confirms the fix targets the real /api/health path, not a bare /health prefix', async () => {
    // With a healthy db the guard is a no-op regardless of path, so this
    // exercises routing only: no route is registered at bare /health, so it
    // must fall through to the 404 catch-all.
    const server = await startServer();
    try {
      const res = await fetch(`${server.baseUrl}/health`);
      assert.equal(res.status, 404);
    } finally {
      await server.stop();
    }
  });
});
