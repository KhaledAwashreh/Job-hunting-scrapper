const { default: FirecrawlApp } = require('@mendable/firecrawl-js');
const { invokeMCPScraperAgent } = require('./mcp-client');
const logger = require('../utils/logger');
const axios = require('axios');

// Initialize Firecrawl client
let firecrawlClient = null;
function getFirecrawlClient() {
  if (!firecrawlClient && process.env.FIRECRAWL_API_KEY) {
    firecrawlClient = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
  }
  return firecrawlClient;
}

/**
 * Use Firecrawl's asyncExtract for AI-powered job extraction
 * This is the recommended approach - define a task and let AI handle the rest
 */
async function scrapeWithFirecrawlAgent(careerUrl, company) {
  const firecrawl = getFirecrawlClient();
  
  if (!firecrawl) {
    console.warn('  ⚠ Firecrawl API key not set');
    return [];
  }

  try {
    console.log('  → Using Firecrawl Agent for intelligent extraction...');

    // Define the extraction task - the AI will figure out the page structure
    const extractionPrompt = `You are a job posting extractor. Your task is to find and extract ALL job postings from this careers page.
    
For each job posting, extract:
- title: The job title/position name (e.g., "Senior Software Engineer")
- description: Full job description, responsibilities, and requirements
- qualifications: Required skills, experience, education
- publishDate: When the job was posted (look for dates like "2 days ago", "May 2026")
- link: Direct URL to the job posting (must be a complete URL starting with http)
- location: Job location (city, country)

Return a JSON object with a "jobs" array containing all found jobs. Example:
{ "jobs": [
  {
    "title": "Senior Software Engineer",
    "description": "We are looking for...",
    "qualifications": "5+ years experience...",
    "publishDate": "2026-05-10",
    "link": "https://company.com/jobs/123",
    "location": "Amsterdam, Netherlands"
  }
] }

If no jobs found, return an empty array { "jobs": [] }.`;

    // Use extract which handles polling internally (SDK v1.29+)
    const extractResult = await firecrawl.extract([careerUrl], {
      prompt: extractionPrompt,
      // Define the expected schema with wrapper object
      schema: {
        type: 'object',
        properties: {
          jobs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                qualifications: { type: 'string' },
                publishDate: { type: 'string' },
                link: { type: 'string' },
                location: { type: 'string' }
              },
              required: ['title', 'link']
            }
          }
        },
        required: ['jobs']
      }
    });

    if (!extractResult.success) {
      console.error(`  ✗ Firecrawl Agent failed: ${extractResult.error || 'Unknown'}`);
      return [];
    }

    const jobs = extractResult.data?.jobs || [];
    console.log(`  ✓ Firecrawl Agent extracted ${jobs.length} jobs`);
    
    // Normalize and return
    return jobs.map(job => ({
      title: job.title || '',
      description: (job.description || '').substring(0, 2000),
      qualifications: (job.qualifications || '').substring(0, 1000),
      publishDate: job.publishDate || '',
      link: job.link || '',
      company: company?.name || '',
      country: job.location || company?.country || ''
    })).filter(j => j.title && j.link);
  } catch (error) {
    console.error(`  ✗ Firecrawl Agent error: ${error.message}`);
    return [];
  }
}

// Puppeteer for dynamic content (fallback when Firecrawl fails)
let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  console.log('Puppeteer not available');
}

