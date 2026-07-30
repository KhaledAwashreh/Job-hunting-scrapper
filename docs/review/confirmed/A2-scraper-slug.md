# A2 — Lever slug detection

**Status:** confirmed by execution · **Owner:** fix agent A2
**Files:** `src/agents/apiAgent.js`

## A2.1 — `api.lever.co` URLs resolve to the wrong company (High)

`detectLeverSlug` (`apiAgent.js:43-57`) has two branches. The first (`m1`, lines 46-49) matches the first path
segment for any hostname containing `lever.co` — which includes `api.lever.co` — and returns before the
dedicated `postings/` branch (`m2`, lines 51-52) is ever reached.

**Reproduced:**
```
https://jobs.lever.co/acme                      -> {"platform":"lever","platform_slug":"acme"}
https://api.lever.co/v0/postings/acme?mode=json -> {"platform":"lever","platform_slug":"v0"}
https://api.lever.co/v0/postings/acme           -> {"platform":"lever","platform_slug":"v0"}
```

The function's own docstring lists `https://api.lever.co/v0/postings/{slug}` as a supported form, so this is a
contradiction between documented and actual behaviour. A company onboarded with that URL gets
`scrapeLever('v0')` — the wrong board, or none.

**Fix direction:** try the most specific pattern first. The `postings/` path form must be checked before the
generic first-segment form, and the generic form should not apply to the `api.` host at all.

**Acceptance:**
- all three URLs above resolve to slug `acme`
- `https://acme.jobs.lever.co` still resolves to `acme`
- a non-Lever URL still returns `{platform: null, platform_slug: null}`
- test fails against the current code

## Rules

- Fix only this defect. `extractCountry` in the same file was just rewritten — do not touch it.
- Tests under `test/`, `node:test` only, no new dependencies.
- Mutation-check: revert the fix, show the test fails, restore.
- Never touch `jobs.db`. Do not run git commands; do not commit.
