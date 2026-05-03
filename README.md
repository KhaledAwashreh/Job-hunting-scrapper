# Job Hunter - AI-Powered Job Scraper

AI-powered job scraper with a dashboard UI. Add career sites, upload your resume, and discover matching jobs with AI scoring.

## Features

- **Multi-country support**: Ireland, Netherlands, Spain, Germany, France, UK, Austria, Switzerland, Belgium, Sweden, and more
- **Site repository**: Expandable JSON config with country-specific career sites
- **Major job boards**: LinkedIn, Indeed, Glassdoor + regional sites (IrishJobs.ie, StepStone, InfoJobs, etc.)
- **AI matching**: Uses Claude/Ollama/OpenAI to rank jobs against your resume (model-agnostic)
- **Easy to extend**: Add new sites via dashboard or `job_sites.json`
- **Intelligent scraping**: Firecrawl API with MCP agent fallback for complex sites
- **Multi-language support**: European languages + Arabic with automatic translation to English
- **Smart deduplication**: Hash-based job deduplication with company_id and link

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure API Keys

Create a `.env` file in the project root:

```
# Required for AI scoring (Claude)
ANTHROPIC_API_KEY=your_api_key_here

# Optional: Firecrawl API (replaces Playwright for smarter scraping)
FIRECRAWL_API_KEY=your_firecrawl_key_here

# Optional: OpenAI (alternative to Claude)
OPENAI_API_KEY=your_openai_key_here

# Optional: Ollama (local LLM, free)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=mistral

# Optional: Model selection per use case
SCORING_PROVIDER=anthropic
EXTRACTION_PROVIDER=anthropic
MCP_PROVIDER=anthropic
```

