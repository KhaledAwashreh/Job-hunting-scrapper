// #19 — an untrusted scraped job title was interpolated raw into the
// Content-Disposition header for tailored-resume downloads
// (GET /api/tailored-resumes/:id/download). A title containing CRLF made
// res.setHeader() throw ("Invalid character in header content"), producing a
// *permanent* 500 for that resume's downloads in every format (txt/docx/pdf
// all built the header the same way) — there's no API to edit a stored
// position title, so the resume was permanently unreachable. A title with an
// embedded quote could also smuggle a second filename= into the header.
//
// Fix: src/server.js's contentDispositionHeader() helper strips control
// characters and encodes the filename per RFC 6266 before it ever reaches
// res.setHeader(). This test seeds positions with exactly those
// header-breaking titles and confirms the download still succeeds (200,
// correct body, no crash) across all three export formats.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');

const { realDbFingerprint, assertRealDbUntouched } = require('./helpers/harness');

const REPO_ROOT = path.join(__dirname, '../..');

const TAILORED_TEXT = 'JANE APPLESEED\n\nEXPERIENCE\n- Shipped things\n';

// Titles crafted to break a naive `filename="${title}"` interpolation.
const MALICIOUS_TITLES = [
  { label: 'CRLF header injection', title: 'Backend Engineer\r\nX-Injected: pwned' },
  { label: 'quote-breaking / filename smuggling', title: 'Evil"; filename="pwned.exe' },
  { label: 'non-ASCII', title: 'Ingénieur Backend Senior — 日本語' },
];

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

// Seed one position + tailored resume per malicious title, directly against
// dbPath in its own process (mirrors tailored-resume-pdf-download.e2e.js:
// sql.js keeps the whole db in memory and rewrites the file on save, so
// seeding must finish and the process exit before the server opens the file).
function seedMaliciousTitles(dbPath, titles) {
  const schemaPath = path.join(REPO_ROOT, 'src/db/schema.js');
  const queriesPath = path.join(REPO_ROOT, 'src/db/queries.js');
  const script = `
    const { initializeDatabase } = require(${JSON.stringify(schemaPath)});
    const q = require(${JSON.stringify(queriesPath)});
    (async () => {
      await initializeDatabase();
      const companyId = q.addCompany('Acme BV', 'Netherlands', 'https://acme.example/careers', 'custom');
      const profileId = q.addProfile('Header Injection Test Profile', '', ['Backend Engineer'], null, 'Mid', [], []);
      const titles = ${JSON.stringify(titles)};
      const results = [];
      let i = 0;
      for (const title of titles) {
        i += 1;
        const posResult = q.addPosition(
          'hdr-inj-e2e-' + i, companyId, 'Netherlands', title,
          'desc', 'quals', '2026-07-01', 'https://acme.example/jobs/' + i,
          'Backend', ['Remote'], ['3-5'], ['Mid'], 80, null
        );
        const tailored = q.addTailoredResume(posResult.id, profileId, 'base text', ${JSON.stringify(TAILORED_TEXT)}, 1);
        results.push(tailored.id);
      }
      process.stdout.write(JSON.stringify({ tailoredResumeIds: results }));
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

describe('GET /api/tailored-resumes/:id/download with a header-breaking job title (#19)', () => {
  let tmpDir;
  let resumesDir;
  let child;
  let baseUrl;
  let tailoredResumeIds;
  let dbBefore;

  before(async () => {
    dbBefore = realDbFingerprint();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-hdr-inj-e2e-'));
    resumesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-hdr-inj-e2e-resumes-'));
    const dbPath = path.join(tmpDir, 'test-jobs.db');

    const titles = MALICIOUS_TITLES.map(t => t.title);
    const seeded = await seedMaliciousTitles(dbPath, titles);
    tailoredResumeIds = seeded.tailoredResumeIds;
    assert.equal(tailoredResumeIds.length, MALICIOUS_TITLES.length, 'seeding must produce one tailored resume per title');

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

  for (const format of ['txt', 'docx', 'pdf']) {
    MALICIOUS_TITLES.forEach(({ label, title }, i) => {
      test(`${label} title survives download as ${format} (200, no crash)`, async () => {
        const id = tailoredResumeIds[i];
        const res = await fetch(`${baseUrl}/api/tailored-resumes/${id}/download?format=${format}`);
        const disposition = res.headers.get('content-disposition');

        if (res.status !== 200) {
          assert.fail(`expected 200 for title ${JSON.stringify(title)}, got ${res.status}: ${await res.text()}`);
        }

        // The header itself must not carry a raw CR/LF (which would mean
        // Node accepted an injected header) and must not let the title's
        // embedded quote close the filename="..." string early.
        assert.ok(disposition, 'Content-Disposition header must be present');
        assert.doesNotMatch(disposition, /[\r\n]/, 'Content-Disposition must not contain raw CR/LF');
        assert.match(disposition, /^attachment; filename="[^"]*"; filename\*=UTF-8''/);

        const buffer = Buffer.from(await res.arrayBuffer());
        assert.ok(buffer.length > 0, 'download body must not be empty');
        if (format === 'txt') {
          assert.equal(buffer.toString('utf8'), TAILORED_TEXT);
        } else if (format === 'pdf') {
          assert.equal(buffer.subarray(0, 5).toString('ascii'), '%PDF-');
        }
      });
    });
  }

  test('quote-breaking title does not smuggle a second filename param', async () => {
    const smugglingIndex = MALICIOUS_TITLES.findIndex(t => t.label.includes('smuggling'));
    const id = tailoredResumeIds[smugglingIndex];
    const res = await fetch(`${baseUrl}/api/tailored-resumes/${id}/download?format=txt`);
    assert.equal(res.status, 200);
    const disposition = res.headers.get('content-disposition');
    // Only one filename="..." (legacy) and one filename*= (extended) param — never two of either.
    assert.equal((disposition.match(/filename="/g) || []).length, 1);
    assert.equal((disposition.match(/filename\*=/g) || []).length, 1);
  });
});
