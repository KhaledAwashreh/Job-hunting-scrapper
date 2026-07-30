# UI polish + end-to-end tests — design

Date: 2026-07-30
Branch: `fix-scoring-and-filtering`
Status: **awaiting approval** — no implementation until this document is approved.

## 1. What was asked

> "I'm not really much of a UI/UX designer but as it stands the UI is ugly, and not friendly for
> E2E tests. I still want it SSR with HTMX but would like it to be a bit more polished. I would like
> some fixes to be done and E2E tests to be run and conducted properly to make sure no regressions
> occur."

And on what the tests should care about:

> "My concern is also data extraction, scoring existing, UI components loading, navigation correct —
> ugly UI is not an indication for tests, but malformed is."

And:

> "Also a snapshot test to make sure that the UI is not extremely different. I do not intend to
> change the UI with fluid styling so this should be easy."

## 2. Two premises that need correcting first

**The app is not SSR and does not use HTMX.** It serves static files (`express.static`,
`res.sendFile`) and the browser populates the DOM through 19 `fetch()` calls across
`dashboard.html` and the three component files. "Keep it SSR with HTMX" therefore describes a
migration, not a preservation. The agreed scope (*Polish + E2E in place*, approach B) deliberately
excludes that migration. **If an actual HTMX migration is wanted, this spec is the wrong shape and
should be rewritten.**

**E2E needs no new dependency.** `playwright@^1.60.0` is already a direct dependency in
`package.json`. What is missing is only the browser binaries — `npx playwright install chromium`,
a one-time ~150 MB download, not a package change. This corrects the earlier read that E2E was
blocked on adding `@playwright/test`; only *pixel* snapshotting needs that (see §7).

## 3. Goals

1. Consolidate the styling so the UI is coherent and readable, without redesigning it.
2. Make the UI addressable by tests — stable hooks that don't depend on text or CSS classes.
3. Fix the confirmed UI defects found while surveying (§4).
4. An E2E suite that fails on malformed or missing UI and on broken data, and does not fail on
   aesthetics.
5. A snapshot test that catches "the UI changed a lot" without breaking on every pixel.

### Non-goals

- No visual redesign, no new design language, no component framework.
- No HTMX/SSR migration.
- No assertion that any particular score, job, or company is "correct" — only that the shapes and
  ranges hold.
- No new runtime dependencies.

## 4. Confirmed defects to fix

These were verified in the code, not inferred.

| # | Defect | Evidence | Severity |
|---|--------|----------|----------|
| D1 | The country picker **always** falls back to a hardcoded 15-country list, and that list omits **Ireland and Portugal** — two of the four target countries. So those two cannot be selected in the UI at all. | `server.js:97` sets `connect-src 'self'`, which blocks the `fetch('https://restcountries.com/v3.1/all')` at `companies-countries.js:19`. The `catch` at :32 calls `useFallbackCountries()` (:38), whose list has US/GB/CA/AU/DE/FR/NL/SG/IN/JP/ES/IT/BR/MX/ZA — no IE, no PT. | **High** — directly blocks the user's actual search. |
| D2 | Two separate `<style>` blocks and 53 inline `style=` attributes; no single source of truth for color or spacing. | `dashboard.html` `<style>` at top (388 lines) plus a second `<style>` at :611; inline styles across the three component files. | Medium |
| D3 | Zero `@media` queries — the layout has no small-viewport behavior at all. | grep across `public/`. | Medium |
| D4 | Zero test hooks. Tests would have to select on text or presentational classes. | grep for `data-testid` returns nothing. | Medium (blocks goal 2) |
| D5 | `jobs.db` path is hardcoded, so no test can run against an isolated database. | `schema.js:7` — `path.join(__dirname, '../../jobs.db')`, written at :160. | **Blocking for E2E** |

D1 is the one that changes the user's day. It gets fixed regardless of what happens to the rest.

## 5. Styling consolidation (approach B)

Keep the current look; give it one spine.