async function scrapeWithPuppeteer(url, company) {
  if (!puppeteer) {
    return null;
  }

  let browser = null;
  try {
    console.log('  → Using Puppeteer for dynamic content...');
    
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    
    const page = await browser.newPage();
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate to the page
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for the page to fully render with extra time for SPAs
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Try to scroll down to trigger lazy-loaded content
    await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.evaluate(() => { window.scrollTo(0, 0); });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Better job extraction: look for job cards, links, and text with smarter selectors
    const extractionResult = await page.evaluate(() => {
      const jobs = [];
      
      // Strategy 1: Look for common job card containers
      const cardSelectors = [
        '.job-listing', '.job-card', '.job-post', '.job-result',
        '.position', '.opening', '.vacancy', '.job-item',
        '[data-job-id]', '[data-qa="job"]', '[data-test="job-posting"]',
        'article.job', 'li.job', 'tr.job',
        // Greenhouse-specific
        '.job-post', '.opening',
        // Generic cards with job-related text
        '[class*="job"]', '[class*="position"]', '[class*="career"]'
      ];
      
      const seen = new Set();
      
      for (const sel of cardSelectors) {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
          // Extract title from heading or link
          const titleEl = el.querySelector('h1, h2, h3, h4, a[class*="title"], [class*="title"]');
          const linkEl = el.querySelector('a');
          const title = titleEl ? titleEl.textContent.trim() : (linkEl ? linkEl.textContent.trim() : '');
          
          // Skip if no meaningful title
          if (!title || title.length < 3) continue;
          // Skip common non-job phrases
          if (/^(back|home|about|careers|join|benefits|culture|contact|faq|privacy|terms|search)$/i.test(title)) continue;
          
          const link = linkEl ? linkEl.href : '';
          const key = title + '|' + link;
          if (seen.has(key)) continue;
          seen.add(key);
          
          jobs.push({ title, link, containerText: el.textContent.trim().substring(0, 500) });
        }
      }
      
      // Strategy 2: Find job links directly from the page
      if (jobs.length === 0) {
        const allLinks = document.querySelectorAll('a[href]');
        const jobLinkPatterns = [/job/i, /position/i, /career/i, /opening/i, /vacanc/i, /apply/i, /requisition/i];
        
        for (const link of allLinks) {
          const href = link.href;
          const text = link.textContent.trim();
          
          // Check if link looks job-related
          const isJobLink = jobLinkPatterns.some(p => p.test(href)) && text.length > 3;
          if (!isJobLink) continue;
          
          // Skip common non-job phrases
          if (/^(back|home|about|careers|join|benefits|culture|contact|faq)$/i.test(text)) continue;
          
          const key = text + '|' + href;
          if (seen.has(key)) continue;
          seen.add(key);
          
          // Try to find context
          const parent = link.closest('li, div, article, tr') || link;
          const context = parent.textContent.trim().substring(0, 500);
          
          jobs.push({ title: text, link: href, containerText: context });
        }
      }
      
      return jobs;
    });
    
    console.log(`  → Puppeteer extracted ${extractionResult.length} job links`);
    
    if (extractionResult.length === 0) {
      // Final fallback: just get all page text and look for job-like content
      const bodyText = await page.evaluate(() => document.body.innerText);
      console.log(`  → Page body text: ${bodyText.length} chars`);
      return [];
    }
    
    // Deduplicate by URL
    const urlMap = new Map();
    for (const j of extractionResult) {
      if (j.link && !urlMap.has(j.link)) {
        urlMap.set(j.link, j);
      } else if (!j.link && !urlMap.has(j.title)) {
        urlMap.set(j.title, j);
      }
    }
    
    const jobs = [];
    for (const [key, j] of urlMap) {
      // Try to get proper description from container text
      const description = j.containerText || `Position at ${company?.name || 'company'}`;
      
      jobs.push({
        title: j.title,
        description: description.substring(0, 2000),
        // No fallback to the listing `url` here: multiple link-less job
        // cards would otherwise all get the *same* link, which both breaks
        // the UI's "View" button (it points at the listing page, not the
        // job) and can collide in job-dedup hashing if they also share
        // title/description. '' matches this file's own convention for a
        // missing link elsewhere (see e.g. scrapeWithFirecrawlAgent above).
        link: j.link || '',
        company: company?.name || '',
        country: company?.country || ''
      });
    }
    
    // Try to visit first few detail pages for better descriptions
    const detailUrls = jobs.slice(0, 5).map(j => j.link).filter(l => l && l.startsWith('http'));
    for (const jobUrl of detailUrls) {
      try {
        const response = await page.goto(jobUrl, { waitUntil: 'networkidle2', timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 1000));

        // A 404 (or any non-2xx) detail page still resolves normally from
        // page.goto() — it doesn't throw or reject — but its <title>/meta
        // description (e.g. "Page Not Found") must not be allowed to
        // silently overwrite the good listing-page data already in `jobs`.
        const status = response ? response.status() : null;
        if (status !== null && (status < 200 || status >= 300)) {
          continue;
        }

        const jobContent = await page.content();
        const jobInfo = extractJobFromHTML(jobContent, jobUrl, company);

        // Match with existing job
        const existing = jobs.find(j => j.link === jobUrl);
        if (existing && jobInfo.title) {
          existing.title = jobInfo.title;
          existing.description = jobInfo.description.substring(0, 2000);
        }
      } catch (e) {
        // Skip failed pages
      }
    }
    
    console.log(`  ✓ Puppeteer scraped ${jobs.length} jobs`);
    return jobs;
  } catch (error) {
    console.log(`  ⚠ Puppeteer error: ${error.message}`);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Known false-positive phrases that appear as headings/links on career pages
// but are NOT actual job titles
const NON_JOB_TITLE_PATTERNS = [
  /^back\s+button$/i, /^back$/, /^home$/i, /^about$/i, /^careers?$/i,
  /^join\s+(us|the|our)/i, /^benefits$/i, /^culture$/i, /^contact$/i,
  /^faq$/i, /^privacy$/i, /^terms$/i, /^search$/i,
  /^sign\s+(in|up)$/i, /^log\s+in$/i, /^register$/i,
  /^life\s+at/i, /^why\s+(join|work)/i, /^our\s+(team|story|values)/i,
  /^meet\s+our/i, /^employee\s+stor/i, /^career\s+(opportunities?|pages?)$/i,
  /^open\s+positions?$/i, /^current\s+openings?$/i,
  /^view\s+(all|more|open)/i, /^apply\s+now$/i,
  /^learn\s+more$/i, /^get\s+started$/i,
  /^sitemap$/i, /^accessibility$/i, /^cookie/i,
  /^english$/i, /^dutch$/i, /^french$/i, /^german$/i, /^spanish$/i,
];

function isNonJobTitle(title) {
  const t = title.trim();
  if (t.length > 60) return false; // Long text is unlikely to be a nav label
  return NON_JOB_TITLE_PATTERNS.some(p => p.test(t));
}

/**
 * Parse jobs from HTML content with better false-positive filtering
 */
function parseJobsFromHTML(html, links, careerUrl, company) {
  const jobs = [];
  const baseUrl = new URL(careerUrl).origin;
  const seenUrls = new Set();
  
  // Strategy 1: Look for job-related headings with nearby links
  const headingLinkPairs = html.match(
    /<h[1-4][^>]*>(.*?)<\/h[1-4]>\s*(?:.*?)<a\s+href=["']([^"']*)["']/gi
  ) || [];
  
  for (const pair of headingLinkPairs) {
    const titleMatch = pair.match(/<h[1-4][^>]*>(.*?)<\/h[1-4]>/i);
    const linkMatch = pair.match(/href=["']([^"']*)["']/i);
    
    if (!titleMatch || !linkMatch) continue;
    
    const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    let link = linkMatch[1];
    
    if (!title || title.length < 3 || isNonJobTitle(title)) continue;
    if (!link || link.startsWith('#') || link.startsWith('javascript:')) continue;
    
    if (!link.startsWith('http')) {
      try { link = new URL(link, careerUrl).href; } catch { continue; }
    }
    
    const key = title + '|' + link;
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    
    jobs.push({
      title,
      description: `Position at ${company?.name || 'company'}`,
      link,
      company: company?.name || '',
      country: company?.country || ''
    });
  }
  
  // Strategy 2: Find links with job-related URLs and titles
  if (jobs.length === 0) {
    const jobLinkRegex = /<a\s+[^>]*href=["']([^"']*(?:job|career|position|opening|vacanc|requisition|apply)[^"']*)["'][^>]*>([^<]+)<\/a>/gi;
    let match;
    
    while ((match = jobLinkRegex.exec(html)) !== null) {
      let title = match[2].trim();
      let link = match[1];
      
      if (!title || title.length < 3 || isNonJobTitle(title)) continue;
      if (!link || link.startsWith('#') || link.startsWith('javascript:')) continue;
      
      if (!link.startsWith('http')) {
        try { link = new URL(link, careerUrl).href; } catch { continue; }
      }
      
      const key = title + '|' + link;
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
      
      jobs.push({
        title,
        description: `Position at ${company?.name || 'company'}`,
        link,
        company: company?.name || '',
        country: company?.country || ''
      });
    }
  }
  
  return jobs;
}

/**
 * Extract job info from job detail HTML
 */
function extractJobFromHTML(html, url, company) {
  const result = {
    title: '',
    description: '',
    qualifications: '',
    publishDate: '',
    link: url,
    company: company?.name || '',
    location: company?.country || ''
  };
  
  // Extract title from <title> or <h1>
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i) || html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (titleMatch) {
    result.title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
  }
  
  // Extract description from meta tags or main content
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                   html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
  if (descMatch) {
    result.description = descMatch[1].substring(0, 2000);
  }
  
  return result;
}

