# Skill Index

Complete reference of all available skills for the Job Hunter project.

## Skill Organization

### Core Scraping Skills (6 files)

These skills document specific interaction patterns for web scraping tasks.

#### 1. Navigation Skill
**File**: `.opencode/skills/navigation.md`
**Purpose**: Handle page navigation, pagination, pagination, and dynamic loading
**Use when**: Site has multiple pages of jobs, infinite scroll, or "Load More" buttons
**Key techniques**:
- URL-based pagination (modify query params)
- Next/Previous button clicking
- Infinite scroll with scroll position tracking
- Detecting end of results

**Example task**:
```
Navigate to the careers page and extract jobs from all 5 pages.
Each page is accessible via URL query parameter: page=1, page=2, etc.
Stop when no new jobs are found.
```

#### 2. Extraction Skill
**File**: `.opencode/skills/extraction.md`
**Purpose**: Extract job data from HTML with validation and fallback selectors
**Use when**: Parsing job details (title, description, requirements, link)
**Key techniques**:
- Primary/fallback selector chains
- Text cleaning (whitespace, special chars)
- Date normalization (YYYY-MM-DD format)
- Data validation (required fields present)

**Example task**:
```
Extract job title, description, and requirements from each job card.
Title selector: h2.job-title (fallback: h3[data-qa="title"])
Description selector: div.description (fallback: largest text block)
Return empty if title is missing.
```

#### 3. Filtering Skill
**File**: `.opencode/skills/filtering.md`
**Purpose**: Interact with search filters, dropdowns, multi-select inputs
**Use when**: Site requires filter selection before viewing jobs
**Key techniques**:
- Dropdown interaction (click, select, confirm)
- Multi-select checkbox handling
- Date range filtering
- Search field entry and submission

**Example task**:
```
Filter jobs by country (Netherlands) and seniority (Junior).
1. Click country dropdown [data-qa="country-select"]
2. Select "Netherlands" from options
3. Click seniority filter
4. Check "Junior" checkbox
5. Click "Apply Filters" button
6. Wait for results to load
```

#### 4. Modals Skill
**File**: `.opencode/skills/modals.md`
**Purpose**: Handle popup dialogs, modals, and overlay interactions
**Use when**: Job details open in popup, forms appear in modals, overlays block content
**Key techniques**:
- Modal detection (check for overlay)
- Modal content scrolling (large job descriptions)
- Modal closure (X button, outside click, ESC key)
- Nested modal handling

**Example task**:
```
Click the job title to open detail modal.
Wait for modal to appear.
If description is cut off, scroll within the modal to see full text.
Extract all content.
Close modal by clicking X button.
```

#### 5. Evaluation Skill
**File**: `.opencode/skills/evaluation.md`
**Purpose**: Run JavaScript code on the page to inspect data, call APIs
**Use when**: Data not in HTML (client-side rendered), need to call page APIs, evaluate conditions
**Key techniques**:
- DOM element queries and property reading
- JavaScript evaluation (get hidden data, call exposed APIs)
- Network interception patterns
- Conditional evaluation (if X then Y)

**Example task**:
```
Execute JavaScript to extract job data from the React app state:
  window.__jobData = [...]
Get the array of jobs from window.__jobData.
Return as JSON array.
If no data found in window, try calling fetch() to /api/jobs endpoint.
```

#### 6. Resilience Skill
**File**: `.opencode/skills/resilience.md`
**Purpose**: Handle timeouts, rate limits, retries, session management
**Use when**: Site blocks repeated requests, requires cookie persistence, fails intermittently
**Key techniques**:
- Exponential backoff retry logic
- Rate limit detection (429 status)
- Cookie persistence across requests
- Request header customization (User-Agent, Referer)
- Session timeout handling

**Example task**:
```
If a request fails with 429 (rate limited):
  1. Wait 5 seconds
  2. Retry the request
  3. Max 3 retries total
If requesting a protected resource, use stored cookies from previous session.
Add custom User-Agent header to appear as real browser.
```

### MCP Integration Skills (1 file)

