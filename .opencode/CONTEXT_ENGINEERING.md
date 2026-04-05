# Code Style & Context Engineering Conventions

## Code Style

All code must follow these conventions:

### JavaScript/Node.js Style

```js
// ✓ GOOD
async function scrapeJobs(url) {
  try {
    const jobs = await extractJobs(url);
    return jobs.filter(j => j.title);
  } catch (error) {
    console.error('Scrape error:', error.message);
    throw error;
  }
}

// ✗ BAD
async function scrapeJobs(url){
  let jobs = await extractJobs(url)
  return jobs
}
```

### Standards

- **Indentation**: 2 spaces (no tabs)
- **Semicolons**: Required at end of statements
- **Quotes**: Single quotes `'` for strings (except JSON which requires double)
- **var/let/const**: Use `const` by default, `let` if reassignment needed, never `var`
- **Async/Await**: Always use async/await, never raw Promise chains
- **Error handling**: Always wrap async operations in try/catch
- **Comments**: Inline comments only for non-obvious logic (not for obvious code)
- **Naming**: camelCase for variables/functions, PascalCase for classes/constants
- **Line length**: Max 100 characters (wrap long lines)

### Function Structure

```js
async function complexTask(input, options = {}) {
  const { timeout = 5000, retries = 3 } = options;
  
  // Validate input
  if (!input) {
    throw new Error('Input required');
  }
  
  // Execute with error handling
  try {
    const result = await doWork(input);
    return result;
  } catch (error) {
    console.error(`Task failed: ${error.message}`);
    throw error; // Re-throw for caller to handle
  }
}
```

## Context Engineering Conventions

When providing context to agents (Claude, scraper agent, etc.), follow this pattern:

### Task Format

```
TASK: [One-line summary]

OBJECTIVE:
[What you want accomplished]

CONTEXT:
[Relevant background information]

REQUIREMENTS:
- [Specific requirement 1]
- [Specific requirement 2]
- [Specific requirement 3]

CONSTRAINTS:
- [What NOT to do]
- [Limits (max jobs, timeout, etc)]

EXPECTED OUTPUT:
[Format of result: JSON, array, etc]

FALLBACK:
[What to do if primary approach fails]
```

### Example: MCP Scraper Task

```
TASK: Extract jobs from TechCorp careers page

OBJECTIVE:
Navigate to https://techcorp.com/careers and extract all visible job postings

CONTEXT:
TechCorp is a tech company in Netherlands. Job site uses React/dynamic loading.

REQUIREMENTS:
- Extract title, description, qualifications, link for each job
- Limit to first 50 jobs
- Handle pagination with "Load More" button
- Format dates as YYYY-MM-DD

CONSTRAINTS:
- Don't click "Apply" buttons
- Don't simulate login
- Stop if blocking detected (403, 429)

EXPECTED OUTPUT:
JSON array: [{ title, description, qualifications, publishDate, link, country }]

FALLBACK:
If pagination fails, return jobs from current page only
```

### Selector Specification

When specifying HTML selectors in context:

```
SELECTORS:
- Job card: .job-card, [data-qa="job-listing"]
- Title: h2.job-title, [data-qa="job-title"], .title
- Description: div.description, section.job-details, [itemprop="description"]
- Link: a[href*="job"], [data-qa="job-link"], .job-link

FALLBACK PATTERN:
If primary selector not found, try alternatives in order
If still not found, use largest text block in element
```

### Error Scenarios

When specifying error handling in context:

```
ERROR SCENARIOS:
1. Page not found (404) → Return { error: "page not found" }
2. Access blocked (403) → Return { error: "access denied" }
3. Rate limited (429) → Retry after 5s delay, max 3 retries
4. CAPTCHA detected → Return { error: "captcha required" }
5. No jobs found → Return empty array (not an error)
6. Pagination broken → Return jobs from current page only
```

## Prompt Engineering for Agents

### Bad Agent Context
```
"Go scrape some jobs from this website"
```

