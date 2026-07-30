// Issue #25 — gracefulShutdown() called process.exit(0) without ever
// awaiting server.close()'s callback. Verified against a real SIGTERM: the
// process exited in ~15-20ms, "HTTP server closed" never printed, and about
// a third of genuinely in-flight requests were dropped mid-response. This
// hits any normal `docker stop` / k8s eviction / process-manager restart,
// not just crashes.
//
// The fix tracks "HTTP server fully closed" (server.close()'s callback) and
// only calls process.exit(0) once that has actually fired (plus a 30s hard
// timeout fallback for anything that never finishes).
//
// This test sends a real SIGTERM to a real child-process server while a
// request is deliberately held in-flight (via a mocked, artificially slow
// LLM call on the tailor endpoint) and asserts that request completes
// successfully — rather than being dropped — before the process exits.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');

const { realDbFingerprint, assertRealDbUntouched } = require('./helpers/harness');
const { startMockOllama } = require('./helpers/mockOllama');
const { seedTailorFixture } = require('./helpers/seedTailorFixture');
const { resumeFixtureEnv } = require('./helpers/resumeFixture');

const REPO_ROOT = path.join(__dirname, '../..');
const RESUME_FILENAME = 'graceful-shutdown-base.e2e-fixture.txt';
const LLM_DELAY_MS = 1000;

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

async function waitForHealth(baseUrl, child, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        const body = await res.json();
        if (body.db_initialized) return body;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`server did not become healthy in time: ${lastErr && lastErr.message}`);
}

describe('SIGTERM drains in-flight requests instead of dropping them (#25)', () => {
  let tmpDir;
  let child;
  let mockLlm;
  let baseUrl;
  let positionId;
  let profileId;
  let dbBefore;
  let exitPromise;

  before(async () => {
    dbBefore = realDbFingerprint();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-shutdown-e2e-'));

    const dbPath = path.join(tmpDir, 'test-jobs.db');
    const seeded = await seedTailorFixture(dbPath, { resumeFile: RESUME_FILENAME });
    positionId = seeded.positionId;
    profileId = seeded.profileId;
    assert.ok(positionId && profileId, 'seeding must produce a position and profile id');

    // Simulates real LLM latency so the tailor request is still genuinely
    // in-flight (past connection-accept, into the async LLM call) when
    // SIGTERM is sent below.
    mockLlm = await startMockOllama({ delayMs: LLM_DELAY_MS, text: 'MOCKED TAILORED RESUME' });

    const port = await freePort();
    child = spawn(process.execPath, [path.join(REPO_ROOT, 'src/server.js')], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        JOBS_DB_PATH: dbPath,
        PORT: String(port),
        NODE_ENV: 'test',
        TAILORING_PROVIDER: 'ollama',
        OLLAMA_BASE_URL: mockLlm.baseUrl,
        ...resumeFixtureEnv(RESUME_FILENAME, 'JANE DOE\nEXPERIENCE\n- Shipped things.\n'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', d => { stdout += d; });
    child.logs = () => stdout;

    exitPromise = new Promise(resolve => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });

    baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
  });

  after(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGKILL');
    }
    if (mockLlm) await mockLlm.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('a request in flight when SIGTERM arrives still completes successfully', async () => {
    const inFlight = fetch(`${baseUrl}/api/positions/${positionId}/tailor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId }),
    });

    // Give the request enough time to pass the rate limiter, reach the
    // (mocked, deliberately slow) LLM call, and be genuinely in-flight —
    // but send SIGTERM well before the mocked LLM responds.
    await new Promise(r => setTimeout(r, 200));

    child.kill('SIGTERM');

    // Before the fix this either threw ("fetch failed" — connection reset)
    // or the process was killed before responding at all.
    const res = await inFlight;
    if (res.status !== 201) {
      assert.fail(`expected the in-flight request to complete successfully, got ${res.status}: ${await res.text().catch(() => '')}`);
    }
    const body = await res.json();
    assert.equal(body.tailored_text, 'MOCKED TAILORED RESUME');

    const { code: exitCode } = await exitPromise;
    assert.equal(exitCode, 0, `expected a clean exit, process logs:\n${child.logs()}`);
    assert.match(child.logs(), /HTTP server closed/,
      'expected the close callback to actually run before exit (previously unreachable on this path)');
  });
});