/**
 * Try to scrape a job page using a direct API-based approach for known ATS.
 * Many ATS platforms have public APIs that aren't always detected by apiAgent.
 */
async function tryDirectAPIScrape(careerUrl, company) {
  const lower = careerUrl.toLowerCase();

  // Try Greenhouse API for any boards.greenhouse.io URL
  if (lower.includes('boards.greenhouse.io') || lower.includes('greenhouse.io')) {
    try {
      // Reuse apiAgent's already-fixed slug detection (issue #39) rather
      // than a second, naive regex here — a plain
      // /greenhouse\.io\/([^/?]+)/ match mis-extracts the slug for the
      // `{slug}.boards.greenhouse.io` subdomain form.
      const { detectGreenhouseSlug } = require('./apiAgent');
      const slug = detectGreenhouseSlug(careerUrl);
      if (slug) {
        console.log(`  → Direct Greenhouse API attempt: ${slug}`);
        const { scrapeGreenhouse } = require('./apiAgent');
        const jobs = await scrapeGreenhouse(slug);
        if (jobs && jobs.length > 0) return jobs;
      }
    } catch (e) { /* fall through */ }
  }

  // Try Lever API for any jobs.lever.co URL
  if (lower.includes('jobs.lever.co') || lower.includes('lever.co')) {
    try {
      // Reuse apiAgent's already-fixed slug detection (issue #39) — a plain
      // /lever\.co\/([^/?]+)/ match mis-extracts "v0" as the slug for
      // api.lever.co/v0/postings/{slug} URLs.
      const { detectLeverSlug } = require('./apiAgent');
      const slug = detectLeverSlug(careerUrl);
      if (slug) {
        console.log(`  → Direct Lever API attempt: ${slug}`);
        const { scrapeLever } = require('./apiAgent');
        const jobs = await scrapeLever(slug);
        if (jobs && jobs.length > 0) return jobs;
      } else {
        // Not part of the #39 bug/fix: kept as-is. Fallback for URL shapes
        // detectLeverSlug doesn't recognize — try extracting the company
        // name from the URL path.
        const pathParts = careerUrl.split('/').filter(Boolean);
        const companyName = pathParts[pathParts.length - 1]?.replace(/[?#].*$/, '');
        if (companyName && companyName !== 'jobs') {
          console.log(`  → Direct Lever API attempt: ${companyName}`);
          const { scrapeLever } = require('./apiAgent');
          const jobs = await scrapeLever(companyName);
          if (jobs && jobs.length > 0) return jobs;
        }
      }
    } catch (e) { /* fall through */ }
  }

  // Try Workable API for any apply.workable.com URL
  if (lower.includes('apply.workable.com') || lower.includes('workable.com')) {
    try {
      const slug = careerUrl.match(/workable\.com\/([^/?]+)/i);
      if (slug) {
        console.log(`  → Direct Workable API attempt: ${slug[1]}`);
        const { scrapeWorkable } = require('./apiAgent');
        const jobs = await scrapeWorkable(slug[1]);
        if (jobs && jobs.length > 0) return jobs;
      }
    } catch (e) { /* fall through */ }
  }

  // Try RSS feed if api_url is set to an RSS feed
  if (company?.api_url && (company.api_url.includes('rss') || company.api_url.includes('xml'))) {
    try {
      console.log(`  → Direct RSS feed attempt: ${company.api_url}`);
      const { scrapeRSSFeed } = require('./apiAgent');
      const jobs = await scrapeRSSFeed(company.api_url);
      if (jobs && jobs.length > 0) return jobs;
    } catch (e) { /* fall through */ }
  }

  // Try generic JSON API for next.js /api/careers patterns
  if (lower.includes('/api/career') || lower.includes('/api/jobs')) {
    try {
      console.log(`  → Direct JSON API attempt: ${careerUrl}`);
      const { scrapeJSONAPI } = require('./apiAgent');
      const jobs = await scrapeJSONAPI(careerUrl);
      if (jobs && jobs.length > 0) return jobs;
    } catch (e) { /* fall through */ }
  }

  return null;
}

/**
 * PROGRAMMATIC ENTRY POINT - Called by orchestrator.js
 * Intelligently navigates career pages and extracts jobs
 * @param {string} careerUrl - Careers page URL
 * @param {object} company - { id, name, country, platform }
 * @returns {Promise<Array>} Array of jobs from all pages
 */
async function scrapeWebsite(careerUrl, company = null) {
  console.log(`\n[WebScraping] Starting scraping for ${careerUrl}`);

  // STRATEGY 0: Direct API scrape for known ATS platforms
  try {
    const directJobs = await tryDirectAPIScrape(careerUrl, company);
    if (directJobs && directJobs.length > 0) {
      console.log(`  ✓ Direct API found ${directJobs.length} jobs`);
      return directJobs;
    }
  } catch (error) {
    console.warn(`  ⚠ Direct API failed: ${error.message}`);
  }

  // STRATEGY 1: Firecrawl scrape (fast, single page with JS rendering)
  // Scrapes the career page with wait+scroll actions, parses jobs from markdown
  if (process.env.FIRECRAWL_API_KEY) {
    try {
      console.log('  → Strategy 1: Firecrawl scrape (JS-rendered content)');
      const scrapedJobs = await scrapeWithFirecrawlScrape(careerUrl, company);
      if (scrapedJobs && scrapedJobs.length > 0) {
        console.log(`  ✓ Firecrawl scrape found ${scrapedJobs.length} jobs`);
        return scrapedJobs;
      }
    } catch (error) {
      console.warn(`  ⚠ Strategy 1 failed: ${error.message}`);
    }
  }

  // STRATEGY 2: Firecrawl Agent (AI-powered extraction for complex SPAs)
  if (process.env.FIRECRAWL_API_KEY) {
    try {
      console.log('  → Strategy 2: Firecrawl Agent (AI-powered extraction)');
      const agentJobs = await scrapeWithFirecrawlAgent(careerUrl, company);
      if (agentJobs && agentJobs.length > 0) {
        console.log(`  ✓ Firecrawl Agent found ${agentJobs.length} jobs`);
        return agentJobs;
      }
    } catch (error) {
      console.warn(`  ⚠ Strategy 2 failed: ${error.message}`);
    }
  }

  // STRATEGY 3: Puppeteer fallback (last resort for dynamic pages)
  console.log('  → Strategy 3: Puppeteer (last resort)');
  try {
    const puppeteerJobs = await scrapeWithPuppeteer(careerUrl, company);
    if (puppeteerJobs && puppeteerJobs.length > 0) {
      console.log(`  ✓ Puppeteer found ${puppeteerJobs.length} jobs`);
      return puppeteerJobs;
    }
  } catch (error) {
    console.warn(`  ⚠ Strategy 3 failed: ${error.message}`);
  }

  console.log('  ✗ All strategies exhausted, returning empty');
  return [];
}

/**
 * Fallback: Use Firecrawl's scrape method with enhanced wait times
 * Used when extract method fails
 */
async function scrapeWithFirecrawlScrape(careerUrl, company) {
  const firecrawl = getFirecrawlClient();
  
  if (!firecrawl) {
    return [];
  }

  try {
    console.log('  → Trying Firecrawl scrape as fallback...');

    // Enhanced actions for better dynamic content handling
    const scrapeResult = await firecrawl.scrapeUrl(careerUrl, {
      formats: ['markdown', 'links'],
      onlyMainContent: true,
      timeout: 45000,
      actions: [
        // Wait for initial page load
        { type: 'wait', milliseconds: 2000 },
        // Scroll down to trigger lazy loading
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 2000 },
        // Scrape the final page state
        { type: 'scrape' }
      ]
    });

    // Log page content for debugging
    const pageContent = scrapeResult.data?.markdown || '';
    const links = scrapeResult.data?.links || [];
    require('fs').appendFileSync('debug.log', `\n=== PAGE CONTENT (${careerUrl}) ===\n${pageContent.substring(0, 3000)}\n=== LINKS ===\n${links.slice(0, 50).join('\n')}\n`, 'utf8');

    console.log(`  → Page has ${links.length} links, content length: ${pageContent.length}`);

    // Parse job listings from the page content
    const jobsFromPage = parseJobsFromMarkdown(pageContent, links, careerUrl, company);
    console.log(`  → Found ${jobsFromPage.length} potential jobs from page parsing`);

    // Normalize job format
    const normalizedJobs = jobsFromPage.map(job => ({
      title: job.title || '',
      description: (job.description || '').substring(0, 2000),
      qualifications: (job.qualifications || '').substring(0, 1000),
      publishDate: job.publishDate || '',
      link: job.link || '',
      company: job.company || company?.name || '',
      country: job.location || company?.country || ''
    })).filter(j => j.title);

    console.log(`  ✓ Firecrawl scraped ${normalizedJobs.length} jobs`);
    return normalizedJobs;

  } catch (error) {
    console.error(`  ✗ Firecrawl scrape fallback failed: ${error.message}`);
    logger.error(`Firecrawl scrape fallback failed for ${careerUrl}: ${error.stack || error.message}`);
    return [];
  }
}

/**
 * Parse job listings from markdown content and links
 * Enhanced to handle SPAs where jobs load dynamically
 * Filters out known non-job entries (nav links, culture pages, etc.)
 */
function parseJobsFromMarkdown(markdown, links, careerUrl, company) {
  const jobs = [];
  const seenUrls = new Set();
  const baseUrl = new URL(careerUrl).origin;

  // Strategy 1: Parse from markdown headings and content
  const lines = markdown.split('\n');
  let currentTitle = '';
  let currentDescription = '';

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^#{1,3}\s+/.test(trimmed)) {
      const title = currentTitle.replace(/^#{1,3}\s+/, '').trim();
      if (title && !isNonJobTitle(title) && currentDescription) {
        jobs.push({
          title,
          description: currentDescription.substring(0, 2000),
          link: '',
          company: company?.name || '',
          country: company?.country || '',
        });
      }
      currentTitle = trimmed;
      currentDescription = '';
    } else if (currentTitle && trimmed.length > 50) {
      currentDescription += ' ' + trimmed;
    }
  }

  // Final heading check
  {
    const title = currentTitle.replace(/^#{1,3}\s+/, '').trim();
    if (title && !isNonJobTitle(title) && currentDescription) {
      jobs.push({
        title,
        description: currentDescription.substring(0, 2000),
        link: '',
        company: company?.name || '',
        country: company?.country || '',
      });
    }
  }

  // Strategy 2: Extract markdown links with [title](url) pattern
  const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
  let mdMatch;
  while ((mdMatch = mdLinkRegex.exec(markdown)) !== null) {
    const title = mdMatch[1].trim();
    const link = mdMatch[2];
    if (!title || title.length < 3 || isNonJobTitle(title)) continue;
    if (seenUrls.has(link)) continue;

    // Only include if link looks job-related
    const lower = link.toLowerCase();
    if (!(lower.includes('job') || lower.includes('position') || lower.includes('career') ||
          lower.includes('/jobs/') || lower.includes('/careers/') || lower.includes('/openings/') ||
          lower.includes('apply') || lower.includes('requisition'))) {
      continue;
    }

    seenUrls.add(link);
    jobs.push({
      title,
      description: 'Position at ' + (company?.name || 'company'),
      link,
      company: company?.name || '',
      country: company?.country || '',
    });
  }

  // Strategy 3: Extract job links from plain URLs and try to find nearby context
  const jobLinks = (links || []).filter(link => {
    const lower = link.toLowerCase();
    return (lower.includes('job') || lower.includes('position') || lower.includes('/jobs/') ||
            lower.includes('/careers/') || lower.includes('/openings/') || lower.includes('requisition') ||
            lower.includes('apply')) &&
           !lower.includes('#') &&
           !seenUrls.has(link);
  });

  for (const jobLink of jobLinks) {
    let title = 'Job at ' + (company?.name || 'Unknown Company');

    // Try to find a nearby heading in markdown
    const linkIndex = markdown.indexOf(jobLink);
    if (linkIndex !== -1) {
      const beforeLink = markdown.substring(Math.max(0, linkIndex - 500), linkIndex);
      const headingMatch = beforeLink.match(/#{1,3}\s+([^\n]+)$/m);
      if (headingMatch) {
        const candidate = headingMatch[1].trim();
        if (!isNonJobTitle(candidate)) {
          title = candidate;
        }
      }
    }

    seenUrls.add(jobLink);
    jobs.push({
      title,
      description: 'Position at ' + (company?.name || 'company'),
      link: jobLink.startsWith('http') ? jobLink : baseUrl + jobLink,
      company: company?.name || '',
      country: company?.country || '',
    });
  }

  console.log(`  → Parsed ${jobs.length} jobs from markdown (${seenUrls.size} unique URLs)`);
  return jobs;
}

module.exports = {
  scrapeWebsite,
};
