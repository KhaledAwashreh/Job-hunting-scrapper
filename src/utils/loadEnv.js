// Loads .env from the project root, whatever directory the process was started
// from.
//
// `require('dotenv').config()` with no path resolves against process.cwd(), so
// the app only picked up its own .env when launched from the repo root. Running
// from a subdirectory, a git worktree, a systemd unit with a different
// WorkingDirectory, or an editor's run button silently produced an app with no
// API keys — and the first symptom was an unrelated-looking
// "ANTHROPIC_API_KEY not set" thrown from deep inside scoring.
//
// Anchoring to __dirname makes the location a property of the checkout rather
// than of how it was invoked. Require this once from each entry point.

const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '../..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');

// override: false keeps real environment variables authoritative, so a value
// exported in the shell or injected by Docker still wins over the file.
// quiet: true suppresses dotenv v17's startup banner, which otherwise writes to
// stdout on every process start.
const result = require('dotenv').config({ path: ENV_PATH, override: false, quiet: true });

module.exports = {
  ENV_PATH,
  PROJECT_ROOT,
  // Present when the file is missing or unreadable. Not fatal: deployments that
  // inject real environment variables have no .env at all.
  error: result.error || null,
  loaded: !result.error,
};
