# Batch 4 (FINAL) — Group B (Server) — Issues #23, #24, #25

Worktree: /home/kawashreh/Projects/Job-hunting-scrapper/.claude/worktrees/group-b-server
Branch: issues/group-b-server
Files: src/server.js

## GitHub Issue #23 (verbatim)

# No rate limiting on the paid LLM-backed resume-tailor endpoint

**Severity: Medium**

`POST /api/positions/:positionId/tailor` (`server.js:522`) invokes `tailorResume()` — a paid Anthropic call — with no throttle, unlike `POST /api/scrape/run` (`:338-364`), which explicitly enforces `MIN_SCRAPE_INTERVAL_MS`. Firing 5 rapid requests all reached full business logic with no `429`. Combined with the wildcard-CORS/no-auth finding, this endpoint can be hammered for unlimited LLM spend by anyone who can reach the server.

### Fix direction
Add the same kind of interval/rate guard used on the scrape route, scoped per position or per IP.

Found by independent audit of `docs/review/unconfirmed/U2-server.md`.

## GitHub Issue #24 (verbatim)

# Static assets (styles.css, countries.json) ship without security headers

**Severity: Low**

`express.static` is registered at `server.js:84`, before the CORS middleware (`:87`) and the security-header middleware (`:96`). Confirmed by request: `/styles.css` and `/countries.json` carry no `content-security-policy`, `x-frame-options`, or `x-content-type-options`, while `/api/health` and `/` do.

Severity corrected down from the original "High" report: `/` — the actual page that renders the unescaped values from the stored-XSS finding — **does** carry the CSP. The registration-order issue only strips headers from static files, which don't execute application logic, not from the page that matters for the XSS finding.

### Fix direction
Move the security-header middleware before `express.static`, or apply `helmet`-style headers globally rather than per-route.

Full repro: `docs/review/unconfirmed/U2-server.md`, item U2.1.

## GitHub Issue #25 (verbatim)

# Shutdown is not graceful — SIGTERM drops in-flight requests

**Severity: Medium**

`gracefulShutdown()` (`server.js:819-848`) calls `process.exit(0)` without awaiting `server.close()`'s callback. Verified with a real `SIGTERM`: the process exits in ~15-20ms, before the close callback runs ("HTTP server closed" never prints), and empirically 11 of 30 concurrent in-flight requests were dropped by the abrupt exit. This hits any normal `docker stop`/k8s eviction/process manager restart, not just crashes — severity raised from the original "Low" report.

### Fix direction
Await `server.close()`'s callback (or a promisified wrapper) before calling `process.exit()`, with a timeout fallback for requests that never finish.

Full repro: `docs/review/unconfirmed/U2-server.md`, item U2.4.

## Authoritative technical brief

Read docs/review/unconfirmed/U2-server.md in this worktree sections U2.1-U2.4 before starting -- these already have corrected/verified severities (U2.1 High->Low since / does carry CSP; U2.4 Low->Medium, empirically drops ~1/3 of in-flight requests under real SIGTERM).
