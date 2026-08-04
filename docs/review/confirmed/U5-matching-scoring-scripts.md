# U5 — Matching, scoring and maintenance scripts (VERIFIED)

> ## RESOLUTION — all 6 items fixed (audited 2026-08-04)
>
> | Item | Status | Where |
> |---|---|---|
> | U5.1 scoring returns 0 on fenced/prose JSON | fixed | fence-stripping + brace-slice fallback in `relevanceScorer.js` (#44, #50) |
> | U5.2 `matched_resume` unvalidated | fixed | validated as an in-range integer (#45) |
> | U5.3 CSV stores invalid seniority | fixed | rejected, not warned-and-stored (#46, #52) |
> | U5.4 "Design System Engineer" rejected | fixed | adjacency-tolerant negative lookahead (#47, #48) |
> | U5.5 `bulk-add-companies.js` duplicates | fixed | `companyExists()` pre-check + UNIQUE index (#29) |
> | U5.6 stale validation scripts | fixed | both deleted (#49) |

**Status:** independently verified against a local OpenAI-protocol stub (no real LLM calls) and temp SQLite DBs
(no real `jobs.db` touched). All six claims CONFIRMED; two carry a correction to the reviewers' stated
mechanism (U5.2, U5.6) and severity was revised for two (U5.4 downgraded Medium→Low, U5.1 scoped to
non-Anthropic providers). See per-claim VERDICT blocks below.
**Files:** `src/utils/csvParser.js`, `src/utils/jobFieldExtractor.js`, `src/scoring/relevanceScorer.js`,
`bulk-add-companies.js`, `validate-imports.js`, `full-validation.js`

**Summary table**

| # | Claim | Verdict | Severity (was → now) |
|---|---|---|---|
| U5.1 | Scoring silently returns 0 on fenced/prose JSON | CONFIRMED | High → High (scoped: non-Anthropic providers) |
| U5.2 | `matched_resume` unvalidated | CONFIRMED (mechanism corrected) | Medium → Medium |
| U5.3 | CSV validation warns but stores invalid seniority anyway | CONFIRMED, incl. downstream chain | Medium → Medium |
| U5.4 | `isEngineeringRelevantTitle` rejects "Design System Engineer" | CONFIRMED | Medium → Low |
| U5.5 | `bulk-add-companies.js` duplicates every company on rerun | CONFIRMED | High → High |
| U5.6 | `validate-imports.js` / `full-validation.js` stale, one exits 0 always | CONFIRMED | Medium → Medium (recommend deletion) |

The country-substring and time-window bugs were confirmed separately (see
`docs/review/confirmed/A1-dedup-and-matching.md`), as were the two scripts ignoring `JOBS_DB_PATH`
(`A7`). **Do not duplicate those.**

---

## U5.1 — Scoring silently returns 0 on fenced or prose-wrapped JSON (claimed High)

**Claim:** `relevanceScorer.js:175` is a bare `JSON.parse(text)` with no pre-processing. A model replying with a
` ```json ` fence or a lead-in sentence falls into the catch and returns
`{score: 0, reasoning: 'Scoring response parsing failed'}` — indistinguishable from a genuine 0.

**Partly established:** the controller confirmed by inspection that no fence-stripping exists anywhere in the
pipeline.

**Verify** end to end by pointing `OPENAI_BASE_URL` at a local stub (set `SCORING_PROVIDER=openai`,
`OPENAI_API_KEY=dummy`; the client posts to `{baseURL}/chat/completions` and reads
`choices[0].message.content`). Test: valid JSON, fenced JSON, prose-wrapped JSON, truncated JSON, empty string.

Then assess impact honestly: the default provider is Anthropic, which follows the "respond ONLY with JSON"
instruction reliably. This matters most for the cheap/local providers just enabled. Say which providers are
realistically affected.

**Also assess:** a failed parse and a genuine zero score are stored identically. Is that distinguishable
anywhere downstream? Recommend a fix direction; **do not implement**.

### VERDICT: CONFIRMED — severity High, but scoped to non-Anthropic providers

**Setup:** local stub HTTP server on `127.0.0.1:38921` implementing `POST /chat/completions` (matches
`createOpenAIClient` in `src/utils/llmFactory.js:150`, which posts to `${baseURL}/chat/completions` and reads
`data.choices[0].message.content`). Ran with `SCORING_PROVIDER=openai`, `OPENAI_API_KEY=dummy`,
`OPENAI_BASE_URL=http://127.0.0.1:38921`, `JOBS_DB_PATH` unset (no DB touched — this test never persists).
Called the real `scorePosition()` from `src/scoring/relevanceScorer.js` seven times in sequence against a
queue of canned replies. Actual output (`node u5_stub_server.js` + `node u5_1_2_runner.js`):

| stub reply | stored `score` | stored `matched_resume` | stored `reasoning` |
|---|---|---|---|
| valid JSON | `80` | `1` | `"Good fit"` |
| ` ```json {...}``` ` fence | `0` | `null` | `"Scoring response parsing failed"` |
| prose-wrapped JSON | `0` | `null` | `"Scoring response parsing failed"` |
| truncated JSON | `0` | `null` | `"Scoring response parsing failed"` |
| empty string | `0` | `null` | `"Scoring response parsing failed"` |

Confirms `relevanceScorer.js`'s bare `JSON.parse(text)` (line 176) has no fence-stripping or prose extraction —
every non-strict-JSON reply collapses to the identical `{score: 0, matched_resume: null}` regardless of *why*
it failed.

**Provider impact, checked against `src/utils/llmFactory.js`:** `getProviderForUseCase('scoring')` defaults to
`'anthropic'` only when `SCORING_PROVIDER` is unset (line 237). The current code path for every other value —
`openai`, `ollama`, and every entry in `OPENAI_COMPATIBLE` (`deepseek`, `groq`, `together`, `openrouter`) —
funnels through `createOpenAIClient`/`createOllamaClient`, neither of which does any parsing beyond the same
bare `JSON.parse`. So this is not "one provider is risky" — it is every provider except the default. That
matters concretely here: commit a4bd816 (referenced in the task brief) just made these cheap/local providers
selectable, which is precisely when this bug starts mattering for real usage rather than being theoretical.
Severity stays **High**, but should be read as "High for any deployment that sets `SCORING_PROVIDER` /
`TRANSLATION_PROVIDER` to anything other than Anthropic" rather than universally High.

**Downstream distinguishability — confirmed indistinguishable, and worse than the claim states.** Traced the
full path: `orchestrator.js:391` calls `scorePosition()` and passes only `scoreData.score` and
`scoreData.matched_resume` into `addPosition()` (`orchestrator.js:412-413`). `addPosition` in
`src/db/queries.js:150-156` inserts into `positions(match_score, matched_resume, ...)` — there is no
`reasoning`/`score_reasoning` column in the schema at all (`src/db/schema.js:51-68`). The `reasoning` string is
never persisted anywhere; it exists only inside the function call and is discarded the instant `addPosition`
returns. So a genuine 0/100 match and a parse failure are not merely hard to tell apart — they are byte-for-byte
identical in the database and in every UI/API surface built on it (`server.js` never sees `reasoning` either).

**Recommendation (not implemented):** the cheapest fix is at the parse site, not downstream — strip a
` ```json ... ``` ` fence and attempt to extract the first `{...}` balanced span before falling back to
`JSON.parse`, exactly like the `code-review`/`superpowers` prompts in this repo already assume LLMs do. For
distinguishability, either (a) add a `score_reasoning TEXT` column and store the raw failure reason so a
`reasoning = 'Scoring response parsing failed'` row can be filtered/re-scored later, or (b) use a sentinel like
`match_score = -1` for parse failures instead of `0`, since `0` is a legitimate score a real reply can produce.
Do not conflate the two fixes — (a) is needed regardless of whether the parser itself gets more lenient, since
provider/network errors (the `catch` at line 191) hit the identical `score: 0` shape today.

---

## U5.2 — `matched_resume` is unvalidated (claimed Medium)

**Claim:** `relevanceScorer.js:188` does `parsed.matched_resume || null` with no type or range check, while
`score` on the line above is clamped and coerced. A string `"1"` or an out-of-range `99` passes straight through
into an INTEGER column and is later compared with strict equality at `server.js:488`.

**Verify** both cases via the stub.

### VERDICT: CONFIRMED (with a nuance the claim didn't anticipate) — severity remains Medium

**Via the stub (same run as U5.1):**

| stub reply | stored `matched_resume` | type |
|---|---|---|
| `"matched_resume": "1"` (string) | `"1"` | `string` |
| `"matched_resume": 99` (out of range, only 2 resumes loaded) | `99` | `number` |

Confirms `relevanceScorer.js:188` (`parsed.matched_resume \|\| null`) does zero type/range checking — both
values pass through the function verbatim, unlike `score` on the line above which is clamped via
`Math.min(100, Math.max(0, parseInt(...) || 0))`.

**End-to-end through the real DB** (`JOBS_DB_PATH` → temp file, `initializeDatabase()` + `addPosition()` +
`getPositionById()`, no real `jobs.db` touched):

- Storing `matched_resume: '1'` (string) → **round-trips as the number `1`**. SQLite's `INTEGER` column-type
  affinity (`positions.matched_resume INTEGER`, `schema.js:66`) silently converts any well-formed numeric-string
  literal on insert. `resumeCache.find(r => r.index === position.matched_resume)` at `server.js:542` then
  **succeeds** — this specific example from the claim does not actually break the strict-equality lookup.
- Storing `matched_resume: 99` (out of range) → stored as `99`, and the strict-equality `find()` **fails to
  find** a match (only indices 1–2 exist), producing the `/api/positions/:id/tailor` 404
  `'Matched resume not found in loaded resumes'` at `server.js:544` even though the LLM did pick a resume.
- Storing a genuinely non-numeric string, e.g. `matched_resume: 'Resume 1'` (a plausible LLM deviation from the
  "respond with just a number" instruction) → SQLite affinity does **not** rescue this one; it stores as the
  literal text `"Resume 1"`, and the strict-equality lookup fails exactly as the claim predicted.

**Correction to the claim:** "a string `\"1\"`... passes straight through into an INTEGER column and is later
compared with strict equality" implies that specific case breaks the lookup — it doesn't, because of SQLite type
affinity, which the reviewers apparently didn't check against. The underlying claim (no validation exists) is
still correct, and it still causes real breakage for (a) any out-of-range integer and (b) any non-numeric-string
reply. Severity holds at **Medium**: the missing validation is real and does cause user-visible 404s on the
"Tailor Resume" action, just not via the exact mechanism described for the `"1"` example.

---

## U5.3 — CSV validation logs "ignoring" but stores the value anyway (claimed Medium)

**Claim:** `csvParser.js:48-49` warns `Invalid seniority ... - ignoring`, but `:58` stores
`record.seniority.trim().toLowerCase()` unconditionally without checking `VALID_SENIORITY`, and the row counts
as valid.

**Verify.** Then trace the downstream effect the reviewer asserted: does an unrecognised seniority make
`seniorityRank` return 0 and silently disable seniority filtering for that profile? Confirm or refute that
specific chain.

**Do not modify `data/search-params.csv`.** Read it if useful; test with in-memory or temp fixtures.

### VERDICT: CONFIRMED, including the downstream chain — severity Medium (narrower blast radius than it first looks)

Read `src/utils/csvParser.js:47-58` directly: the `if (record.seniority && !VALID_SENIORITY.includes(...))`
block only `console.warn`s; the field is stored unconditionally two lines later
(`seniority: record.seniority ? record.seniority.trim().toLowerCase() : null`), and the row is pushed into
`validatedRecords` regardless. Reproduced with a fixture row `{title: 'Backend Engineer', country:
'Netherlands', seniority: 'expert'}` (`'expert'` is not in `VALID_SENIORITY`) — the warning
`Row 1: Invalid seniority "expert" - ignoring` fires, and the value stored is still `"expert"`, not `null`. The
real `data/search-params.csv` (read-only, not modified) has no invalid seniority values today, so this defect is
currently latent, not actively firing.

**Downstream chain — confirmed, exactly as asserted.** Traced `seniority` from `csvParser.js` through to
`matchesProfile()`: only one consumer exists — `ensureProfilesFromSearchParams()` in
`src/agents/orchestrator.js:139-140`, which is auto-bootstrap code that runs **only when zero profiles exist yet
in the DB**. It picks `firstNonNullSeniority` per title-group and writes it straight into
`profile.seniority_level`. `matchesProfile()` (`jobFieldExtractor.js:279-299`) then does:
```
const seniorityRank = { intern:1, junior:2, mid:3, senior:4, lead:5, principal:6, staff:6 };
const profileRank = seniorityRank[profileSeniority] || 0;   // 'expert' -> 0
...
if (jobRank < profileRank - 1) return false;                 // jobRank < -1 is never true
```
Built a minimal repro (no DB, pure function calls): with `profile.seniority_level = 'senior'` (valid), a
`'Junior Backend Engineer'` job is correctly rejected (`matchesProfile` → `false`). With
`profile.seniority_level = 'expert'` (the invalid, un-rejected value), the identical junior job is **accepted**
(`matchesProfile` → `true`). This confirms the reviewer's specific claim: an unrecognised seniority value makes
`seniorityRank[...] || 0` produce `profileRank = 0`, and because `jobRank` is always `>= 1` once the
`'unspecified'` early-exit doesn't apply, `jobRank < profileRank - 1` (`jobRank < -1`) can never be true —
seniority filtering is silently disabled for that profile, letting every seniority level through.

**Severity note:** confirmed Medium is fair. The *csvParser-specific* trigger (silently storing an invalid
value it just warned about) only reaches production behavior through the one-time CSV-to-profile auto-bootstrap
in `ensureProfilesFromSearchParams()`, which only runs when the profiles table is empty — narrower than it
first looks. But the underlying `seniorityRank[...] || 0` design flaw in `matchesProfile()` is not CSV-specific:
checked `validateProfileInput` in `server.js:190-191` and it only enforces `typeof seniority_level === 'string'`
— it does not restrict to `VALID_SENIORITY`. So a profile edited directly through the `/api/profiles` UI with a
typo'd seniority also silently disables seniority filtering, via the exact same rank-defaults-to-0 mechanism,
independent of csvParser. The CSV bug is real and narrow as scoped; the rank-table fallback-to-0 issue it
exposes is broader and worth flagging as a related-but-distinct finding if this area gets revisited. Keeping
severity at **Medium** for the CSV claim as scoped by the brief.

---

## U5.4 — `isEngineeringRelevantTitle` rejects "Design System Engineer" (claimed Medium)

**Claim:** the regex at `jobFieldExtractor.js:351` — `/\bdesign(?:er)?\b(?!\s*engineer)/` — only tolerates
`design` when `engineer` immediately follows, so "Design System Engineer" and "UI Design Tools Engineer" are
classified non-engineering and rejected.

**Verify**, including the end-to-end claim that `matchesProfile` rejects
`"Design System Platform Engineer"` against a profile requiring `Platform Engineer`. Assess how likely such
titles are in this user's actual target market (backend/platform/AI roles in NL/IE/PT/ES) — that governs
severity.

### VERDICT: CONFIRMED, including the end-to-end claim — severity downgraded to Low for this user

Regex verified as described at `jobFieldExtractor.js:379`: `/\bdesign(?:er)?\b(?!\s*engineer)/`. The negative
lookahead only excludes the match when `"engineer"` comes *immediately* after `"design"` (optionally separated
by plain whitespace) — a single intervening word defeats it. Direct calls to `isEngineeringRelevantTitle()`:

| title | result |
|---|---|
| `"Design System Engineer"` | `false` (rejected) |
| `"UI Design Tools Engineer"` | `false` (rejected) |
| `"Design System Platform Engineer"` | `false` (rejected) |
| `"Senior Backend Engineer"` (control) | `true` (accepted) |
| `"Product Marketing Manager, Platform"` (control — genuinely non-eng) | `false` (correctly rejected) |

**End-to-end, exactly as the claim specified:** built a profile with `job_types: ["Platform Engineer"]` and ran
the real `matchesProfile()` against a job titled `"Design System Platform Engineer"` — result: `false`. The job
is rejected even though `classifyJobType` would have matched it against `"Platform Engineer"` on the word
`"Platform"` and `"Engineer"`; step 5 of `matchesProfile` (`isEngineeringRelevantTitle`) vetoes it after the
fact.

**Severity assessment for this user's actual target market:** the brief's own recent commits
(`dac243d` "add focused search profiles for Java Backend, Backend, Platform, AI/ML engineering roles in
NL/IE/PT/ES/Remote EU"; `2dc8715` bulk company import) and `bulk-add-companies.js` (read for U5.5, see below)
show the real company list: Booking.com, Adyen, ASML, ING, Stripe, HubSpot, Workday, Revolut, Glovo, Klarna,
etc. — fintech, logistics, infra and platform-tooling companies, not design-tool vendors. "Design System
Engineer" titles cluster at companies with dedicated design-systems/DX teams (Figma, Atlassian, large consumer
product orgs) and are uncommon at this company list's profile. Given the claimed defect requires a title that
(a) contains "design" as a whole word and (b) is not immediately followed by "engineer", genuine collisions with
this user's Backend/Platform/AI search profiles will be rare in practice — most true "Platform Engineer" or
"Backend Engineer" postings at these companies won't have "design" anywhere in the title. The regex flaw is
real and the fix is a one-line lookahead widening, but downgrading severity from the reviewers' claimed
**Medium** to **Low** given the low real-world collision rate for this specific user's search scope. Worth
revisiting if the user later adds design-tooling or dev-experience-platform companies to the target list.

---

## U5.5 — `bulk-add-companies.js` duplicates every company on a second run (claimed High)

**Claim:** its skip logic catches a `UNIQUE constraint` error that can never fire, because `companies` has no
UNIQUE column. Reported: two runs → 98 rows, every company doubled.

**Verify against a temp database only.** This relates to U3.2; cross-reference rather than re-deriving.

### VERDICT: CONFIRMED exactly as described — severity High

Checked `src/db/schema.js:25-35`: the `companies` table has no `UNIQUE` constraint or unique index on any
column (`name`, `country`, `career_url` are all plain `TEXT NOT NULL`; only `id` is a primary key). Checked
`addCompany()` in `src/db/queries.js:30-41`: a plain `INSERT INTO companies (...)` with no `ON CONFLICT`
clause. So the `catch (err) { if (err.message.includes('UNIQUE constraint')) ... }` skip branch in
`bulk-add-companies.js:109` is dead code — SQLite has no unique constraint to violate here, so that error can
never be thrown by this table.

**Verified against a temp DB** (`JOBS_DB_PATH` → temp file, never touching real `jobs.db`): called
`initializeDatabase()` then `addCompany('TestCo', 'Netherlands', 'https://testco.example/careers', ...)` twice
in a row, simulating two runs of `bulk-add-companies.js`. Actual result:
```
Run 1: added with id 1
Run 2: added with id 2   (no UNIQUE-constraint error thrown — nothing to catch)
Total rows named TestCo after 2 runs: 2
```
Both rows persist, fully independent, with the identical name/country/career_url. Scaled to the real 49-company
list in `bulk-add-companies.js`, a second run doubles every row exactly as reported (98 rows from 49 companies).
Confirmed, severity **High** as claimed — this is a straightforward re-run-safety bug on a script whose whole
purpose is idempotent bulk import.

---

## U5.6 — `validate-imports.js` and `full-validation.js` are stale, and one always exits 0 (claimed Medium)

**Claim:** both assert against `hashContent` (now `hashJob`), `extractJobType` (now `classifyJobType`) and
`src/agents/playwrightAgent.js` (now `webScrapingAgent.js`). `validate-imports.js` has no `process.exit(1)`
anywhere, so it exits 0 even with failures.

**Verify** by running both and checking exit codes. Then make a recommendation the reviewers did not: are these
scripts worth repairing at all, now that the repo has 157 real tests? Deletion may be the right answer. Argue it.

### VERDICT: CONFIRMED — both the staleness and the exit-code claim; severity Medium as claimed; recommend deletion, not repair

**Stale references confirmed by direct inspection + running the scripts** (`JOBS_DB_PATH` → temp file; neither
script writes to the DB, so this was low-risk even without it):

- `src/utils/hasher.js` now exports only `{ hashJob }` — `hashContent` does not exist (`hasher.js:20`).
  `validate-imports.js:9` and `full-validation.js:224-249` both destructure `{ hashContent, hashJob }` and call
  `hashContent(...)`.
- `src/utils/jobFieldExtractor.js` exports `classifyJobType`, not `extractJobType` (`jobFieldExtractor.js:100`,
  `416-427`). Both scripts call `extractJobType`.
- `src/agents/playwrightAgent.js` no longer exists; the file is `src/agents/webScrapingAgent.js`.
  `full-validation.js`'s `requiredFiles` list and its orchestrator-imports regex check both still reference the
  old path/name.

**Ran `node validate-imports.js` (actual output):**
```
Test 1: hasher module...
  ✓ hashJob works: 4fc1374cf97a4374...
  ✗ FAILED: hashContent is not a function
...
Test 5: jobFieldExtractor module...
  ✗ FAILED: extractJobType is not a function

All validation tests completed.
EXIT CODE: 0
```
Confirmed exactly as claimed: two tests fail, both print `✗ FAILED`, and the script still exits `0`. Grepped
the file — there is genuinely no `process.exit(1)` anywhere in it, only the implicit success exit.

**Ran `node full-validation.js` (actual output, abbreviated):**
```
✗ File exists: src/agents/playwrightAgent.js - Missing: src/agents/playwrightAgent.js
✗ orchestrator.js imports exist - Missing import matching: require.*playwrightAgent
✗ hasher.js exports hashJob and hashContent - hashContent not a function
✗ hasher.js hashContent works correctly - hashContent is not a function
✗ jobFieldExtractor.js exports all functions - Missing: extractJobType
✗ jobFieldExtractor.js extractJobType detection - extractJobType is not a function
✗ jobFieldExtractor.js matchesProfile works - Non-matching should not match
✗ playwrightAgent.js exports required functions - Cannot find module './src/agents/playwrightAgent'
Passed: 54 / Failed: 8
❌ VALIDATION FAILED
EXIT CODE: 1
```
Partial correction to the claim: `full-validation.js` does **not** have the "always exits 0" problem — it has
proper `results.failed.length > 0 → process.exit(1)` logic (`full-validation.js:647-654`) and correctly exits
`1`. The claim as written groups both scripts together on staleness (accurate for both) but only explicitly
attributes the exit-0 bug to `validate-imports.js` — re-reading the claim text confirms it already scopes the
exit-code bug to `validate-imports.js` specifically ("`validate-imports.js` has no `process.exit(1)`"), so no
correction is actually needed there; flagging this only so it's clear `full-validation.js`'s exit code was
independently verified rather than assumed. Bonus finding beyond what was asked: `full-validation.js`'s own
`matchesProfile` test (line 424-437) fails for an *unrelated* reason — it calls
`matchesProfile({jobType: ['Frontend']}, ['Backend', 'Fullstack'])` using the old two-array signature, but the
current `matchesProfile(jobFields, profile, searchParam, companyCountry)` expects `profile` to be an object with
a `.job_types` field, not a raw array. That test would fail even after fixing the `extractJobType` /
`playwrightAgent` renames — its assertions are stale against the current function signature, not just against
symbol names.

**Recommendation (not implemented): delete, don't repair.** Ran the real suite —
`node --test test/*.test.js` passes 201/201 (`test/relevance-scorer.test.js`, `test/hasher.test.js`,
`test/job-field-extractor.country.test.js`, `test/orchestrator.profiles.test.js`, etc. — the count is higher
than the brief's "157" figure, which is presumably stale itself, but the substance holds: there is a real,
current, comprehensive test suite). Everything `validate-imports.js` and `full-validation.js` check —
module exports existing, `hashJob` producing a 64-char hex string, `isWithinTimeWindow` behavior, `matchesProfile`
behavior — is covered more precisely by `test/*.test.js`, which uses `assert` semantics that actually fail the
process on a bad assertion, unlike `validate-imports.js`. Repairing these two scripts means fixing the same
three renames in two separate places, permanently, forever, in addition to the real test suite — pure
maintenance liability with negative marginal coverage. Worse, `validate-imports.js`'s silent-success-on-failure
behavior makes it actively dangerous if anyone wires it into CI or a pre-commit hook, since it launders real
failures into a `0` exit code. Delete both files; if `npm test` doesn't already run in CI, that's the actual
gap worth closing, not resurrecting these.

---

## Rules

- **Do not fix anything.** Do not edit any file outside this document.
- You MAY edit this document: correct claims, adjust severities, add evidence, mark items refuted.
- **No real LLM API calls.** Use a local stub on 127.0.0.1.
- Never open the real `jobs.db`; use `JOBS_DB_PATH` to a temp file. Do not modify `data/search-params.csv`.
- Scratch scripts under /tmp only.
