# A3 — Scrape run IDs

**Status:** confirmed by execution · **Owner:** fix agent A3
**Files:** `src/db/queries.js` (and `src/db/schema.js` if needed)

## A3.1 — `createScrapeRun` always returns 1 (Critical)

`queries.js:195-199`. `runWrite()` calls `saveDatabase()` → `database.export()` immediately after the INSERT.
**`export()` resets the connection's `last_insert_rowid()` to 0.** The subsequent
`SELECT last_insert_rowid()` therefore returns `0`, and line 198 is `result[0]?.id || 1` — `0` is falsy, so the
hardcoded fallback `1` is returned.

**Reproduced against a temp database:**
```
createScrapeRun returned: [1,1,1]
actual rows in table  : [3,2,1]
```

Every scrape run after the first writes its stats onto row 1 via `updateScrapeRun`. Rows 2..n keep
`finished_at = NULL` permanently, so the Run Log is fiction.

**Note the precedent:** `addPosition` has a comment stating `last_insert_rowid()` was unreliable under sql.js and
works around it by re-selecting on the unique `hash`. That workaround was never applied elsewhere.

**Also audit, in the same pass:** `addCompany` (`:30-41`), `addProfile`, and `addTailoredResume` use the same
raw `last_insert_rowid()` pattern. Determine for each whether it reads the rowid **before or after** the
`export()` that clobbers it, and report which are actually affected. Fix the ones that are; leave a note for the
ones that are not, with evidence.

**Fix direction:** do not paper over it with a different fallback. Either read the rowid before the export, or
retrieve the row deterministically after insert. `scrape_runs` has no natural unique key, so the safest route is
to capture the id before `saveDatabase()` runs.

**Acceptance:**
- three sequential `createScrapeRun` calls return three distinct ids matching the actual rows
- `updateScrapeRun` then updates the correct row (verify `finished_at` lands on the right one)
- tests fail against current code

## Rules

- Every test MUST set `JOBS_DB_PATH` to a fresh file under a temp dir. **Never open the real `jobs.db`.**
  `stat` it before and after and confirm size and mtime are unchanged; report that check.
- Tests under `test/`, `node:test` only, no new dependencies.
- Mutation-check each fix.
- Do not run git commands; do not commit.
