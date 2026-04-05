# Skill: JavaScript Evaluation & API Access

## Purpose
Use Playwright's `evaluate()` to run JavaScript on the page and interact with browser APIs, extract data via page scripts, and access REST APIs from the page context.

## When to Use
- Complex DOM traversal (nested, dynamic structures)
- Extracting data from JavaScript-rendered content
- Accessing `window` global variables (e.g., job data in JS)
- Parsing SVG or canvas content
- Calling page's own API methods
- Getting computed styles or dimensions

## Page Evaluation Patterns

### Extract Jobs via Evaluate
```js
async function extractJobsViaEvaluate(page) {
  const jobs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-job-id], .job-card, li.job'))
      .map(el => ({
        title: el.querySelector('[data-qa="title"], .title, h2')?.textContent?.trim(),
        company: el.querySelector('[data-qa="company"], .company')?.textContent?.trim(),
        location: el.querySelector('[data-qa="location"], .location')?.textContent?.trim(),
        link: el.querySelector('a')?.href,
        salary: el.getAttribute('data-salary') || el.querySelector('[data-qa="salary"]')?.textContent?.trim(),
      }))
      .filter(j => j.title && j.link);
  });
  
  return jobs;
}
```

### Access Window Variables
```js
async function extractFromWindowData(page) {
  const data = await page.evaluate(() => {
    // Some SPAs store job data in window object
    if (window.__INITIAL_STATE__?.jobs) {
      return window.__INITIAL_STATE__.jobs;
    }
    
    // Or in Redux store
    if (window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__) {
      return window.reduxStore?.getState()?.jobs;
    }
    
    return null;
  });
  
  return data;
}
```

### Get Computed Styles
```js
async function getElementSize(page, selector) {
  const size = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const rect = el?.getBoundingClientRect();
    return {
      width: rect?.width,
      height: rect?.height,
      visible: rect?.height > 0 && rect?.width > 0
    };
  }, selector);
  
  return size;
}
```

### Parse Complex Structures
```js
async function parseTableData(page) {
  const data = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    return Array.from(rows).map(row => {
      const cells = row.querySelectorAll('td');
      return {
        position: cells[0]?.textContent?.trim(),
        company: cells[1]?.textContent?.trim(),
        location: cells[2]?.textContent?.trim(),
        salary: cells[3]?.textContent?.trim(),
        postedDate: cells[4]?.textContent?.trim(),
      };
    });
  });
  
  return data;
}
```

## Async Evaluation

```js
async function waitForDataViaEvaluate(page, condition) {
  const result = await page.evaluate(async (cond) => {
    // This function runs in browser context
    for (let i = 0; i < 50; i++) {
      const jobCount = document.querySelectorAll('[data-qa="job"]').length;
      
      if (eval(cond)) { // e.g., "jobCount > 0"
        return jobCount;
      }
      
      await new Promise(r => setTimeout(r, 200));
    }
    
    return 0;
  }, 'jobCount > 5');
  
  return result;
}
```

## REST API Calls from Browser

```js
async function callPageAPI(page, endpoint) {
  const response = await page.evaluate(async (url) => {
    try {
      const res = await fetch(url);
      return await res.json();
    } catch (e) {
      return null;
    }
  }, endpoint);
  
  return response;
}
```

## Track Network Requests

```js
async function captureJobApiCall(page) {
  const apiResponses = [];
  
  page.on('response', async (response) => {
    if (response.url().includes('/api/jobs') || response.url().includes('job')) {
      try {
        const data = await response.json();
        apiResponses.push({ url: response.url(), data });
      } catch (e) {
        // Not JSON
      }
    }
  });
  
  // Trigger action that makes API call
  await page.click('button:has-text("Search")');
  await page.waitForTimeout(2000);
  
  return apiResponses;
}
```

## Complex DOM Parsing Example

```js
async function extractNestededJobData(page) {
  const jobs = await page.evaluate(() => {
    const results = [];
    
    document.querySelectorAll('.job-section').forEach(section => {
      const category = section.querySelector('h2')?.textContent?.trim();
      
      section.querySelectorAll('.job-posting').forEach(posting => {
        results.push({
          category,
          title: posting.querySelector('.job-title')?.textContent?.trim(),
          details: {
            company: posting.querySelector('[data-company]')?.getAttribute('data-company'),
            salary: posting.querySelector('[data-salary]')?.getAttribute('data-salary'),
            remote: posting.querySelector('[data-remote]')?.textContent?.includes('Remote'),
          },
          link: posting.querySelector('a[href*="apply"]')?.href,
        });
      });
    });
    
    return results;
  });
  
  return jobs;
}
```

## Best Practices
✓ Keep evaluated code simple—return data, not side effects
✓ Use `evaluate()` for complex DOM, use `locator()` for simple selections
✓ Pass parameters to evaluation functions to avoid closure issues
✓ Always wrap `evaluate()` in try/catch
✓ Use `page.evaluate()` for single values, `page.evaluateHandle()` for object references
✓ Log evaluated data for debugging
✓ Timeout evaluate calls (default 30s)—set shorter if possible
