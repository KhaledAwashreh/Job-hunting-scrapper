# Batch 3 — Group B (Server) — Issues #21, #22

Worktree: /home/kawashreh/Projects/Job-hunting-scrapper/.claude/worktrees/group-b-server
Branch: issues/group-b-server
Files: src/server.js

## GitHub Issue #21 (verbatim)

# Malformed JSON bodies and rejected uploads surface as generic 500s instead of 400s

**Severity: Medium**

Both malformed JSON request bodies and rejected multer upload types reach the catch-all handler at `server.js:789` and return `500 {"error":"Internal server error"}`, losing the specific underlying message. Confirmed for both cases; the JSON case is actually worse than the original report — `body-parser` sets `err.status = 400`, which the generic handler silently discards and coerces to 500 anyway.

### Fix direction
Give the error-handling middleware an explicit branch for `err.status`/`err.type === 'entity.parse.failed'` (JSON) and multer's `MulterError` (uploads), returning 400 with the real message instead of falling through to the generic 500.

Full repro: `docs/review/unconfirmed/U2-server.md`, item U2.2.

## GitHub Issue #22 (verbatim)

# PATCH /api/companies/:id skips the input validation applied on POST

**Severity: Medium**

`validateCompanyInput` is applied to `POST /api/companies` (`server.js:275`) but not to the `PATCH` route (`:287-316`). Confirmed live: patching with `career_url: "not-a-url-at-all"`, `platform: "totally-bogus-platform"`, `name: ""` persists all three unchanged. Since `platform` drives scraper dispatch downstream, this silently breaks scraping for that company with no surfaced error.

### Fix direction
Apply the same `validateCompanyInput` (or a partial-update variant of it) to the PATCH route.

Found by independent audit of `docs/review/unconfirmed/U2-server.md`.

## Authoritative technical brief

Read docs/review/unconfirmed/U2-server.md in this worktree before starting.
