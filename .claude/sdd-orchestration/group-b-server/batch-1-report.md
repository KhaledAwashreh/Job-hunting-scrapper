# Group B — batch 1 report: issue #18 (wildcard CORS + no auth)

## Judgment on the pre-existing draft

The uncommitted `src/server.js` diff found at the start of this session was sound and matched issue #18's
"Fix direction" exactly:

- `ALLOWED_ORIGIN` env var, unset by default → no `Access-Control-Allow-Origin` header is ever sent, so a
  cross-origin browser request (the exact exploit proved in the issue: spoofed `Origin`, `DELETE
  /api/companies/2`) fails CORS and the browser refuses to send/act on it. When set, only that exact origin
  is granted (checked via `req.headers.origin === ALLOWED_ORIGIN`, not reflected/wildcarded).
- `API_TOKEN` env var, unset by default (with a `console.warn` at startup) → `X-API-Token` header required
  and checked on every `POST`/`PATCH`/`DELETE` when set; rejects with `401 {"error":"Unauthorized"}` on a
  missing or wrong token. This is what closes the gap CORS alone can't: a direct `curl`/script request that
  never goes through a browser and so is never subject to CORS at all.
- No new dependency, `async/await`-compatible, sensible zero-friction default for the common single-local-user
  case, off-by-default with a clear warning — appropriate MVP scope per the task's explicit "don't over-engineer"
  guidance (no JWT/sessions/per-IP rate limiting needed).

I traced every `app.post/patch/delete` route (24 routes across `src/server.js`) and confirmed all of them are
registered after the new auth middleware, so the global `MUTATING_METHODS` check covers all of them with no
bypass. I also checked `docs/review/unconfirmed/U2-server.md` as instructed: its four findings (U2.1 static-asset
headers, U2.2 400→500 status coercion, U2.3 PATCH-on-missing-id returning fake success, U2.4 ungraceful
shutdown) are unrelated to CORS/auth — the doc's own text says issue #18 was "found by independent audit of"
that document, not described within it, and its "Rules" section (`Do not fix anything... outside this
document`) plus the note that path-traversal/health-check/PDF findings are tracked separately under
`docs/review/confirmed/A4-server-security.md` confirm U2.1-U2.4 are out of scope for this batch. No changes were
needed to reconcile the draft against that doc.

**Conclusion: the draft was correct and complete. No code changes were made to it** — only tests were added.

## What was added

`test/e2e/security-cors-auth.e2e.js`, following the existing `test/e2e/helpers/harness.js` pattern (ephemeral
port, isolated temp `JOBS_DB_PATH`, real-jobs.db-untouched assertions). 13 tests across 4 suites:

1. **CORS is opt-in via `ALLOWED_ORIGIN` (#18)** — with it unset, a plain cross-origin `GET` and a cross-origin
   `OPTIONS` preflight (mirroring the issue's exact `DELETE /api/companies/2` preflight repro) both get no
   `Access-Control-Allow-Origin` header.
2. **CORS grants only the configured `ALLOWED_ORIGIN`** — a request from the configured origin gets the header
   with that exact value; a request from any other origin still gets none.
3. **Mutating routes require `X-API-Token` when `API_TOKEN` is set (#18)** — missing token → 401; wrong token →
   401; correct token → 200 with the expected body; a non-mutating `GET` is never blocked regardless of token.
4. **Mutating routes stay backward compatible when `API_TOKEN` is unset (default)** — a mutating `POST` with no
   token still succeeds, and the startup warning is present in the server's logs.

## Test results

- `npm test` (unit tests): **201/201 pass**, 0 fail.
- `npm run test:e2e`: **57/57 pass**, 0 fail (11 suites, including the 4 new ones above; all pre-existing
  suites — dashboard, health-check, positions, snapshot, resume-delete-traversal,
  tailored-resume-pdf-download, positions-parse-array — remained green with no changes needed).
- Every suite that touches the DB asserts the real repo `jobs.db` fingerprint (existence/size/mtime) is
  unchanged before/after; none of them created, read, or modified it (it does not exist in this worktree at
  all — confirmed via `ls jobs.db` → no such file).

## Commit

`b3d3a2675fa40d0225faab08ad27f353d3ca148d` — "fix(server): opt-in CORS + shared-secret auth on mutating routes (#18)"

2 files changed: `src/server.js` (the pre-existing draft, committed as-is), `test/e2e/security-cors-auth.e2e.js`
(new, 212 insertions total across both files).
