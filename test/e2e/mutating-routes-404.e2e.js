// #20 — mutating routes (PATCH/DELETE) returned 200/phantom-success when
// acting on a nonexistent id instead of 404, across the CRUD surface:
//   PATCH  /api/positions/:id/status  -> 200, body null
//   PATCH  /api/companies/:id         -> 200, empty body
//   DELETE /api/companies/:id         -> 200 {"success":true,...}
//   PATCH  /api/profiles/:id          -> 200, plausible-looking but content-free object
//   DELETE /api/profiles/:id          -> 200 {"message":"Profile deleted"}
//   DELETE /api/tailored-resumes/:id  -> 200 {"message":"Tailored resume deleted"}
// Callers could not distinguish "acted on the target" from "nothing existed
// to act on" anywhere in the API.
//
// Fix: each route now does an existence lookup before mutating and returns
// 404 when the target id doesn't exist. This test hits every affected route
// with a nonexistent id and asserts 404, then confirms the same route still
// works (200) against a real, seeded id.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');

const { realDbFingerprint, assertRealDbUntouched } = require('./helpers/harness');

const REPO_ROOT = path.join(__dirname, '../..');
const NONEXISTENT_ID = 999999;

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

// Seed one company, one position, and two profiles (one to PATCH, one kept
// around so DELETE /api/profiles/:id has a target that doesn't collide with
// the PATCH test) plus a tailored resume to DELETE. Run in its own process,
// same reasoning as the other e2e seed scripts: sql.js keeps the whole db in
// memory and rewrites the file on save, so seeding must finish and exit
// before the server opens the file.
function seedFixtures(dbPath) {
  const schemaPath = path.join(REPO_ROOT, 'src/db/schema.js');
  const queriesPath = path.join(REPO_ROOT, 'src/db/queries.js');
  const script = `
    const { initializeDatabase } = require(${JSON.stringify(schemaPath)});
    const q = require(${JSON.stringify(queriesPath)});
    (async () => {
      await initializeDatabase();
      const companyId = q.addCompany('Acme BV', 'Netherlands', 'https://acme.example/careers', 'custom');
      const companyToDeleteId = q.addCompany('Doomed BV', 'Netherlands', 'https://doomed.example/careers', 'custom');
      const posResult = q.addPosition(
        '404-e2e-1', companyId, 'Netherlands', 'Backend Engineer',
        'desc', 'quals', '2026-07-01', 'https://acme.example/jobs/1',
        'Backend', ['Remote'], ['3-5'], ['Mid'], 80, null
      );
      const profileToPatchId = q.addProfile('Patch Target Profile', '', ['Backend Engineer'], null, 'Mid', [], []);
      const profileToDeleteId = q.addProfile('Delete Target Profile', '', ['Backend Engineer'], null, 'Mid', [], []);
      const tailored = q.addTailoredResume(posResult.id, profileToPatchId, 'base text', 'tailored text', 1);
      process.stdout.write(JSON.stringify({
        companyId,
        companyToDeleteId,
        positionId: posResult.id,
        profileToPatchId,
        profileToDeleteId,
        tailoredResumeId: tailored.id,
      }));
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

describe('PATCH/DELETE routes 404 on a nonexistent id, and still work on a real one (#20)', () => {
  let tmpDir;
  let resumesDir;
  let child;
  let baseUrl;
  let ids;
  let dbBefore;

  before(async () => {
    dbBefore = realDbFingerprint();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-404-e2e-'));
    resumesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-404-e2e-resumes-'));
    const dbPath = path.join(tmpDir, 'test-jobs.db');

    ids = await seedFixtures(dbPath);

    const port = await freePort();
    child = spawn(process.execPath, [path.join(REPO_ROOT, 'src/server.js')], {
      cwd: REPO_ROOT,
      env: { ...process.env, JOBS_DB_PATH: dbPath, RESUMES_DIR: resumesDir, PORT: String(port), NODE_ENV: 'test' },
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(resumesDir, { recursive: true, force: true });
  });

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('PATCH /api/positions/:id/status -> 404 for nonexistent id, non-numeric id', async () => {
    for (const badId of [NONEXISTENT_ID, 'not-a-number']) {
      const res = await fetch(`${baseUrl}/api/positions/${badId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'applied' }),
      });
      assert.equal(res.status, 404, `expected 404 for id ${badId}`);
      const body = await res.json();
      assert.ok(body.error, 'error body expected');
    }
  });

  test('PATCH /api/positions/:id/status -> 200 for the real id', async () => {
    const res = await fetch(`${baseUrl}/api/positions/${ids.positionId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'applied' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, ids.positionId);
    assert.equal(body.status, 'applied');
  });

  test('PATCH /api/companies/:id -> 404 for nonexistent id', async () => {
    const res = await fetch(`${baseUrl}/api/companies/${NONEXISTENT_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.ok(body.error);
  });

  test('PATCH /api/companies/:id -> 200 for the real id', async () => {
    const res = await fetch(`${baseUrl}/api/companies/${ids.companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed Acme BV' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, ids.companyId);
    assert.equal(body.name, 'Renamed Acme BV');
  });

  test('DELETE /api/companies/:id -> 404 for nonexistent id', async () => {
    const res = await fetch(`${baseUrl}/api/companies/${NONEXISTENT_ID}`, { method: 'DELETE' });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.ok(body.error);
  });

  test('DELETE /api/companies/:id -> 200 for the real id', async () => {
    const res = await fetch(`${baseUrl}/api/companies/${ids.companyToDeleteId}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });

  test('PATCH /api/profiles/:id -> 404 for nonexistent id', async () => {
    const res = await fetch(`${baseUrl}/api/profiles/${NONEXISTENT_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', resume_file: 'foo.pdf', job_types: ['Backend'] }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.ok(body.error);
  });

  test('PATCH /api/profiles/:id -> 200 for the real id', async () => {
    const res = await fetch(`${baseUrl}/api/profiles/${ids.profileToPatchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed Profile', resume_file: 'foo.pdf', job_types: ['Backend Engineer'] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, ids.profileToPatchId);
    assert.equal(body.name, 'Renamed Profile');
  });

  test('DELETE /api/profiles/:id -> 404 for nonexistent id', async () => {
    const res = await fetch(`${baseUrl}/api/profiles/${NONEXISTENT_ID}`, { method: 'DELETE' });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.ok(body.error);
  });

  test('DELETE /api/profiles/:id -> 200 for the real id', async () => {
    const res = await fetch(`${baseUrl}/api/profiles/${ids.profileToDeleteId}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.message, 'Profile deleted');
  });

  test('DELETE /api/tailored-resumes/:id -> 404 for nonexistent id', async () => {
    const res = await fetch(`${baseUrl}/api/tailored-resumes/${NONEXISTENT_ID}`, { method: 'DELETE' });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.ok(body.error);
  });

  test('DELETE /api/tailored-resumes/:id -> 200 for the real id', async () => {
    const res = await fetch(`${baseUrl}/api/tailored-resumes/${ids.tailoredResumeId}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.message, 'Tailored resume deleted');
  });
});
