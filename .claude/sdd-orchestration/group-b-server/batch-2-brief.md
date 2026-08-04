# Batch 2 — Group B (Server) — Issues #19, #20

Worktree: /home/kawashreh/Projects/Job-hunting-scrapper/.claude/worktrees/group-b-server
Branch: issues/group-b-server
Files: src/server.js

## GitHub Issue #19 (verbatim)

# Untrusted scraped job title injected raw into Content-Disposition header — permanent 500 on that resume's downloads

**Severity: High**

`server.js:669` builds the download filename as `` `tailored-resume-${tailoredResume.position_title}-v${version}.${format}` `` and uses it unescaped at three call sites (`:673`, `:719`, `:770`). `position_title` originates from scraped external job postings — untrusted, second-order input.

Proved two ways:
- Quote-breaking / filename smuggling: a title of `Evil"; filename="pwned.exe` produces `Content-Disposition: attachment; filename="tailored-resume-Evil"; filename="pwned.exe-v1.txt"`.
- CRLF: a title containing `\r\nX-Injected: pwned` makes the header-set call throw, returning `500 {"error":"Invalid character in header content [\"Content-Disposition\"]"}` — and leaking a Node-internal error string.

Because there's no API to edit a stored position title, the CRLF case is a **permanent** 500 for that tailored resume's download route, in every format (txt/docx/pdf all build the header the same way).

### Fix direction
Sanitize/encode `position_title` before using it in the header (strip or percent-encode control characters and quotes), e.g. via a `Content-Disposition` filename encoding helper (RFC 6266) rather than raw template interpolation.

Found by independent audit of `docs/review/unconfirmed/U2-server.md`.

## GitHub Issue #20 (verbatim)

# Mutating routes return 200/phantom-success for nonexistent ids across PATCH and DELETE endpoints

**Severity: Medium-High**

`PATCH /api/positions/:id/status` with a nonexistent or non-numeric id returns `200 null`. The same unchecked-lookup-after-write pattern recurs across the CRUD surface — confirmed live against multiple routes:
```
DELETE /api/companies/99999        → 200 {"success":true,"message":"Company deleted"}
DELETE /api/profiles/99999         → 200 {"message":"Profile deleted"}
DELETE /api/tailored-resumes/99999 → 200 {"message":"Tailored resume deleted"}
PATCH  /api/companies/99999        → 200 (empty body)
PATCH  /api/profiles/99999         → 200 (plausible-looking but content-free object)
PATCH  /api/positions/not-a-number/status → 200 null
```
Callers cannot distinguish "deleted/updated" from "nothing existed to act on" anywhere in the API. Files/lines: `server.js:248-263, 287-326, 510-518, 648-656`.

### Fix direction
Check the affected-row count (or do a lookup) before responding; return 404 when the target id doesn't exist, consistently across all mutating routes.

Merges original claim U2.3 (`docs/review/unconfirmed/U2-server.md`) with the broader pattern found by independent audit of the same file.

## Authoritative technical brief

Read docs/review/unconfirmed/U2-server.md in this worktree before starting — it has corrected/verified severities and exact line numbers/reproduction for both issues. Use it as primary spec.