#### 7. Playwright MCP Skill
**File**: `.opencode/skills/playwright-mcp.md`
**Purpose**: Invoke Claude AI as autonomous scraper via Playwright MCP server
**Use when**: Complex scraping logic needed, want AI to handle edge cases, site requires reasoning
**Key techniques**:
- Structured task specification (with requirements, fallbacks)
- MCP tool invocation patterns
- Result parsing (extract JSON from Claude response)
- Error recovery and fallback chains

**Example task**:
```
Use MCP to scrape jobs from a complex JS-heavy site.
Provide Claude with:
  - URL to scrape
  - Required fields to extract
  - Selector suggestions
  - Pagination instructions
  - Error scenarios to handle
Claude will navigate, extract, and return JSON array of jobs.
```

---

## Skill Usage in Tasks

### Single Skill Task
When the job requires one technique:

```
SKILL: Extraction
TASK: Extract job data from cards already visible

Steps:
1. For each .job-card element
2. Extract title from h2.title
3. Extract description from div.description
4. Extract link from a[href]
Return array of {title, description, link}
```

### Multi-Skill Task
When the job requires combining multiple skills:

```
SKILLS: Navigation + Filtering + Extraction

Steps:
1. [Navigation] Go to page 1
2. [Filtering] Select country filter = "Netherlands"
3. [Extraction] Extract jobs from all visible cards
4. [Navigation] Go to page 2
5. [Extraction] Extract jobs from page 2
6. Repeat for all pages
```

### Complex Task with Resilience
When the job needs error handling:

```
SKILLS: Extraction + Resilience + Modals

Steps:
1. [Extraction] Extract job title and link
2. [Modals] Click link to open detail modal
3. [Extraction] Extract description/requirements from modal
4. [Modals] Close modal
5. [Resilience] If timeout, retry up to 3 times
6. [Resilience] If 429, wait 5s before retrying
```

### Autonomous Agent Task (MCP)
When you want Claude to handle the logic:

```
SKILL: Playwright MCP

Task specification sent to Claude:
- URL: https://example.com/careers
- Extract: title, description, requirements, link
- Pagination: Click "Load More" button, max 50 jobs
- Selectors: [hints for finding data]
- Fallback: If selector fails, try alternative
- Error scenarios: Return what's available if partial failure

Claude executes with Playwright tools and returns JSON array.
```

---

## Skill Selection Guide

**Question**: "How do I tell the agent to handle X?"

### "The site has multiple pages"
→ **Navigation skill** — pagination, next buttons, URL parameters

### "I need to extract job details"
→ **Extraction skill** — selectors, cleaning, validation

### "The site requires filter selection first"
→ **Filtering skill** — dropdowns, checkboxes, form submission

### "The job details open in a popup"
→ **Modals skill** — detect modal, scroll content, close modal

### "The data is rendered by JavaScript client-side"
→ **Evaluation skill** — run JS code, read window object, call APIs

### "The site blocks my requests / times out / needs retries"
→ **Resilience skill** — backoff, rate limits, cookies, session management

### "The site is complex and I want AI to figure it out"
→ **Playwright MCP skill** — let Claude handle navigation and extraction

### "I need to combine multiple techniques"
→ **Agent definition** (scraper.md) — orchestrate multiple skills together

---

## Skill File Structure

Each skill file contains:

```markdown
# Skill: [Name]

## Purpose
[Why this skill exists - 1-2 sentences]

## When to Use
- Scenario 1
- Scenario 2

## Selectors
[Common element selectors for this pattern]

## Techniques
[Code examples and explanations]

## Best Practices
- ✓ DO this
- ✗ DON'T do this

## Edge Cases
[Common failure modes and how to handle]

## Examples
[Real-world task examples]
```

---

## Agent Definitions

### Builder Agent
**File**: `.opencode/agents/builder.md`
**Purpose**: Develop and build Job Hunter modules
**Use for**: Code development, module creation, integration
**Tools**: File operations, code generation, testing
**Context**: Full project knowledge, resume architecture, MCP integration

**When to invoke**: `@builders` or when coding a new module

### Scraper Agent
**File**: `.opencode/agents/scraper.md`
**Purpose**: Autonomously scrape job sites using Playwright
**Use for**: Complex site scraping, edge case handling, multi-step navigation
**Tools**: Playwright (navigation, extraction, JavaScript evaluation)
**Temperature**: 0.3 (deterministic, precise)
**Context**: All 7 skills (navigation, extraction, filtering, modals, evaluation, resilience, MCP)