### Good Agent Context
```
Navigate to https://example.com/careers
Extract all job listings from the page.
Wait for dynamic content to load.
For each job, extract:
  - title (h2 or [data-qa="title"])
  - description (largest text block)
  - requirements (element with "require" in heading)
  - link (href of job detail link)
  - publishDate (time element or metadata)
Return as JSON array with these fields.
Limit to 50 jobs max.
If pagination exists, go to next page and repeat.
```

### Agent Instruction Patterns

**For navigation tasks**:
```
1. Navigate to [URL]
2. Wait for [element/condition]
3. Look for [specific pattern]
4. If found, [action]
5. If not found, [fallback]
```

**For extraction tasks**:
```
Extract [fields] using these selectors:
- Primary: [selector1]
- Fallback: [selector2]
Return format: [JSON structure]
Validation: [validation rules]
```

**For interaction tasks**:
```
Click [selector/description]
Wait [time/for element]
Fill '[selector]' with '[value]'
Verify result by [checking for indicator]
```

## Document Conventions

### Skill File Metadata

Each skill file should have:
```markdown
# Skill: [Name]

## Purpose
[1-2 sentences on why this skill exists]

## When to Use
[Bullet list of scenarios]

## Techniques
[Code examples with explanations]

## Best Practices
[Checkmarks and guidelines]
```

### Agent File Metadata

Each agent should have YAML frontmatter:
```yaml
---
name: agent-name
description: One-line description
temperature: 0.3
tools: ["tool1", "tool2"]
---
```

## Logging Conventions

```js
// Info level
console.log(`✓ Success: extracted ${count} jobs`);
console.log(`[${new Date().toLocaleTimeString()}] Starting scrape...`);

// Warning level
console.warn(`⚠ No results found for query: ${query}`);
console.warn(`Selector not found: ${selector}, trying fallback`);

// Error level
console.error(`✗ Failed to scrape: ${error.message}`);
console.error(`Critical error: ${error.stack}`);

// Debug
if (process.env.DEBUG) {
  console.log(`[DEBUG] Response: ${JSON.stringify(response)}`);
}
```

## Testing Conventions

Test files follow pattern: `test-<module>.js`

```js
async function test() {
  try {
    console.log('Testing Module X...\n');
    
    // Arrange
    const input = { /* test data */ };
    
    // Act
    const result = await functionUnderTest(input);
    
    // Assert
    if (result.success) {
      console.log('✓ Test passed');
    } else {
      throw new Error('Expected success');
    }
    
    console.log('\n✅ PASS - Module X complete');
  } catch (error) {
    console.error('\n❌ FAIL -', error.message);
    process.exit(1);
  }
}

test();
```

## Commit Message Conventions

```
Module 5 complete: API agent with Greenhouse/Lever/Workday support

- Extract jobs from 3 major platforms via REST APIs
- Fallback to Playwright for custom sites
- Normalize output to standard job schema
- Add rate limiting and error handling
```

## File Organization Conventions

```
src/
├── agents/       # Autonomous scraping/orchestration
├── scoring/      # AI-based matching
├── db/           # Database operations
├── utils/        # Shared utilities
└── server.js     # Main Express app

.opencode/
├── agents/       # Agent definitions (e.g., scraper.md)
└── skills/       # Skill documentation for agents
```

## Configuration Conventions

```js
// Use objects for grouped settings
const config = {
  scraping: {
    maxJobs: 50,
    timeout: 15000,
    retries: 3,
  },
  api: {
    rateLimit: 1000, // ms between requests
    backoffMultiplier: 2,
  },
  scoring: {
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 8192,
  }
};

// Use `const` with defaults
const { maxJobs = 50, timeout = 15000 } = options;
```

## Documentation Conventions

Always include:
1. **Purpose** - Why this code/skill exists
2. **Usage** - How to use it
3. **Examples** - Code samples or task examples
4. **Best Practices** - Dos and don'ts
5. **Error Handling** - Common failure modes
