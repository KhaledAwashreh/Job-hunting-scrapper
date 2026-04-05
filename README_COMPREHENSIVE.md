## Quick Start

1. **Start the server**:
   ```bash
   npm start
   ```
   Server runs on `http://localhost:3000`

2. **Open dashboard**: Visit `http://localhost:3000` in your browser

3. **Add job sites**: Go to "Companies" tab, add career URLs

4. **Run scraper**: Click "Run Scraper Now" button in "Run Log" tab

5. **View results**: Positions appear in "Positions" tab with AI match scores

---

## System Overview

**Job Hunter** is an AI-powered job scraper that:
- Scrapes job openings from company career pages
- Deduplicates jobs across runs
- Scores jobs against your resume(s) using Claude AI
- Provides a dashboard for browsing and tracking

### Architecture

```
┌─────────────────────┐
│   Express Server    │  (localhost:3000)
│   + REST API        │
│   + Dashboard UI    │
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    │             │
┌───▼────┐   ┌───▼────┐
│  SQLite │   │ Resume │
│Database │   │ Cache  │
└────────┘    └────────┘
    │             │
    └──────┬──────┘
           │
    ┌──────▼──────────────┐
    │   Orchestrator      │  (Main loop)
    │   - Load params     │
    │   - Iterate sites   │
    │   - Score jobs      │
    └──────┬──────────────┘
           │
    ┌──────┴──────┬──────────┬────────────┐
    │             │          │            │
┌───▼───┐  ┌──────▼───┐ ┌──┴──┐ ┌──────┴──┐
│ API   │  │ MCP      │ │Play  │ │Scorer   │
│Agent  │  │Scraper   │ │wght  │ │(Claude) │
│       │  │(Claude)  │ │Fallb │ │         │
└───────┘  └──────────┘ └──────┘ └─────────┘
```

### Three-Tier Scraping

1. **API Scraper** — Fast, direct REST API calls (Greenhouse, Lever, Workday)
2. **MCP Scraper Agent** — Smart browser automation with Claude AI reasoning (complex sites)
3. **Playwright Fallback** — Direct Puppeteer/Playwright (simple sites)

All three run in sequence; first success returns results.

---

## Key Components

### 1. Database (`src/db/`)
- **schema.js**: SQLite schema (companies, positions, scrape_runs tables)
- **queries.js**: 20+ helper functions (insert, query, dedup)

### 2. Scrapers (`src/agents/`)
- **apiAgent.js**: REST API calls for major job boards
- **mcp-client.js**: Claude AI invocation for complex scraping (NEW)
- **playwrightAgent.js**: Browser automation with MCP fallback (ENHANCED)
- **orchestrator.js**: Main loop (iterate sites, score, store results)

### 3. Utilities (`src/utils/`)
- **hasher.js**: SHA-256 deduplication (title + desc + quals + date)
- **csvParser.js**: Parse `data/search-params.csv` (what to search for)
- **resumeParser.js**: Extract text from PDF/DOCX/TXT resumes at startup

### 4. Scoring (`src/scoring/`)
- **relevanceScorer.js**: Claude AI scores each job against resumes (0–100)

### 5. Server (`src/server.js`)
- Express HTTP server
- 8 REST API endpoints
- Static file serving (dashboard)

### 6. Dashboard (`public/dashboard.html`)
- **Tab 1**: Browse positions with scoring
- **Tab 2**: Manage company career URLs
- **Tab 3**: View scrape run history

---

## Configuration Files

### Agent Configuration (`.opencode/`)

**AGENTS.md**
- Build order (11 modules)
- Behavior rules (no confirmation, execute immediately)
- Code style guidelines

**agents/builder.md**
- Builder agent definition
- Module building instructions
- Resume architecture explanation

**agents/scraper.md** (NEW)
- Specialized scraper agent
- Playwright tools for autonomous job extraction
- Temperature 0.3 (precise, deterministic)