**When to invoke**: Via `invokeMCPScraperAgent()` in mcp-client.js

---

## Cross-Skill Workflows

### Scenario: LinkedIn-Style Careers Page

**Skills needed**: Navigation + Filtering + Modals + Extraction + Resilience

```
1. [Navigation] Access /jobs page
2. [Filtering] Apply filters: Country = NL, Experience = Junior
3. [Navigation] Handle pagination (infinite scroll)
4. [Extraction] Extract visible job cards
5. [Modals] Click each job to open detail modal
6. [Extraction] Extract full description from modal
7. [Modals] Close modal and continue
8. [Resilience] Retry if 429 rate limit hit
9. Repeat for all pages seen in pagination
```

### Scenario: Custom Homepage with API Backend

**Skills needed**: Evaluation + Extraction + Resilience

```
1. [Evaluation] Run JavaScript to access fetch() or XHR
2. [Evaluation] Call /api/jobs endpoint or read window data
3. [Extraction] Parse response JSON
4. [Extraction] Validate all required fields present
5. [Resilience] If request fails, retry with backoff
6. Return extracted jobs
```

### Scenario: JavaScript-Heavy React App

**Skills needed**: Playwright MCP (handles all internally)

```
1. Specify task to MCP scraper agent:
   - URL
   - Data requirements
   - Fallback strategies
2. Claude handles:
   - Navigation
   - Waiting for React to render
   - Evaluating JS for data
   - Retries and error handling
3. Returns final JSON array
```

---

## Environment Variables

Skills and agents use these env vars:

```bash
ANTHROPIC_API_KEY=sk-...        # Required for all AI operations
DEBUG=1                          # Enable verbose logging (optional)
SCRAPER_TIMEOUT=30000           # Max time per job in ms
SCRAPER_RETRIES=3               # Max retry attempts
SCRAPER_RATE_LIMIT=1000         # ms between requests
```

---

## Troubleshooting Skills

### Extraction not finding data?
1. Check selector in **Extraction** skill
2. Use browser DevTools to verify selector works
3. Consider **Evaluation** skill if data is JS-rendered
4. Try **Modals** skill if data is in popup

### Pagination not working?
1. Check **Navigation** skill for pagination pattern
2. Use **Evaluation** skill to debug page state
3. Add delays with **Resilience** skill
4. Use **Playwright MCP** skill to let Claude figure it out

### Getting blocked / 429 errors?
1. Apply **Resilience** skill: backoff, rate limits
2. Check **Filtering** skill: maybe need to filter first
3. Use **Evaluation** skill: call page's internal API instead of scraping HTML
4. Escalate to **Playwright MCP** skill: let Claude handle as real user

### Complex multi-step flow failing?
→ Use **Playwright MCP** skill to orchestrate with AI reasoning

---

## Quick Reference

| Skill | Purpose | Best For |
|-------|---------|----------|
| Navigation | Pagination, scrolling | Multi-page sites |
| Extraction | Get job data | All scrapers |
| Filtering | Form interaction | Filtered search |
| Modals | Popup handling | Detail views in modals |
| Evaluation | JS execution, APIs | Client-side rendering |
| Resilience | Errors, retries | Blocking, timeouts |
| Playwright MCP | Autonomous scraping | Complex sites, AI reasoning |

---

## Adding New Skills

To add a skill:

1. Create `.opencode/skills/[skill-name].md`
2. Follow structure in "Skill File Structure" section above
3. Add YAML frontmatter with:
   ```yaml
   ---
   name: skill-name
   description: One-line summary
   use_cases: [scenario1, scenario2]
   ---
   ```
4. Reference in `builder.md` advanced scraping section
5. Reference in `scraper.md` context section
6. Update this index file with new skill entry

---

## Skill Mastery Checklist

For agents to use skills effectively:

- ✓ Read skill file before attempting task
- ✓ Follow step-by-step examples
- ✓ Use recommended selectors and patterns
- ✓ Apply fallbacks when primary approach fails
- ✓ Handle errors per skill's error handling section
- ✓ Log progress and errors for debugging
- ✓ Validate extracted data matches requirements
- ✓ Use Playwright MCP skill for complex logic
