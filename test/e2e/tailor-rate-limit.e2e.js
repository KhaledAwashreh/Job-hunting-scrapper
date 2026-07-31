// Issue #23 — POST /api/positions/:positionId/tailor invokes a paid
// Anthropic call with no throttle at all, unlike POST /api/scrape/run which
// enforces MIN_SCRAPE_INTERVAL_MS. A bug (retry loop, double-click) or an
// unauthenticated caller could run up unbounded LLM spend.
//
// The fix adds an in-process sliding-window rate limiter (TAILOR_RATE_LIMIT_MAX
// requests per TAILOR_RATE_LIMIT_WINDOW_MS, keyed by client IP) in front of
// the tailor route, returning 429 once the window's budget is used up.
//
// This test hammers the real endpoint past that limit and asserts 429 kicks
// in. The LLM call itself is mocked out (server pointed at a local fake
// Ollama endpoint via TAILORING_PROVIDER=ollama) so the test is fast and
// never makes a real, billed API call.

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
const RESUME_FILENAME = 'tailor-rate-limit-base.e2e-fixture.txt';

// The fix's own constant (kept in sync manually — if server.js's limit
// changes, this test's expectations should be revisited alongside it).
const TAILOR_RATE_LIMIT_MAX = 10;

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

describe('POST /api/positions/:positionId/tailor is rate-limited (#23)', () => {
  let tmpDir;
  let child;
  let mockLlm;
  let baseUrl;
  let positionIds;
  let profileId;
  let dbBefore;

  before(async () => {
    dbBefore = realDbFingerprint();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-tailor-rl-e2e-'));

    const dbPath = path.join(tmpDir, 'test-jobs.db');
    // One position per planned request (see seedTailorFixture's comment):
    // hitting the *same* position+profile concurrently trips an unrelated,
    // pre-existing race in getNextVersionForPositionProfile/addTailoredResume.
    const seeded = await seedTailorFixture(dbPath, { resumeFile: RESUME_FILENAME, positionCount: TAILOR_RATE_LIMIT_MAX + 5 });
    positionIds = seeded.positionIds;
    profileId = seeded.profileId;
    assert.ok(positionIds.length === TAILOR_RATE_LIMIT_MAX + 5 && profileId, 'seeding must produce positions and a profile id');

    mockLlm = await startMockOllama({ delayMs: 0, text: 'MOCKED TAILORED RESUME' });

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
        ...resumeFixtureEnv(RESUME_FILENAME, 'JOHN DOE\nEXPERIENCE\n- Built things.\n'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
  });

  after(async () => {
    if (child) {
      await new Promise(resolve => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', resolve);
        child.kill('SIGTERM');
        setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000).unref();
      });
    }
    if (mockLlm) await mockLlm.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('firing well past the limit trips a 429 with the expected count of successes', async () => {
    const attempts = TAILOR_RATE_LIMIT_MAX + 5;
    const requests = positionIds.map(id =>
      fetch(`${baseUrl}/api/positions/${id}/tailor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      })
    );
    const responses = await Promise.all(requests);
    const statuses = responses.map(r => r.status);

    const succeeded = statuses.filter(s => s === 201).length;
    const limited = statuses.filter(s => s === 429).length;

    assert.ok(limited > 0, `expected at least one 429 among statuses: ${statuses.join(',')}`);
    assert.equal(succeeded, TAILOR_RATE_LIMIT_MAX,
      `expected exactly TAILOR_RATE_LIMIT_MAX (${TAILOR_RATE_LIMIT_MAX}) successes, statuses were: ${statuses.join(',')}`);
    assert.equal(succeeded + limited, attempts,
      `every response should be either a success or a 429, statuses were: ${statuses.join(',')}`);

    const limitedResponse = responses.find(r => r.status === 429);
    const body = await limitedResponse.json();
    assert.ok(body.error, 'expected an error message in the 429 body');
    assert.ok(typeof body.retryAfter === 'number', 'expected a numeric retryAfter in the 429 body');
  });
});
