# Job Hunter — Agent Rules

## Project context
This is a Node.js job hunting scraper. Stack: Express, sql.js, 
@anthropic-ai/sdk, firecrawl-js, csv-parse, pdf-parse, mammoth. 
Single developer project.
Do not introduce additional frameworks or dependencies without being asked.

## Behavior rules
- Never ask for confirmation before writing or editing files
- Never ask for confirmation before running npm, npx, or node commands
- Never summarize what you are about to do — just do it
- Never show a plan and wait for approval — execute immediately
- If a step fails, fix it and continue without asking

## Build order — follow this exactly, one module at a time
1. package.json + npm install
2. src/db/schema.js + src/db/queries.js
3. src/utils/hasher.js + src/utils/languageDetector.js
4. src/utils/csvParser.js + src/utils/resumeParser.js
5. src/agents/apiAgent.js
6. src/utils/llmFactory.js + src/agents/mcp-client.js (MCP scraper agent integration)
7. src/scoring/relevanceScorer.js (model-agnostic)
8. src/agents/webScrapingAgent.js (Firecrawl + MCP, replaces playwrightAgent)
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
src/agents/webScrapingAgent.js (Firecrawl + MCP, model-agnostic)
src/scoring/relevanceScorer.js (uses llmFactory)
src/db/schema.js
src/db/queries.js
src/utils/llmFactory.js (model-agnostic LLM client factory)
src/utils/languageDetector.js (European + Arabic)
src/utils/hasher.js
src/utils/csvParser.js
src/utils/resumeParser.js
src/server.js
data/resumes/           (create empty dir — user drops files here)
data/search-params.csv  (create with 2 example rows)
public/dashboard.html
jobs.db                 (auto-created by schema.js, never commit this)

## Model-Agnostic Architecture
- All LLM calls go through `src/utils/llmFactory.js`
- Supports: Anthropic (Claude), OpenAI, Ollama (local)
- Configure via environment variables (SCORING_PROVIDER, etc.)
- No direct `require('@anthropic-ai/sdk')` in agent files
