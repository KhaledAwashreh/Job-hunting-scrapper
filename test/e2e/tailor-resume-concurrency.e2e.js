// Regression tests for #27 — POST /api/positions/:id/tailor read the current
// version synchronously, awaited a (slow, paid) LLM call, then inserted.
// Two concurrent requests for the same position+profile (double click, two
// browser tabs, a client retry) both read the same next version before
// either finished its await, then raced to insert: the loser hit the
// UNIQUE(position_id, profile_id, version) constraint and got a 500 after
// already paying for an LLM call it could never save.
//
// The fix is an in-process `Set` guard in src/server.js (tailoringInFlight)
// keyed on `${positionId}:${profileId}`, checked-and-set synchronously
// before any version read or LLM call, and released in a `finally` no
// matter how the request ends.
//
// This spawns the REAL server as a child process (not an in-process
// simulation) and points TAILORING_PROVIDER/OLLAMA_BASE_URL at a local mock
// HTTP server standing in for the LLM, so:
//   - no real API key or network call is needed,
//   - the mock can hold each request open long enough to guarantee both
//     concurrent HTTP requests are in flight before either resolves, and
//   - the mock counts its own invocations, so "the second request never
//     wasted an LLM call" is asserted directly rather than inferred.
//
// JOBS_DB_PATH is set to a fresh temp file for the isolated server process,
// so the real jobs.db is never opened.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const net = require('node:net');

const { realDbFingerprint, assertRealDbUntouched } = require('./helpers/harness');

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

// Stands in for Ollama's /api/chat. Holds every request open for `delayMs`
// before responding, so two concurrent tailor requests are both guaranteed
// to be mid-flight at the same time — and counts how many times it was
// actually hit, which is the proof that a rejected (409) request never
// reached the LLM call at all.
function startMockLlmServer(delayMs) {
  let callCount = 0;
  const server = http.createServer((req, res) => {
    callCount++;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: { content: 'MOCK TAILORED RESUME TEXT' } }));
      }, delayMs);
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        getCallCount: () => callCount,
        stop: () => new Promise(r => server.close(r)),
      });
    });
    server.on('error', reject);
  });
}

// Seed a company/position/profile in their own process — sql.js keeps the
// whole db in memory and rewrites the file on save, so seeding must finish
// and exit before the server opens the file (mirrors helpers/seed.js).
function seedFixture(dbPath) {
  const schemaPath = path.join(REPO_ROOT, 'src/db/schema.js');
  const queriesPath = path.join(REPO_ROOT, 'src/db/queries.js');
  const script = `
    const { initializeDatabase } = require(${JSON.stringify(schemaPath)});
    const q = require(${JSON.stringify(queriesPath)});
    (async () => {
      await initializeDatabase();
      const companyId = q.addCompany('Concurrency Co', 'Netherlands', 'https://concurrency.example/careers', 'custom');
      const posResult = q.addPosition(
        'concurrency-e2e-1', companyId, 'Netherlands', 'Backend Engineer',
        'desc', 'quals', '2026-07-01', 'https://concurrency.example/jobs/1',
        'Backend', ['Remote'], ['3-5'], ['Mid'], 80, null
      );
      const profileId = q.addProfile('Concurrency Profile', 'resume.txt', ['Backend Engineer'], null, 'Mid', [], []);
      process.stdout.write(JSON.stringify({ positionId: posResult.id, profileId }));
      process.exit(0);
    })().catch(err => { console.error(err); process.exit(1); });
  `;

  return new Promise((resolve, reject) => {
    const seeder = spawn(process.execPath, ['-e', script], {
      cwd: REPO_ROOT,
      env: { ...process.env, JOBS_DB_PATH: dbPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    seeder.stdout.on('data', d => { out += d; });
    seeder.stderr.on('data', d => { err += d; });
    seeder.on('exit', code => {
      if (code === 0) return resolve(JSON.parse(out.trim() || '{}'));
      reject(new Error(`seeding failed (exit ${code}):\n${err}`));
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

describe('POST /api/positions/:id/tailor — concurrent requests (#27)', () => {
  let tmpDir;
  let resumesDir;
  let child;
  let mockLlm;
  let baseUrl;
  let positionId;
  let profileId;
  let dbBefore;

  before(async () => {
    dbBefore = realDbFingerprint();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-tailor-race-e2e-'));
    resumesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-tailor-race-e2e-resumes-'));
    fs.writeFileSync(path.join(resumesDir, 'resume.txt'), 'JANE DOE\n\nEXPERIENCE\n- Built things.\n');

    const dbPath = path.join(tmpDir, 'test-jobs.db');
    const seeded = await seedFixture(dbPath);
    positionId = seeded.positionId;
    profileId = seeded.profileId;
    assert.ok(positionId, 'seeding must produce a position id');
    assert.ok(profileId, 'seeding must produce a profile id');

    // Long enough that both concurrent HTTP requests are reliably in flight
    // before either's LLM call resolves, short enough to keep the suite fast.
    mockLlm = await startMockLlmServer(400);

    const port = await freePort();
    child = spawn(process.execPath, [path.join(REPO_ROOT, 'src/server.js')], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        JOBS_DB_PATH: dbPath,
        RESUMES_DIR: resumesDir,
        PORT: String(port),
        NODE_ENV: 'test',
        TAILORING_PROVIDER: 'ollama',
        OLLAMA_BASE_URL: mockLlm.url,
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
    fs.rmSync(resumesDir, { recursive: true, force: true });
  });

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('two concurrent requests for the same position+profile: one 201, one 409 (never 500) — and the LLM is only called once', async () => {
    const postTailor = () => fetch(`${baseUrl}/api/positions/${positionId}/tailor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId }),
    });

    const [resA, resB] = await Promise.all([postTailor(), postTailor()]);
    const statuses = [resA.status, resB.status].sort();

    assert.deepEqual(
      statuses, [201, 409],
      `expected exactly one 201 and one 409, got [${resA.status}, ${resB.status}]`
    );

    // Neither request should ever see a 500 — that was the original bug: the
    // loser paid for an LLM call and then still failed with a 500 on the
    // UNIQUE-constraint insert.
    assert.ok(!statuses.includes(500), 'no request should 500');

    const winner = resA.status === 201 ? resA : resB;
    const loser = resA.status === 409 ? resA : resB;

    const winnerBody = await winner.json();
    assert.equal(winnerBody.position_id, String(positionId));
    assert.equal(winnerBody.tailored_text, 'MOCK TAILORED RESUME TEXT');

    const loserBody = await loser.json();
    assert.match(loserBody.error, /already in progress/i);

    // The whole point of guarding BEFORE the LLM call: the rejected request
    // must never have triggered one. If the guard were missing (or placed
    // after the LLM call), this would be 2.
    assert.equal(mockLlm.getCallCount(), 1, 'the LLM must be invoked exactly once, not twice');
  });

  test('exactly one tailored_resumes row was created for the race, not zero and not two', async () => {
    const res = await fetch(`${baseUrl}/api/positions/${positionId}/tailored-resumes`);
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.equal(rows.length, 1, `expected exactly 1 tailored resume row, got ${rows.length}`);
  });

  test('the guard is released after the first request completes — a subsequent request succeeds, not stuck at 409 forever', async () => {
    const res = await fetch(`${baseUrl}/api/positions/${positionId}/tailor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId }),
    });
    assert.equal(res.status, 201, `expected 201 now that the earlier request has finished, got ${res.status}: ${await res.text()}`);
    assert.equal(mockLlm.getCallCount(), 2, 'this follow-up request should be a fresh, real LLM call');
  });
});