**skills/** (NEW - 7 files)
- navigation.md — Pagination, infinite scroll
- extraction.md — Data parsing and validation
- filtering.md — Form interactions, dropdown selection
- modals.md — Popup and modal handling
- evaluation.md — JavaScript execution on page
- resilience.md — Retries, rate limits, session management
- playwright-mcp.md — MCP integration techniques

**CONTEXT_ENGINEERING.md** (NEW)
- Code style conventions
- Prompt engineering best practices
- Logging standards

**SKILL_INDEX.md** (NEW)
- Reference guide to all skills
- When to use each skill
- Skill selection logic
- Troubleshooting guide

---

## Data Files

### `data/search-params.csv`
Defines what to search for:
```csv
title,keywords,country,seniority,remote
"Software Engineer","python javascript node",Netherlands,junior,yes
"Product Manager","product strategy",USA,mid,no
```

### `data/resumes/`
Drop resume files here (before starting server):
- `resume.pdf` — PDF resumes
- `resume.docx` — Word documents
- `resume.txt` — Plain text

**Note**: Resumes are parsed automatically at server startup. Add/remove files and restart server.

### `jobs.db`
SQLite database (auto-created). Contains:
- **companies**: career_url, country, platform, active status
- **positions**: job title, description, qualifications, link, match score, matched resume index
- **scrape_runs**: start/end times, counts, errors

---

## API Endpoints

All endpoints return JSON.

### GET `/`
Serves dashboard.html

### GET `/api/positions`
List all jobs found.
- Query params: `?country=NL&status=open`
- Fields: id, title, description, score, matched_resume, status, link

### PATCH `/api/positions/:id/status`
Update job status (saved, archived, rejected).
- Body: `{ status: "saved" }`

### GET `/api/companies`
List all company career URLs.
- Fields: id, name, country, career_url, platform, active

### POST `/api/companies`
Add new company.
- Body: `{ name: "TechCorp", country: "Netherlands", career_url: "...", platform: "custom" }`

### PATCH `/api/companies/:id`
Toggle company active/inactive.
- Body: `{ active: true }`

### GET `/api/runs`
Scrape run history.
- Fields: id, started_at, finished_at, companies_visited, positions_found, positions_new, errors

### POST `/api/scrape/run`
Trigger scraper (non-blocking).
- Response: `{ status: "Running", run_id: 123 }`

### GET `/api/scrape/status`
Check if scraper is running.
- Response: `{ running: true, current_run_id: 123 }` or `{ running: false }`

---

## How It Works

### Startup Flow
1. Server starts, reads `package.json` dependencies
2. `orchestrator.js` calls `parseResumes()` — scans `data/resumes/`, extracts text from PDF/DOCX/TXT
3. Resumes cached in memory (max 10k chars each)
4. Dashboard ready to use

### Scrape Flow (Manual trigger)
1. User clicks "Run Scraper Now" → POST `/api/scrape/run`
2. Orchestrator starts loop:
   - Load search parameters from CSV
   - Fetch active companies from DB
   - For each company:
     - Try API scraper (Greenhouse, Lever, Workday)
     - Fall back to MCP scraper agent if ANTHROPIC_API_KEY set
     - Fall back to direct Playwright
     - For each job found:
       - Hash job (dedup check)
       - Score against resumes via Claude
       - Insert into DB (or skip if duplicate)
3. Update run record with timing, counts
4. Scraper status returns to "idle"

### Scoring Flow
1. For each newly-scraped job:
2. Call Claude AI with job details + all resume texts
3. Claude returns score (0–100) and best-matching resume index
4. Store score + resume index in DB
5. Updated scores visible immediately in dashboard

### Dashboard Flow
1. User sees "Positions" tab with recent jobs
2. Color-coded match scores: green (70+), amber (40–69), red (<40)
3. Can filter by country or status (saved, archived)
4. Can click job link to open original posting
5. Can mark job as "saved", "archived", or "rejected" for tracking

---

## Advanced Features

### MCP Scraper Agent (NEW)
If `ANTHROPIC_API_KEY` is set in your environment:
1. Orchestrator passes company URL to `playwrightAgent.js`
2. `playwrightAgent.js` calls `invokeMCPScraperAgent()` from `mcp-client.js`
3. `mcp-client.js` sends structured task to Claude API
4. Claude uses Playwright tools to autonomously:
   - Navigate to URL
   - Handle pagination
   - Extract job data
   - Return JSON array
5. If successful, jobs added to DB
6. If MCP fails, falls back to direct Playwright

**Benefits**:
- Handle complex sites with AI reasoning
- Automatic retry logic
- Handles dynamic content better
- Perceives "end of results" intelligently

### Resume Scoring (Claude AI)
Every job is scored against all resumes:
1. Claude receives job details (title, description, qualifications)
2. Claude reviews all loaded resumes
3. Claude scores 0–100 (how well does this job match the best-resume person?)
4. Claude returns: score + which resume is best match
5. Stored in DB for filtering/tracking

**To get scores**:
- Set `ANTHROPIC_API_KEY=sk-...` in environment
- Server will call Claude API during scraping
- If API key not set, scores default to 0 (no error, just skipped)

### Dashboard Status Updates
While scraper runs:
1. "Run Log" tab shows green spinner + "Running..."
2. API endpoint `/api/scrape/status` returns `{ running: true }`
3. Every 3 seconds, dashboard polls for status
4. When scraper finishes, spinner stops, run record added
5. New jobs appear in "Positions" tab with fresh scores

---

## Environment Setup

### Required: Node.js
- Version 18+ recommended
- Check: `node --version`

### Optional: API Key (for MCP & Scoring)
```bash
# Add to .env or export before running
export ANTHROPIC_API_KEY=sk-...
npm start
```

### Optional: DEBUG Mode
```bash
export DEBUG=1
npm start
# Logs detailed Playwright, API, and MCP activity
```

---

## Common Tasks

### Add a new job site
1. Go to "Companies" tab
2. Fill in: Name, Country, Career URL
3. Select platform: "Greenhouse", "Lever", "Workday", or "custom"
4. Click "Add Company"
5. New company appears in list

### Run scraper manually
1. Go to "Run Log" tab
2. Click "Run Scraper Now"
3. Watch spinner indicate progress
4. When done, new run record appears with counts
5. Check "Positions" tab for new jobs

### View job match score details
1. Go to "Positions" tab
2. Scores shown as color-coded badges
3. Hover over score for percentage
4. Click job title/link to open original posting
5. Match score comes from Claude AI scoring

### Save interesting jobs
1. Find job in "Positions" tab
2. Change status from "open" to "saved"
3. Filter by "Status = saved" to see bookmarks
4. Status "archived" hides job from list
5. Status "rejected" marks it as not interested

### Check resume parsing
1. Put resume files in `data/resumes/`
   - `.pdf`, `.docx`, or `.txt`
2. Restart server
3. Server startup log shows "Parsed X resumes"
4. Check dashboard "Status" area (if available)

---

## Troubleshooting

### Scraper not finding jobs?
1. Check company Career URL is valid
2. Verify company "active" toggle is on
3. Check logs: `npm start` shows errors
4. Try manual scrape: "Run Scraper Now" button
5. If still failing, may need custom playwright agent setup

### Scores all zeros?
1. Scores are 0 if ANTHROPIC_API_KEY not set (not an error)
2. Set API key: `export ANTHROPIC_API_KEY=sk-...`
3. Restart server
4. Next scrape will calculate scores
5. Re-score old jobs by re-running scraper

### Can't find resume files?
1. Check files in `data/resumes/` exist
2. File extensions must be `.pdf`, `.docx`, or `.txt`
3. Filenames can be anything
4. Server logs "Parsed X resumes" on startup
5. Restart server after adding/removing resume files

### Server won't start?
1. Check Node.js: `node --version` (need 18+)
2. Check npm install: `npm install` (all dependencies)
3. Check Playwright: `npx playwright install chromium`
4. Check port 3000 is free: `lsof -i :3000` (macOS/Linux)

### MCP scraper failing?
1. Verify ANTHROPIC_API_KEY is set
2. Check API key is valid in Anthropic dashboard
3. Check internet connection
4. Logs show MCP attempt/results: `npm start` with debug enabled
5. Falls back to direct Playwright automatically

---

## Project Structure

```
d:\projects\Job hunting scrapper\
├── src/
│   ├── agents/
│   │   ├── apiAgent.js          # Greenhouse, Lever, Workday REST API
│   │   ├── mcp-client.js        # Claude MCP invocation (NEW)
│   │   ├── playwrightAgent.js   # Browser automation + MCP fallback
│   │   └── orchestrator.js      # Main loop
│   ├── scoring/
│   │   └── relevanceScorer.js   # Claude AI job scoring
│   ├── db/
│   │   ├── schema.js            # SQLite structure
│   │   └── queries.js           # 20+ helper functions
│   ├── utils/
│   │   ├── hasher.js           # SHA-256 deduplication
│   │   ├── csvParser.js        # Parse search params
│   │   └── resumeParser.js     # Extract resume text
│   └── server.js               # Express HTTP server
├── public/
│   └── dashboard.html          # 3-tab UI
├── data/
│   ├── resumes/               # Your resume files
│   └── search-params.csv      # Search configuration
├── .opencode/
│   ├── opencode.json          # Agent config
│   ├── agents/
│   │   ├── builder.md         # Builder agent definition
│   │   ├── scraper.md         # Scraper agent definition (NEW)
│   │   └── RESUME_ARCHITECTURE.md
│   ├── skills/               # Skill reference (NEW)
│   │   ├── navigation.md
│   │   ├── extraction.md
│   │   ├── filtering.md
│   │   ├── modals.md
│   │   ├── evaluation.md
│   │   ├── resilience.md
│   │   └── playwright-mcp.md
│   ├── CONTEXT_ENGINEERING.md  # Code conventions (NEW)
│   └── SKILL_INDEX.md          # Skill reference guide (NEW)
├── AGENTS.md                   # Build rules, module order
├── jobs.db                     # SQLite database (auto-created)
├── package.json               # Dependencies
└── README.md                  # This file
```

---

## Key Innovations

### 1. Three-Tier Fallback
```
Try API → Try MCP → Try Playwright
```
Each tier is independent but chains together.

### 2. Deduplication via Hash
Jobs hashed on (title + description + qualifications + date).
Duplicate jobs across runs are ignored automatically.

### 3. AI-Based Scoring
Every job scored 0–100 against your resumes using Claude AI.
Scores shown with color badges (green/amber/red).

### 4. Offline Resume Caching
Resumes parsed once at startup, cached in memory.
Scoring works without re-reading files.

### 5. MCP Scraper Agent (NEW)
Claude AI as autonomous scraper with Playwright tools.
Handles complex JavaScript-heavy sites intelligently.

### 6. Modular Skill System (NEW)
7 reusable skills documented in `.opencode/skills/`.
Agents use skills for consistent, reliable scraping.

---

## Next Steps

### To Start Using:
1. `npm install`
2. `npx playwright install chromium`
3. **Add resumes**: Copy `.pdf`, `.docx`, or `.txt` files to `data/resumes/`
4. **Add companies**: Use dashboard "Companies" tab
5. **Run scraper**: Click "Run Scraper Now" button
6. **Browse results**: "Positions" tab shows jobs with scores

### To Add MCP Scraper (AI-powered):
1. Get API key: https://console.anthropic.com/
2. `export ANTHROPIC_API_KEY=sk-...`
3. `npm start`
4. MCP will be tried first (with fallback to Playwright)

### To Extend:
- New scraping site? Add to `apiAgent.js` or use MCP agent
- New feature? Create module following structure + test script
- New skill? Add to `.opencode/skills/` with examples

---

## License & Credits

**Tech Stack**:
- Node.js / Express
- Playwright (browser automation)
- sql.js (SQLite in JS)
- @anthropic-ai/sdk (Claude AI)
- csv-parse, pdf-parse, mammoth (file parsing)

**Build System**: 11 modular components, each independently testable

**Agent System**: Builder (development) + Scraper (production)

**Skill System**: 7 documented techniques for reliable scraping

---

## Support

For issues:
1. Check logs: `npm start` (or set `DEBUG=1`)
2. Verify API key if using MCP: `echo $ANTHROPIC_API_KEY`
3. Check company URLs are valid
4. Verify resume files in `data/resumes/` are readable
5. Try restart: `Ctrl+C` and `npm start` again

For questions, refer to:
- `AGENTS.md` — Build rules and architecture
- `.opencode/skills/` — Technique documentation
- `.opencode/SKILL_INDEX.md` — Skill reference
- `.opencode/CONTEXT_ENGINEERING.md` — Code conventions
