# U2 — Server routes (UNCONFIRMED)

**Status:** reported by one reviewer, NOT independently verified
**Files:** `src/server.js`

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

## U2.2 — Client errors reported as 500 (claimed Medium)

**Claim:** malformed JSON bodies and rejected upload types both reach the catch-all at `:789` and return
`500 {"error":"Internal server error"}`, losing multer's specific message.

**Verify both cases.** If you test the upload path, ensure it cannot write into the repo's `data/resumes/`.

---

## U2.3 — Status updates on nonexistent positions return `200 null` (claimed Medium)

**Claim:** `PATCH /api/positions/:id/status` with a nonexistent or non-numeric id returns `200` with body `null`.

**Verify.** Check whether other routes share the pattern (`UPDATE` matching zero rows, then returning the
lookup result unchecked) — if so, list them; that is more useful than the single instance.

---

## U2.4 — Shutdown is not graceful (claimed Low)

**Claim:** `gracefulShutdown()` (`:819-848`) calls `process.exit(0)` without awaiting `server.close()`'s
callback; under SIGTERM the "HTTP server closed" line never printed.

**Verify** with a real signal, and check whether an in-flight request is actually cut.

---

## Rules

- **Do not fix anything.** Do not edit any file outside this document.
- You MAY edit this document: correct claims, adjust severities, add evidence, mark items refuted.
- `JOBS_DB_PATH` to a temp file, ephemeral `PORT`, never the real `jobs.db`, never the repo's `data/resumes/`.
- Reuse `test/e2e/helpers/harness.js`. Scratch scripts under /tmp only.
