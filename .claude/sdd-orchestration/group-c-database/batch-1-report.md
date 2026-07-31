# Batch 1 report — Group C (Database layer) — Issues #26, #28

## Summary

Both issues were root-caused in the same place (`saveDatabase()` in
`src/db/schema.js`) and fixed together without adding any new dependency.

## #28 — near-quadratic save cost during scraping

`runWrite()` called `saveDatabase()` after every single write, and
`saveDatabase()` does a full `database.export()` + `fs.writeFileSync()` of the
whole in-memory DB every time. `addPosition()` runs once per scraped job in
`orchestrator.js`'s scrape loop, so save cost (and scrape time) grew with the
square of the database size.

**Fix:** `src/db/schema.js` now has a batching mode:
- `saveDatabase()` keeps its existing contract for every current caller
  (server request handlers, `addCompany`, `createScrapeRun`, etc.) — outside a
  batch it still writes to disk immediately, so single-write durability is
  unchanged.
- `beginBatch()` / `endBatch()` let a bulk caller defer the actual
  export+write: while a batch is open, `saveDatabase()` just marks the DB
  dirty; `endBatch()` (or an explicit `flushDatabase()`) does the real write.
- `orchestrator.js`'s `runScraper()` now wraps the whole companies loop in
  `beginBatch()`/`endBatch()`, and calls `flushDatabase()` once per company
  (in a `finally`, so it runs whether or not that company errored) as a
  durability checkpoint — a crash mid-run loses at most one company's
  unsaved positions, not the whole run. `endBatch()` in the outer `finally`
  guarantees a final flush on every exit path (success, thrown error, or
  scrape timeout).
- `queries.js` re-exports `flushDatabase`/`beginBatch`/`endBatch` from
  `schema.js` so callers only need one require.

This does not touch A3's `createScrapeRun` fix: it still reads
`last_insert_rowid()` via `db.exec()` immediately after `db.run()`, before any
`saveDatabase()` call — batching only changes *when the disk write happens*,
never when `db.run()`/id-reads happen, so ordering guarantees A3 depends on
are untouched.

## #26 — concurrent writers can silently lose rows

sql.js has no shared-file concept: two OS processes opening the same
`jobs.db` (e.g. `bulk-add-companies.js` run while the server is up, or an
accidental second server instance) each hold an independent in-memory
snapshot; whichever saves last wins in full and the other's entire session of
writes vanishes with no error. A lock only around the `writeFileSync` step
can't actually fix this — a second process may have already read a stale
snapshot before ever reaching that step — so the fix makes concurrent access
fail loudly instead of silently corrupting data, per the brief's documented
alternative.

**Fix:** `src/db/schema.js` adds an advisory lock, built from `fs.mkdirSync`
(atomic directory creation — no new dependency), held for the whole lifetime
of a process's database session:
- `initializeDatabase()` calls `acquireLock()` first, before touching the
  file. It creates `<dbPath>.lock/` and writes the holder's pid inside.
- If the lock directory already exists, it reads the stored pid and checks
  liveness with `process.kill(pid, 0)` (built-in, no dependency). A live
  holder produces a clear thrown error naming the pid and the lock path
  instead of proceeding. A dead holder (crash / `kill -9`, which skips our
  cleanup) is treated as an orphaned lock and reclaimed automatically.
- `process.on('exit', releaseLock)` removes the lock directory on normal
  exit, `process.exit()` calls, and caught signals — covering the server's
  existing SIGTERM/SIGINT/uncaughtException handling. SIGKILL can't be
  caught by design; that's exactly what the pid-liveness check on the next
  `initializeDatabase()` handles.

Read-only scripts (`inspect_db.js`, `count_companies.js`) never call
`initializeDatabase()`, so they're correctly unaffected and remain safe to
run alongside a live server, matching the brief's confirmed reachability
analysis.

## Tests added

- `test/db-write-batching.test.js` — counts real `fs.writeFileSync(dbPath,
  ...)` calls (the exact operation the issue measured scaling ~7x for a ~7x
  larger DB) to prove: unbatched writes are unchanged (one write per insert);
  a batch of 200 inserts costs exactly one write; `flushDatabase()` commits
  mid-batch without ending it; and write count scales with number of
  *batches*, not number of *rows* (the actual mechanism behind the
  near-quadratic cost). Also verifies data durability by reloading rows
  through the normal query path after a flush.
- `test/db-concurrent-lock.test.js` — spawns real second Node processes
  (not an in-process simulation) against the same db file to prove: a second
  writer while the first still holds the db is refused with a clear error
  and the first process's data is untouched; the lock releases on normal
  exit so a later run against the same path succeeds; and a lock left behind
  by a process that's no longer running is detected as stale and reclaimed.

Both new files follow the existing `queries.rowid.test.js` /
`scripts.jobs-db-path.test.js` convention: `JOBS_DB_PATH` is set to a fresh
temp file before `schema.js` is required, and each file's `after()` hook
asserts the real `jobs.db` was never touched.

## Test results

`npm test`: **208 passed, 0 failed** (201 pre-existing + 7 new). No existing
test was modified or deleted.

`full-validation.js` and `git stash` comparison confirm its 8 pre-existing
failures (missing `playwrightAgent.js`, `hashContent`, `extractJobType`, etc.)
are unrelated to this batch — identical with and without these changes.

## Commit

See git log on branch `issues/group-c-database` for the commit referencing
"#26" and "#28".

## Files touched

- `src/db/schema.js` — cross-process lock + batched-save mechanism
- `src/db/queries.js` — re-export batching controls
- `src/agents/orchestrator.js` — wrap the scrape loop in beginBatch/endBatch
  with a per-company flush checkpoint
- `test/db-write-batching.test.js` (new)
- `test/db-concurrent-lock.test.js` (new)
