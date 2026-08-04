# Group B — batch 2 report: issues #19, #20

## What was changed (`src/server.js`)

### #19 — untrusted job title raw in `Content-Disposition`

Added a small helper, `contentDispositionHeader(filename)`, placed next to the existing `isValidHttpUrl`
helper (~line 59). It:

1. Strips all control characters (`\x00-\x1F`, `\x7F` — this covers CR/LF, so a title can never inject a
   second header or crash `res.setHeader`).
2. Builds an ASCII-only fallback by replacing remaining non-ASCII bytes and any `"`/`\` with `_` (quotes are
   what let `Evil"; filename="pwned.exe` smuggle a second `filename=` param into the plain
   `filename="..."` form).
3. Also emits the extended `filename*=UTF-8''<percent-encoded>` form per RFC 6266, so non-ASCII titles (e.g.
   accented characters, CJK) still round-trip correctly for clients that support it, per the issue's fix
   direction ("do both, per RFC 6266, for broad client compatibility").

Replaced the three raw-interpolation call sites (`txt`, `docx`, `pdf` branches of
`GET /api/tailored-resumes/:id/download`) with `contentDispositionHeader(filename)`. No other behavior in that
route changed.

### #20 — mutating routes phantom-success on missing ids

Went with the "SELECT-before" option from the brief rather than plumbing `sql.js`'s row-changed count through
`src/db/queries.js`, since the brief scopes this batch to `src/server.js` only and every affected route already
has a matching `getXById` lookup available. Added an existence check immediately after destructuring `id` (and
before any validation/mutation) in each of:

- `PATCH /api/positions/:id/status` → `getPositionById(id)` → 404 `{error:'Position not found'}`
- `PATCH /api/companies/:id` → `getCompanyById(id)` → 404 `{error:'Company not found'}`
- `DELETE /api/companies/:id` → `getCompanyById(id)` → 404 `{error:'Company not found'}`
- `PATCH /api/profiles/:id` → `getProfileById(id)` → 404 `{error:'Profile not found'}` (this also makes the
  route's inner `try/catch` around `JSON.parse(updated.job_types...)` unreachable for the missing-id case,
  since `updated` is now only read after existence is confirmed — the "fake-empty-object" manifestation from
  `U2-server.md` can no longer happen)
- `DELETE /api/profiles/:id` → `getProfileById(id)` → 404 `{error:'Profile not found'}`
- `DELETE /api/tailored-resumes/:id` → `getTailoredResumeById(id)` → 404 `{error:'Tailored resume not found'}`

Non-numeric ids (e.g. `not-a-number`) also 404 through the same path, since the underlying `SELECT ... WHERE
id = ?` matches zero rows for those too — verified by test.

`GET /api/tailored-resumes/:id/download` already had a correct 404 guard before this batch; it was not on
`U2-server.md`'s list and needed no change. `DELETE /api/resumes/:filename` (file-based, not a DB row) already
checked `fs.existsSync` and 404'd correctly; also untouched.

I did not touch `src/db/queries.js` — confirmed via `grep` that every function these routes call
(`updatePositionStatus`, `updateCompany`, `updateCompanyActive`, `deleteCompany`, `updateProfile`,
`deleteProfile`, `deleteTailoredResume`) is only ever called from `src/server.js`, so the added lookups fully
close the gap without needing to change the query layer's return values.

## Tests added

- `test/e2e/tailored-resume-download-header-injection.e2e.js` (#19) — seeds positions with three
  header-breaking titles (CRLF injection, quote-breaking/filename-smuggling, non-ASCII) and a tailored resume
  for each, then downloads each across all three formats (`txt`/`docx`/`pdf`). Asserts: 200 (not 500), the
  `Content-Disposition` header is present, contains no raw CR/LF, matches the expected
  `filename="..."; filename*=UTF-8''...` shape, and the body is correct (exact text match for `txt`, `%PDF-`
  magic bytes for `pdf`). A dedicated test also confirms the quote-breaking title produces exactly one
  `filename="` and one `filename*=` param (no smuggled second param).
- `test/e2e/mutating-routes-404.e2e.js` (#20) — seeds one company (plus a second, disposable one for the
  delete case), one position, two profiles (one to PATCH, one to DELETE, avoiding cross-test interference),
  and one tailored resume. For every affected route: hits it with a nonexistent id (`999999`, plus
  non-numeric for the positions-status route) and asserts 404 with an error body, then hits the same route
  with the real seeded id and asserts 200 with the expected success body/shape.

Both files follow the existing `test/e2e/helpers/harness.js` conventions (isolated `JOBS_DB_PATH` in a temp
dir, ephemeral `PORT`, `assertRealDbUntouched` check), mirroring the seeding pattern already used in
`test/e2e/tailored-resume-pdf-download.e2e.js` (a `-e` child-process seed script, since sql.js needs the
seeding process to exit before the server process opens the same db file).

## Test results

- `npm test`: **201/201 pass**, 0 fail (unchanged from batch 1 — no unit-test-covered code paths touched).
- `npm run test:e2e`: **81/81 pass**, 0 fail, 13 suites (11 pre-existing + the 2 new ones above; all
  pre-existing suites, including `security-cors-auth.e2e.js` from batch 1, remained green with no changes
  needed). Every suite's `assertRealDbUntouched` check passed; the real `jobs.db` does not exist in this
  worktree at all (confirmed via `ls jobs.db` → no such file, before and after the full e2e run).

## Commit

`cd86746` — "fix(server): sanitize resume download filenames; 404 mutating routes on missing ids (#19, #20)"

3 files changed: `src/server.js` (helper + 3 call-site swaps + 6 existence checks), plus the two new e2e test
files above (510 insertions total).
