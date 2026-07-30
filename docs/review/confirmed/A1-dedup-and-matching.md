# A1 — Deduplication and job matching

**Status:** confirmed by execution · **Owner:** fix agent A1
**Files:** `src/utils/hasher.js`, `src/agents/orchestrator.js`, `src/utils/jobFieldExtractor.js`, `src/utils/timeWindow.js`

These four defects share one consequence: **real jobs are silently lost or duplicated**. That is the app's core purpose, so this area outranks everything except the security findings.

---

## A1.1 — Dedup hash collides across companies (Critical)

`hasher.js:6` keys on `job.company_id`, but `orchestrator.js:353` builds the object passed to `hashJob` from
`{...job, country, jobType, locationType, yearsExperience, seniorityLevel}` and **never sets `company_id`**.

**Reproduced:**
```
A: 6d7567f295ecc052
B: 6d7567f295ecc052   collide: true
```
Two different companies posting the same role produce an identical hash. `checkPositionExists` then treats the
second company's genuine posting as a duplicate and discards it.

**Fix direction:** ensure the object handed to `hashJob` carries the real `company_id`. Prefer fixing the caller
(`orchestrator.js`) so the hash input is complete, rather than weakening the hash.

**Acceptance:** two jobs identical in every field except `company_id` must hash differently; a test must fail
against the current code.

---

## A1.2 — The same job re-hashes after a date bump (High)

`hasher.js:10` includes `publishDate`. Many ATS bump the posted date to keep a still-open req looking fresh.
When they do, the hash changes and the identical job is inserted again.

**Reproduced:** same title/description/qualifications/link, `publishDate` `2026-07-01` → `2026-07-08`:
`stable across date bump: false`.

**Fix direction:** remove `publishDate` from the hash input. Identity should be
company + title + link (+ description if needed), not volatile presentation metadata.

**Careful:** A1.1 and A1.2 pull in opposite directions — adding `company_id` and removing `publishDate` both
change every existing hash. Existing rows in the user's live database will not match the new scheme. **Do not
attempt a migration.** Note the consequence in your report so the user can decide.

**Acceptance:** identical job with a changed `publishDate` must hash the same; test must fail against current code.

---

## A1.3 — Country filter matches on substrings (High)

`jobFieldExtractor.js:281` and `:289` use `jobCountry.includes(tc) || tc.includes(jobCountry)`.

**Reproduced:**
```
search=Niger  job=Nigeria                        -> true
search=Oman   job=Romania                        -> true
search=Mali   job=Somalia                        -> true
search=India  job=British Indian Ocean Territory -> true
search=France job=Germany                        -> false   (sanity)
```

**Fix direction:** this is the same defect class already fixed in `extractCountry`
(`src/agents/apiAgent.js`, commit d04a50f) — whole-token matching with Unicode boundaries, not `includes`.
**Read that implementation first and stay consistent with it.** Do not copy-paste; the shape differs
(here both sides are already resolved country names, so exact normalised comparison may be enough — justify
whichever you choose).

**Acceptance:** all four false positives above return `false`; every genuine match in the existing
`test/job-field-extractor.country.test.js` still passes.

---

## A1.4 — Unparseable dates silently drop jobs (High)

`timeWindow.js:27`. The `catch` is commented *"Invalid date format, accept it"*, but `new Date("N/A")` does not
throw — it yields `Invalid Date`, so `daysDiff` is `NaN`, `NaN <= window.days` is `false`, and the job is
**rejected**. The catch never runs.

**Reproduced:** `"N/A" -> false`, `"not-a-date" -> false` (empty string correctly returns `true`).

**Fix direction:** detect `Number.isNaN(postDate.getTime())` explicitly and honour the documented intent
(accept). Keep the existing `!publishDate` early return.

**Acceptance:** `"N/A"` and `"not-a-date"` return `true`; a real old date still returns `false` for a 7-day window.

---

## Rules for this area

- Fix only the four defects above. Do not refactor beyond them.
- Add tests under `test/` using `node:test` + `node:assert/strict`. No new dependencies.
- **Mutation-check every fix**: revert it, show the new test fails, restore. Report the evidence.
- Never touch the repo-root `jobs.db`.
- Do **not** run any git command and do **not** commit. Leave changes in the working tree.
