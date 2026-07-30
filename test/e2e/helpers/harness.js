// E2E harness: boots the real server against an ISOLATED database and drives it
// with a real browser.
//
// The isolation is the whole point. Every run sets JOBS_DB_PATH to a file inside
// a fresh temp directory, so the app's real jobs.db is never opened, written or
// created. `assertRealDbUntouched` below enforces that rather than trusting it.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const REPO_ROOT = path.join(__dirname, '../../..');
const REAL_DB = path.join(REPO_ROOT, 'jobs.db');

// Chromium binaries are not installable on this platform (playwright 1.60 has no
// ubuntu26.04 build), so we drive the system Chrome instead. If neither is
// present we skip rather than fail — a missing browser is an environment gap,
// not a defect in the code under test.
function findBrowser() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    return { available: false, reason: 'playwright is not installed' };
  }

  for (const candidate of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(candidate)) {
      return { available: true, chromium, launchOptions: { executablePath: candidate, headless: true } };
    }
  }
  return {
    available: false,
    reason: 'no Chrome/Chromium found — install one, or run `npx playwright install chromium` on a supported platform',
  };
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

async function waitForHealth(port, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) {
        const body = await res.json();
        if (body.db_initialized) return body;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`server did not become healthy in ${timeoutMs}ms: ${lastErr && lastErr.message}`);
}

// Boot the server on an ephemeral port with its own database in a temp dir.
async function startServer(env = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-e2e-'));
  const dbPath = path.join(tmpDir, 'test-jobs.db');
  const port = await freePort();

  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'src/server.js')], {
    cwd: REPO_ROOT,
    env: { ...process.env, JOBS_DB_PATH: dbPath, PORT: String(port), NODE_ENV: 'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  child.stdout.on('data', d => logs.push(String(d)));
  child.stderr.on('data', d => logs.push(String(d)));

  try {
    await waitForHealth(port, child);
  } catch (err) {
    child.kill('SIGKILL');
    throw new Error(`${err.message}\n--- server output ---\n${logs.join('')}`);
  }

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    dbPath,
    tmpDir,
    logs,
    async stop() {
      await new Promise(resolve => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', resolve);
        child.kill('SIGTERM');
        setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000).unref();
      });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

// Snapshot the real database's state so a test can prove it was not touched.
function realDbFingerprint() {
  if (!fs.existsSync(REAL_DB)) return { exists: false };
  const st = fs.statSync(REAL_DB);
  return { exists: true, size: st.size, mtimeMs: st.mtimeMs };
}

function assertRealDbUntouched(before, assert) {
  const after = realDbFingerprint();
  assert.deepEqual(
    after,
    before,
    'the real jobs.db must not be created, read into existence, or modified by an E2E run'
  );
}

module.exports = { startServer, findBrowser, realDbFingerprint, assertRealDbUntouched, REAL_DB };
