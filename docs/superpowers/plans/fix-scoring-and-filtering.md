# Plan: Fix scoring, filtering, profiles, and the resumes route

Fixes GitHub issues #1–#5 in `KhaledAwashreh/Job-hunting-scrapper`. Issue #6 (repo hygiene) is
deliberately out of scope.

## Context

Job Hunter is a Node/CommonJS job scraper: `src/agents/orchestrator.js` walks active companies,
scrapes each via `apiAgent` (Greenhouse/Lever/Workable/RSS/JSON) or `webScrapingAgent`
(Firecrawl → Puppeteer), filters each job against the user's profiles, scores it against their
resume, and stores it in a sql.js SQLite file (`jobs.db`). An Express server (`src/server.js`)
serves a 5-tab vanilla-JS dashboard from `public/`.

The database currently holds 40 positions from one run on 2026-05-24. Every one has
`match_score = 0`, roughly a third are outside the configured target countries, and the
`profiles` table holds 10 near-duplicate rows. These four tasks address the causes.

## Global Constraints

These bind every task. They are copied from `AGENTS.md` plus decisions made for this branch.

- **CommonJS only** — `require` / `module.exports`. No ES modules, no TypeScript.
- **No new runtime dependencies.** `package.json` dependencies must not gain entries. Tests use
  the built-in `node:test` and `node:assert/strict` (Node 22 is installed; `package.json`
  declares `"node": ">=18.0.0"`).
- **Async/await** — no raw promise chains.
- **2-space indentation.** Inline comments only where the logic is non-obvious.
- **Write complete files.** No stubs, no `TODO`, no "rest of implementation here".
- **Tests are kept, not deleted.** This intentionally supersedes the `AGENTS.md` rule "Delete the
  test script after it passes" — that rule is being changed on this branch (Task 1). Every task
  adds tests under `test/` that survive in the repo.
- **Do not modify `jobs.db`.** It is gitignored live data. Tests must build their own database
  state or test pure functions directly; no test may open or write the repo-root `jobs.db`.
- **Do not reformat untouched code.** Keep diffs scoped to the behavior being changed.

---

## Task 1: Provider-agnostic scoring, current model IDs, and the test harness

Closes #1 and #5.

### 1a. Test harness (prerequisite for every later task)

Create `test/` at the repo root. Update the `test` script in `package.json` from:

```json
"test": "echo \"Running tests...\" && node test-*.js"
```

to:

```json
"test": "node --test test/"
```

Delete these four dead test scripts:

- `src/test-db.js` and `src/test-hasher.js` — both reference a `better-sqlite3`-era API
  (`createSchema`, `queries.insertCompany.run`) that this project no longer has, and neither is
  reachable from any npm script.
- `test-orchestrator.js` — matched by the current `test-*.js` glob and crashes immediately with
  `Cannot find module './agents/orchestrator'` (the path is missing the `src/` prefix). This is
  why `npm test` currently fails.
- `test-orchestrator2.js` — also matched by the glob. Its paths are correct, which is worse: it
  calls `runScraper()`, so a green `npm test` would launch a **live scrape** against every active
  company, spending Firecrawl credits and hitting third-party APIs. It must not survive into a
  working test suite.

The baseline `npm test` on this branch fails before any task work begins; fixing it is part of
this task, not a pre-existing condition to preserve.

Update `AGENTS.md`: replace the "After each module" section's delete-after-passing rule with the
kept-tests convention. Keep the rest of `AGENTS.md` unchanged.

### 1b. Provider selection

`src/scoring/relevanceScorer.js` hardcodes Anthropic at two call sites:

- line 72 — `translateToEnglish`
- line 164 — `scorePosition`

Both call `createClient('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY })`.

Replace each with a provider resolved through the existing, currently-unused helper
`getProviderForUseCase` from `src/utils/llmFactory.js:174`:

- `scorePosition` → `getProviderForUseCase('scoring')` (reads `SCORING_PROVIDER`)
- `translateToEnglish` → `getProviderForUseCase('translation')` (reads `TRANSLATION_PROVIDER`)

Drop the explicit `apiKey` option so each provider factory reads its own environment variable —
`createAnthropicClient` already reads `ANTHROPIC_API_KEY` (`llmFactory.js:40`), the OpenAI factory
reads `OPENAI_API_KEY` (`:92`), and Ollama needs no key.

### 1c. Per-provider model defaults

`relevanceScorer.js:166` passes `model: MODELS.CLAUDE_MAIN` unconditionally, and `:78` passes
`MODELS.CLAUDE_FAST` — meaningless when the provider is Ollama or OpenAI.

