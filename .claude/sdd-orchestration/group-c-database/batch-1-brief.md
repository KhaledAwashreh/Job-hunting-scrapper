# Batch 1 — Group C (Database layer) — Issues #26, #28

Worktree: `/home/kawashreh/Projects/Job-hunting-scrapper/.claude/worktrees/group-c-database`
Branch: `issues/group-c-database`
Files: `src/db/queries.js`, `src/db/schema.js`

## Do NOT re-fix

`docs/review/confirmed/A3-database-rowid.md` already fixed `createScrapeRun` always returning row 1
(a bug where `saveDatabase()`/`export()` resets `last_insert_rowid()`). That fix is already committed
on this branch. Do not touch that mechanism/logic — your job is the broader performance/serialization
issue below, which is a separate concern even though it involves the same `saveDatabase()` function.

## GitHub Issue #26 (verbatim)

**Title:** Concurrent writers against the same jobs.db can silently lose rows

**Severity: Medium** (corrected down from "Critical" — reachable but only via an undocumented manual workflow, not normal server operation)

sql.js holds the whole database in memory and does a full `export()` + `writeFileSync()` on every write (`schema.js:160-165`), with no locking. Reproduced: two Node processes each inserting a company both reported id `1`, and one row silently vanished after the second `saveDatabase()` call.

**Reachability, confirmed concretely:** the normal server process is single-threaded and not at risk from itself. The real exposure is `bulk-add-companies.js` (or any other root script) run manually while the server is already up — both processes will `saveDatabase()` against the same file and the loser's writes vanish with no error. An accidental second server instance has the same effect (it resaves on `initializeDatabase()` before hitting `EADDRINUSE`).

### Fix direction
Either serialize writes through the single server process only (document "don't run root scripts against jobs.db while the server is up"), or add a file lock (e.g. `proper-lockfile`) around `saveDatabase()`.

Full repro: `docs/review/unconfirmed/U3-database.md`, item U3.1.

## GitHub Issue #28 (verbatim)

**Title:** saveDatabase() rewrites the entire database file on every single write, causing near-quadratic slowdown during scraping

**Severity: High**

`runWrite()` (`queries.js:16-20`) calls `saveDatabase()` after every single insert, and `saveDatabase()` (`schema.js:160-165`) serializes the **entire** in-memory DB (`database.export()`) and rewrites the whole file on disk. `addPosition` is called once per scraped job inside a nested loop in `orchestrator.js` (~lines 248-399) with no batching, so scrape time grows with the square of the database size, not linearly with new positions.

Measured by inserting positions one at a time into a growing DB:
```
after  500 inserts: marginal cost for last 500 =  500ms
after 2000 inserts: marginal cost for last 500 = 1948ms
after 4000 inserts: marginal cost for last 500 = 3379ms
```
Marginal cost per 500 rows grew ~7x as the file grew ~7x — clearly superlinear. As `jobs.db` accumulates positions over repeated daily runs, every subsequent scrape gets slower, and large runs risk stalling the single-threaded server for seconds mid-scrape (`saveDatabase` is synchronous).

### Fix direction
Batch writes within a scrape run (accumulate inserts, `saveDatabase()` once at the end or every N rows) rather than after every single `runWrite()` call.

Found by independent audit of `docs/review/unconfirmed/U3-database.md`.

## U3-database.md excerpt (U3.1 — authoritative technical brief, corrected reachability/severity)

**Verdict: CONFIRMED (mechanism), CORRECTED (reachability/severity)**

Root cause confirmed at `schema.js:160-165`: `saveDatabase()` does `database.export()` + `fs.writeFileSync()`,
an unconditional full-snapshot overwrite with no locking, no merge, and no version check. Whichever
process's in-memory snapshot is exported last wins in full; the other process's entire session of
writes disappears silently.

Reachable via: (1) `bulk-add-companies.js` run alongside a live server (concrete, user-triggerable,
undocumented), (2) an accidental second `npm start`/`node src/server.js` instance (analytically
supported — `initializeDatabase()` calls `saveDatabase()` unconditionally even before a later
`EADDRINUSE` crash). NOT reachable via `inspect_db.js`, `count_companies.js`, `full-validation.js`,
`validate-imports.js`, or the test suite (all of which either are read-only or set `JOBS_DB_PATH` to
an isolated temp file per repo convention).

Separately, `addTailoredResume`'s read-then-await-then-insert pattern in `server.js`'s tailor
endpoint is a same-process race — that is issue #27, in Batch 2. Do not fix it here; it needs no
second OS process and has a different (constraint-caught, not silent) failure mode. Your batch is
about `saveDatabase()`'s cross-process file-clobber (#26) and its unconditional full-export cost on
every write (#28).

## Suggested fix direction for this batch

You have judgment here — pick a design that satisfies both issues without a new runtime dependency
(no `proper-lockfile`, no new npm packages — see Global Constraints). Reasonable approaches:

- **For #28 (perf):** stop calling `saveDatabase()` on every single `runWrite()`/write call. Introduce
  batching/debouncing: e.g. an explicit "flush" step callable by orchestrator-style bulk-write callers,
  and/or a debounced/deferred save (e.g. save at most once per N writes or once per tick via
  `setImmediate`/a dirty flag), while preserving the existing synchronous-return contract that callers
  depend on (e.g. `addCompany`/`addPosition`/`createScrapeRun` return ids computed via
  `last_insert_rowid()` BEFORE any save — do not disturb that ordering, which A3 already fixed).
  Ensure normal server request handlers still end up durably persisted in a bounded/reasonable time
  (do not silently defer saves forever — e.g. flush at process exit / after each request cycle / after
  each scrape run, and document the chosen policy in a comment).
- **For #26 (cross-process safety):** since no new dependency is allowed, consider an advisory lock
  built from primitives already available (e.g. `fs` — a lockfile using `fs.writeFileSync` with the
  `wx` flag, checked/created around the save, with a stale-lock timeout), OR document + enforce
  (e.g. a runtime guard that fails fast with a clear error) that a second process must not write
  concurrently, OR another approach you can justify. Explain your chosen tradeoff in commit message /
  code comments. The goal is: no more silent, undetected row loss — either prevent the race, or make
  concurrent writers fail loudly instead of silently losing data.

Both fixes touch `saveDatabase()`/`runWrite()` in `schema.js`/`queries.js`, so they are natural to
solve together in one coherent design rather than as two unrelated patches.

## Global Constraints (verbatim — apply to all batches)

- CommonJS only (`require`/`module.exports`). No ES modules, no TypeScript.
- No new runtime dependencies.
- Async/await, no raw promise chains. 2-space indentation. Comments only where non-obvious.
- Write complete files, no stubs/TODOs.
- Tests are kept under `test/`, never deleted to make them pass.
- Never modify or open the repo's real `jobs.db` or `data/resumes/` — tests use temp/in-memory DBs.
- Do not reformat untouched code; keep diffs scoped.