- **Tokens.** One `:root` block of custom properties for color, spacing, radius, and type scale,
  derived from the colors already in use rather than newly invented. Everything else references
  the tokens.
- **One stylesheet.** Merge both `<style>` blocks into `public/styles.css`, served by the existing
  `express.static`. This is same-origin, so `style-src 'self'` is satisfied — no CSP change.
- **Kill the inline styles.** Replace all 53 inline `style=` attributes with classes. This is the
  bulk of the mechanical work and the part most likely to cause visual drift, so it lands before
  the snapshot baseline is taken (§8).
- **One breakpoint.** A single `@media (max-width: 768px)` that stacks the layout and lets tables
  scroll in their own container. Not a full responsive redesign — one breakpoint that stops the
  page breaking.
- **Visible focus states** on every interactive element. Currently absent; also makes keyboard-driven
  E2E steps observable.

Explicitly *not* changing: the tab metaphor, the information layout, the color identity, or any
copy.

## 6. Test hooks

Convention: `data-testid="<area>-<thing>"`, kebab-case, added to
1. each of the four tab buttons and the four tab panels,
2. every data container that gets populated by a `fetch` (`positions-table`, `companies-table`,
   `profiles-list`, `runs-list`, `countries-container`),
3. each row-level repeated element, plus a `data-testid` on the row's key fields (title, company,
   location, score),
4. every form control and submit button in the profile and company forms,
5. the empty-state and error-state elements, so "no data" and "failed to load" are distinguishable
   from "not rendered".

Point 5 matters more than it looks: without it, a test cannot tell a genuinely empty table from a
silently broken one, which is precisely the "malformed" case the tests exist to catch.

Existing `id` attributes stay — they're referenced by `getElementById` throughout and are not
test-owned.

## 7. E2E architecture

**Runner:** `node:test`, the same runner the 66 existing tests use.
**Driver:** the `playwright` library, already a dependency.
**Browsers:** `npx playwright install chromium` — needs to be run once. Documented in the README
and guarded by a clear skip-with-message if the binary is absent, so `npm test` never hard-fails
for someone who hasn't installed it.

**Isolation (fixes D5).** `schema.js:7` becomes:

```js
const dbPath = process.env.JOBS_DB_PATH || path.join(__dirname, '../../jobs.db');
```

The E2E harness sets `JOBS_DB_PATH` to a file in a temp directory, seeds it with fixtures, boots
the server as a child process on an ephemeral port, runs the assertions, then tears down and
deletes the temp directory.

This is the whole reason for the env var: **the real `jobs.db` is never opened, read, written, or
created by any test.** That constraint is absolute.

**Fixtures.** A small deterministic seed: 2 companies, 4 positions across the four target
countries plus one non-target, 2 profiles, 1 run-log entry, and one deliberately awkward row (empty
location, null score) to exercise the empty/error states.

**Scripts.** `npm test` keeps running only the fast unit tests. E2E goes behind `npm run test:e2e`
so the fast suite stays fast and CI-friendly.

### Assertion matrix

| Concern | Assert | Do **not** assert |
|---|---|---|
| Data extraction | Every rendered position has non-empty title, company, location and a valid URL; country resolves through `extractCountry`. | Which jobs exist upstream, or scrape results. |
| Scoring exists | Every position with a score renders it, and it is a number within the valid range; null scores render the defined empty state, not `null`/`NaN`/`undefined`. | That a score is the "right" score. |
| Components load | Each of the five data containers is populated after load; where seeded data exists, the container is non-empty and shows neither the empty nor the error state. | Pixel placement, spacing, color. |
| Navigation | All four tabs reachable by click; exactly one panel active at a time; the correct panel for the clicked tab; no control that does nothing. | Transition/animation styling. |
| Malformed markup | No `undefined`/`NaN`/`[object Object]` in rendered text; no unclosed or orphaned containers; no element overflowing the body horizontally; console has no uncaught errors. | Whether it looks good. |
| **D1 regression** | Ireland and Portugal are both selectable in the country picker. | Whether the live REST API is reachable. |

