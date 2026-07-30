# A7 — Deployment and maintenance scripts

**Status:** confirmed by execution/inspection · **Owner:** fix agent A7
**Files:** `Dockerfile`, `inspect_db.js`, `count_companies.js`

---

## A7.1 — The Docker image ships an empty UI and no config (Critical for anyone deploying)

`Dockerfile:19-25` copies `node_modules`, `src`, `package.json` and `.env.example`, then does
`RUN mkdir -p /app/data/resumes /app/public` — creating **empty** directories. It never copies:

- `public/` — `express.static` (`server.js:84`) and `res.sendFile` (`:182`) serve `dashboard.html`,
  `styles.css`, `countries.json` and `components/*.js` from here. All 404 in the image.
- `data/search-params.csv` — read by `src/utils/csvParser.js:5`. The scraper starts with zero search config.

Worse, `HEALTHCHECK` only probes `/api/health`, so **the container reports healthy while the entire UI is
broken**.

Secondary, same file: `COPY --from=builder /app/.env.example ./.env` bakes the placeholder
`your_claude_key_here` in as the active key. Because `loadEnv.js` uses `override: false`, a real injected
environment variable still wins — but with nothing injected, the placeholder is what the app uses.

**Also verify while you are in here:**
- the base image is `node:18-alpine`. The code uses `AbortSignal.timeout` (`llmFactory.js`), global `fetch`,
  and RegExp lookbehind (`apiAgent.js`). Determine whether Node 18 actually supports all three; if not, that is
  part of this fix. **Check, do not assume.**
- `CMD` vs. `package.json`'s `start` script — do they agree?

**Fix direction:** copy what the app reads at runtime; make the healthcheck meaningful enough to catch a missing
UI; stop baking a placeholder `.env`. Do **not** build or run the image (no daemon assumed) — reason from the
file and the repo contents, and say clearly in your report that the build was not executed.

**Acceptance:** a reviewer can trace every runtime file read in `src/` to a `COPY` in the Dockerfile. List that
mapping in your report.

---

## A7.2 — Two scripts ignore `JOBS_DB_PATH` (High — safety footgun)

`inspect_db.js:6` and `count_companies.js:6` both hardcode:
```js
const dbPath = path.join(__dirname, 'jobs.db');
```
`src/db/schema.js:7` honours `process.env.JOBS_DB_PATH`; these two do not. Anyone following the project's own
isolation convention finds it silently has no effect here, and the scripts read the real database instead.

Both are read-only (`SELECT`), so this corrupts nothing — but it defeats the isolation mechanism everything else
relies on, which is exactly the kind of gap that causes an accident later.

**Fix direction:** honour `JOBS_DB_PATH` with the same precedence as `schema.js`. Consider whether these scripts
should simply require the shared module instead of re-deriving the path — a second source of truth for the
database location is the underlying problem.

**Acceptance:** with `JOBS_DB_PATH` set to a temp database, both scripts read that database. With it unset,
behaviour is unchanged. Prove it by running them against a seeded temp database.

---

## Rules for this area

- **Never open the real `jobs.db`.** Point `JOBS_DB_PATH` at a temp file for all testing; `stat` the real file
  before and after and report that it is unchanged.
- Do not build or run Docker.
- Tests where practical under `test/`, `node:test` only, no new dependencies. For the Dockerfile, a reasoned
  written mapping is the deliverable rather than a test.
- Do not run git commands; do not commit.
