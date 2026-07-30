# U3 — Database layer (UNCONFIRMED)

**Status:** independently verified 2026-07-30. U3.1 CONFIRMED (mechanism reproduced) but
CORRECTED on reachability/severity — split into a Medium cross-process file-clobber hazard and a
newly-surfaced Low-Medium same-process tailor-resume race. U3.2 CONFIRMED as described, including
the migration hazard (tested directly). U3.3 CONFIRMED as an inconsistency but REFUTED as a live
bug (no caller distinguishes `null`/`undefined`). U3.4 CONFIRMED as described and CORRECTED from
"bug" to "dead code" (zero callers found repo-wide). See per-item "Verdict" sections below for
commands, output, and reasoning. All checks ran against `JOBS_DB_PATH`-isolated temp databases;
the real `jobs.db` was never opened (verified via `stat` before/after — unchanged, same size and
mtime).
**Files:** `src/db/schema.js`, `src/db/queries.js`

`createScrapeRun` returning `1` was confirmed separately and is being fixed under
`docs/review/confirmed/A3-database-rowid.md`. **Do not duplicate that.** The items below are the remainder.

---

## U3.1 — Concurrent writers silently lose data (claimed Critical)

**Claim:** sql.js holds the whole database in memory and rewrites the entire file on every save
(`schema.js:160-165`). Two Node processes each inserted a company; one row vanished with no error, and both
received id `1`.

**Verify.** Then go further than the original reviewer and establish the part that actually matters:
1. **Can this happen in normal use?** Which real workflows run a second process against the same database while
   the server is up — the root scripts? A manual `node inspect_db.js`? A second server instance? Be concrete.
2. Is the web server itself ever concurrent in a way that triggers it, given Node is single-threaded but the
   handlers are `async` and `saveDatabase` is synchronous? Reason carefully and test if you can.
3. Does `addTailoredResume`'s read-then-insert version pattern (`:315-335`, `:359-365`) make this worse?

A confirmed-but-unreachable hazard should be labelled as such. Severity here depends entirely on reachability.

### Verdict: CONFIRMED (mechanism), CORRECTED (reachability/severity)

**Mechanism, reproduced on current code.** `JOBS_DB_PATH` pointed at a fresh temp file, two
separate `node` processes each `require`d the CURRENT `src/db/schema.js`/`src/db/queries.js`
(post b61f2f6) and each called `addCompany()` after a short artificial delay:

```
( JOBS_DB_PATH=$f node scratch/test_concurrent_processes.js A 300 & \
  JOBS_DB_PATH=$f node scratch/test_concurrent_processes.js B 100 & wait )
```
Output:
```
[process B] addCompany returned id=1
[process A] addCompany returned id=1
```
Re-reading the resulting file afterward:
```
[[1,"Company-A"]]
```
Company-B vanished with no error, and both processes reported id `1` — exactly as the original
reviewer described. Root cause confirmed at `schema.js:160-165`: `saveDatabase()` does
`database.export()` + `fs.writeFileSync()`, an unconditional full-snapshot overwrite with no
locking, no merge, and no version check. Whichever process's in-memory snapshot is exported last
wins in full; the other process's entire session of writes disappears silently.

**Does b61f2f6 change this? No.** That commit only changed *when* `createScrapeRun` reads
`last_insert_rowid()` relative to `saveDatabase()` (an intra-process ordering bug). It has nothing
to do with the cross-process file-clobber mechanism above — `addCompany` already captured its id
via `db.exec('SELECT last_insert_rowid()')` *before* `saveDatabase()`, both before and after
b61f2f6, and the repro above still loses a whole row regardless. This claim's severity is
independent of the A3 fix.

