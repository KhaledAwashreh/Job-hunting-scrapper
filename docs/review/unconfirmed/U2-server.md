# U2 — Server routes (UNCONFIRMED)

**Status:** reported by one reviewer, NOT independently verified
**Files:** `src/server.js`

**Independent verification pass (2026-07-30):** all four claims CONFIRMED as real defects; all four had stale
line references (the file grew ~120 lines under commit `ca801c0`'s A4 fixes — `resolveResumePath` plus its
comment block) and are corrected below with current locations. Severities revised: U2.1 High → **Low** (the
page that actually matters, `/`, does carry the CSP — see verdict), U2.2 Medium → **Medium** (unchanged, but
evidence shows it's a 400→500 status coercion, not just a lost message), U2.3 Medium → **Medium-High** (the
pattern reproduces on two more routes with two more, worse, failure shapes), U2.4 Low → **Medium** (empirically
drops ~1/3 of in-flight requests under a real `SIGTERM`, not just a missing log line). All verification was done
against a running server via real HTTP requests/signals — `test/e2e/helpers/harness.js` plus one custom `SIGTERM`
script — never by reading source alone. No `jobs.db` or files were left in the repo by any run (checked after
each script: worktree root has no `jobs.db`, worktree has no `data/resumes/` at all, and the outer repo's
`jobs.db` timestamp was unchanged before/after).

The path-traversal, health-check and PDF findings from the same reviewer were confirmed separately and are being
fixed under `docs/review/confirmed/A4-server-security.md`. **Do not duplicate that work.** The items below are
the remainder.

---

## U2.1 — Static assets ship with no security headers (claimed High)

**Claim:** `express.static` is registered at `:84`, before the CORS middleware (`:87`) and the security-header
middleware (`:96`). Reported: `/styles.css` and `/countries.json` return no `content-security-policy`,
`x-frame-options` or `x-content-type-options`, while `/api/health` and `/` do.

**Verify by request, not by reading.** Then answer what the reviewer did not: **does `/` itself carry the CSP?**
That determines whether the XSS in U1.1 is constrained at all, so the two findings must be reconciled. State the
answer explicitly.

---

### Verdict: CONFIRMED, severity CORRECTED (High → Low)

**Line numbers are stale.** In the current tree (post commit `ca801c0`, A4 fixes) the file grew by ~120 lines
(mostly the `resolveResumePath` doc comment). Current locations: `express.static` at `src/server.js:131`, CORS
middleware at `:134-140`, security-header middleware at `:143-148`. The relative ordering the claim describes
(static → CORS → security headers) is unchanged and still accurate.

**Verified by real HTTP requests** against a server booted via `test/e2e/helpers/harness.js`
(`startServer({ seed: true, RESUMES_DIR: <tmp dir> })`, isolated `JOBS_DB_PATH`, ephemeral `PORT`):

```
GET /                 -> 200, csp: present, x-frame-options: SAMEORIGIN, x-content-type-options: nosniff
GET /styles.css        -> 200, csp: null,     x-frame-options: null,      x-content-type-options: null
GET /countries.json    -> 200, csp: null,     x-frame-options: null,      x-content-type-options: null
GET /api/health         -> 200, csp: present, x-frame-options: SAMEORIGIN, x-content-type-options: nosniff
```

The root-cause claim (static assets miss all three security headers because `express.static` short-circuits the
request before it reaches the header middleware) is **confirmed exactly as reported**.

**The reconciliation question, answered explicitly: yes, `/` carries the CSP.** There is no `public/index.html`,
so a request for `/` is *not* matched by `express.static` (it has nothing to serve at that path), falls through
to `next()`, and reaches the explicit `app.get('/', ...)` handler at `:231` — which runs *after* the
security-header middleware at `:143`. The page that U1.1 identifies as the stored-XSS sink (`dashboard.html`,
served from that route) does carry `Content-Security-Policy`, `X-Frame-Options: SAMEORIGIN`, and
`X-Content-Type-Options: nosniff` on every response. **U1.1's premise that the CSP might not even apply to the
vulnerable page is refuted** — it does apply. What U1.1 must still resolve on its own is whether the policy's
`script-src 'self' 'unsafe-inline'` actually blocks the specific `onerror=` payload it describes (this brief
does not re-test that; it is out of scope for U2 and belongs in U1.1 itself).

