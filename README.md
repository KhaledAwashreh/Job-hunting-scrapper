# Job Hunter — AI-Powered Job Scraper

Scrapes engineering job openings from any company career page, scores them against your resume, and helps you track applications — all from a dashboard UI.

## Features

- **Multi-platform scraping** — Greenhouse API, Lever, Workable, RSS, JSON API, Firecrawl, Puppeteer
- **Profile-driven filtering** — Only stores roles matching your profiles (Java Backend, Backend, Platform, AI/ML Engineer)
- **Title-only classification** — Word-boundary matching rejects non-engineering roles even when descriptions mention technical keywords
- **AI scoring** — Scores jobs 0–100 against your resume(s) using Claude/Ollama/OpenAI (model-agnostic)
- **Resume tailoring** — Generates Harvard CV format resumes tailored to each position
- **Deduplication** — Hash-based job dedup across scrape runs
- **Dashboards** — 4-tab UI: Positions, Companies, Profiles, Run Log

## Quick Start

```bash
npm install
npm start
```

Open `http://localhost:3000`

## Setup

### 1. Configure API Keys

Create a `.env` file:

```env
# Required for AI scoring & resume tailoring
ANTHROPIC_API_KEY=your_api_key_here

# Required for web scraping fallback
FIRECRAWL_API_KEY=your_firecrawl_key_here

# Optional: OpenAI as alternative LLM
OPENAI_API_KEY=your_openai_key_here

# Optional: Ollama (local LLM)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=mistral

# Model selection per use case (default: anthropic)
SCORING_PROVIDER=anthropic
EXTRACTION_PROVIDER=anthropic
MCP_PROVIDER=anthropic
```

### 2. Add Resumes

Drop `.pdf`, `.docx`, or `.txt` files into `data/resumes/` and restart the server. Resumes are parsed automatically at startup.

### 3. Add Companies

Use the **Companies** tab to add career URLs. A bulk import script is also available to pre-populate with popular EU tech companies:

```bash
node bulk-add-companies.js
```

### 4. Configure Search Profiles

Edit `data/search-params.csv` to define what roles to look for:

```csv
title,keywords,country,seniority_level,job_type,remote
"Java Backend Engineer","java spring backend",NL,med,full-time,yes
"Backend Engineer","backend distributed systems",IE,sen,full-time,no
"Platform Engineer","platform infrastructure",NL,sen,full-time,yes
"AI/ML Engineer","machine learning ai",Remote EU,sen,full-time,yes
```

### 5. Run the Scraper

Click **"Run Scraper Now"** in the **Run Log** tab. The pipeline:

1. **API Scraper** — Greenhouse, Lever, Workable, RSS, JSON API (fast, <1s per company)
2. **Firecrawl Scrape** — Single-page extraction for known career page layouts
3. **Firecrawl Agent** — AI-powered structured extraction for complex pages
4. **Puppeteer** — Full browser automation as last resort

Only roles matching your profiles (title + engineering relevance) are stored.

## Dashboard Tabs

| Tab | Description |
|-----|-------------|
| **Positions** | Browse scored jobs. Filter by country, job type, seniority. Change status (new/applied/rejected/accepted). Tailor resume for any position. |
| **Companies** | Add/manage career URLs. Platform auto-detection. Toggle active/inactive. |
| **Profiles** | Create named profiles (e.g. "Java Backend", "Platform Engineer") with resume assignment, job types, seniority, work location preferences. |
| **Run Log** | View scrape history, start new runs, expand error details per company. |

## Actions Column

Each position row includes:
- **Change** — Update application status (new/applied/rejected/accepted)
- **Tailor Resume** — Generate a Harvard CV format resume tailored to that specific position (prompts for profile selection when multiple profiles exist)

## Resume Tailoring

Produces a Harvard CV format resume for any position:
- Reorders sections to put job-relevant experience first
- Highlights matching keywords and skills
- Preserves your exact wording (never hallucinates)
- Download as TXT, DOCX, or PDF
- Versioned per position+profile combination

**Requires** `ANTHROPIC_API_KEY` to be set.

## Supported Company Platforms

| Platform | Detection | Speed |
|----------|-----------|-------|
| **Greenhouse** | Board API (`boards-api.greenhouse.io`) | ~500ms |
| **Lever** | Lever API (`api.lever.co`) | ~500ms |
| **Workable** | Workable API | ~1s |
| **RSS/XML** | Career page RSS feeds | ~1s |
| **JSON API** | Direct career API endpoints | ~1s |
| **Firecrawl** | Scraping + AI extraction | ~5-15s |
| **Puppeteer** | Browser automation (last resort) | ~10-30s |

## Project Structure

