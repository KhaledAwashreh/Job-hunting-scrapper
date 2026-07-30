const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');

// Run a snippet in a fresh node process with a chosen cwd, so we are testing the
// real resolution behaviour rather than this process's already-loaded state.
//
// The test variable is DELETED rather than set to '': under override:false an
// empty-string variable still counts as already set, so blanking it would block
// the file value and make this test lie.
function runFrom(cwd, script) {
  const env = { ...process.env };
  delete env.SOME_TEST_ONLY_VAR;
  return execFileSync(process.execPath, ['-e', script], { cwd, encoding: 'utf8', env }).trim();
}

describe('loadEnv — .env resolves from the project root, not the cwd', () => {
  test('ENV_PATH points at the project root regardless of cwd', () => {
    const script = `console.log(require(${JSON.stringify(path.join(PROJECT_ROOT, 'src/utils/loadEnv'))}).ENV_PATH)`;

    const fromRoot = runFrom(PROJECT_ROOT, script);
    const fromElsewhere = runFrom(os.tmpdir(), script);
    const fromSubdir = runFrom(path.join(PROJECT_ROOT, 'src/agents'), script);

    assert.equal(fromRoot, path.join(PROJECT_ROOT, '.env'));
    assert.equal(fromElsewhere, fromRoot, 'cwd must not change where .env is looked for');
    assert.equal(fromSubdir, fromRoot, 'running from a subdirectory must not change it');
  });

  test('values in the project-root .env are visible when started from another directory', () => {
    // Use a real .env only if the project does not already have one, so this
    // test never overwrites the developer's own file.
    const envPath = path.join(PROJECT_ROOT, '.env');
    if (fs.existsSync(envPath)) {
      // Do not touch a real .env. Assert the weaker but still meaningful thing:
      // whatever it contains is loaded identically from any cwd.
      const script = `require(${JSON.stringify(path.join(PROJECT_ROOT, 'src/utils/loadEnv'))});` +
        `console.log(JSON.stringify(Object.keys(process.env).filter(k => k.endsWith('_API_KEY')).sort()))`;
      assert.equal(runFrom(os.tmpdir(), script), runFrom(PROJECT_ROOT, script));
      return;
    }

    fs.writeFileSync(envPath, 'SOME_TEST_ONLY_VAR=from_project_root\n');
    try {
      const script = `require(${JSON.stringify(path.join(PROJECT_ROOT, 'src/utils/loadEnv'))});` +
        `console.log(process.env.SOME_TEST_ONLY_VAR || '<unset>')`;
      assert.equal(runFrom(os.tmpdir(), script), 'from_project_root',
        'the .env must load even when the process starts elsewhere');
      assert.equal(runFrom(PROJECT_ROOT, script), 'from_project_root');
    } finally {
      fs.unlinkSync(envPath);
    }
  });

  test('a missing .env is not fatal', () => {
    // Deployments that inject real environment variables have no .env file.
    const script = `const m = require(${JSON.stringify(path.join(PROJECT_ROOT, 'src/utils/loadEnv'))});` +
      `console.log(typeof m.loaded === 'boolean' ? 'ok' : 'bad')`;
    assert.equal(runFrom(os.tmpdir(), script), 'ok');
  });

  test('a real environment variable still wins over the file', () => {
    const envPath = path.join(PROJECT_ROOT, '.env');
    if (fs.existsSync(envPath)) return; // never modify a developer's own .env

    fs.writeFileSync(envPath, 'SOME_TEST_ONLY_VAR=from_file\n');
    try {
      const out = execFileSync(process.execPath, ['-e',
        `require(${JSON.stringify(path.join(PROJECT_ROOT, 'src/utils/loadEnv'))});` +
        `console.log(process.env.SOME_TEST_ONLY_VAR)`,
      ], {
        cwd: os.tmpdir(),
        encoding: 'utf8',
        env: { ...process.env, SOME_TEST_ONLY_VAR: 'from_real_env' },
      }).trim();
      assert.equal(out, 'from_real_env', 'override:false must leave the real environment authoritative');
    } finally {
      fs.unlinkSync(envPath);
    }
  });
});