**1. Reachability — which real workflows run a second process against the same DB?**
Concretely, in this repo:
- `bulk-add-companies.js` — a standalone root script (`node bulk-add-companies.js`) that calls
  `initializeDatabase()` + `addCompany()` in a loop, with no lock and no coordination with a
  running server. Nothing prevents a user from running it while `npm start`/`node
  src/server.js` is already up (there's no README warning, no PID check, no "stop the server
  first" instruction). This is the one clearly real, user-facing path to data loss.
- `inspect_db.js` and `count_companies.js` — read-only (`SQL.Database(buffer)` + `db.exec`
  SELECTs, never `saveDatabase()`/`writeFileSync`). Verified by reading both files in full:
  **not a risk**, contrary to what one might assume from the "second process touches the db"
  framing.
- `full-validation.js` / `validate-imports.js` — only assert that `queries`/`schema` *export* the
  right function names (`typeof queries[fn] === 'function'`); neither calls
  `initializeDatabase()`. **Not a risk.**
- The test suite — grepped every `test/*.test.js` for `db/schema`/`db/queries` imports; every
  test file that touches the DB sets `JOBS_DB_PATH` to its own temp file (per repo convention).
  **Not a risk** as long as that convention holds, but it is a convention, not an enforced
  guarantee — a future test that forgets to set `JOBS_DB_PATH` would silently target the real
  `jobs.db` and could race a running server.
- A second `npm start`/`node src/server.js` instance (e.g. forgetting one is already running in
  another terminal) — analytically confirmed to also be a risk, though not independently
  reproduced under controlled timing (the race window for this specific sub-case is narrow: it
  requires the second process's fast schema-init-and-resave to straddle a slower first-process
  write). Analytically: `initializeDatabase()` calls `saveDatabase()` **unconditionally**
  (`schema.js:150`) at the end of every call, even if the process never performs a user-directed
  write and even if it's about to crash on `EADDRINUSE` when it reaches `app.listen()`
  (`server.js` has no `server.on('error', ...)` handler, so a bind failure becomes an
  `uncaughtException` and `process.exit(1)` — but only *after* `startup()`, i.e. after
  `initializeDatabase()`, has already resaved the file once). So simply mis-starting a second
  server instance is a real, low-effort way to trigger one clobber, on top of the
  `bulk-add-companies.js` path.

  Revised: reachable via at least one concrete, undocumented, user-triggerable workflow
  (`bulk-add-companies.js` run alongside a live server), plus a second, analytically-supported
  path (accidental second server instance). Not reachable via `inspect_db.js`,
  `count_companies.js`, `full-validation.js`, `validate-imports.js`, or the test suite.

**2. Is the single-threaded server itself ever concurrent in a way that triggers this?**
Yes — but via a *different*, narrower mechanism than the cross-process file clobber, and it does
**not** need a second OS process at all. `POST /api/positions/:id/tailor` in `src/server.js`
(lines 522-614) is fully synchronous through `getNextVersionForPositionProfile()` (line 582), then
`await tailorResume(...)` (an LLM call, line 585 — genuinely slow, seconds), then
`addTailoredResume()` (line 594). Two concurrent requests for the *same* position+profile (double
click, two browser tabs, a client retry) can both execute the synchronous version-read before
either finishes its `await`, both compute the same next `version`, and then race to insert.
Reproduced directly (same process, no second OS process, `JOBS_DB_PATH` on a fresh temp file):
```
[requestB] read version=1, addTailoredResume -> id=1, isDuplicate=false
[requestA] read version=1, addTailoredResume -> id=null, isDuplicate=true
```
This is caught by the `UNIQUE(position_id, profile_id, version)` constraint on
`tailored_resumes` — so it is **not** silent data loss like U3.1's file-clobber case. The loser
gets `result.id === null`, and `server.js:602-604` turns that into an HTTP 500 ("Failed to save
tailored resume"), while the (possibly expensive) LLM-generated text for that request is simply
discarded. So: real, reachable, single-process bug — but its failure mode is "wasted LLM call +
user-facing 500," not silent loss, and it is a distinct issue from U3.1's core claim (which is
specifically about the whole-file overwrite in `saveDatabase()`). Every other write path in
`queries.js` is synchronous end-to-end (`runWrite`, or explicit `db.run`+`last_insert_rowid()`,
with no `await` in between read and write), so this race pattern is specific to
`addTailoredResume`'s call site, not general to the server.

**3. Does `addTailoredResume`'s read-then-insert pattern make U3.1 worse?** Yes, in the sense
above — it's the one place a race can happen *within a single server process* without any second
OS process, which the original claim (framed entirely around "two Node processes") didn't
consider. Its severity is lower than the cross-process case (constraint-caught error, not silent
loss) but its reachability is higher (no second process needed, just a double click).

**Revised severity:** Split into two findings.
- Cross-process whole-file overwrite (`schema.js:160-165`): **Medium**, not Critical as claimed —
  real and reproduced, but reachable only through an undocumented manual workflow
  (`bulk-add-companies.js` while the server is running) or an accidental second server instance,
  not through any normal single-user operation of this app.
- Same-process tailor-resume version race (`server.js:582-604`): **Low-Medium**, new finding
  surfaced by this verification — reachable by ordinary UI double-clicks/multi-tab use, but fails
  loudly (500 + wasted LLM call) rather than silently losing data.

---

## U3.2 — No UNIQUE constraint on companies (claimed Medium)

**Claim:** the same company (identical name and career_url) can be inserted repeatedly; `POST /api/companies`
has no guard. Related: `bulk-add-companies.js` relies on catching a `UNIQUE constraint` error that can never
fire.

**Verify.** Recommend where the constraint belongs (schema, query layer, or route) — but **do not implement it**.
Note explicitly whether adding a UNIQUE constraint would fail against the user's existing live database if it
already contains duplicates. That is a migration hazard the user must decide on.

### Verdict: CONFIRMED

On a fresh `JOBS_DB_PATH` temp DB (current `schema.js`/`queries.js`), inserted the same
`(name, career_url)` pair via `addCompany()` twice:
```
Inserted duplicate company twice, ids: 1 2
Rows now: 2
```
Confirmed: no constraint, no application-level guard in `addCompany()` or in
`POST /api/companies` (`src/server.js`), duplicates insert cleanly with distinct ids.

Also confirmed the related claim about `bulk-add-companies.js:109` (`if (err.message &&
err.message.includes('UNIQUE constraint'))`): since `addCompany()`'s `INSERT` never violates any
constraint today (companies has none), that `catch` branch is unreachable dead code — the "-
Skipped (already exists)" log line can never print, and `bulk-add-companies.js` run twice will
silently double every company in the list instead of skipping.

**Migration hazard, tested directly.** After the duplicate insert above, attempted
`CREATE UNIQUE INDEX idx_companies_unique ON companies(name, career_url)` against that same
in-memory/on-disk database:
```
UNIQUE index creation FAILED as expected against existing dupes: UNIQUE constraint failed: companies.name, companies.career_url
```
Confirmed: adding a UNIQUE constraint (whether via a new `UNIQUE` column constraint that forces a
table rebuild, or via `CREATE UNIQUE INDEX`) **will fail outright** against any existing database
— including potentially the user's real `jobs.db` — that already contains duplicate
`(name, career_url)` pairs. This is a genuine migration hazard: any fix must first deduplicate
existing rows (and decide what to do with positions/links that point at the rows being merged or
dropped) before the constraint can be added. This is a decision for the user, not something to
implement here.

**Recommendation (not implemented):** the constraint belongs in the schema
(`CREATE UNIQUE INDEX IF NOT EXISTS ... ON companies(name, career_url)` alongside the other
`CREATE TABLE`/`ALTER TABLE` statements in `schema.js`), mirroring how `positions.hash` and
`position_profiles`/`tailored_resumes` already do it — that's the layer that currently owns all
other uniqueness rules in this codebase, and it makes `addCompany()`'s existing
`UNIQUE`-error-catching pattern (already implemented for `addPosition`/`addTailoredResume`) trivial
to extend to companies too. Doing it only at the route layer (`POST /api/companies`) would leave
`bulk-add-companies.js` and any other direct `addCompany()` caller unprotected. Before adding it,
the existing `jobs.db` needs a one-time dedup pass — that migration should be a deliberate,
reviewed step, not a side effect of this fix.

Severity: claim's **Medium** stands, confirmed as described.

---

## U3.3 — Inconsistent not-found return shapes (claimed Low)

**Claim:** `getCompanyById`, `getProfileById` and `getScrapeRunById` return `undefined` for a missing row, while
`getPositionById` returns `null`.

**Verify**, and check whether any caller actually compares with `=== null` — that determines whether this is a
live bug or a latent inconsistency. Search `src/` for callers.

### Verdict: CONFIRMED as described, CORRECTED severity to "latent only" (no live bug found)

Empirically confirmed the exact shapes on a fresh temp DB, querying a nonexistent id in each case:
```
getCompanyById(999)   -> undefined  (typeof undefined)
getProfileById(999)   -> undefined  (typeof undefined)
getScrapeRunById(999) -> undefined  (typeof undefined)
getPositionById(999)  -> null       (typeof object)
```
Matches the source: `getCompanyById`/`getProfileById`/`getScrapeRunById` all do `return
result[0]` on a possibly-empty array (`undefined` when empty); `getPositionById` explicitly checks
`if (raw.length === 0) return null;` (`queries.js:184`).

**Caller check.** `grep -rn "=== null\|== null\|!== null" src/ test/` across the whole codebase
returned **zero matches**. Every caller of all four functions
(`src/server.js:280,311,452,467,493,528,554`) uses a plain truthiness check (`if (!company)`, `if
(!profile)`, `if (!position)`), which treats `undefined` and `null` identically. No caller
anywhere distinguishes the two return shapes.

**Conclusion:** confirmed as a real inconsistency in the code, but refuted as a live bug — it has
zero observable effect on current behavior since nothing branches on the distinction. Severity
correctly stays **Low**, but should be described as "cosmetic/latent inconsistency, no live
bug found" rather than left ambiguous.

---

## U3.4 — `getPositionsForProfile` returns unparsed JSON strings (claimed Low)

**Claim:** it returns raw JSON strings for `location_type` / `years_experience` / `seniority_level` where every
other position accessor returns arrays.

**Verify**, and confirm whether it has any caller at all. If it is genuinely unreferenced, say so — that changes
this from a bug to dead code, and the right recommendation may be deletion.

### Verdict: CONFIRMED, and CORRECTED from "bug" to "dead code"

**JSON-string claim confirmed empirically.** On a fresh temp DB, inserted a position with
`location_type=['remote']`, `years_experience=['3-5']`, `seniority_level=['mid']`, linked it to a
profile, then called `getPositionsForProfile()`:
```
location_type:    "[\"remote\"]"  (typeof string)
years_experience: "[\"3-5\"]"     (typeof string)
seniority_level:  "[\"mid\"]"     (typeof string)
```
Confirmed: unlike `getAllPositions`, `getPositionsByFilters`, and `getPositionById` — which all
map their raw rows through `ensureArray()` for these three columns — `getPositionsForProfile`
(`queries.js:284-293`) returns the raw SQLite text column untouched.

**Caller check.** `grep -rn "getPositionsForProfile" --include="*.js" .` (repo-wide, excluding
`node_modules`) returns only the function's own definition and its `module.exports` entry in
`src/db/queries.js`. No file in `src/`, `test/`, or any root script calls it.

**Conclusion:** confirmed as genuinely dead code, not a live bug — there is no caller to be
affected by the unparsed-JSON shape. Recommend deletion (or, if it's meant to back a near-term
feature, fixing the `ensureArray` gap at the same time it gets its first caller) rather than
patching a function nothing calls. Severity revised from Low-as-a-bug to **Low, and framed as
dead-code cleanup rather than a correctness fix**.

---

## Rules

- **Do not fix anything.** Do not edit any file outside this document.
- You MAY edit this document: correct claims, adjust severities, add evidence, mark items refuted.
- Every database interaction MUST use `JOBS_DB_PATH` pointed at a fresh temp file. **Never open the real
  `jobs.db`.** `stat` it before and after; report the check.
- Run scripts with the repo as cwd so `sql.js` resolves. Scratch scripts under /tmp only.
