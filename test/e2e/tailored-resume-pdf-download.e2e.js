// A4.3 — PDF export of a tailored resume (GET
// /api/tailored-resumes/:id/download?format=pdf) was 100% broken: the pdf
// branch referenced `timesRoman`, an identifier that was never declared
// (only `timesRomanFont` and `timesRomanBold` exist). Every PDF download hit
// a ReferenceError and came back as a generic `500 {"error":"timesRoman is
// not defined"}`. Nothing exercised this code path, which is exactly why a
// plainly undefined variable survived — hence the test here actually opens
// the returned bytes as a PDF and checks the text made it in, rather than
// just checking for a 200.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const zlib = require('node:zlib');

const { realDbFingerprint, assertRealDbUntouched } = require('./helpers/harness');

const REPO_ROOT = path.join(__dirname, '../..');

// Extract the text pdf-lib actually drew into the PDF's content stream(s),
// to check the download is not just PDF-shaped but carries the real content.
//
// `pdf-parse` is already a dependency and looks like the obvious tool for
// this, but its bundled pdf.js cannot read pdf-lib 1.17's output in this
// environment at all — confirmed independently of this fix: even a blank
// pdf-lib document with no text and no fonts fails the same way
// ("Invalid PDF structure" / "Unknown compression method in flate stream").
// So this decodes the FlateDecode content streams directly with Node's
// built-in zlib (no new dependency) and pulls out the hex-string operands of
// the Tj/TJ text-showing operators, which is exactly the text pdf-lib wrote.
function extractPdfText(buffer) {
  const latin1 = buffer.toString('latin1');
  const streamRe = /stream\r?\n/g;
  let match;
  let decoded = '';
  while ((match = streamRe.exec(latin1))) {
    const start = match.index + match[0].length;
    const end = latin1.indexOf('endstream', start);
    if (end === -1) continue;
    try {
      decoded += zlib.inflateSync(buffer.subarray(start, end)).toString('latin1');
    } catch {
      // Not every stream is FlateDecode (or the endstream boundary search is
      // fuzzy) — those chunks just don't contribute text.
    }
  }
  return [...decoded.matchAll(/<([0-9A-Fa-f]+)>/g)]
    .map(m => Buffer.from(m[1], 'hex').toString('latin1'))
    .join('\n');
}

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

const TAILORED_TEXT = [
  'JANE APPLESEED',
  '',
  'EXPERIENCE',
  '- Shipped a load-bearing payments pipeline serving 2M requests a day',
  '- Cut deploy time from 40 minutes to 4',
  '',
  'EDUCATION',
  '- BSc Computer Science',
].join('\n');

// Seed a company/position/profile/tailored-resume directly against dbPath in
// its own process (mirrors helpers/seed.js's reasoning: sql.js keeps the
// whole db in memory and rewrites the file on save, so seeding must finish
// and the process must exit before the server opens the file).
function seedTailoredResume(dbPath) {
  const schemaPath = path.join(REPO_ROOT, 'src/db/schema.js');
  const queriesPath = path.join(REPO_ROOT, 'src/db/queries.js');
  const script = `
    const { initializeDatabase } = require(${JSON.stringify(schemaPath)});
    const q = require(${JSON.stringify(queriesPath)});
    (async () => {
      await initializeDatabase();
      const companyId = q.addCompany('Acme BV', 'Netherlands', 'https://acme.example/careers', 'custom');
      const posResult = q.addPosition(
        'pdf-e2e-1', companyId, 'Netherlands', 'Backend Engineer',
        'desc', 'quals', '2026-07-01', 'https://acme.example/jobs/1',
        'Backend', ['Remote'], ['3-5'], ['Mid'], 80, null
      );
      const profileId = q.addProfile('PDF Test Profile', '', ['Backend Engineer'], null, 'Mid', [], []);
      const tailored = q.addTailoredResume(posResult.id, profileId, 'base text', ${JSON.stringify(TAILORED_TEXT)}, 1);
      process.stdout.write(JSON.stringify({ tailoredResumeId: tailored.id }));
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

describe('GET /api/tailored-resumes/:id/download?format=pdf (A4.3)', () => {
  let tmpDir;
  let resumesDir;
  let child;
  let baseUrl;
  let tailoredResumeId;
  let dbBefore;

  before(async () => {
    dbBefore = realDbFingerprint();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-pdf-e2e-'));
    resumesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-pdf-e2e-resumes-'));
    const dbPath = path.join(tmpDir, 'test-jobs.db');

    const seeded = await seedTailoredResume(dbPath);
    tailoredResumeId = seeded.tailoredResumeId;
    assert.ok(tailoredResumeId, 'seeding must produce a tailored resume id');

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

  test('returns 200 with a real, parseable PDF containing the tailored text', async () => {
    const res = await fetch(`${baseUrl}/api/tailored-resumes/${tailoredResumeId}/download?format=pdf`);
    if (res.status !== 200) {
      assert.fail(`expected 200, got ${res.status}: ${await res.text()}`);
    }
    assert.equal(res.headers.get('content-type'), 'application/pdf');

    const buffer = Buffer.from(await res.arrayBuffer());

    // Magic bytes: a real PDF starts with '%PDF-'.
    assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-', 'response body is not PDF-magic-prefixed');
    // A single-page Harvard-format resume PDF from pdf-lib is comfortably
    // more than a trivial/empty document.
    assert.ok(buffer.length > 500, `PDF is suspiciously small (${buffer.length} bytes) — looks empty/broken`);

    // Decode the content streams for real and confirm the tailored text
    // actually made it in — not just "some bytes that start with %PDF".
    const text = extractPdfText(buffer);
    assert.match(text, /JANE APPLESEED/);
    assert.match(text, /load-bearing payments pipeline/);
    assert.match(text, /EDUCATION/);
  });
});
