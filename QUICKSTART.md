# Job Hunter — AI-Powered Job Scraper

A Node.js application that scrapes company career pages, scores job positions against your resume using Claude AI, and serves a local dashboard for job management.

## Quick Start

### 1. Setup

```bash
cd job-hunter
npm install
npx playwright install chromium
```

### 2. Configure

Create a `.env` file with your Anthropic API key:
```
ANTHROPIC_API_KEY=sk-ant-...
```

Add your resumes to `data/resumes/`:
- PDF files (`.pdf`)
- Word documents (`.docx`)
- Text files (`.txt`)

### 3. Add Companies

Edit `data/search-params.csv` with job search parameters:
```csv
title,keywords,country,seniority,remote
Backend Engineer,"Node.js,TypeScript",Netherlands,Senior,yes
```

### 4. Start the Server

```bash
npm start
```

Server runs on **http://localhost:3000**

## Dashboard

### Tab 1: Positions
- View all scraped job positions
- Filter by country and status
- See AI-generated match scores (0–100)
  - 🟢 Green (70+): Strong match
  - 🟡 Amber (40–69): Moderate match
  - 🔴 Red (<40): Weak match
- Mark positions as applied/rejected/accepted

### Tab 2: Companies
- Add new company careers pages
- Select platform: Greenhouse, Lever, Workday, or Custom
- Toggle companies on/off for scraping

### Tab 3: Run Log
- View scrape run history with timing
- See counts: companies visited, positions found, new positions
- Expand rows to see error details

## How It Works

1. **Scrape** — API-first approach using Greenhouse/Lever/Workday endpoints, falls back to Playwright browser scraping
2. **Dedup** — SHA-256 hash of title + description + qualifications + publish date prevents duplicates
3. **Score** — Claude AI compares each position against all 3 resumes, returns 0–100 match score + best-matching resume
4. **Store** — Positions stored in SQLite with match scores and status tracking
5. **Display** — Live dashboard with sorting, filtering, and status updates

## API Endpoints

```
GET    /                           # Dashboard
GET    /api/positions              # List positions (supports ?country= &status=)
PATCH  /api/positions/:id/status   # Update position status
GET    /api/companies              # List all companies
POST   /api/companies              # Add company
PATCH  /api/companies/:id          # Toggle company active
GET    /api/runs                   # Scrape run history
POST   /api/scrape/run             # Trigger scraper (returns 202)
GET    /api/scrape/status          # Get current status
```

## Architecture

```
job-hunter/
├── src/
│   ├── agents/
│   │   ├── apiAgent.js            # API scraper (Greenhouse/Lever/Workday)
│   │   ├── playwrightAgent.js     # Browser scraper (fallback)
│   │   └── orchestrator.js        # Main scraping loop
│   ├── scoring/
│   │   └── relevanceScorer.js     # Claude AI scoring
│   ├── db/
│   │   ├── schema.js              # SQLite schema
│   │   └── queries.js             # Database helpers
│   ├── utils/
│   │   ├── hasher.js              # SHA-256 dedup
│   │   ├── csvParser.js           # Parse search params
│   │   └── resumeParser.js        # Parse PDF/DOCX/TXT
│   └── server.js                  # Express server
├── public/
│   └── dashboard.html             # Vanilla JS frontend
├── data/
│   ├── resumes/                   # Your resume files (drop here)
│   └── search-params.csv          # Job search filters
├── jobs.db                        # SQLite database (auto-created)
└── package.json
```

## Stack

- **Backend**: Express, Node.js
- **Database**: SQLite + sql.js
- **Scraping**: Playwright (Chromium) + Axios
- **AI**: Anthropic Claude API
- **Frontend**: Vanilla JavaScript (no framework)
- **Parsing**: pdf-parse, mammoth (PDF/DOCX), csv-parse

## Notes

- **Cost**: ~$0.002 per position scored (~$0.40/week at 200 positions)
- **Rate Limiting**: 1–2 second delays between companies to avoid blocking
- **Dedup**: Uses `INSERT OR IGNORE` — duplicates silently skipped
- **Resume Parsing**: Truncates to 10k chars per resume for API token limits
- **Playwright**: Runs headless Chromium; installs browser binaries automatically

## Environment Variables

```
ANTHROPIC_API_KEY    # Required for Claude scoring
PORT                 # Optional (default: 3000)
```

## License

Built for single-developer job hunting automation.

---

**Status**: ✅ All 10 modules complete and tested
