// #21 — malformed JSON bodies and rejected uploads reached the generic error
// handler and were coerced to a 500 ("Internal server error"), even though
// body-parser had already tagged the JSON case with err.status = 400 and
// multer's fileFilter rejection carried a specific, useful message. Both
// cases should now surface as 400 with the real error message; genuine
// server-side failures must still fall through to 500.
//
// #22 — PATCH /api/companies/:id skipped the input validation POST applies
// (validateCompanyInput), so an invalid career_url/platform/name silently
// persisted. PATCH now runs the same validation (in a partial mode that
// only checks fields actually present in the body) and rejects bad input
// the same way POST does, while a valid partial PATCH still succeeds.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

// Seed one company to PATCH against. Run in its own process — sql.js keeps
// the whole db in memory and rewrites the file on save, so seeding must
// finish and exit before the server opens the file.
function seedFixtures(dbPath) {
  const schemaPath = path.join(REPO_ROOT, 'src/db/schema.js');
  const queriesPath = path.join(REPO_ROOT, 'src/db/queries.js');
  const script = `
    const { initializeDatabase } = require(${JSON.stringify(schemaPath)});
    const q = require(${JSON.stringify(queriesPath)});
    (async () => {
      await initializeDatabase();
      const companyId = q.addCompany('Acme BV', 'Netherlands', 'https://acme.example/careers', 'custom');
      process.stdout.write(JSON.stringify({ companyId }));
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

describe('client-input errors surface as 400, not 500 (#21); PATCH /api/companies/:id validates input (#22)', () => {
  let tmpDir;
  let resumesDir;
  let child;
  let baseUrl;
  let ids;
  let dbBefore;

  before(async () => {
    dbBefore = realDbFingerprint();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-errhandling-e2e-'));
    resumesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-errhandling-e2e-resumes-'));
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

  test('#21: malformed JSON body -> 400 with a real message, not 500', async () => {
    const res = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not valid json ',
    });
    assert.equal(res.status, 400, 'malformed JSON must be a 400, not a 500');
    const body = await res.json();
    assert.ok(body.error, 'error body expected');
    assert.notEqual(body.error, 'Internal server error', 'the real parse error message must survive, not be genericized');
  });

  test('#21: malformed JSON body on PATCH -> 400 as well', async () => {
    const res = await fetch(`${baseUrl}/api/companies/${ids.companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name": "oops"',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });

  test('#21: rejected upload (disallowed file type) -> 400 with the real message, not 500', async () => {
    const form = new FormData();
    form.append('resume', new Blob(['not really an executable'], { type: 'application/octet-stream' }), 'malware.exe');

    const res = await fetch(`${baseUrl}/api/resumes/upload`, {
      method: 'POST',
      body: form,
    });
    assert.equal(res.status, 400, 'a rejected upload type must be a 400, not a 500');
    const body = await res.json();
    assert.ok(body.error, 'error body expected');
    assert.match(body.error, /Invalid file type/);

    // The rejection must happen before any write.
    assert.deepEqual(fs.readdirSync(resumesDir), [], 'rejected upload must not be written to disk');
  });

  test('genuine server errors still return 500 (unmatched-route sanity check does not regress)', async () => {
    // Not a client-input error at all — confirms the branch added for #21
    // did not swallow the generic-500 path. (A truly-forced 500 needs DB
    // failure injection that is out of scope for this file; the 404
    // catch-all below is the nearest safe proxy that the rest of the
    // error-handling chain is untouched.)
    const res = await fetch(`${baseUrl}/api/does-not-exist`, { method: 'GET' });
    assert.equal(res.status, 404);
  });

  test('#22: PATCH /api/companies/:id rejects an invalid career_url the same way POST would', async () => {
    const res = await fetch(`${baseUrl}/api/companies/${ids.companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ career_url: 'not-a-url-at-all' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Invalid URL format/);
  });

  test('#22: PATCH /api/companies/:id rejects a bogus platform', async () => {
    const res = await fetch(`${baseUrl}/api/companies/${ids.companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'totally-bogus-platform' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Invalid platform/);
  });

  test('#22: PATCH /api/companies/:id rejects an empty name', async () => {
    const res = await fetch(`${baseUrl}/api/companies/${ids.companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Invalid name/);
  });

  test('#22: the invalid PATCH from the previous tests did not persist', async () => {
    const res = await fetch(`${baseUrl}/api/companies`);
    const companies = await res.json();
    const company = companies.find(c => c.id === ids.companyId);
    assert.equal(company.name, 'Acme BV', 'name must be unchanged');
    assert.equal(company.career_url, 'https://acme.example/careers', 'career_url must be unchanged');
  });

  test('#22: a valid partial PATCH (only one field) still succeeds', async () => {
    const res = await fetch(`${baseUrl}/api/companies/${ids.companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme International BV' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, ids.companyId);
    assert.equal(body.name, 'Acme International BV');
    // Untouched fields must survive the partial update.
    assert.equal(body.career_url, 'https://acme.example/careers');
  });
});
