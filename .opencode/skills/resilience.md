# Skill: Session Management & Resilience

## Purpose
Maintain browser state across scraping, handle blocks, implement retry logic, and manage cookies/headers.

## When to Use
- Scraping sites that block after repeated requests
- Maintaining login sessions (requiring authentication)
- Managing rate limits and 429 errors
- Reusing browser context for efficiency
- Avoiding detection by appearing as real user

## Reuse Browser Context

```js
async function scrapeMultipleSitesEfficiently() {
  const browser = await chromium.launch({ headless: true });
  
  try {
    for (const site of sites) {
      // Create page in SAME browser context
      const page = await browser.newPage();
      
      try {
        // Scrape...
        const jobs = await scrapeJobSite(page, site.url);
        
        // Process...
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}
```

## Implement Retry Logic

```js
async function retryWithBackoff(asyncFn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await asyncFn();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        const delayMs = baseDelay * Math.pow(2, attempt - 1); // exponential backoff
        console.log(`Attempt ${attempt} failed. Retrying in ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  
  throw lastError;
}

// Usage
const jobs = await retryWithBackoff(() => page.goto(url), 3, 2000);
```

## Handle Rate Limiting (429 Errors)

```js
async function handleRateLimiting(page, url) {
  let backoffDelay = 5000; // 5 seconds initial
  
  while (backoffDelay < 60000) { // Max 1 minute
    try {
      const response = await page.goto(url, { waitUntil: 'networkidle' });
      
      if (response.status() === 429) {
        console.warn(`Rate limited! Waiting ${backoffDelay}ms`);
        await page.waitForTimeout(backoffDelay);
        backoffDelay *= 2; // Double the delay
        continue;
      }
      
      return response;
    } catch (error) {
      throw error;
    }
  }
  
  throw new Error('Rate limit backoff exceeded 1 minute');
}
```

## Add Realistic Headers

```js
async function setupRealisticBrowser() {
  const browser = await chromium.launch();
  const context = await browser.createBrowserContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'light',
    timezoneId: 'America/New_York',
  });
  
  const page = await context.newPage();
  
  // Add headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.google.com/',
  });
  
  return { browser, context, page };
}
```

## Manage Cookies & Login State

```js
async function loadCookies(context, cookiesPath) {
  try {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
    await context.addCookies(cookies);
    console.log(`Loaded ${cookies.length} cookies`);
  } catch (e) {
    console.log('No saved cookies found');
  }
}

async function saveCookies(context, cookiesPath) {
  const cookies = await context.cookies();
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
  console.log(`Saved ${cookies.length} cookies`);
}

async function ensureLoggedIn(page, loginUrl, email, password) {
  // Check if already logged in
  const isLoggedIn = await page.locator('[data-qa="user-profile"], .logged-in-indicator').isVisible().catch(() => false);
  
  if (isLoggedIn) {
    console.log('Already logged in');
    return;
  }
  
  // Login
  await page.goto(loginUrl);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForNavigation();
  
  console.log('Logged in successfully');
}
```

## Detect & Skip Blocked Pages

```js
async function handleBlockedResponse(page, response) {
  const blockedStatuses = [403, 429, 503];
  
  if (blockedStatuses.includes(response.status())) {
    console.warn(`Page blocked with status ${response.status()}: ${response.url()}`);
    return { blocked: true, status: response.status() };
  }
  
  // Check for captcha
  const hasCaptcha = await page.locator('iframe[src*="recaptcha"], [data-captcha]').isVisible().catch(() => false);
  if (hasCaptcha) {
    console.warn('CAPTCHA detected—cannot proceed');
    return { blocked: true, reason: 'captcha' };
  }
  
  return { blocked: false };
}
```

## Add Random Delays

```js
function randomDelay(minMs = 500, maxMs = 3000) {
  return Math.floor(Math.random() * (maxMs - minMs + 1) + minMs);
}

async function scrapeWithRandomDelays(page, urls) {
  for (const url of urls) {
    await page.goto(url);
    
    // Random delay between 500ms-3s
    const delay = randomDelay(500, 3000);
    await page.waitForTimeout(delay);
  }
}
```

## Pool Concept (Advanced)

```js
class BrowserPool {
  constructor(poolSize = 3) {
    this.poolSize = poolSize;
    this.browsers = [];
    this.queue = [];
  }
  
  async initialize() {
    for (let i = 0; i < this.poolSize; i++) {
      const browser = await chromium.launch();
      this.browsers.push({ browser, available: true });
    }
  }
  
  async getPage() {
    let browserData = this.browsers.find(b => b.available);
    
    if (!browserData) {
      // Wait for browser to become available
      await new Promise(r => {
        const check = setInterval(() => {
          browserData = this.browsers.find(b => b.available);
          if (browserData) {
            clearInterval(check);
            r();
          }
        }, 100);
      });
    }
    
    browserData.available = false;
    const page = await browserData.browser.newPage();
    return { page, releaseFn: () => { browserData.available = true; } };
  }
  
  async closeAll() {
    await Promise.all(this.browsers.map(b => b.browser.close()));
  }
}
```

## Best Practices
✓ Reuse browser/context across multiple pages (avoid creating new browser per job)
✓ Add 1-3s random delays between requests
✓ Set User-Agent and realistic headers
✓ Implement exponential backoff for retries
✓ Log all retry attempts and blocks for debugging
✓ Save and restore cookies to maintain login state
✓ Detect CAPTCHA and block indicators early—fail fast
✓ Monitor HTTP status codes and handle errors gracefully
