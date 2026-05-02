const { FirecrawlApp } = require('@firecrawl/sdk');
const { invokeMCPScraperAgent } = require('./mcp-client');
const { extractJobsIntelligently, extractCompanyMetadata } = require('./semantic-extractor');
const {
  analyzePageForms,
  generateFillStrategy,
  executeFillStrategy,
  clickSearchButton,
  detectPaginationControl,
  navigateToNextPage,
  INTERACTION_DELAYS,
} = require('./form-navigator');

const MEMORY_LIMITS = {
  MAX_HEAP_MB: 512,
  MAX_JOBS_IN_MEMORY: 500,
};

// Initialize Firecrawl client
let firecrawlClient = null;
function getFirecrawlClient() {
  if (!firecrawlClient && process.env.FIRECRAWL_API_KEY) {
    firecrawlClient = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
  }
  return firecrawlClient;
}

/**
 * Monitor memory pressure during scraping
 * Returns false if memory is critical
 */
function monitorMemoryPressure(allJobs) {
  const heapUsage = process.memoryUsage().heapUsed / 1024 / 1024; // MB
  const HEAP_LIMIT_MB = MEMORY_LIMITS.MAX_HEAP_MB;
  const JOBS_LIMIT = MEMORY_LIMITS.MAX_JOBS_IN_MEMORY;

  if (heapUsage > HEAP_LIMIT_MB) {
    console.warn(`⚠ MEMORY WARNING: Heap usage ${heapUsage.toFixed(0)}MB exceeds ${HEAP_LIMIT_MB}MB limit`);
    return false;
  }

  if (allJobs.length > JOBS_LIMIT) {
    console.warn(`⚠ MEMORY WARNING: Jobs array (${allJobs.length}) exceeds ${JOBS_LIMIT} items limit`);
    return false;
  }

  if (heapUsage > HEAP_LIMIT_MB * 0.8) {
    console.warn(`⚠ MEMORY: Heap at ${heapUsage.toFixed(0)}MB (high pressure)`);
  }

  return true;
}

/**
 * PROGRAMMATIC ENTRY POINT - Called by orchestrator.js
 * Intelligently navigates career pages and extracts jobs
 * @param {string} careerUrl - Careers page URL
 * @param {object} company - { id, name, country, platform }
 * @returns {Promise<Array>} Array of jobs from all pages
 */
async function scrapeBrowser(careerUrl, company = null) {
  console.log(`\n[Firecrawl] Starting scraping for ${careerUrl}`);

  // STRATEGY 1: Try MCP agent first (most powerful, uses Claude with full context)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      console.log('  → Strategy 1: MCP Agent (Claude with full reasoning)');
      const mcpJobs = await invokeMCPScraperAgent(careerUrl, {
        maxJobs: 50,
        country: company?.country,
      });

      if (mcpJobs && Array.isArray(mcpJobs) && mcpJobs.length > 0) {
        console.log(`  ✓ MCP found ${mcpJobs.length} jobs`);
        return mcpJobs;
      }
    } catch (error) {
      console.warn(`  ⚠ Strategy 1 failed: ${error.message}`);
    }
  }

  // STRATEGY 2: Firecrawl (replaces Playwright)
  console.log('  → Strategy 2: Firecrawl API');
  return await scrapeWithFirecrawl(careerUrl, company);
}

/**
 * Scrape using Firecrawl API
 */
async function scrapeWithFirecrawl(careerUrl, company) {
  const allJobs = [];
  const firecrawl = getFirecrawlClient();

  if (!firecrawl) {
    console.warn('  ⚠ Firecrawl API key not set, falling back to empty results');
    return [];
  }

  try {
    console.log('  → Scraping with Firecrawl...');
    
    // Scrape the career page with Firecrawl
    const scrapeResult = await firecrawl.scrapeUrl(careerUrl, {
      formats: ['markdown', 'html'],
      waitFor: 5000, // Wait for dynamic content to load
      timeout: 30000,
    });

    if (!scrapeResult.success) {
      console.error(`  ✗ Firecrawl scrape failed: ${scrapeResult.error}`);
      return [];
    }

    const htmlContent = scrapeResult.data.html;
    if (!htmlContent) {
      console.warn('  ⚠ No HTML content returned from Firecrawl');
      return [];
    }

    // Extract jobs from the scraped HTML
    console.log('  Phase 1: Job Extraction (Semantic)');
    const pageJobs = await extractJobsIntelligently(htmlContent, {
      name: company?.name || 'unknown',
      country: company?.country,
      url: careerUrl,
    });

    if (pageJobs && pageJobs.length > 0) {
      allJobs.push(...pageJobs);
      console.log(`  ✓ Extracted ${pageJobs.length} jobs from initial page (total: ${allJobs.length})`);
    } else {
      console.log(`  ℹ No jobs found on initial page`);
    }

    // Memory pressure check
    if (!monitorMemoryPressure(allJobs)) {
      console.log('  ✗ Memory pressure detected - stopping scraper');
      return allJobs;
    }

    // Check for pagination (simplified, Firecrawl handles some pagination)
    console.log('  Phase 2: Pagination Check');
    const pagination = detectPaginationControl(null, htmlContent);
    if (pagination) {
      console.log('  ℹ Pagination detected, but Firecrawl handles single-page scrapes. For multi-page, use Firecrawl crawl instead.');
      // Note: Full multi-page support would use firecrawl.crawlUrl() with maxPages
    } else {
      console.log('  ℹ No pagination - all pages scraped');
    }

    console.log(`\n  ✓ Scraping complete: ${allJobs.length} total jobs`);
    return allJobs;
  } catch (error) {
    console.error(`  ✗ Firecrawl scraping failed: ${error.message}`);
    return allJobs.length > 0 ? allJobs : [];
  }
}

module.exports = {
  scrapeBrowser,
  monitorMemoryPressure,
};