```
.
├── src/
│   ├── agents/
│   │   ├── orchestrator.js        # Main scraping loop
│   │   ├── apiAgent.js            # Greenhouse, Lever, Workable, RSS, JSON API
│   │   ├── webScrapingAgent.js    # Firecrawl + Puppeteer fallback pipeline
│   │   └── mcp-client.js          # MCP scraper agent (requires ANTHROPIC_API_KEY)
│   ├── scoring/
│   │   └── relevanceScorer.js     # Resume-based job scoring (model-agnostic)
│   ├── db/
│   │   ├── schema.js              # SQLite schema (companies, positions, profiles, etc.)
│   │   └── queries.js             # Database CRUD helpers
│   ├── utils/
│   │   ├── llmFactory.js          # Unified LLM client (Anthropic/OpenAI/Ollama)
│   │   ├── languageDetector.js    # European + Arabic language detection
│   │   ├── jobFieldExtractor.js   # Profile-driven title classification + engineering filter
│   │   ├── csvParser.js           # search-params.csv parsing
│   │   ├── resumeParser.js        # PDF/DOCX/TXT resume extraction
│   │   ├── resumeTailor.js        # Harvard CV format resume generation
│   │   ├── hasher.js              # SHA-256 deduplication
│   │   └── logger.js              # Structured file + console logging
│   ├── config.js                  # Model configuration
│   └── server.js                  # Express server + all API routes
├── public/
│   ├── dashboard.html             # Main UI (4 tabs)
│   └── components/
│       ├── positions-tab.js       # Positions table with filtering + actions
│       └── profiles-tab.js        # Profile CRUD
├── data/
│   ├── resumes/                   # Resume files (PDF/DOCX/TXT)
│   └── search-params.csv          # Search profiles
├── bulk-add-companies.js          # 49 EU company import script
├── AGENTS.md                      # Build rules
├── package.json
└── jobs.db                        # SQLite (auto-created)
```

## Architecture

```
orchestrator.js
    ↓ Load search profiles from CSV
    ↓ Load active companies from DB
    ↓ For each company:
       ├─→ apiAgent.js          (Greenhouse/Lever/Workable/RSS/JSON)
       ├─→ webScrapingAgent.js  (Firecrawl → Puppeteer)
       └─→ For each job found:
            ├─→ jobFieldExtractor.js (title-only profile matching)
            ├─→ hasher.js            (dedup check)
            ├─→ relevanceScorer.js   (score against resumes)
            └─→ store in DB

dashboard.html → REST API → server.js → queries.js → jobs.db
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | For scoring/tailoring | Claude API key |
| `FIRECRAWL_API_KEY` | For Firecrawl scraping | Firecrawl API key |
| `OPENAI_API_KEY` | Optional | OpenAI alternative |
| `OLLAMA_BASE_URL` | Optional | Local Ollama endpoint |
| `OLLAMA_MODEL` | Optional | Ollama model name |
| `SCORING_PROVIDER` | Optional | `anthropic`, `openai`, or `ollama` |
| `EXTRACTION_PROVIDER` | Optional | Extraction LLM provider |
| `MCP_PROVIDER` | Optional | MCP agent LLM provider |
| `LOG_LEVEL` | Optional | `DEBUG`, `INFO`, `WARN`, `ERROR` |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/positions` | List positions (filterable) |
| PATCH | `/api/positions/:id/status` | Update position status |
| POST | `/api/positions/:id/tailor` | Generate tailored resume |
| GET | `/api/positions/:id/tailored-resumes` | List tailored versions |
| GET | `/api/companies` | List companies |
| POST | `/api/companies` | Add company |
| PATCH | `/api/companies/:id` | Update company |
| DELETE | `/api/companies/:id` | Remove company |
| GET | `/api/profiles` | List profiles |
| POST | `/api/profiles` | Create profile |
| PATCH | `/api/profiles/:id` | Update profile |
| DELETE | `/api/profiles/:id` | Delete profile |
| GET | `/api/runs` | Scrape run history |
| POST | `/api/scrape/run` | Trigger scraper |
| GET | `/api/scrape/status` | Check running status |
| GET | `/api/resumes` | List loaded resumes |
| POST | `/api/resumes/upload` | Upload resume file |
| DELETE | `/api/resumes/:id` | Delete resume |
| GET | `/api/tailored-resumes/:id/download` | Download tailored resume |

## Model-Agnostic Design

All LLM calls go through `src/utils/llmFactory.js`. Switch providers via env vars:

```env
SCORING_PROVIDER=anthropic   # Use Claude
SCORING_PROVIDER=openai      # Use GPT
SCORING_PROVIDER=ollama      # Use local model (free)
```

No code changes needed to switch providers.

## Testing

```bash
npm test        # unit tests — fast, no browser, no database
npm run test:e2e  # end-to-end — drives a real browser against a real server
```

**The E2E suite never touches your `jobs.db`.** Every run points `JOBS_DB_PATH` at a throwaway
file in a temp directory, seeds it with fixtures, and asserts that the real database was not
created or modified.

E2E needs a Chrome or Chromium binary. It uses the system `/usr/bin/google-chrome` if present.
(`npx playwright install chromium` fails on Ubuntu 26.04 — playwright 1.60 ships no build for it.)
If no browser is found the suite skips with a message rather than failing.

The UI has DOM-structure snapshots under `test/e2e/__snapshots__/`. After an intentional UI change:

```bash
UPDATE_SNAPSHOTS=1 npm run test:e2e
```

## License

MIT — built with Node.js, Express, sql.js, Playwright, Puppeteer, Firecrawl, @anthropic-ai/sdk.
