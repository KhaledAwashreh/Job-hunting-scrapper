# Intelligent Semantic Extraction & Navigation Skill

## Overview
This skill governs how career pages are intelligently navigated and parsed using Claude/Ollama instead of brittle CSS selectors. The system:
1. **Navigates** pages intelligently (fills search forms, applies filters, paginate results)
2. **Extracts** job listings semantically (understands content regardless of HTML structure)
3. **Respects** real-world constraints (rate limits, dynamic loading, human-like delays)

## Architecture (Agentic Pipeline)
```
orchestrator.runScraper() [PROGRAMMATIC]
  ↓
scrapeBrowser(careerUrl, company) [PROGRAMMATIC ENTRY]
  ↓
playwrightAgent.js [ORCHESTRATES AGENTS]
  ├─→ formNavigator.intelligentlyFillForms() [SUB-AGENT: Fill filters/search]
  ├─→ Extract current page with semantic-extractor [SUB-AGENT: Parse]
  ├─→ formNavigator.navigateToNextPage() [SUB-AGENT: Pagination]
  └─→ Repeat until all pages scraped [LOOP]
  ↓
Return consolidated jobs array
```

### Sub-Agents
- **semantic-extractor.js** → Reads HTML semantically with Claude/Ollama
- **form-navigator.js** → Intelligently fills forms, clicks buttons, navigates pages
- **playwrightAgent.js** → Coordinates both sub-agents + browser lifecycle

## Extraction Strategy

### Phase 1: Page Loading (Playwright)
- Load URL with Playwright headless browser
- Wait for dynamic content to render (networkidle)
- Get full HTML + page metadata

### Phase 2: Intelligent Parsing (Claude/Ollama)
- Send HTML chunk to LLM with extraction prompt
- LLM identifies: job listings container, job entries, fields
- LLM extracts: title, description, location, requirements, salary (if visible)
- Returns structured JSON array

### Prompt Structure
```
You are a job listing analyzer. Given the HTML of a careers page:

1. Identify all job listings on this page
2. For each job, extract:
   - job_title (string)
   - job_description (string, first 500 chars)
   - location (string)
   - job_type (if visible: Full-time, Part-time, Contract, Intern)
   - salary (if visible, string like "$80k-100k")
   - link (full URL to job posting page, if available)

3. Return ONLY valid JSON array, no markdown code blocks:
[
  {
    "job_title": "...",
    "job_description": "...",
    "location": "...",
    "job_type": null,
    "salary": null,
    "link": "..."
  }
]

If no jobs found, return: []
```

## Validation

Each extraction result is validated:
- ✓ Required fields present (title, description)
- ✓ No JSON parse errors
- ✓ URL is absolute (not relative)
- ✗ Skip entries with missing title or description
- ✗ Reject strings that look like "Failed to extract" or error messages

## Fallback Strategy

1. **Try MCP Client First** (if ANTHROPIC_API_KEY set)
   - Uses Claude with full reasoning
   - Slowest but most accurate

2. **Try Local LLM** (if OLLAMA_API_KEY set)
   - Uses Ollama devstral or similar
   - Medium speed, good accuracy

3. **Return Empty Array**
   - If LLM extraction fails, return `[]`
   - Orchestrator will try next company in queue

## Error Handling

- **Parse Errors**: Log and return `[]`
- **Timeout**: Playwright timeout = 15s per page, LLM timeout = 30s per extraction
- **Rate Limiting**: Respect per-company rate limits (add delays between requests)
- **Invalid JSON**: Validate LLM output, reject garbage responses

## Performance Notes

- **Batch extraction NOT recommended** — Send one page at a time
- **HTML chunking** — If page > 100KB, extract visible text first
- **Caching** — MCP client handles caching, playwright doesn't
- **Headless browser** — Always headless (no GUI overhead)

## Testing

Test extraction against:
1. Greenhouse jobs page (structured)
2. Lever jobs page (semi-structured)
3. Custom HTML careers pages (unstructured)
4. Single-page app (React/Vue with dynamic loading)

Expected: All extract similarly accurate results despite different HTML.

