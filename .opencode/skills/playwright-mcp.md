# Skill: Playwright MCP Integration

## Purpose
Use the Playwright Model Context Protocol (MCP) server to delegate complex browser scraping tasks to an AI agent with full Playwright access.

## When to Use
- Complex multi-step scraping scenarios
- Sites that require human-like interaction (search, filter, pagination)
- Extracting from dynamic JavaScript-rendered content
- When you need AI reasoning to navigate site structure
- Handling edge cases and site-specific quirks
- Sites with unusual layouts or navigation patterns

## MCP Architecture

The Playwright MCP server exposes Playwright capabilities as tools that an agent can use:

```
Your Code
   ↓
Invoke MCP Scraper Agent
   ↓
Agent receives task: "Scrape jobs matching criteria X from URL"
   ↓
Agent uses Playwright MCP tools:
   - navigate(url)
   - waitForSelector(selector)
   - click(selector)
   - fill(selector, text)
   - extract(selector)
   - evaluate(code)
   - etc.
   ↓
Agent performs task autonomously
   ↓
Returns: { jobs: [...], errors: [...] }
```

## MCP Tool Reference

The Playwright MCP server provides these core tools:

### Navigation
```
navigate(url, options)
  - Opens URL in browser
  - Options: { waitUntil, timeout }
  - Returns: { status, url }

goBack()
  - Goes back in browser history
  - Returns: { success }

reload()
  - Reloads current page
```

### Interaction
```
click(selector)
  - Clicks element matching selector
  - Returns: { success, error }

fill(selector, text)
  - Fills input field with text
  - Returns: { success }

press(key)
  - Presses keyboard key (Enter, Escape, etc)
  - Returns: { success }

type(text)
  - Types text character by character
  - Returns: { success }

hover(selector)
  - Hovers over element
  - Returns: { success }
```

### Waiting & Inspection
```
waitForSelector(selector, options)
  - Waits for element to appear
  - Options: { timeout }
  - Returns: { found }

waitForNavigation(options)
  - Waits for page navigation
  - Options: { timeout }
  - Returns: { success }

isVisible(selector)
  - Checks if element is visible
  - Returns: { visible }

getAttribute(selector, name)
  - Gets element attribute
  - Returns: { value }

getElementText(selector)
  - Gets element text content
  - Returns: { text }
```

### Extraction
```
extract(selector)
  - Extracts all matching elements
  - Returns: { elements: [...] }

evaluate(code)
  - Runs JavaScript in page context
  - Returns: { result }

getPageTitle()
  - Gets page title
  - Returns: { title }

getPageUrl()
  - Gets current URL
  - Returns: { url }

getPageContent(selector)
  - Gets HTML content of selector
  - Returns: { content }
```

## Invoke MCP Scraper Agent

### Simple Invocation Pattern

```js
const { invokeMCPAgent } = require('./mcp-client');

async function scrapeWithMCP(url, criteria) {
  const task = `
    Navigate to ${url}
    Search for jobs matching: ${JSON.stringify(criteria)}
    Extract all job titles, descriptions, and links
    Return as JSON array
  `;
  
  const result = await invokeMCPAgent('scraper', task, {
    tools: ['playwright'],
    timeout: 60000
  });
  
  return result;
}
```

### Advanced: Multi-Step Scraping Task

```js
async function scrapeSiteWithFilters(url, filters) {
  const task = `
    1. Navigate to ${url}
    2. Apply filters:
       - Country: ${filters.country}
       - Seniority: ${filters.seniority}
       - Keywords: ${filters.keywords.join(', ')}
    3. Wait for results to load
    4. Extract all job cards from current page
    5. Click "Load More" or go to next page if available
    6. Extract jobs from next page too
    7. Return all jobs as JSON array with: title, company, location, link, salary
  `;
  
  const result = await invokeMCPAgent('scraper', task, {
    tools: ['playwright'],
    model: 'claude-3-5-sonnet-20241022',
    timeout: 120000
  });
  
  return result.jobs || [];
}
```

