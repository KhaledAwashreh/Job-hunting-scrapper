# U5 — Matching, scoring and maintenance scripts (UNCONFIRMED)

**Status:** reported by two reviewers, NOT independently verified
**Files:** `src/utils/csvParser.js`, `src/utils/jobFieldExtractor.js`, `src/scoring/relevanceScorer.js`,
`bulk-add-companies.js`, `validate-imports.js`, `full-validation.js`

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

---

## U5.2 — `matched_resume` is unvalidated (claimed Medium)

**Claim:** `relevanceScorer.js:188` does `parsed.matched_resume || null` with no type or range check, while
`score` on the line above is clamped and coerced. A string `"1"` or an out-of-range `99` passes straight through
into an INTEGER column and is later compared with strict equality at `server.js:488`.

**Verify** both cases via the stub.

---

## U5.3 — CSV validation logs "ignoring" but stores the value anyway (claimed Medium)

**Claim:** `csvParser.js:48-49` warns `Invalid seniority ... - ignoring`, but `:58` stores
`record.seniority.trim().toLowerCase()` unconditionally without checking `VALID_SENIORITY`, and the row counts
as valid.

**Verify.** Then trace the downstream effect the reviewer asserted: does an unrecognised seniority make
`seniorityRank` return 0 and silently disable seniority filtering for that profile? Confirm or refute that
specific chain.

**Do not modify `data/search-params.csv`.** Read it if useful; test with in-memory or temp fixtures.

---

## U5.4 — `isEngineeringRelevantTitle` rejects "Design System Engineer" (claimed Medium)

**Claim:** the regex at `jobFieldExtractor.js:351` — `/\bdesign(?:er)?\b(?!\s*engineer)/` — only tolerates
`design` when `engineer` immediately follows, so "Design System Engineer" and "UI Design Tools Engineer" are
classified non-engineering and rejected.

**Verify**, including the end-to-end claim that `matchesProfile` rejects
`"Design System Platform Engineer"` against a profile requiring `Platform Engineer`. Assess how likely such
titles are in this user's actual target market (backend/platform/AI roles in NL/IE/PT/ES) — that governs
severity.

---

## U5.5 — `bulk-add-companies.js` duplicates every company on a second run (claimed High)

**Claim:** its skip logic catches a `UNIQUE constraint` error that can never fire, because `companies` has no
UNIQUE column. Reported: two runs → 98 rows, every company doubled.

**Verify against a temp database only.** This relates to U3.2; cross-reference rather than re-deriving.

---

## U5.6 — `validate-imports.js` and `full-validation.js` are stale, and one always exits 0 (claimed Medium)

**Claim:** both assert against `hashContent` (now `hashJob`), `extractJobType` (now `classifyJobType`) and
`src/agents/playwrightAgent.js` (now `webScrapingAgent.js`). `validate-imports.js` has no `process.exit(1)`
anywhere, so it exits 0 even with failures.

**Verify** by running both and checking exit codes. Then make a recommendation the reviewers did not: are these
scripts worth repairing at all, now that the repo has 157 real tests? Deletion may be the right answer. Argue it.

---

## Rules

- **Do not fix anything.** Do not edit any file outside this document.
- You MAY edit this document: correct claims, adjust severities, add evidence, mark items refuted.
- **No real LLM API calls.** Use a local stub on 127.0.0.1.
- Never open the real `jobs.db`; use `JOBS_DB_PATH` to a temp file. Do not modify `data/search-params.csv`.
- Scratch scripts under /tmp only.