---

## Intelligent Navigation Strategy (Form-Filler Agent)

### Phase 1: Page Analysis & Form Detection
**Code side (form-navigator.js):**
1. Load page with Playwright
2. Scan for form elements: `<input>`, `<select>`, `<textarea>`, `<button>`
3. For each field, extract: label, name, type, placeholder, options (for selects)
4. Send form structure to Claude

**Claude/Ollama responsibility:**
- Analyze form fields semantically
- Identify: location field, job type field, experience level field, search button
- Match fields against profile criteria (profile.job_types, company.country)
- Generate fill strategy: which fields to fill, what values to use

### Phase 2: Intelligent Form Filling
**Code side (form-navigator.js):**
```javascript
// Example interaction pattern
await fill(page, locationFieldSelector, profile.country); // e.g., "Netherlands"
await fill(page, jobTypeFieldSelector, profile.job_types[0]); // e.g., "Backend"
await fill(page, experienceFieldSelector, "5+");
await click(page, submitButtonSelector);
await waitForNavigation(page);
await waitForJobListings(page); // Wait for dynamic content
```

**Real-world delays (critical for success):**
- After filling input: 500ms wait (let UI update)
- After clicking submit: 2-5s wait (network + rendering)
- Between page interactions: 1-2s wait (respect server resources)
- Between companies: 5-10s wait (rate limiting)

### Phase 3: Pagination Logic
**Code side (form-navigator.js):**
1. After extraction, detect pagination: "Next" button, page numbers, load-more
2. Check if more jobs available
3. Click next/pagination control
4. Wait for new content to load
5. Return to extraction phase

**Indicators of "more jobs available":**
- "Next" or ">" button is enabled
- Page number less than total pages shown
- "Load more" button present
- Infinite scroll detected (page height changes)

### Waits & Delays (in form-navigator.js)

```javascript
const INTERACTION_DELAYS = {
  AFTER_INPUT_FILL: 500,        // User types, UI debounces
  AFTER_CLICK: 2000,             // Network latency + rendering
  BETWEEN_INTERACTIONS: 1000,    // Be respectful to server
  BETWEEN_COMPANIES: 5000,       // Don't hammering one domain
  PAGE_LOAD: 5000,               // Wait for dynamic content
};

// Intelligent waits
await waitForSelector(page, '.jobs-container', { timeout: 10000 });
await waitForNavigation(page, { waitUntil: 'networkidle' });
await waitForFunction(page, () => 
  document.querySelectorAll('.job-item').length > 0
);
```

### Error Recovery in Navigation
- **Field not found**: Log and skip (might not match profile criteria)
- **Click fails**: Retry with visibility check first
- **Form submission fails**: Check for error messages, skip this page
- **Pagination fails**: Mark as last page, return results
- **Network timeout**: Retry once with longer timeout

### Example Full Flow

```javascript
// User calls (PROGRAMMATIC):
const jobs = await scrapeBrowser('https://company.com/careers', userProfile);

// Internal flow (AGENTIC):
1. Load page → https://company.com/careers
2. Detect filters: [jobLocationSelect, jobTypeSelect, senioritySelect, searchButton]
3. Claude analyzes: "jobLocationSelect matches country, jobTypeSelect matches job types"
4. Fill jobLocationSelect = "Netherlands" → wait 500ms
5. Fill jobTypeSelect = "Backend" → wait 500ms
6. Click searchButton → wait 3000ms for results
7. Extract jobs from rendered page (semantic-extractor)
8. Check pagination: "Next page available"
9. Click "Next" → wait 2000ms
10. Extract next page
11. No more pagination → Return all jobs
```

### When to Use LLM for Navigation
- **Complex forms with ambiguous labels** → Use Claude to understand semantics
- **Dynamic form changes** → Detect new fields mid-interaction
- **Non-standard pagination** → Understand custom pagination UI

### When to Use Code with Selectors
- **Straightforward interactions** → Input text, click button, wait
- **Simple pagination** → Next/Previous buttons
- **Known platform patterns** → Greenhouse, Lever have predictable layouts (create reusable patterns)
