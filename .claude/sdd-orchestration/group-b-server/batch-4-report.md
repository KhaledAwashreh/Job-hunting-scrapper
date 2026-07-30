# Group B — batch 4 (FINAL) report: issues #23, #24, #25

## What was changed (`src/server.js`)

### #23 — no rate limiting on the paid LLM-backed resume-tailor endpoint

Added an in-process sliding-window rate limiter in front of `POST /api/positions/:positionId/tailor`
(the file already had a similar precedent: `MIN_SCRAPE_INTERVAL_MS` guarding `POST /api/scrape/run`).

```js
const TAILOR_RATE_LIMIT_MAX = 10;
const TAILOR_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const tailorRequestLog = new Map(); // ip -> array of request timestamps (ms)

function tailorRateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const windowStart = now - TAILOR_RATE_LIMIT_WINDOW_MS;
  const timestamps = (tailorRequestLog.get(key) || []).filter(t => t > windowStart);
  if (timestamps.length >= TAILOR_RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((timestamps[0] + TAILOR_RATE_LIMIT_WINDOW_MS - now) / 1000);
    tailorRequestLog.set(key, timestamps);
    return res.status(429).json({ error: '...', retryAfter });
  }
  timestamps.push(now);
  tailorRequestLog.set(key, timestamps);
  next();
}

app.post('/api/positions/:positionId/tailor', tailorRateLimit, async (req, res) => { ... });
```

10 requests/minute per client IP, no new dependency (a `Map` of timestamps). Generous enough for
normal interactive use (comparing profiles/versions) but caps runaway LLM spend from a bug or
unauthenticated caller. The constant is documented inline; adjust `TAILOR_RATE_LIMIT_MAX` /
`TAILOR_RATE_LIMIT_WINDOW_MS` if it turns out too tight/loose in practice.

### #24 — static assets shipped without security headers

`express.static` (`:151`, was `:131` per U2.1's stale line numbers) was registered *before* the
security-header middleware, so `/styles.css`, `/countries.json`, etc. short-circuited out before ever
reaching it. Fix: moved the security-header middleware (CSP/X-Content-Type-Options/X-Frame-Options) to
run immediately after `express.json()` and before `express.static`. `/` was already covered (per U2.1's
corrected verdict) since it has no `public/index.html` and falls through to the explicit `app.get('/', ...)`
handler, which already ran after the header middleware — that ordering is unchanged.

### #25 — SIGTERM dropped in-flight requests

`gracefulShutdown()` called `process.exit(0)` immediately after issuing `server.close()`, never awaiting
its callback — confirmed by U2.4 to drop ~1/3 of in-flight requests under a real signal. Rewrote it to
track two booleans (`serverClosed`, `scraperDone`) and only call `process.exit(0)` once both are true,
via a shared `maybeExit()`, with the existing 30s hard-timeout kept as a fallback (`forced` flag) for
anything that never finishes. Also added `server.closeIdleConnections()` (Node 18.2+, guarded with a
`typeof` check) right after `server.close()` so idle keep-alive sockets with no request in flight don't
delay the close callback for no reason — this doesn't affect genuinely in-flight requests, which keep
their own sockets open until their response is sent.

## Tests added (all under `test/e2e/`)

- **`test/e2e/static-security-headers.e2e.js`** (#24) — boots the server via the existing harness and
  asserts `/`, `/styles.css`, and `/countries.json` all carry `content-security-policy`,
  `x-frame-options`, and `x-content-type-options`.
- **`test/e2e/tailor-rate-limit.e2e.js`** (#23) — fires `TAILOR_RATE_LIMIT_MAX + 5` concurrent tailor
  requests and asserts exactly `TAILOR_RATE_LIMIT_MAX` succeed (201) and the rest get 429 with an
  `error`/numeric `retryAfter` body. Each request targets a distinct seeded position (see
  "quirks found" below for why) to isolate the rate-limiter itself from an unrelated concurrency bug.
- **`test/e2e/graceful-shutdown.e2e.js`** (#25) — spawns the server directly, fires a tailor request
  against a deliberately slow mocked LLM call, sends a real `SIGTERM` ~200ms in (while the request is
  genuinely in-flight), and asserts the request still completes with 201 (not a connection reset),
  the process exits 0, and stdout actually contains "HTTP server closed" (previously unreachable on
  this path — direct evidence the fix works, matching U2.4's repro method).
- **`test/e2e/helpers/mockOllama.js`** — minimal fake of Ollama's `POST /api/chat` (configurable
  response delay), so both the rate-limit and shutdown tests exercise the real tailor code path
  without making real, billed Anthropic calls (server pointed at it via `TAILORING_PROVIDER=ollama` /
  `OLLAMA_BASE_URL`).
- **`test/e2e/helpers/seedTailorFixture.js`** — seeds a company/position(s)/profile combo for the
  tailor endpoint; supports seeding N positions sharing one profile for concurrency tests.
- **`test/e2e/helpers/fakeResumeCachePreload.js`** + **`test/e2e/helpers/resumeFixture.js`** — see below.

### Quirks found while testing (not fixed, out of scope for #23/#24/#25)

1. `startup()` calls `resumeCache.refresh()` with no directory argument, so it always reads from
   `resumeParser.js`'s hardcoded default (`<repo>/data/resumes`) rather than honoring the `RESUMES_DIR`
   env var the way uploads/deletes/traversal-checks do. A sibling test
   (`resume-delete-traversal.e2e.js`) already asserts as a hard invariant that the repo's real
   `data/resumes/` must never exist during an e2e run, so a test fixture can't just write a resume file
   into `RESUMES_DIR` and expect the tailor endpoint to find it. Worked around this with
   `fakeResumeCachePreload.js`, a `NODE_OPTIONS=--require` preload that swaps `resumeCache` for an
   in-memory fake in the require cache *before* `server.js` ever requires it — no filesystem writes at
   all, so it can't collide with that invariant. Flagging this RESUMES_DIR/resumeCache gap for a future
   ticket; did not touch it here to keep this diff scoped to #23/#24/#25.
2. `tailored_resumes` has a `UNIQUE(position_id, profile_id, version)` constraint, and
   `getNextVersionForPositionProfile()` + `addTailoredResume()` are not atomic — concurrent tailor
   requests against the *same* position+profile race to compute "next version" and collide, surfacing
   as 500s. Confirmed by first writing the rate-limit test against a single shared position (9 of the
   first 10 requests came back 500 instead of 201). Worked around by seeding one position per concurrent
   request in that test (version is always 1 for a fresh position+profile pair, so no collision) rather
   than fixing the underlying race, again to keep this diff scoped.

## Test results

- `npm test`: **201/201 pass**, 0 fail (no unit-test-covered code paths touched).
- `npm run test:e2e`: **99/99 pass**, 0 fail, 0 cancelled, 17 suites (14 pre-existing + the 3 new ones
  above; all pre-existing suites stayed green). The real `jobs.db` was confirmed absent from the
  worktree before and after the full run, and the worktree's `data/resumes/` was confirmed to not
  exist at the end of the run (the fake-resume-cache preload never touches disk).

## Commit

See `git log` on branch `issues/group-b-server` — commit message references "#23", "#24", "#25".
