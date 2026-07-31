# Batch 2 — Group C (Database) — Issues #27, #29

Worktree: /home/kawashreh/Projects/Job-hunting-scrapper/.claude/worktrees/group-c-database
Branch: issues/group-c-database
Files: src/server.js (resume-tailor endpoint), src/db/schema.js, bulk-add-companies.js

## GitHub Issue #27 (verbatim)

# Resume-tailor endpoint has a same-process version race — concurrent requests for one position can 500 and waste an LLM call

**Severity: Low-Medium**

New finding surfaced while investigating the concurrent-writer claim: `POST /api/positions/:id/tailor` reads the current `version` synchronously, `await`s an LLM call, then writes. Two concurrent requests for the same position/profile race on that read-await-write; the loser hits a UNIQUE-constraint failure (500), after already having spent a real LLM call generating the tailored resume it can't save.

Unlike the cross-process finding above, this needs no second OS process — it's reachable from a single user double-clicking "Tailor Resume" or a slow network causing a retry.

### Fix direction
Re-fetch or lock the version inside the same transaction as the insert, or de-duplicate in-flight tailor requests per position/profile on the client and/or server.

Found during verification of `docs/review/unconfirmed/U3-database.md`, item U3.1.

## GitHub Issue #29 (verbatim)

# companies table has no UNIQUE constraint — bulk-add-companies.js duplicates every company on a second run

**Severity: High**

`companies` has no UNIQUE column/index on `(name, career_url)`, so identical inserts succeed as distinct rows. `bulk-add-companies.js`'s skip logic catches a `UNIQUE constraint` error that can never fire — confirmed dead code. Running the script twice against a temp DB produced two independent rows per company with no error (reported live: "two runs → 98 rows, every company doubled").

**Migration hazard, confirmed directly:** adding `CREATE UNIQUE INDEX` against a DB that already contains duplicates fails with `UNIQUE constraint failed` — so this would break against the user's live `jobs.db` if it already has dupes, and needs a dedup pass first, not a blind schema change.

### Fix direction
Add a `UNIQUE(name, career_url)` constraint (or a normalized dedup key) in `schema.js`, preceded by a one-time migration script that dedupes existing rows in the live database before the constraint is added.

Merges U3.2 and U5.5 (`docs/review/unconfirmed/U3-database.md` and `U5-matching-scoring-scripts.md`) — same root cause, reported independently in both areas.

## Authoritative technical brief

Read docs/review/unconfirmed/U3-database.md in this worktree before starting.
