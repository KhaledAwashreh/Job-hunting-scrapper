# U3 — Database layer (UNCONFIRMED)

**Status:** reported by one reviewer, NOT independently verified
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

---

## U3.2 — No UNIQUE constraint on companies (claimed Medium)

**Claim:** the same company (identical name and career_url) can be inserted repeatedly; `POST /api/companies`
has no guard. Related: `bulk-add-companies.js` relies on catching a `UNIQUE constraint` error that can never
fire.

**Verify.** Recommend where the constraint belongs (schema, query layer, or route) — but **do not implement it**.
Note explicitly whether adding a UNIQUE constraint would fail against the user's existing live database if it
already contains duplicates. That is a migration hazard the user must decide on.

---

## U3.3 — Inconsistent not-found return shapes (claimed Low)

**Claim:** `getCompanyById`, `getProfileById` and `getScrapeRunById` return `undefined` for a missing row, while
`getPositionById` returns `null`.

**Verify**, and check whether any caller actually compares with `=== null` — that determines whether this is a
live bug or a latent inconsistency. Search `src/` for callers.

---

## U3.4 — `getPositionsForProfile` returns unparsed JSON strings (claimed Low)

**Claim:** it returns raw JSON strings for `location_type` / `years_experience` / `seniority_level` where every
other position accessor returns arrays.

**Verify**, and confirm whether it has any caller at all. If it is genuinely unreferenced, say so — that changes
this from a bug to dead code, and the right recommendation may be deletion.

---

## Rules

- **Do not fix anything.** Do not edit any file outside this document.
- You MAY edit this document: correct claims, adjust severities, add evidence, mark items refuted.
- Every database interaction MUST use `JOBS_DB_PATH` pointed at a fresh temp file. **Never open the real
  `jobs.db`.** `stat` it before and after; report the check.
- Run scripts with the repo as cwd so `sql.js` resolves. Scratch scripts under /tmp only.