Get your API keys from:
- Claude: [console.anthropic.com](https://console.anthropic.com/)
- Firecrawl: [firecrawl.dev](https://firecrawl.dev/)
- OpenAI: [platform.openai.com](https://platform.openai.com/)

### 3. Start the server

```bash
npm start
```

Dashboard opens at `http://localhost:3000`

## Usage

### 1. Upload Your Resume

Drag and drop your resume (PDF, DOCX, or TXT) into `data/resumes/`. The system automatically extracts your skills and experience on startup. Supports multiple resumes with AI-powered matching.

### 2. Add Career Sites

Go to the **"Companies"** tab and add job board URLs:
- LinkedIn Jobs
- Indeed
- Glassdoor
- Regional sites (IrishJobs.ie, StepStone, etc.)

Or add your own custom career pages.

### 3. Run Scraper

Click **"Run Scraper Now"** button in the **"Run Log"** tab. The system will:
1. Scrape jobs from all active sites using Firecrawl API (or MCP agent for complex sites)
2. Extract job details (title, description, requirements, location)
3. Detect language (European/Arabic) and translate to English if needed
4. Score each job against your resume using configured LLM (Claude/Ollama/OpenAI)
5. Deduplicate jobs across scrape runs

### 4. Browse Results

Go to **"Positions"** tab to see:
- AI match score (0-100, color-coded)
- Job title, company, location
- Direct links to job postings
- Filter by country or status (saved, archived, rejected)

### Progress Tracking

The **"Run Log"** tab shows historical scrape runs with:
- Start/end times
- Companies visited
- New jobs found
- Any errors encountered

## Dashboard Features

| Feature | Description |
|---------|-------------|
| **Positions Tab** | Browse all scraped jobs with AI scores, filter by country/status |
| **Companies Tab** | Add/remove job boards, toggle sites on/off |
| **Run Log Tab** | View scrape history, start new scrapes, expand error details |
| **Profiles Tab** | Manage multiple resumes, match different profiles to jobs |
| **Status Indicator** | Real-time scraper status with job counts |
| **Match Scoring** | AI-powered job matching (0-100 scale) using configurable LLM |
| **Deduplication** | Automatic duplicate job detection across runs |
| **Language Detection** | Auto-detect European/Arabic languages, translate to English |

## Supported Job Sites

### Major Job Boards
- LinkedIn Jobs
- Indeed
- Glassdoor

### By Country

| Country | Sites |
|---------|-------|
| **Ireland** | IrishJobs.ie, Jobs.ie |
| **Netherlands** | ICTJob |
| **Spain** | InfoJobs |
| **Germany** | StepStone, XING |
| **France** | APEC |
| **UK** | CW Jobs, Reed |
| **Austria** | Karriere.at |
| **Switzerland** | jobs.ch |

Add any career URL via the dashboard **Companies** tab.

## Project Structure

```
.
├── src/
│   ├── agents/
│   │   ├── orchestrator.js       # Main scraping loop
│   │   ├── apiAgent.js          # REST API scraper (Greenhouse, Lever, Workday)
│   │   ├── webScrapingAgent.js  # Firecrawl API + MCP agent fallback
│   │   ├── mcp-client.js        # MCP agent for complex sites
│   │   ├── semantic-extractor.js # AI-powered extraction (model-agnostic)
│   │   └── form-navigator.js     # Form handling (model-agnostic)
│   ├── scoring/
│   │   └── relevanceScorer.js  # LLM job matching (model-agnostic)
│   ├── db/
│   │   ├── schema.js           # SQLite structure (sql.js)
│   │   └── queries.js          # Database helpers
│   ├── utils/
│   │   ├── llmFactory.js       # Model-agnostic LLM client factory
│   │   ├── languageDetector.js  # European/Arabic language detection
│   │   ├── csvParser.js        # Search parameters
│   │   ├── resumeParser.js     # Resume text extraction (with caching)
│   │   ├── hasher.js           # Job deduplication (company_id + link)
│   │   ├── jobFieldExtractor.js # Job field parsing
│   │   ├── extractionPrompts.js # LLM prompts
│   │   ├── timeWindow.js       # Time filtering
│   │   └── typeHelpers.js      # Type utilities
│   ├── config.js               # Model configuration
│   └── server.js              # Express HTTP server
├── public/
│   ├── dashboard.html           # Web UI (3 tabs)
│   └── components/            # UI components
├── data/
│   ├── resumes/               # Resume files (PDF/DOCX/TXT)
│   └── search-params.csv      # Search configuration
├── job_sites.json             # Career site repository
├── package.json               # Node.js dependencies
└── jobs.db                    # SQLite database (auto-created)
```

## Environment Variables

```bash
# LLM Configuration (model-agnostic)
ANTHROPIC_API_KEY=your_api_key_here   # Required for Claude scoring
OPENAI_API_KEY=your_key_here        # Optional: OpenAI as alternative
OLLAMA_BASE_URL=http://localhost:11434/v1  # Optional: Local Ollama
OLLAMA_MODEL=mistral                  # Default Ollama model

# Model selection per use case (optional)
SCORING_PROVIDER=anthropic            # LLM for resume matching
EXTRACTION_PROVIDER=anthropic        # LLM for job extraction
MCP_PROVIDER=anthropic                # LLM for MCP agent

# Firecrawl API (replaces Playwright)
FIRECRAWL_API_KEY=your_key_here    # Smarter scraping with AI

# Optional: Custom model overrides
CLAUDE_MODEL=claude-3-5-sonnet-20241022
CLAUDE_MODEL_FAST=claude-3-haiku-20250305
```

## Architecture

```
orchestrator.js
    ↓ detectLanguage() → translateToEnglish()
    ↓
webScrapingAgent.js
    ├─→ Strategy 1: MCP Agent (Claude + Playwright tools)
    └─→ Strategy 2: Firecrawl API (JSON extraction, multi-page)

relevanceScorer.js
    ↓ (receives English text + resumes)
    ↓ LLM Factory (Claude/Ollama/OpenAI)
    ↓
    Score returned (0-100)
```

## Model-Agnostic Design

The system uses a unified `llmFactory.js` that supports:
- **Anthropic (Claude)** - Cloud-based, high quality
- **OpenAI (GPT)** - Alternative cloud provider
- **Ollama** - Local, free, privacy-focused

Switch between providers using environment variables - no code changes needed!