**Severity correction:** the assets actually missing headers — `/styles.css`, `/countries.json`, and any other
file under `public/` served by `express.static` — are static, non-user-controlled, correctly-`Content-Type`'d
files with no injectable content. Missing `X-Content-Type-Options` on them has negligible impact since
`express.static` already sets the correct MIME type; missing `X-Frame-Options`/CSP on a standalone `.css`/`.json`
response has no realistic framing/injection value. Since the one page that matters for exploitability (`/`,
where U1.1's payload would render) **is** covered, "High" overstates the risk. Recommend **Low** — it's a real
inconsistency worth fixing for defense-in-depth and header-policy hygiene, not a High-severity security gap.

---

## U2.2 — Client errors reported as 500 (claimed Medium)

**Claim:** malformed JSON bodies and rejected upload types both reach the catch-all at `:789` and return
`500 {"error":"Internal server error"}`, losing multer's specific message.

**Verify both cases.** If you test the upload path, ensure it cannot write into the repo's `data/resumes/`.

---

### Verdict: CONFIRMED, severity unchanged (Medium), evidence CORRECTED

**Line number is stale.** `:789` is now a blank line (see the location note under U2.1 — the file grew ~120
lines from the A4 fixes). The actual error-handling middleware that both cases fall through to is the generic
handler at `src/server.js:843-846`; the 404 catch-all is a separate block at `:834-840` and is not what's hit
here (both cases produce a thrown/`next(err)`-ed error, not an unmatched route).

**Verified with real requests**, server booted the same way as U2.1 (isolated DB/port, `RESUMES_DIR` pointed at
a fresh `/tmp` dir):

- Malformed JSON body — `POST /api/companies` with `Content-Type: application/json` and body `"{ this is not
  valid json "`:
  ```
  status: 500
  body:   {"error":"Internal server error"}
  ```
  Confirmed, and worse than the original claim states: `express.json()`'s underlying `body-parser` sets
  `err.status = 400` and `err.type = 'entity.parse.failed'` with a precise message (verified directly:
  `err.status=400 err.message="Expected property name or '}' in JSON at position 1..."`). The generic handler at
  `:843-846` ignores `err.status` entirely and hardcodes `500`, so this isn't just "loses the message" — it
  actively **downgrades a client error (400) into a server error (500)**, which is a bigger deal than the claim
  states: retries, alerting, and error budgets keyed on 5xx will mis-treat every one of these as a server-side
  fault.

- Rejected upload type — `POST /api/resumes/upload` with a multipart body whose file has `filename="malware.exe"`:
  ```
  status: 500
  body:   {"error":"Internal server error"}
  ```
  Confirmed. Multer's `fileFilter` calls back with `new Error('Invalid file type. Only PDF, DOCX, and TXT
  allowed.')`, which reaches the same generic handler and is reduced to `Internal server error`. **Verified
  nothing was written to the resumes directory** — `RESUMES_DIR` (isolated temp dir) was empty after the
  request, so the rejection does happen before any write; the only defect is the status/message downgrade, not
  a file-write leak.

Severity: **Medium is fair**, if not slightly conservative given the 400→500 status coercion found above — flag
that nuance if this graduates to a confirmed/fix doc.

---

## U2.3 — Status updates on nonexistent positions return `200 null` (claimed Medium)

**Claim:** `PATCH /api/positions/:id/status` with a nonexistent or non-numeric id returns `200` with body `null`.

**Verify.** Check whether other routes share the pattern (`UPDATE` matching zero rows, then returning the
lookup result unchecked) — if so, list them; that is more useful than the single instance.

---

### Verdict: CONFIRMED and EXPANDED, severity CORRECTED (Medium → Medium-High)

**Verified with real requests** (same harness/isolation as above):

```
PATCH /api/positions/999999/status      {status:"applied"}   -> 200, body: null
PATCH /api/positions/not-a-number/status {status:"applied"}  -> 200, body: null
```

Both the nonexistent-numeric-id and non-numeric-id cases are confirmed exactly as claimed
(`src/server.js:248-263`, `updatePositionStatus(id, status)` matches 0 rows, `getPositionById(id)` returns `null`
because it explicitly does `if (raw.length === 0) return null;`, and `res.json(null)` is sent with `200`).

**The reviewer's ask — check for the same pattern elsewhere — turned up two more routes, and each fails
differently, which is worse than one consistent bug:**

1. **`PATCH /api/companies/:id`** (`src/server.js:287-316`) shares the exact "UPDATE unconditionally, then
   `res.json(getXById(id))`" shape. Verified:
   ```
   PATCH /api/companies/999999  {name:"X"}  -> 200, body: "" (empty)
   ```
   Not `null` — **empty body**. `getCompanyById` (`src/db/queries.js:94-97`) does `return result[0]`, which is
   `undefined` for a zero-row `SELECT`, unlike `getPositionById`'s explicit `return null`. Express's
   `res.json(undefined)` sends a `200` with no body at all. Same root defect (unchecked write, unchecked lookup),
   different, more confusing manifestation — a `200` with a *truly empty* response is arguably harder for a
   client to detect than an explicit `null`.

2. **`PATCH /api/profiles/:id`** (`src/server.js:487-508`) also shares the shape, but its own inner
   `try { JSON.parse(updated.job_types...) } catch` **masks the bug into something that looks like valid data**.
   Verified:
   ```
   PATCH /api/profiles/999999  {name:"X", resume_file:"foo.pdf", job_types:["backend"]}
     -> 200, body: {"job_types":[],"years_of_experience":[],"work_location_preference":[]}
   ```
   Mechanism: `getProfileById(999999)` returns `undefined`; accessing `updated.job_types` inside the response
   object literal throws `TypeError: Cannot read properties of undefined`; that throw is caught by the route's
   own inner `catch (parseErr)` (not the outer 500 handler), which then builds
   `{ ...updated, job_types: [], years_of_experience: [], work_location_preference: [] }`. Spreading `undefined`
   in an object literal is a documented no-op in JS, so this silently produces a **plausible-looking but
   content-free 200 response** — no `id`, no `name`, just empty arrays — that a client checking only `res.ok`
   would treat as "updated a profile with no fields," rather than "the profile doesn't exist." This is the
   worst of the three: it doesn't even surface as an obviously-empty/null response.

**Severity correction:** raise from Medium to **Medium-High**. This isn't an isolated single-route oversight —
it's a systemic pattern across three mutation endpoints (`positions/:id/status`, `companies/:id`, `profiles/:id`)
that all silently no-op on a nonexistent id instead of 404ing, and the three manifestations (`null`, empty body,
fake-empty-object) are inconsistent enough that a client can't even build one workaround for all three.

---

## U2.4 — Shutdown is not graceful (claimed Low)

**Claim:** `gracefulShutdown()` (`:819-848`) calls `process.exit(0)` without awaiting `server.close()`'s
callback; under SIGTERM the "HTTP server closed" line never printed.

**Verify** with a real signal, and check whether an in-flight request is actually cut.

---

### Verdict: CONFIRMED, severity CORRECTED (Low → Medium)

**Line number is stale**, same drift as above: `gracefulShutdown()` is now at `src/server.js:873-903` (was
`:819-848`). Logic is unchanged: `server.close(cb)` is fire-and-forget, and when no scrape is running the `else`
branch calls `clearTimeout(...); process.exit(0);` synchronously, immediately after issuing `server.close()`,
without ever awaiting its callback.

**Verified by sending a real `SIGTERM`** to a server process spawned directly (`spawn(process.execPath,
['src/server.js'], { env: { JOBS_DB_PATH: <tmp>, RESUMES_DIR: <tmp>, PORT: <ephemeral> } })`), capturing stdout:

```
child.kill('SIGTERM') -> process exits with code 0 in 14-19ms
stdout contains "Graceful shutdown initiated..." : yes
stdout contains "HTTP server closed"             : NO — never printed
```

Confirmed exactly as claimed: `process.exit(0)` runs before the event loop ever gets to invoke `server.close()`'s
callback, so that log line is unreachable on this path (no scraper running).

**In-flight-request-cut check, run for real:** fired 30 concurrent `GET /api/positions` requests, gave them a
15ms head start to get past connection-accept and into flight, then sent `SIGTERM`:

```
30 requests fired, SIGTERM sent 15ms later, process exited ~19ms after SIGTERM
  succeeded: 19/30
  failed:    11/30  (all with "fetch failed" — connection reset/dropped mid-request)
```

This is not a theoretical concern — **over a third of genuinely in-flight requests were dropped** by the abrupt
`process.exit(0)` in a single real run. `server.close()` alone does stop new connections but does not wait for
in-flight ones to finish before the process is killed, because nothing in `gracefulShutdown()` awaits it.

**Severity correction:** raise from Low to **Medium**. The original claim framed this mostly as a cosmetic
logging gap ("the line never printed"); the actual, verified behavior is that `SIGTERM` — the signal sent by
`docker stop`, PM2 restarts, and Kubernetes pod termination in normal operation, not just crash scenarios —
reliably drops a meaningful fraction of in-flight requests instead of draining them. That's a real availability
defect during ordinary deploys, not just a missing log line.

---

## Rules

- **Do not fix anything.** Do not edit any file outside this document.
- You MAY edit this document: correct claims, adjust severities, add evidence, mark items refuted.
- `JOBS_DB_PATH` to a temp file, ephemeral `PORT`, never the real `jobs.db`, never the repo's `data/resumes/`.
- Reuse `test/e2e/helpers/harness.js`. Scratch scripts under /tmp only.
