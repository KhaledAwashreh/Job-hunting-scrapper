# A4 — Server security and broken routes

**Status:** confirmed by execution · **Owner:** fix agent A4
**Files:** `src/server.js`

Contains the single most severe finding in the review. Fix A4.1 first.

---

## A4.1 — Arbitrary file deletion via path traversal (CRITICAL)

`server.js:368-378`:
```js
const filename = req.params.filename;
const filepath = path.join(__dirname, '../data/resumes', filename);
...
fs.unlinkSync(filepath);
```
`filename` comes straight from the URL with no normalisation and no containment check.

**Reproduced** — a canary nine directories outside the repo was deleted:
```
DELETE /api/resumes/..%2F..%2F..%2F..%2F..%2F..%2F..%2F..%2F..%2Ftmp/<dir>/canary/target.txt
-> 200 {"success":true,"deleted":"../../../../../../../../../tmp/<dir>/canary/target.txt"}
-> canary: No such file or directory
```
Anything the Node process can reach is deletable: `.env`, `jobs.db`, source files.

**Fix direction:** resolve the path and verify it is contained within the resumes directory before any
filesystem call. `path.basename` alone is a common but incomplete answer — reason about it and justify your
choice. Reject with 400, not 404, so a traversal attempt is distinguishable from a missing file.

**Acceptance:** encoded `../`, raw `../`, absolute paths, and null-byte tricks all rejected without deleting
anything; a legitimate filename still deletes. Tests must operate on a **temp** resumes directory — never the
repo's `data/resumes/`. Test must fail against current code.

---

## A4.2 — `/api/health` can never report a database failure (High)

The guard at `:104-110` exempts `req.path.startsWith('/health')`, but the route is `/api/health` (`:759`).
The strings never match, so on any startup failure the guard returns its generic
`503 {"error":"Database not initialized"}` and **the real handler never runs** — the one that would report
`db_initialized`, the error, and a timestamp.

**Reproduced:** with `JOBS_DB_PATH` pointed at a non-existent directory, startup logs `ENOENT`, `dbInitialized`
stays `false`, and `GET /api/health` returns the generic guard body. `GET /health` 404s, confirming the mismatch.

This also means Docker's `HEALTHCHECK` goes red with no diagnostic.

**Fix direction:** make the exemption match the actual health route. Consider whether `/api/health` should be
exempt at all — it should, since its purpose is reporting that the database is down.

**Acceptance:** with a forced startup failure, `GET /api/health` returns the real handler's shape with
`db_initialized: false`; with a healthy start it returns `status: "ok"`. Test fails against current code.

---

## A4.3 — PDF export is 100% broken (High)

`server.js:699`: `const font = isHeading ? timesRomanBold : timesRoman;`
`timesRoman` is never declared. Only `timesRomanFont` (`:672`) and `timesRomanBold` (`:673`) exist —
confirmed by grep, the identifier appears exactly once in the file, at its point of use.

Every `GET /api/tailored-resumes/:id/download?format=pdf` returns
`500 {"error":"timesRoman is not defined"}`, masked as a generic server error.

**Fix direction:** one-word fix. But add a test, because nothing currently exercises this path — that is why a
plainly undefined variable survived.

**Acceptance:** a PDF download returns 200 with a valid PDF (check the `%PDF` magic bytes and non-trivial
length). Test fails against current code.

---

## Rules for this area

- Every test MUST boot the server with `JOBS_DB_PATH` set to a temp file and `PORT` to an ephemeral port.
  `test/e2e/helpers/harness.js` already does exactly this — reuse it.
- **Never touch the real `jobs.db` or the repo's `data/resumes/`.** Verify and report.
- Put HTTP-level tests in `test/e2e/*.e2e.js` (run with `npm run test:e2e`); pure unit tests in `test/*.test.js`.
- Mutation-check every fix.
- Do not run git commands; do not commit.
