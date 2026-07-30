# U1 — Frontend (UNCONFIRMED)

**Status:** reported by one reviewer, NOT independently verified
**Files:** `public/components/positions-tab.js`, `public/dashboard.html`

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

---

## U1.2 — Event listeners accumulate on tab revisits (claimed High)

**Claim:** `dashboard.html` calls `PositionsTab.init()` on every Positions tab click; `init()` calls
`setupEventListeners()` unconditionally; handlers are never removed. Reported: after 3 revisits, one filter
change fires 4 fetches.

**Verify:** reproduce the count. Then determine whether it is merely wasteful or actually harmful — the reviewer
claimed a race where out-of-order responses overwrite fresh data. Prove or disprove that specifically.

---

## U1.3 — The Job Type filter does nothing (claimed Medium)

**Claim:** `#jobTypeFilter` is populated with real options and has a change handler, but `loadPositions()`
(`positions-tab.js:36-52`) never reads its value, so no filtering occurs.

**Verify:** reproduce. Check whether some *other* code path applies it before concluding it is dead.

---

## U1.4 — Three filter selects can never be used (claimed Medium)

**Claim:** `#filterJobType`, `#filterLocation`, `#filterLevel` (`dashboard.html:44-52`) contain only a
placeholder option; nothing populates them, though their handlers and the filtering logic are correct.

**Verify:** reproduce, and confirm no population code exists anywhere.

**Note:** U1.4 interacts with confirmed finding A6 (`parseArray` returns `[]` for already-parsed arrays), which
is being fixed in parallel. Two of these selects filter via `parseArray`. Say clearly whether A6's fix alone
would make them work once populated.

---

## Rules

- **Do not fix anything.** Do not edit any file outside this document.
- You MAY edit this document: correct claims, adjust severities, add evidence, mark items refuted.
- Boot the app with `JOBS_DB_PATH` set to a temp file and `PORT` ephemeral. Never touch the real `jobs.db`.
- `playwright` resolves from the repo, so run scripts with the repo as cwd; launch Chrome via
  `chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true })`.
- Reuse `test/e2e/helpers/harness.js` (it has a `seed` option).
- Scratch scripts under /tmp only.
