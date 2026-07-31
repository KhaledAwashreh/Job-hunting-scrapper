# Batch 2 report — Group C (Database) — Issues #27, #29

## Summary

Picked up from a previous agent's in-progress, uncommitted diff. The existing
work for both issues was substantively complete and well-reasoned; it needed
one real bug fixed (unrelated pre-existing issue that blocked the required
#27 e2e test from actually exercising the endpoint) and then verification.

## #27 — resume-tailor endpoint same-process version race

`POST /api/positions/:id/tailor` read the current `version` synchronously,
awaited a (slow, paid) LLM call, then inserted. Two concurrent requests for
the same position+profile (double click, two tabs, a client retry) both read
the same next version before either finished its `await`, then raced to
insert — the loser hit the `UNIQUE(position_id, profile_id, version)`
constraint and got an unhandled 500 after already paying for an LLM call it
could never save.

**Fix (already present in the inherited diff, verified correct):**
`src/server.js` adds an in-process `Set` (`tailoringInFlight`), keyed on
`${positionId}:${profileId}`. The handler does a synchronous check-and-set
against it before any version read or LLM call (safe under Node's
single-threaded event loop — no `await` between check and set), returning a
clean `409` for a second concurrent request instead of racing it. The guard
is released in a `finally` block regardless of how the request ends (success,
error, or an early return such as position/profile not found), so it can
never get stuck.

**Bug found and fixed in this batch:** the e2e test for this (see below)
initially failed with `404 Base resume file not found for this profile` on
every request — not a race-related failure. Root cause, pre-existing and
unrelated to #26/#27/#28/#29: `resumeCache.refresh()` is called with no
argument in `startup()` (`src/server.js`), so it always parses resumes from
`resumeParser.js`'s hardcoded default directory (`data/resumes`) rather than
from the `RESUMES_DIR` env var the rest of `server.js` already resolves and
documents as a test override (see the comment above `RESUMES_DIR`'s
definition). This makes `RESUMES_DIR` silently inert for any resume the
tailor endpoint needs to find at startup, which is exactly the isolation the
new e2e test (and any future test of a resume-dependent endpoint) needs.
Fixed by passing `RESUMES_DIR` through: `await resumeCache.refresh(RESUMES_DIR)`.
Left the two other `resumeCache.refresh()` call sites (upload/delete
handlers) untouched — `test/server.resumes.test.js` asserts their literal
no-arg call text, and neither is on the path the required #27 test needs.

## #29 — companies table has no UNIQUE constraint

`companies` had no UNIQUE column/index on `(name, career_url)`, so identical
inserts succeeded as distinct rows; `bulk-add-companies.js`'s
`err.message.includes('UNIQUE constraint')` skip branch was confirmed dead
code (rerunning the script duplicated every company).

**Fix (already present in the inherited diff, verified correct):**
- `src/db/schema.js` — `UNIQUE(name, career_url)` added inline to
  `CREATE TABLE companies` (covers fresh databases), plus a best-effort
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_career_url ON
  companies(name, career_url)` so the constraint also applies retroactively
  to an existing `jobs.db`. If that existing db already has duplicate rows,
  the index creation throws (`UNIQUE constraint failed`) and is caught with a
  clear log message rather than crashing startup — a real migration hazard
  documented in `docs/review/unconfirmed/U3-database.md` (U3.2) that needs a
  deliberate dedup pass, correctly called out as out of scope for this fix
  rather than silently swallowed or blindly forced.
- `src/db/queries.js` — `addCompany()` uses `INSERT OR IGNORE`; on a
  collision (`getRowsModified() === 0`) it re-selects and returns the
  existing row's id instead of throwing, so every existing caller's contract
  (always returns a real numeric id, never throws on a duplicate) is
  preserved. New `companyExists(name, careerUrl)` lets a caller check before
  doing expensive work (platform detection) for a company that's already
  there.
- `bulk-add-companies.js` — pre-checks `companyExists()` before the
  network round-trip to `detectPlatformAndSlug()`, reports "skipped"
  accurately, and no longer relies on the now-impossible
  `UNIQUE constraint` string match in its `catch` block (anything landing
  there now is a genuine unexpected error).

No changes needed here beyond what was inherited — reviewed the logic
carefully (INSERT OR IGNORE + re-select race window, `getRowsModified()`
usage, the retroactive-index try/catch) and it holds up.

## Batch-1 lock/batching logic — untouched

Verified `acquireLock()`, `beginBatch()`/`endBatch()`/`flushDatabase()`, and
the `dirty`-flag write-batching logic in `src/db/schema.js` (commits
4c9e8e3, 5cf05cc) were not modified by this batch's diff — the only changes
to `schema.js` are additive, inside/after the `companies` table definition.

## Tests

- `test/companies-unique.test.js` (new, inherited from previous agent,
  verified correct as written) — schema-level UNIQUE enforcement via a raw
  `db.run()` duplicate insert; `addCompany()` returns the same id on a
  duplicate instead of throwing; `companyExists()` correctness;
  same-name-different-`career_url` is NOT treated as a duplicate; and a
  full simulation of `bulk-add-companies.js`'s per-company logic run twice
  produces zero duplicate rows and no unhandled error.
- `test/e2e/tailor-resume-concurrency.e2e.js` (new, inherited, fixed to
  actually pass) — spawns the real server as a child process against an
  isolated temp `jobs.db` and `RESUMES_DIR`, with a local mock HTTP server
  standing in for the LLM (counts its own invocations, holds each request
  open long enough to guarantee both concurrent requests are in flight).
  Fires two concurrent `POST /api/positions/:id/tailor` requests for the
  same position+profile and asserts: exactly one `201` and one `409` (never
  `500`); the mock LLM was invoked exactly once (proves the rejected request
  never reached the LLM call, not just that it eventually failed); exactly
  one `tailored_resumes` row exists after the race; and the guard releases
  correctly (a follow-up request after the first completes gets a fresh
  `201`, not a permanently stuck `409`). Also asserts the real `jobs.db` is
  never touched.

## Test results

- `npm test`: **215 passed, 0 failed** (no regressions vs. batch 1's 208;
  +7 from `companies-unique.test.js`).
- `npm run test:e2e`: **48 passed, 0 failed**, including all 4 subtests of
  the new `tailor-resume-concurrency.e2e.js` suite.

## Commit

See git log on branch `issues/group-c-database` for the commit referencing
"#27" and "#29".

## Files touched

- `src/server.js` — #27 in-flight guard on the tailor endpoint (inherited);
  fixed `startup()` to pass `RESUMES_DIR` into `resumeCache.refresh()` (new
  in this batch — required for the endpoint to be reachable/testable in an
  isolated environment at all).
- `src/db/schema.js` — #29 UNIQUE constraint + retroactive index (inherited).
- `src/db/queries.js` — #29 `addCompany()` INSERT OR IGNORE + `companyExists()`
  (inherited).
- `bulk-add-companies.js` — #29 pre-check with `companyExists()` (inherited).
- `test/companies-unique.test.js` (new, inherited).
- `test/e2e/tailor-resume-concurrency.e2e.js` (new, inherited).
