# Group B — batch 3 report: issues #21, #22

## What was changed (`src/server.js`)

### #21 — malformed JSON bodies and rejected uploads surfaced as generic 500s

Two changes:

1. **Upload rejection now carries a status.** In the `resumeUpload` multer config's `fileFilter`
   (~line 130), the disallowed-file-type branch now does:
   ```js
   const err = new Error('Invalid file type. Only PDF, DOCX, and TXT allowed.');
   err.status = 400;
   cb(err);
   ```
   instead of `cb(new Error(...))`. This is a plain `Error`, not a `multer.MulterError` (multer only wraps
   its *own* built-in rule violations, e.g. the file-size limit, in `MulterError` — a `fileFilter` callback
   error passes through as-is), so it needed its own marker to be recognized as a client error downstream.

2. **The final error-handling middleware** (bottom of the file, was `:910-913`) now branches before
   defaulting to 500:
   ```js
   const status = err.status || err.statusCode;
   const isClientError =
     err.type === 'entity.parse.failed' ||
     err instanceof multer.MulterError ||
     (typeof status === 'number' && status >= 400 && status < 500);

   if (isClientError) {
     return res.status(status || 400).json({ error: err.message || 'Invalid request' });
   }
   console.error('Express error:', err);
   return res.status(500).json({ error: 'Internal server error' });
   ```
   This covers: `express.json()`'s underlying `body-parser` malformed-JSON errors (which already carry
   `err.status = 400` and `err.type = 'entity.parse.failed'` — the old handler discarded both and hardcoded
   500), any `multer.MulterError` (e.g. exceeding the 10MB size limit), and the upload `fileFilter`'s error
   from change (1) above. Anything without a 4xx status — unexpected exceptions, DB failures, etc. — still
   falls through to the generic 500, so genuine server errors are unaffected.

### #22 — PATCH /api/companies/:id skipped POST's input validation

`validateCompanyInput`'s field checks (name/country/career_url/platform) were extracted into a new
`validateCompanyFields(fields, { partial })` function. In `partial: false` mode (used by the existing
`validateCompanyInput` middleware, unchanged behavior for `POST /api/companies`) every field is required, same
as before. In `partial: true` mode (new, used by `PATCH /api/companies/:id`) a field that is simply absent
from the request body is skipped — PATCH allows partial updates — but any field that *is* present is validated
with the exact same rule POST uses.

The PATCH handler now calls `validateCompanyFields(req.body, { partial: true })` immediately after
destructuring the body and returns `400 {error: <message>}` on failure, before the existence check or any
mutation — so `career_url: "not-a-url-at-all"`, `platform: "totally-bogus-platform"`, or `name: ""` are now
rejected instead of silently persisting.

## Tests added

`test/e2e/client-errors-and-company-validation.e2e.js` — spawns the real server against an isolated
`JOBS_DB_PATH`/`RESUMES_DIR` (same pattern as `mutating-routes-404.e2e.js`), seeds one company, and covers:

- Malformed JSON body (`POST /api/companies` and `PATCH /api/companies/:id`) → 400 with a non-generic error
  message (not 500).
- Rejected upload (`POST /api/resumes/upload` with `filename="malware.exe"`) → 400 with the real
  "Invalid file type..." message (not 500), plus a check that nothing was written to the isolated resumes dir.
- A 404 sanity check confirming the rest of the error-handling chain (unmatched routes) wasn't disturbed.
- `PATCH /api/companies/:id` with an invalid `career_url`, a bogus `platform`, and an empty `name` — each
  rejected with 400 and the same message POST would give.
- A follow-up `GET /api/companies` confirming none of the three invalid PATCHes above persisted.
- A valid partial PATCH (`{name: "..."}` only) still succeeds (200) and leaves other fields (`career_url`)
  untouched.
- `assertRealDbUntouched` check, matching every other e2e suite in this repo.

## Test results

- `npm test`: **201/201 pass**, 0 fail (no unit-test-covered code paths touched).
- `npm run test:e2e`: **91/91 pass**, 0 fail, 14 suites (13 pre-existing + the 1 new one above; all
  pre-existing suites remained green with no changes needed). The real `jobs.db` was confirmed absent from
  the worktree both before and after the full run.

## Commit

`7b2f503` — "fix(server): client-input errors return 400 not 500; PATCH /api/companies validates input (#21, #22)"

2 files changed, 300 insertions(+), 12 deletions(-): `src/server.js` (fileFilter status marker + rewritten
error handler + `validateCompanyFields` extraction + PATCH validation call) and the new e2e test file above.