## Integration in Orchestrator

```js
// In src/agents/orchestrator.js

const { invokeMCPAgent } = require('./mcp-client');

async function scrapeWithMCPFallback(company, resumes) {
  const apiJobs = await scrapeByPlatform(company);
  
  if (apiJobs && apiJobs.length > 0) {
    console.log(`✓ API scraper found ${apiJobs.length} jobs`);
    return apiJobs;
  }
  
  // Fall back to MCP Playwright agent
  console.log(`Invoking MCP Playwright agent for ${company.name}...`);
  
  try {
    const mcpJobs = await invokeMCPAgent('scraper', 
      `Navigate to ${company.career_url} and extract all visible job postings. 
       Return jobs as JSON array with fields: title, description, qualifications, 
       publishDate, link, country`
    );
    
    if (mcpJobs && Array.isArray(mcpJobs)) {
      console.log(`✓ MCP agent found ${mcpJobs.length} jobs`);
      return mcpJobs;
    }
  } catch (error) {
    console.warn(`MCP agent failed: ${error.message}`);
  }
  
  return null;
}
```

## MCP Client Implementation

```js
// src/agents/mcp-client.js

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function invokeMCPAgent(agentType, task, options = {}) {
  const {
    tools = ['playwright'],
    timeout = 60000,
    model = 'claude-3-5-sonnet-20241022'
  } = options;
  
  try {
    const message = await client.messages.create({
      model,
      max_tokens: 4096,
      tools: tools.map(tool => ({
        type: 'playwright',
        name: tool,
        description: 'Playwright browser automation tool'
      })),
      messages: [
        {
          role: 'user',
          content: task
        }
      ]
    });
    
    // Process tool calls if any
    let response = message;
    while (response.stop_reason === 'tool_use') {
      // Handle tool execution (MCP server would do this)
      response = await client.messages.create({
        model,
        max_tokens: 4096,
        messages: [
          { role: 'user', content: task },
          { role: 'assistant', content: response.content }
          // Add tool result here after execution
        ]
      });
    }
    
    // Extract JSON from response
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return text;
  } catch (error) {
    console.error(`MCP agent error: ${error.message}`);
    throw error;
  }
}

module.exports = { invokeMCPAgent };
```

## Context Engineering for MCP Tasks

### Good Task Specification
```
"Navigate to https://example.com/careers
Wait for job listings to load
Extract each job with:
- title (h2 or job-title class)
- company (from current page, it's TechCorp)
- description (div.description text)
- qualifications (any ul/ol with requirements)
- link (href of job detail link)
- publishDate (time element or metadata)

Limit to first 50 jobs
Return as JSON array"
```

### Bad Task Specification
```
"Scrape jobs"
```

## Best Practices for MCP Scraping

✓ **Be specific**: Include exact selectors and expected fields  
✓ **Set clear limits**: "first 50 jobs" not "all jobs"  
✓ **Include fallbacks**: "if selector X not found, try selector Y"  
✓ **Handle pagination**: "if Load More button exists, click it and extract next page"  
✓ **Specify output format**: "Return as JSON array with fields: [...]"  
✓ **Add error handling**: "if page blocks with 403, skip and return partial results"  
✓ **Set timeouts**: "give page 10 seconds to load"  
✓ **Test first**: Test with a simple "extract page title" task before complex ones  

## Debug MCP Agent Actions

```js
async function debugMCPAgent(task) {
  const result = await invokeMCPAgent('scraper', task, {
    tools: ['playwright'],
    verbose: true // Logs all tool calls
  });
  
  console.log('Agent Actions:', result.actions);
  console.log('Final Result:', result.data);
  
  return result;
}
```

## Advantages Over Direct Playwright
✓ Agent reasons about site structure automatically  
✓ Handles edge cases and site variations  
✓ No hardcoded selectors—agent finds elements  
✓ Can interact with pages like a human would  
✓ Better at pagination, filtering, search  
✓ Easier to adapt to site layout changes