Change `src/config.js` to:

```js
const MODELS = {
  CLAUDE_MAIN: process.env.CLAUDE_MODEL || 'claude-opus-5',
  CLAUDE_FAST: process.env.CLAUDE_MODEL_FAST || 'claude-haiku-4-5',
  OPENAI_MAIN: process.env.OPENAI_MODEL || 'gpt-4o',
  OLLAMA_DEFAULT: process.env.OLLAMA_MODEL || 'mistral',
};
```

Use these exact ID strings. `claude-opus-5` and `claude-haiku-4-5` are complete as written —
do not append date suffixes. The previous values were both dead: `claude-3-5-sonnet-20241022`
was retired 2025-10-28, and `claude-3-haiku-20250305` was never a valid ID.

Add a `defaultModelFor(provider, tier)` helper to `src/utils/llmFactory.js` and export it:

- `('anthropic', 'main')` → `MODELS.CLAUDE_MAIN`
- `('anthropic', 'fast')` → `MODELS.CLAUDE_FAST`
- `('openai', 'main' | 'fast')` → `MODELS.OPENAI_MAIN`
- `('ollama', 'main' | 'fast')` → `MODELS.OLLAMA_DEFAULT`
- unknown provider → throw `Error(\`Unknown LLM provider: ${provider}\`)`, matching the existing
  message at `llmFactory.js:32`

Have `relevanceScorer.js` call it for both the scoring (`'main'`) and translation (`'fast'`) paths
instead of naming `MODELS.*` directly.

### 1d. `maxTokens` headroom

`relevanceScorer.js:167` requests `maxTokens: 200`. On `claude-opus-5` thinking is on by default
and `max_tokens` caps thinking *plus* response text together, so 200 truncates before the JSON is
emitted and `JSON.parse` at `:175` fails — which lands back at `score: 0`, the exact symptom
being fixed. Raise the scoring call to `maxTokens: 2048`. Leave the translation call's
`maxTokens: 4000` (`:80`) as is.

### Tests — `test/relevance-scorer.test.js`, `test/llm-factory.test.js`

`scorePosition` and `translateToEnglish` are not currently injectable, so add tests that do not
require network access:

1. `defaultModelFor` returns the expected ID for each of the six provider/tier pairs, and throws
   on an unknown provider.
2. `getProviderForUseCase('scoring')` returns `'ollama'` when `SCORING_PROVIDER=ollama` is set,
   and `'anthropic'` when it is unset. Restore `process.env` after each case.
3. `scorePosition` returns `{score: 0, matched_resume: null, reasoning: 'Incomplete job data'}`
   for a job missing `title` or `description` (existing guard at `relevanceScorer.js:93`), and
   `reasoning: 'No resumes available for scoring'` for an empty resumes array (`:101`). These
   pin the early-return contract the orchestrator depends on.
4. `extractResumeSummary` (not currently exported — export it) extracts years of experience and
   seniority from a sample resume string.

### Acceptance

- `SCORING_PROVIDER=ollama` routes scoring to the Ollama client; no code path reaches
  `createAnthropicClient` when it is set.
- No literal `'anthropic'` string remains as a provider argument in `relevanceScorer.js`.
- `npm test` passes.

---

## Task 2: Country filter must not fall back past an explicit non-matching location

Closes #2.

`matchesProfile` in `src/utils/jobFieldExtractor.js:272-293` currently reads:

```js
if (searchParam && searchParam.country) {
  const targetCountries = searchParam.country.split(';').map(c => c.trim().toLowerCase());
  const jobCountry = (jobFields._country || '').trim().toLowerCase();
  const compCountry = (companyCountry || '').trim().toLowerCase();

  const jobMatch = jobCountry && targetCountries.some(tc =>
    jobCountry.includes(tc) || tc.includes(jobCountry)
  );

  if (jobMatch) {
    // Job country matches — keep going
  } else {
    // Step 2: Fall back to company's home country
    const compMatch = compCountry && targetCountries.some(tc =>
      compCountry.includes(tc) || tc.includes(compCountry)
    );
    if (!compMatch) {
      return false;
    }
  }
}
```

The company-country fallback is intended for jobs whose location is missing or unparseable, but
it also fires when the location is present and explicitly outside the target set. Adyen is
registered `Netherlands`, so its Bengaluru, Chicago, Singapore, and São José dos Campos postings
all pass; Contentful is `Remote EU`, so its United Kingdom postings pass.

### Required behavior

Consult the company country **only** when the job has no usable location of its own. Three cases:

