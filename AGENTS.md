# Job Hunter — Agent Rules

## Project context
This is a Node.js job hunting scraper. Stack: Express, better-sqlite3, Playwright,
@anthropic-ai/sdk, csv-parse, pdf-parse, mammoth. Single developer project.
Do not introduce additional frameworks or dependencies without being asked.

## Behavior rules
- Never ask for confirmation before writing or editing files
- Never ask for confirmation before running npm, npx, or node commands
- Never summarize what you are about to do — just do it
- Never show a plan and wait for approval — execute immediately
- If a step fails, fix it and continue without asking

## Build order — follow this exactly, one module at a time
1. package.json + npm install + npx playwright install chromium
2. src/db/schema.js + src/db/queries.js
3. src/utils/hasher.js
4. src/utils/csvParser.js + src/utils/resumeParser.js
5. src/agents/apiAgent.js
6. src/agents/mcp-client.js (MCP scraper agent integration)
7. src/scoring/relevanceScorer.js
8. src/agents/playwrightAgent.js (now uses MCP when available)
9. src/agents/orchestrator.js
10. src/server.js + all API routes
11. public/dashboard.html (Tab 2 first, then Tab 1, then Tab 3)

## File writing rules
- Write complete files — never truncate with "rest of implementation here"
- Every function must be fully implemented, no stubs or TODOs
- Every file must be runnable as written

## After each module
- Write and run a test script named test-<module>.js
- Print clear PASS/FAIL output to console
- Fix any failure before moving to the next module
- Delete the test script after it passes

## Code style
- CommonJS (require/module.exports) — no ES modules
- Async/await — no raw promise chains
- 2-space indentation
- No TypeScript
- Inline comments only where the logic is non-obvious

## Project structure — do not deviate
src/agents/orchestrator.js
src/agents/apiAgent.js
src/agents/playwrightAgent.js
src/scoring/relevanceScorer.js
src/db/schema.js
src/db/queries.js
src/utils/hasher.js
src/utils/csvParser.js
src/utils/resumeParser.js
src/server.js
data/resumes/           (create empty dir — user drops files here)
data/search-params.csv  (create with 2 example rows)
public/dashboard.html
jobs.db                 (auto-created by schema.js, never commit this)
