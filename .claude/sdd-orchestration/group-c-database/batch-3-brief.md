# Batch 3 (FINAL) — Group C (Database) — Issues #30, #31, #32

Worktree: /home/kawashreh/Projects/Job-hunting-scrapper/.claude/worktrees/group-c-database
Branch: issues/group-c-database
Files: src/db/queries.js, src/db/schema.js

## GitHub Issue #30 (verbatim)

# ON DELETE CASCADE is declared in the schema but never enforced — deleting a company/profile leaves orphaned rows

**Severity: Medium**

`schema.js` declares `REFERENCES ... ON DELETE CASCADE` for `positions.company_id`, `position_profiles.position_id/profile_id`, and `tailored_resumes.position_id/profile_id`, but SQLite/sql.js has foreign-key enforcement **off by default** and `PRAGMA foreign_keys = ON` is never executed — confirmed (`PRAGMA foreign_keys` reads `0`). `deleteCompany`/`deleteProfile` (`queries.js:87-92`, `254-258`) each manually delete one dependent table but miss others.

Reproduced: after `deleteCompany`, `position_profiles` and `tailored_resumes` still contain rows pointing at the deleted position. After `deleteProfile`, `tailored_resumes` still contains a row pointing at the deleted profile.

Every current read path uses `INNER JOIN` back to `positions`/`profiles`, so these orphans don't surface as visibly wrong data today, but they accumulate on disk forever and silently contradict the schema's own stated intent.

### Fix direction
Either execute `PRAGMA foreign_keys = ON` at connection time so the declared cascades actually fire, or extend `deleteCompany`/`deleteProfile` to manually clean up every dependent table.

Found by independent audit of `docs/review/unconfirmed/U3-database.md`.

## GitHub Issue #31 (verbatim)

# linkPositionToProfile swallows every error identically, indistinguishable from an expected duplicate link

**Severity: Low-Medium**

`queries.js:261-272` catches *any* exception from the insert and returns `false` — unlike `addPosition`/`addTailoredResume`, which specifically check `e.message` for `UNIQUE constraint failed` before treating an error as "already exists." A real NOT NULL violation (e.g. from a bad `positionId`/`profileId`) and a harmless expected duplicate both return `false`, with no way to tell them apart.

The only current caller is `orchestrator.js:423`; if `result.id` or `matchedProfile.id` is ever `undefined`/`null` upstream, the link silently fails with no error surfaced anywhere.

### Fix direction
Inspect `e.message` for the UNIQUE-constraint case specifically (as the other insert functions already do) and rethrow/log anything else.

Found by independent audit of `docs/review/unconfirmed/U3-database.md`.

## GitHub Issue #32 (verbatim)

# Inconsistent not-found return shapes across query functions (undefined vs null vs unparsed JSON)

**Severity: Low** (cosmetic/latent — no live bug)

Two small inconsistencies confirmed in `src/db/queries.js`, neither currently causing observable problems:

- `getCompanyById`, `getProfileById`, `getScrapeRunById` return `undefined` for a missing row, while `getPositionById` returns `null`. A repo-wide grep for `=== null`/`== null` found zero matches — every caller uses truthy checks, so this has no live effect today, but it's a trap for a future caller that compares strictly.
- `getPositionsForProfile` returns raw unparsed JSON strings for `location_type`/`years_experience`/`seniority_level`, unlike every other position accessor which returns real arrays. A repo-wide grep found **zero callers** of this function anywhere — it's dead code.

### Fix direction
Standardize all "not found" returns on `null`. For `getPositionsForProfile`, delete it (no callers) rather than fixing its output shape.

Merges U3.3 and U3.4, `docs/review/unconfirmed/U3-database.md`.

## Authoritative technical brief

Read docs/review/unconfirmed/U3-database.md in this worktree before starting.