| Job location | Behavior |
|---|---|
| Present and matches a target country | Accept |
| Present and does not match any target | **Reject** — do not consult company country |
| Absent, empty, or whitespace | Fall back to company country as today |

"Absent" means `jobFields._country` is falsy or trims to an empty string. That is the only
condition that reaches the fallback. Note `extractCountry` (`src/agents/apiAgent.js:490`) returns
the raw location text when it recognizes no country, so a present-but-unrecognized value like
`"NYC-Privy"` or `"N/A"` counts as **present** and is therefore rejected, not passed through.

Keep the existing substring matching (`jobCountry.includes(tc) || tc.includes(jobCountry)`) and
the `;`-separated multi-country parsing exactly as they are — this task changes only which branch
is taken, not how a single comparison works.

### Tests — `test/job-field-extractor.country.test.js`

Call `matchesProfile` directly with a profile whose `job_types` is `["Backend Engineer"]` and a
search param `{country: 'Netherlands', remote: false}`. Cover:

1. Job country `"Amsterdam, North Holland, Netherlands"`, company `"Netherlands"` → `true`
2. Job country `"Bengaluru"`, company `"Netherlands"` → `false` *(the regression being fixed)*
3. Job country `"Chicago"`, company `"Netherlands"` → `false`
4. Job country `""`, company `"Netherlands"` → `true` (fallback still works)
5. Job country `"   "`, company `"Netherlands"` → `true` (whitespace counts as absent)
6. Job country `"N/A"`, company `"Netherlands"` → `false` (present but unrecognized)
7. Search param country `"Netherlands;Ireland"`, job country `"Dublin, Ireland"` → `true`
8. No `searchParam.country` at all → country check skipped, `true`

Use a title that passes both `classifyJobType` and `isEngineeringRelevantTitle` — `"Backend
Engineer"` works. Assert case 2 fails on the *country* check specifically by confirming the same
job with country `"Amsterdam"` returns `true`.

### Acceptance

- All eight cases pass.
- No change to the job-type, seniority, remote, or engineering-title checks in `matchesProfile`.

---

## Task 3: One profile per distinct search-param title

Closes #3.

`ensureProfilesFromSearchParams` (`src/agents/orchestrator.js:77-115`) creates one profile per CSV
row. `data/search-params.csv` repeats each title once per target country, so its 10 rows produced
10 profiles — `Java Backend Engineer` ×4, `Backend Engineer` ×4, plus one each of `Platform
Engineer` and `AI/ML Engineer`, differing only by the generated `Profile N:` prefix.

### Required behavior

Group rows by `title` (trimmed, compared case-insensitively) before creating anything, and create
exactly one profile per distinct title.

For each group:

- **`name`** — the title as it appears in the first row of the group, with no `Profile N:` prefix.
  For the current CSV that yields `Java Backend Engineer`, `Backend Engineer`, `Platform
  Engineer`, `AI/ML Engineer`.
- **`job_types`** — `[title]`, unchanged in shape from today.
- **`resume_file`** — first resume's `filename`, or `''` when none, as today.
- **`seniority_level`** — the first non-null `seniority` in the group, else `null`.
- **`work_location_preference`** — `['Remote']` if **any** row in the group has `remote === true`,
  else `[]`.
- **`years_of_experience`** — `[]`, as today.

Return the same array shape the function returns today (objects carrying `id`, `name`,
`resume_file`, `job_types` as a JSON string, `secondary_category`, `seniority_level`,
`years_of_experience`, `work_location_preference`, and `parsed_job_types`), so the caller at
`orchestrator.js:159` and the `profilesWithParsed` mapping at `:164` keep working unchanged.

Preserve the existing early return: if `getAllProfiles()` already returns rows, return them
untouched and create nothing.

### Existing duplicates

Leave the 10 rows in `jobs.db` alone — this task prevents new duplicates, it does not migrate.
Note in the task report that the user must delete the existing profiles manually (or via the
Profiles tab) for the fix to be visible on their current database, since the early return means
`ensureProfilesFromSearchParams` will never run again while those rows exist.

### Tests — `test/orchestrator.profiles.test.js`

`ensureProfilesFromSearchParams` is not exported. Export it from `orchestrator.js` alongside the
existing exports, and inject its database dependencies rather than importing `queries.js` at module
scope inside the test — the simplest approach that respects the no-new-deps rule is to give the
function optional injected `getAllProfiles` / `addProfile` parameters that default to the imported
ones. Do not add a mocking library.

Cover, using the 10 real rows from `data/search-params.csv` as input:

1. Exactly 4 profiles are created.
2. Their names are exactly `Java Backend Engineer`, `Backend Engineer`, `Platform Engineer`,
   `AI/ML Engineer` — no `Profile N:` prefix.
3. `Platform Engineer` gets `seniority_level: 'mid'`; `Java Backend Engineer` gets `'senior'`.
4. Every profile gets `work_location_preference: ['Remote']` (every CSV row has `remote=yes`).
5. Titles differing only by case or surrounding whitespace group together.
6. When `getAllProfiles` returns a non-empty array, `addProfile` is never called and the existing
   array is returned unchanged.

### Acceptance

- A fresh database built from the current CSV yields 4 profiles, not 10.
- `orchestrator.js`'s profile-matching loop at `:277-287` is untouched by this task.

---

## Task 4: Collapse the duplicate `/api/resumes` route and fix the stale cache

Closes #4.

`GET /api/resumes` is registered twice in `src/server.js` — at `:368` (re-parses from disk on every
request, returns a flat array) and at `:759` (serves the module-level `loadedResumes`, returns
`{resumes, summary: {total, truncated}}`). Express dispatches the first, so the second is dead.

Nothing in `public/` fetches this endpoint — the frontend uses only `POST /api/resumes/upload`
(`public/components/profiles-tab.js:174`) and the tailored-resume download. There is no consumer
to coordinate with.

### The staleness problem

`loadedResumes` is assigned once at startup (`src/server.js:175`) and never refreshed:

- `POST /api/resumes/upload` (`:346`) calls `clearResumeCache()` on the resumeParser module cache
  but never updates `loadedResumes`.
- `DELETE /api/resumes/:filename` (`:385`) unlinks the file and calls neither.

So simply keeping the cached handler would regress the upload flow. The tailor endpoints that read
`loadedResumes` (`:497`, `:515`) have the same staleness.

### Required behavior

1. Delete the handler at `src/server.js:368`. Keep the one at `:759` and its
   `{resumes, summary: {total, truncated}}` response shape.
2. Add a `refreshLoadedResumes()` helper in `src/server.js` that calls `clearResumeCache()` then
   `parseResumes()` and reassigns `loadedResumes`. Reuse it at startup (`:175`) so there is one
   code path.
3. `await` it in the upload handler after a successful upload, replacing the bare
   `clearResumeCache()` call at `:353-354`. Make that handler `async`.
4. Call it in the delete handler after `fs.unlinkSync`. Make that handler `async`.
5. Both handlers keep their existing success response bodies unchanged — only the cache side effect
   is added.

Move the `require('./utils/resumeParser')` calls that currently sit inside handler bodies (`:353`,
`:370`) to the module-scope import already present at the top of `src/server.js`.

### Tests — `test/server.resumes.test.js`

`src/server.js` calls `app.listen` at module scope, so it cannot be imported without binding a
port. Rather than restructure the server in this task, test at the level the defect lives:

1. Assert `src/server.js` registers `GET /api/resumes` exactly once — read the file and count
   matches of `app.get('/api/resumes'`. This is a text assertion, and it is the honest one: the
   defect is a duplicate registration, and the file is the artifact that carries it.
2. Assert the upload and delete handlers each reference `refreshLoadedResumes`.
3. Test `refreshLoadedResumes` behavior indirectly through `resumeParser`: call `parseResumes()`,
   then `clearResumeCache()`, then `parseResumes()` again, and assert both calls return equivalent
   results — pinning that a cleared cache repopulates rather than returning empty.

If the implementer finds a clean way to export the Express `app` without starting the listener
(guarding `app.listen` behind `require.main === module`), prefer that and write real `supertest`
assertions instead — `supertest` is already in `devDependencies`. That is a better test; take it
if the change stays small. Otherwise the text assertions above are acceptable.

### Acceptance

- One `GET /api/resumes` registration, returning `{resumes, summary}`.
- Uploading a resume and re-requesting `GET /api/resumes` reflects the new file.
- Deleting a resume and re-requesting reflects its removal.

---

---

## Task 5: Teach `extractCountry` the cities that appear in job locations

Added mid-execution after Task 2 measured its own impact against the live database. Not tied to
an existing GitHub issue — file one if you want it tracked.

### Why

Task 2 correctly stopped the company-country fallback from firing on an explicit mismatch. But
`extractCountry` (`src/agents/apiAgent.js:490-523`) maps country *names* only, so a posting whose
location is just `"Amsterdam"` stays `"Amsterdam"` — present, non-matching, rejected. Measured
against the 40 stored positions, the new rule rejects 35, and that set wrongly includes
`Amsterdam` (Netherlands), `Barcelona` (Spain), and `Dublin` (Ireland).

