# U4 — Scraper parsing and fallbacks (UNCONFIRMED)

**Status:** independently verified 2026-07-30 — see per-claim "Verdict" sections below. All five original
claims CONFIRMED (mechanism correct in every case); severities adjusted for two of them (U4.1 split by feed
type — RSS stays Critical, Greenhouse/Lever downgraded to Low; others unchanged). This document is still filed
under `unconfirmed/` pending the owning reviewer moving it to `confirmed/` alongside the actual fixes (not
implemented here per the verification brief's rules).
**Files:** `src/agents/apiAgent.js`, `src/agents/webScrapingAgent.js`

The Lever slug bug was confirmed separately and is being fixed under
`docs/review/confirmed/A2-scraper-slug.md`. **Do not duplicate that.**

---

## U4.1 — One malformed date discards an entire company's feed (claimed Critical)

**Claim:** `apiAgent.js:111` (Greenhouse), `:163` (Lever), `:246` (RSS) call
`new Date(x).toISOString()` inside `.map()`, with the only `try/catch` wrapping the whole batch and returning
`[]`. One job with an unparseable date throws `RangeError: Invalid time value` and every valid job alongside it
is lost.

**Partly established:** the controller confirmed the code structure by inspection — the `Date` call is inside
`.map()`, the outer catch returns `[]`. What is NOT established is the runtime behaviour end to end.

**Verify** with local stub servers for all three scrapers. Then answer the question that decides severity:
**how likely is an unparseable date in practice?** Greenhouse and Lever emit ISO timestamps. Is this reachable
with real-world data, or only with a hostile/broken feed? RSS `pubDate` is the most likely candidate — test it
specifically. Say so plainly either way.

### Verdict: CONFIRMED (mechanism) — severity split by feed type

**Command:** three local `http` stub servers (127.0.0.1, random ports) built to mimic the real Greenhouse
JSON shape, the real Lever flat-array shape, and an RSS/XML feed. `axios.get` was monkeypatched at runtime
(same cached `axios` module instance `apiAgent.js` requires) to redirect the hardcoded
`boards-api.greenhouse.io` / `api.lever.co` hostnames to the local stubs; `scrapeRSSFeed` was called with a
`127.0.0.1` URL directly since it takes an arbitrary URL. Each stub served **one job with an unparseable date
string alongside one job with a good date**. Script:
`/tmp/.../scratchpad/u4_1_stub_test.js` (scratch only, not in repo).

**Actual output** (all three, unedited):
```
=== Greenhouse ===
  ⚠ Greenhouse API error for any-slug: Invalid time value
[ERROR] Greenhouse API failed for any-slug: RangeError: Invalid time value
    at Date.toISOString (<anonymous>)
    at apiAgent.js:115:62
    at Array.map (<anonymous>)
    at Object.scrapeGreenhouse (apiAgent.js:111:31)
Result length: 0 []

=== Lever ===
  → Lever API returned 2 jobs
  ⚠ Lever API error for any-slug: Invalid time value
[ERROR] Lever API failed for any-slug: RangeError: Invalid time value
    at Date.toISOString (<anonymous>)
    at apiAgent.js:167:60
    at Array.map (<anonymous>)
    at Object.scrapeLever (apiAgent.js:163:21)
Result length: 0 []

=== RSS ===
  → Fetching RSS feed: http://127.0.0.1:44399/feed.xml
  ⚠ RSS feed error for http://127.0.0.1:44399/feed.xml: Invalid time value
[ERROR] RSS feed failed: RangeError: Invalid time value
    at Date.toISOString (<anonymous>)
    at parseRSSJobs (apiAgent.js:250:53)
    at Object.scrapeRSSFeed (apiAgent.js:282:18)
Result length: 0 []
```
`new Date('not-a-real-date').toISOString()` was also confirmed directly to throw `RangeError: Invalid time
value` — this is standard JS behavior (the `Date` constructor itself never throws on a bad string, it produces
an `Invalid Date`; the throw happens on `.toISOString()`). In all three cases the good job sitting right next
to the bad one in the same batch was also lost — the claim is accurate end to end, not just by inspection.

**Reachability (the question that decides severity):**
- **Greenhouse** — `job.updated_at` is a server-generated ISO-8601 timestamp from Greenhouse's own API, and the
  code already treats a missing value as falsy (`job.updated_at ? ... : ''`), so an *empty* value can't reach
  `new Date().toISOString()` at all. Hitting this in practice requires Greenhouse itself emitting a malformed
  non-empty timestamp, which does not happen with the documented public API. **Not realistically reachable with
  real Greenhouse data** — only via a hostile/corrupted response.
- **Lever** — same shape of guard (`job.createdAt ? ... : job.publishDate || ''`), and the real Lever API
  returns `createdAt` as a Unix-ms **number**, not a string — `new Date(<number>)` cannot itself throw.
  **Not realistically reachable with real Lever data** either, for the same reason.
- **RSS** — this is the real exposure. `pubDate` is free-text supplied by whatever ATS/CMS is generating the
  feed (per the brief's own note, ING/Salesforce/etc. patterns are hardcoded elsewhere in this file), it is not
  guarded by a truthy check before hitting `new Date()`, and unlike Greenhouse/Lever it is **not** a
  platform-controlled, schema-validated field — enterprise RSS exports are inconsistent about RFC-822
  formatting in practice (blank dates, "N/A", locale-formatted strings, relative text). **This is realistically
  reachable with real-world feeds**, not just hostile ones.

**Revised severity:** keep **Critical** for the RSS path specifically (realistic, and one bad `pubDate` from
one job silently drops the company's entire feed for that run). Downgrade Greenhouse/Lever to **Low** (real,
demonstrated, but only reachable via a corrupted/hostile upstream, not normal operation) — still worth a fix
since it costs nothing to guard, but it is not the urgent risk the original single "Critical" rating implied
for all three.

---

## U4.2 — `scrapeJSONAPI` crashes when `location` is an object (claimed High)

**Claim:** `apiAgent.js:336-337` passes `item.location` straight into `extractCountry`, so a JSON API returning
`location: {city, country}` throws `locationText.split is not a function` and the whole batch is lost —
unlike the Greenhouse/Lever scrapers, which drill into `.name` first.

**Verify** with a stub. Note this throw now surfaces inside the rewritten `extractCountry`; decide whether the
right fix belongs in the caller (`scrapeJSONAPI`) or in `extractCountry`'s input handling, and recommend which.
**Do not implement it.**

### Verdict: CONFIRMED — exact throw site identified against current `extractCountry`

**Command:** local stub JSON-API server (127.0.0.1) returning two items: one with
`location: { city: 'Amsterdam', country: 'Netherlands' }` (object, no `.name`, no top-level `item.country`)
and one with a normal string `location`. Also called `extractCountry({...})` directly.
Script: `/tmp/.../scratchpad/u4_2_stub_test.js` (scratch only).

**Actual output** (unedited):
```
=== extractCountry called directly with an object ===
THROWS: TypeError - locationText.split is not a function

=== scrapeJSONAPI: 1 job with object location + 1 job with string location ===
  → JSON API returned 2 items
  ⚠ JSON API error for http://127.0.0.1:37143/api/jobs: locationText.split is not a function
[ERROR] JSON API failed: TypeError: locationText.split is not a function
    at hasUsStateSuffix (apiAgent.js:607:33)
    at extractCountry (apiAgent.js:623:7)
    at apiAgent.js:340:16
    at Array.map (<anonymous>)
    at Object.scrapeJSONAPI (apiAgent.js:331:18)
Result length: 0 []
```
Confirms the claim precisely, including against the *rewritten* `extractCountry`: the throw does **not** come
from the country/city regex loop (`RegExp.test()` silently coerces its argument to a string via `ToString`,
so it doesn't throw on an object — it just never matches). It comes one step later, from
`hasUsStateSuffix(locationText)` at `apiAgent.js:607`, which calls `locationText.split(',')` on the raw object.
Both string-location and object-location jobs in the same batch were lost, matching the "whole batch is lost"
part of the claim exactly. The claim's line reference (`apiAgent.js:336-337`) is close but the live line
numbers in the current file are 340-341 (`country: extractCountry(item.country || item.location || ...)`) —
harmless drift, same code.

**Fix-direction recommendation (not implemented):** fix in **`extractCountry` itself**, not the caller.
Reasoning: `scrapeJSONAPI` is explicitly the generic/uncertain-shape scraper (its own doc comment lists four
possible response shapes), so it will keep encountering new object shapes from arbitrary company APIs — patching
one caller only defers the next occurrence. `extractCountry` is also called from three other sites
(Greenhouse/Lever/RSS) that all already do defensive `?.name` drilling before calling it; hardening the shared
function so it degrades safely on non-string input (e.g. `if (typeof locationText !== 'string') { if
(locationText?.name) locationText = locationText.name; else if (locationText?.city || locationText?.country)
locationText = [locationText.city, locationText.country].filter(Boolean).join(', '); else return ''; }` before
the existing logic) fixes this call site and protects every future caller in one place. The caller-side
alternative (mirror Greenhouse/Lever's `?.name` drilling in `scrapeJSONAPI`) is cheaper but narrower — it
would still crash on some other new API's location shape (e.g. `{country: 'NL'}` with no `.name`). Recommend
the defensive guard in `extractCountry`, keeping severity **High** as originally claimed (real generic-API
shape, full-batch loss, no unusual/hostile input required — a "custom Next.js API" as the code's own comments
anticipate is enough).

---

## U4.3 — Puppeteer fallback assigns the career-page URL as a job link (claimed Medium-High)

**Claim:** `webScrapingAgent.js:243` does `link: j.link || url`, where `url` is the career listing page itself.
Jobs with no anchor get the listing URL as their link, which then feeds deduplication and the UI's "View" link.

**Verify.** Also assess the knock-on: does this interact with the dedup hash (see `A1`)? Multiple link-less jobs
sharing one URL could collide.

### Verdict: CONFIRMED, including the dedup knock-on

**Code:** `webScrapingAgent.js:243` (unchanged, still current) reads exactly:
```js
jobs.push({
  title: j.title,
  ...
  link: j.link || url,
```
`url` here is the parameter to `scrapeWithPuppeteer(url, company)` — the career listing page passed in from
`scrapeWebsite()`'s Strategy 3 — confirmed by reading the call site and the enclosing function signature. Any
job card the DOM-extraction step (`page.evaluate`, lines ~146-214) found without an `<a>` element gets the
listing URL as its `link`.

**Dedup knock-on — checked against the *current*, already-fixed `hasher.js`** (A1.1/A1.2 have landed:
`hasher.js` now hashes `company_id|title|description|qualifications|link`, with `publishDate` removed and
`company_id` added). Ran `hashJob()` directly (script: `/tmp/.../scratchpad`, inline `node -e`, not saved to
repo) simulating two link-less job cards from the same company, same `career_url` fallback link, and — the
realistic trigger — the same title and the same generic filler description
(`webScrapingAgent.js` uses `description: containerText || 'Position at ${company.name}'` when no richer
context is found, so two cards can plausibly share it):
```
Hash A: e3e197f0...c7d5709b
Hash B: e3e197f0...c7d5709b
Hash A === Hash B (collide): true
Hash C (different title): 310e51b8...90b562ed
Hash A === Hash C: false
```
So the collision is real but **conditional**, not automatic: it requires the two link-less jobs to *also*
share title + description + qualifications, not just the fallback link. That happens when a company posts the
same role title more than once (e.g. identical title across two locations/reqs) *and* the page gives Puppeteer
no distinguishing container text for either — a real but narrower scenario than "any two link-less jobs
collide." The far more common consequence of this line, independent of dedup, is the one named in the claim
title: the UI's "View" button and any per-job identity downstream point at the company's career-listing page
instead of the actual posting for every link-less job, silently, with no signal to the user.

**Revised severity:** keep **Medium-High** as claimed — confirmed on both counts (broken "View" link is the
common case, occasional dedup collision/data-loss is the less common but real worst case).

---

## U4.4 — A 404 detail page overwrites a good job title (claimed Medium)

**Claim:** `webScrapingAgent.js:251-264` navigates to each job URL without checking the HTTP status, then
unconditionally overwrites the title from the listing page if the detail page yields a truthy one — so an error
page's `<title>` replaces correct data.

**Verify.**

### Verdict: CONFIRMED — live browser proof, not just inspection

**Command:** local stub HTTP server (127.0.0.1) returning HTTP 404 with a body
`<title>404 Not Found - Careers</title>`, navigated to with the *actual* installed `puppeteer` package
(`v25.0.2`, already a project dependency) using the same launch flags `webScrapingAgent.js` uses
(`--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu`). Script:
`/tmp/.../scratchpad/u4_4_stub_test.js` (scratch only).

**Actual output** (unedited):
```
page.goto did NOT throw for a 404.
response.status(): 404
response.ok(): false
Extracted <title> from the 404 page: 404 Not Found - Careers
Would extractJobFromHTML() consider this "truthy title data"? true
```
This confirms both halves of the claim directly, not by documentation lookup: (1) `page.goto()` does not throw
and does not reject on a 4xx/5xx response — it resolves normally, and the code at `webScrapingAgent.js:253`
never reads `response.status()` or `response.ok()` (in fact it never even captures the return value of
`page.goto`), so a 404 is indistinguishable from a 200 to this code; (2) the 404 page's `<title>` is a normal
truthy string, and per `extractJobFromHTML` (`:394-397`) that string becomes `jobInfo.title`, which the loop at
`:261-263` then unconditionally assigns over `existing.title` with no check that the detail fetch actually
succeeded. Line numbers (`:251-264`) match the current file exactly, unshifted by other confirmed fixes.

**Revised severity:** keep **Medium** as claimed — confirmed, real, and cheap to trigger (any dead/expired job
link, redirected posting, or rate-limited detail page reproduces it), but it only corrupts the title/description
of already-discovered jobs rather than losing data outright, which is why Medium rather than High is the right
tier relative to U4.1/U4.2.

---

## U4.5 — Dead reliability code (claimed Low-Medium)

**Claim:** `monitorMemoryPressure` (`:507`) has zero callers; `scrapeWithFirecrawlJSON` (`:706`),
`scrapeWithFirecrawlExtract` (`:858`), `scrapeWithFirecrawlInteract` (`:410`) and `detectSPAType` (`:532`) are
never invoked from `scrapeWebsite()` — roughly 250 lines unreachable.

**Verify** by call-graph, and state clearly whether the memory guard the code appears to rely on ever runs.
Recommend delete vs. wire-up for each; **do not implement**.

### Verdict: CONFIRMED — call-graph checked repo-wide, not just within the file

**Command:** `grep -rn "monitorMemoryPressure\|scrapeWithFirecrawlJSON\|scrapeWithFirecrawlExtract\|scrapeWithFirecrawlInteract\|detectSPAType" --include="*.js" .` across the whole repo (excluding
`node_modules`), plus a targeted grep of each name inside `webScrapingAgent.js` alone to rule out internal
(intra-file) call sites the repo-wide grep might have flattened.

**Actual output:**
- Repo-wide: every one of the five names appears **only** at its own `function`/`async function` definition
  line inside `webScrapingAgent.js`, plus `monitorMemoryPressure` also appears once more in
  `module.exports` (`:1097`) and once in `full-validation.js:567` — but that reference only asserts
  `typeof playwrightAgent.monitorMemoryPressure === 'function'` (a "does this export exist" smoke test), it
  never calls it. No other file requires or invokes any of the four un-exported functions
  (`scrapeWithFirecrawlJSON`, `scrapeWithFirecrawlExtract`, `scrapeWithFirecrawlInteract`, `detectSPAType`) —
  they aren't even in `module.exports` (`:1095-1098` exports only `scrapeWebsite` and `monitorMemoryPressure`).
- Within `webScrapingAgent.js` itself: each name's only occurrence is its own definition line — zero internal
  callers either. `scrapeWebsite()` (the only real entry point, `:642-699`) calls exactly three strategies:
  `scrapeWithFirecrawlScrape` (Strategy 1), `scrapeWithFirecrawlAgent` (Strategy 2), `scrapeWithPuppeteer`
  (Strategy 3), plus `tryDirectAPIScrape` — none of the five audited functions are among them.

**Memory guard specifically:** confirmed it never runs. `monitorMemoryPressure` is fully defined and exported,
but nothing in the live `scrapeWebsite()` path (or anywhere else in the repo) ever calls it — the 512MB
heap / 500-job limits it checks are inert numbers. `full-validation.js` only checks the export exists, which
would keep passing even if the function body were deleted and replaced with `return true`.

**Line count:** actual line ranges — `scrapeWithFirecrawlInteract` 410-472 (63), `monitorMemoryPressure`
507-527 (21), `detectSPAType` 532-554 (23), `scrapeWithFirecrawlJSON` 706-813 (108),
`scrapeWithFirecrawlExtract` 858-914 (57) — sum ≈ **272 lines**, matching the claim's "roughly 250" ballpark
(slightly higher, same order of magnitude; the claim did not miscount materially).

**Delete vs. wire-up recommendation per function (not implemented):**
- `monitorMemoryPressure` — **delete**. Nothing in the current single-company-per-call design of
  `scrapeWebsite()` accumulates jobs across calls the way this function's `allJobs` parameter implies; wiring
  it in would need an accumulator that doesn't currently exist. No evidence (issue history, comments) of an
  actual past OOM incident motivating it.
- `detectSPAType` — **delete**. Its per-platform `url.toLowerCase().includes(...)` checks duplicate logic
  `tryDirectAPIScrape` (`:560-633`, actively used at Strategy 0) already performs; keeping both is redundant,
  not complementary.
- `scrapeWithFirecrawlJSON`, `scrapeWithFirecrawlExtract`, `scrapeWithFirecrawlInteract` — **delete**, with one
  caveat worth flagging to the user before deleting: all three still contain
  `require('fs').appendFileSync('debug.log', ...)` calls that write to `process.cwd()` (not through the
  project's `logger` utility, no rotation/size cap) — dead today, but if anyone "resurrects" one of these by
  wiring it back in, that debug-log side effect comes back with it. `scrapeWithFirecrawlAgent` and
  `scrapeWithFirecrawlScrape` (the two Firecrawl strategies actually in use) already cover the
  prompt-extraction and markdown-parsing approaches these three functions represent alternates of, so wire-up
  is not obviously worth the added Firecrawl-credit cost of an extra strategy tier — delete is the recommended
  default, but flag the `debug.log` writes explicitly if the user decides to keep any of them.

**Revised severity:** keep **Low-Medium** as claimed — confirmed dead, no functional risk today, but the
`debug.log` file-write side effect (unused today) and the false confidence `full-validation.js` gives about
"memory limits are enforced" are worth a maintenance note.

---

## Rules

- **Do not fix anything.** Do not edit any file outside this document.
- You MAY edit this document: correct claims, adjust severities, add evidence, mark items refuted.
- **No network calls to real third-party services.** No live scraping, no Firecrawl API calls (they cost the
  user real credits). Use local stub servers on 127.0.0.1 only.
- Never touch `jobs.db`. Scratch scripts under /tmp only.
