# U4 — Scraper parsing and fallbacks (UNCONFIRMED)

**Status:** reported by one reviewer, NOT independently verified
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

---

## U4.2 — `scrapeJSONAPI` crashes when `location` is an object (claimed High)

**Claim:** `apiAgent.js:336-337` passes `item.location` straight into `extractCountry`, so a JSON API returning
`location: {city, country}` throws `locationText.split is not a function` and the whole batch is lost —
unlike the Greenhouse/Lever scrapers, which drill into `.name` first.

**Verify** with a stub. Note this throw now surfaces inside the rewritten `extractCountry`; decide whether the
right fix belongs in the caller (`scrapeJSONAPI`) or in `extractCountry`'s input handling, and recommend which.
**Do not implement it.**

---

## U4.3 — Puppeteer fallback assigns the career-page URL as a job link (claimed Medium-High)

**Claim:** `webScrapingAgent.js:243` does `link: j.link || url`, where `url` is the career listing page itself.
Jobs with no anchor get the listing URL as their link, which then feeds deduplication and the UI's "View" link.

**Verify.** Also assess the knock-on: does this interact with the dedup hash (see `A1`)? Multiple link-less jobs
sharing one URL could collide.

---

## U4.4 — A 404 detail page overwrites a good job title (claimed Medium)

**Claim:** `webScrapingAgent.js:251-264` navigates to each job URL without checking the HTTP status, then
unconditionally overwrites the title from the listing page if the detail page yields a truthy one — so an error
page's `<title>` replaces correct data.

**Verify.**

---

## U4.5 — Dead reliability code (claimed Low-Medium)

**Claim:** `monitorMemoryPressure` (`:507`) has zero callers; `scrapeWithFirecrawlJSON` (`:706`),
`scrapeWithFirecrawlExtract` (`:858`), `scrapeWithFirecrawlInteract` (`:410`) and `detectSPAType` (`:532`) are
never invoked from `scrapeWebsite()` — roughly 250 lines unreachable.

**Verify** by call-graph, and state clearly whether the memory guard the code appears to rely on ever runs.
Recommend delete vs. wire-up for each; **do not implement**.

---

## Rules

- **Do not fix anything.** Do not edit any file outside this document.
- You MAY edit this document: correct claims, adjust severities, add evidence, mark items refuted.
- **No network calls to real third-party services.** No live scraping, no Firecrawl API calls (they cost the
  user real credits). Use local stub servers on 127.0.0.1 only.
- Never touch `jobs.db`. Scratch scripts under /tmp only.
