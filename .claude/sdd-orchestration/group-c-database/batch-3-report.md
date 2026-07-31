# Batch 3 report (FINAL) — Group C (Database) — Issues #30, #31, #32

## #30 — ON DELETE CASCADE declared but never enforced

**Fix:** `src/db/schema.js`
- `initializeDatabase()` now runs `db.run('PRAGMA foreign_keys = ON')` right
  after opening the connection (both the fresh-file and existing-file
  branches share this one call site, after the `if/else`).
- **Non-obvious second half of the fix, found during verification, not in
  the original brief:** setting the pragma once at startup was not enough.
  sql.js's `Database.export()` — called by `saveDatabase()`/`writeToDisk()`
  after nearly every write via `runWrite()` — closes the underlying sqlite3
  connection and reopens a fresh one internally before returning the
  serialized bytes. That reopen silently resets every connection-level
  PRAGMA, including `foreign_keys`, back to SQLite's off-by-default. A first
  pass that only set the pragma in `initializeDatabase()` passed a naive
  "delete right after startup" smoke test but failed a delete-after-several-
  writes test: cascades stopped firing after the very first `saveDatabase()`
  call. Fixed by re-asserting `PRAGMA foreign_keys = ON` inside
  `writeToDisk()`, immediately after `database.export()` returns, so
  enforcement survives every write/save cycle, not just the first one.
- Left `deleteCompany`/`deleteProfile`'s existing manual cleanup statements
  in place (updated their comments to explain why they're now technically
  redundant-but-harmless with cascade doing the same work) rather than
  removing them — smaller diff, no behavior change, and it's defense in
  depth if the pragma approach ever needs to be revisited.
- Verified empirically (see Tests below) that `position_profiles` and
  `tailored_resumes` rows are actually gone after `deleteCompany`/
  `deleteProfile`, not just that `PRAGMA foreign_keys` reads back as `1`.

## #31 — linkPositionToProfile swallowed every error identically

**Fix:** `src/db/queries.js` — `linkPositionToProfile()` now inspects
`e.message` for the UNIQUE-constraint case specifically, mirroring the
existing pattern in `addPosition()`/`addTailoredResume()`: a duplicate link
(`UNIQUE(position_id, profile_id)` collision) still returns `false` as a
silent no-op, but anything else (e.g. a `NOT NULL` violation from a bad
`positionId`/`profileId`) is rethrown instead of being indistinguishable
from the expected case.

## #32 — inconsistent not-found return shapes / unparsed JSON

**Fix:** `src/db/queries.js` — standardized on `null` (per the audit doc's
recommendation, and matching `getPositionById`'s existing behavior) rather
than `undefined`:
- `getCompanyById`, `getScrapeRunById`, `getProfileById`, and
  `getTailoredResumeById` (same latent inconsistency, not called out by name
  in the original issue text but caught by "audit the query functions") all
  now do `return result[0] || null;` instead of `return result[0];`.
- `getPositionsForProfile` — deleted entirely (function body + its
  `module.exports` entry), per the audit's finding that it has zero callers
  repo-wide (confirmed again with a fresh grep before deleting) and its
  unparsed JSON columns (`location_type`/`years_experience`/
  `seniority_level`) would otherwise need fixing for a function nothing
  calls. Left a comment explaining why it's gone rather than patched.
- Confirmed no caller anywhere compares these return values with
  `=== null`/`=== undefined` (repo-wide grep, matching the audit doc), so
  this is a pure consistency fix with no observable behavior change for
  existing callers — all of which already use truthy checks.

## Tests

New file: `test/db-cascade-and-shapes.test.js` (9 tests, all passing):
- **#30** — `deleteCompany` cascades through `positions` to
  `position_profiles` and `tailored_resumes` (asserted via raw `db.exec`
  counts, not through a query function that might mask the bug);
  `deleteProfile` cascades to `tailored_resumes` (a table it never touches
  directly); a third test specifically reproduces the export()-resets-the-
  pragma trap by inserting/deleting extra rows (forcing several
  `saveDatabase()` round-trips) before asserting cascade still fires.
- **#31** — linking the same position-profile pair twice returns `false`
  without throwing, and leaves exactly one row (no duplicate insert); linking
  with `null` ids (a genuine `NOT NULL` violation, not a `UNIQUE` one) throws
  and the error message is asserted.
- **#32** — `getCompanyById`/`getProfileById`/`getScrapeRunById`/
  `getPositionById`/`getTailoredResumeById` all return `null` (and
  specifically not `undefined`) for a missing row; `getPositionById`'s array
  fields are asserted to be real parsed arrays; `getPositionsForProfile` is
  asserted to no longer be exported.

All database interactions use `JOBS_DB_PATH` pointed at a fresh temp dir
(`fs.mkdtempSync`), following the existing convention in
`test/queries.rowid.test.js`; the real `jobs.db` fingerprint (existence,
size, mtime) is asserted unchanged before/after in an `after()` hook — it
does not exist in this worktree at all, so the check passed trivially.

## Test results

`npm test`: **224 passed, 0 failed** (215 inherited from batches 1-2 +
9 new). No regressions from enabling `PRAGMA foreign_keys = ON` — every
existing insert/link/delete path in the test suite already respects
parent/child ordering.

## Commit

See git log on branch `issues/group-c-database` for the commit referencing
"#30", "#31", and "#32".

## Files touched

- `src/db/schema.js` — `PRAGMA foreign_keys = ON` at connection open
  (`initializeDatabase()`) and re-asserted after every `export()`
  (`writeToDisk()`).
- `src/db/queries.js` — `linkPositionToProfile()` UNIQUE-specific error
  handling; `getCompanyById`/`getScrapeRunById`/`getProfileById`/
  `getTailoredResumeById` return `null` instead of `undefined`;
  `getPositionsForProfile` deleted (definition + export).
- `test/db-cascade-and-shapes.test.js` (new).

## Batch-1/2 logic — untouched

Verified `acquireLock()`/`releaseLock()`, `beginBatch()`/`endBatch()`/
`flushDatabase()`, the `dirty`-flag batching logic, and the `companies`
UNIQUE-constraint/`INSERT OR IGNORE` logic in `src/db/schema.js` and
`src/db/queries.js` (commits 4c9e8e3, 5cf05cc, e4d8fc1) were not modified —
this batch's changes to `writeToDisk()` are additive (one extra `PRAGMA`
call after the existing `export()`/`writeFileSync()`/`dirty = false`
sequence), and `linkPositionToProfile()`'s fix follows the same
try/catch-and-inspect-`e.message` shape `runWrite()`/`saveDatabase()`
already compose with elsewhere.

This was the last batch for Group C (Database). No further batches will be
started.