The old fallback was accidentally rescuing these, which is why the bug was survivable. Fixing
the fallback without teaching the extractor about cities trades false positives for false
negatives. This task closes that gap.

### Required change

Extend the `countryMap` object literal in `extractCountry` with city → country entries. Keep the
existing structure and the existing `lower.includes(key)` matching — this is a data change, not a
logic change. Do not alter `matchesProfile` (Task 2 owns it).

Add at minimum, grouped and commented by country:

- **Netherlands** — `amsterdam`, `rotterdam`, `eindhoven`, `utrecht`, `the hague`, `den haag`,
  `delft`, `groningen`, `hilversum`
- **Spain** — `barcelona`, `madrid`, `valencia`, `seville`, `sevilla`, `malaga`, `bilbao`,
  `zaragoza`
- **Ireland** — `dublin`, `cork`, `galway`, `limerick`
- **Portugal** — `lisbon`, `lisboa`, `porto`, `braga`, `coimbra`

Also add the non-EU hubs already present in the stored data, so they resolve to a real country
and are rejected deliberately rather than by accident:

- **United States** — `chicago`, `san francisco`, `seattle`, `new york`, `nyc`, `boston`,
  `austin`, `denver`
- **India** — `bengaluru`, `bangalore`, `hyderabad`, `pune`, `mumbai`, `chennai`
- **Canada** — `toronto`, `vancouver`, `montreal`, `ottawa`
- **United Kingdom** — `london`, `manchester`, `edinburgh`, `cambridge`, `bristol`
- **Brazil** — `sao paulo`, `são paulo`, `sao jose dos campos`, `são josé dos campos`
- **Germany** — `berlin`, `munich`, `münchen`, `hamburg`, `frankfurt`, `cologne`

### Ordering hazard — read before implementing

`extractCountry` returns on the **first** `lower.includes(key)` hit while iterating
`Object.entries(countryMap)`, so insertion order is load-bearing. Two concrete collisions to
handle:

1. `"Hybrid (Madrid or Buenos Aires)"` is in the live data. It contains `madrid`. Whichever of
   `madrid` / `buenos aires` is reached first wins. Put the **city entries after the existing
   country-name entries** so an explicit country name in the string always beats a city.
2. `cork` is a substring of `"Cork"` but also of words like `"corking"`; `porto` is a substring of
   `"Oporto"`. These are acceptable for a job-location field, but do not add short city keys
   (under 4 characters) — no `"ams"`, no `"bcn"`.

Do not add a city whose name collides with a country name already in the map.

### Tests — `test/api-agent.country.test.js`

`extractCountry` is already exported from `src/agents/apiAgent.js:549`. Cover:

1. `extractCountry('Amsterdam')` → `'Netherlands'`
2. `extractCountry('Barcelona')` → `'Spain'`
3. `extractCountry('Dublin')` → `'Ireland'`
4. `extractCountry('Bengaluru')` → `'India'`
5. `extractCountry('Chicago')` → `'United States'`
6. `extractCountry('Amsterdam, North Holland, Netherlands')` → `'Netherlands'` (country name and
   city agree)
7. `extractCountry('Hybrid (Madrid or Buenos Aires)')` → `'Spain'` — pins the ordering decision
8. `extractCountry('')` → `''` (unchanged behavior)
9. `extractCountry('Atlantis')` → `'Atlantis'` (unrecognized input still returns raw text)

Then add an integration test to the existing `test/job-field-extractor.country.test.js` proving
the two tasks compose: a job whose `_country` is `extractCountry('Amsterdam')` and whose company
is `Netherlands` now passes `matchesProfile`, while `extractCountry('Bengaluru')` does not.

### Acceptance

- Amsterdam, Barcelona, and Dublin postings pass the country filter again.
- Bengaluru, Chicago, Singapore, Toronto, and São José dos Campos postings still do not.
- All previously passing tests stay green.

---

## Out of scope

- Issue #6 (repo hygiene: `langchain4j/`, `path/to/`, `src/package.json`, `main.py`).
- Migrating the 10 existing duplicate profiles or the 13 out-of-country positions already in
  `jobs.db`. Both are data cleanups for the user to run once the code is fixed.
- Upgrading `@anthropic-ai/sdk` from `^0.20.0`. Current model IDs pass through as strings, so it
  is not blocking; flag it if the implementer hits an SDK-level wall.
- The absent `ANTHROPIC_API_KEY` and exhausted Firecrawl credits — account state, not code.