The "console has no uncaught errors" assertion is what would have caught D1 in the first place —
the CSP violation logs, and today nothing watches for it.

## 8. The snapshot test

Requirement restated: catch "the UI is extremely different", not "one pixel moved".

**Decision: DOM-structure snapshot as the gate. No new dependency.**

Serialize the rendered DOM of each of the four tabs to a normalized tree — element tags, nesting,
`data-testid`s, and class names, with all text content and all attribute *values* stripped except
the testids. Write it to `test/e2e/__snapshots__/<tab>.snapshot.txt` and diff on subsequent runs.

Why this and not pixels:

- It catches exactly the failure the user described — structure disappearing or being rearranged —
  and it is what "malformed is [an indication], ugly is not" actually asks for.
- It survives the styling consolidation in §5, which will legitimately change every color and
  spacing value while the structure stays put. A pixel baseline taken today would fail wholesale
  tomorrow for no real reason.
- Zero dependencies, deterministic, and a readable diff that says *what* changed.

**Pixel snapshots are deliberately deferred, and need a decision.** `page.screenshot()` does exist
in the `playwright` driver, so capturing an image is free. What isn't free is *comparing* two
images with a tolerance — that needs either `@playwright/test` (for `toHaveScreenshot()`) or a
small diffing package such as `pixelmatch`. Both are new dependencies and neither can be added
without an explicit yes. Hashing the PNG instead is not a substitute: any 1-pixel change fails it,
which is the exact brittleness we're trying to avoid.

**Baseline timing:** snapshots are captured *after* §5 lands, not before. A baseline taken against
the un-consolidated UI would be stale the moment the first inline style is removed.

## 9. Sequencing

Four phases, each independently reviewable, each leaving the suite green.

| Phase | Work | Exit condition |
|---|---|---|
| **P1 — Testability** | `JOBS_DB_PATH` override (D5); add the `data-testid` hooks (D4); fix D1. | Unit suite still 66/66 green; a test can boot the server against a temp DB; Ireland and Portugal selectable. |
| **P2 — Styling** | Merge the two `<style>` blocks into `public/styles.css`; tokens; remove 53 inline styles; one breakpoint; focus states (D2, D3). | UI renders equivalently by eye; no CSP change needed; no structural DOM change. |
| **P3 — E2E** | Harness, fixtures, and the assertion matrix in §7. | `npm run test:e2e` green; each assertion demonstrated to fail against a deliberately broken build. |
| **P4 — Snapshots** | Capture DOM-structure baselines for the four tabs; wire the diff. | Baselines committed; a structural change is shown to fail the diff. |

P1 fixes D1 first because it's the only defect here that costs the user real jobs.

The P3 exit condition is not decoration. A test that passes against a broken build is worse than no
test, and the branch just spent five tasks learning that — every fix on it was mutation-checked
before being believed.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Removing 53 inline styles causes visual drift nobody notices. | P2 is a separate reviewable phase; DOM structure is asserted unchanged; snapshot baselines come after. |
| Playwright browsers absent on another machine → suite fails confusingly. | Skip with an explicit "run `npx playwright install chromium`" message rather than failing. |
| E2E touching the real `jobs.db`. | `JOBS_DB_PATH` set to a temp file for every E2E run; the harness asserts the real path is untouched before and after. |
| Flaky waits on `fetch`-populated containers. | Wait on the testid'd container reaching a populated state, never on fixed timeouts. |
| Scope creep into an HTMX migration. | Explicit non-goal; if wanted, this spec is replaced, not extended. |

## 11. Decisions needed before implementation

1. **Approve the DOM-structure snapshot** as the snapshot mechanism (§8), with pixel diffing
   deferred pending a dependency decision. — *Recommended.*
2. **Confirm the HTMX/SSR migration stays out of scope** (§2). This is the one item that would
   invalidate the rest of the document.
3. **Approve running `npx playwright install chromium`** in this environment (~150 MB, no package
   change).

Everything else in this document is a consequence of decisions already made
(*Polish + E2E in place*, approach B, all four UI areas, the assertion criteria in §7).
