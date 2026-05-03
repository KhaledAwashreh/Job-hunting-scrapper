const { FirecrawlApp } = require('@mendable/firecrawl-js');
const { invokeMCPScraperAgent } = require('./mcp-client');

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
async function scrapeWebsite(careerUrl, company = null) {
  console.log(`\n[WebScraping] Starting scraping for ${careerUrl}`);

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

  // STRATEGY 2: Firecrawl with JSON extraction (intelligent, handles pagination)
  console.log('  → Strategy 2: Firecrawl API (JSON extraction)');
  return await scrapeWithFirecrawlJSON(careerUrl, company);
}

/**
 * Scrape using Firecrawl API with intelligent JSON extraction
 * Firecrawl automatically handles: dynamic content, pagination, anti-bot
 */
async function scrapeWithFirecrawlJSON(careerUrl, company) {
  const allJobs = [];
  const firecrawl = getFirecrawlClient();

  if (!firecrawl) {
    console.warn('  ⚠ Firecrawl API key not set, falling back to empty results');
    return [];
  }

  try {
    console.log('  → Scraping with Firecrawl (JSON extraction)...');
    
    // Use Firecrawl's crawlUrl for multi-page support with JSON extraction
    const crawlResult = await firecrawl.crawlUrl(careerUrl, {
      maxPages: 5, // Safety limit
      formats: ['json'],
      jsonOptions: {
        prompt: `Extract all job postings from this page. For each job, extract:
          - title (string)
          - description (string, max 2000 chars)
          - qualifications (string, max 1000 chars)
          - publishDate (string, format: YYYY-MM-DD if available)
          - link (string, full URL)
          - company (string, company name)
          - location (string, city/country)
          - language (string, detect the language: English, German, French, etc.)
        
        Return as JSON array of job objects.`,
        schema: {
          jobs: [{
            title: "string",
            description: "string",
            qualifications: "string",
            publishDate: "string",
            link: "string",
            company: "string",
            location: "string",
            language: "string"
          }]
        }
      },
      waitFor: 5000,
      timeout: 60000,
    });

    if (!crawlResult.success) {
      console.error(`  ✗ Firecrawl crawl failed: ${crawlResult.error}`);
      return [];
    }

    // Extract jobs from Firecrawl response
    const crawledData = crawlResult.data;
    
    if (crawledData && crawledData.jobs && Array.isArray(crawledData.jobs)) {
      // Single page result
      allJobs.push(...crawledData.jobs);
    } else if (Array.isArray(crawledData)) {
      // Multi-page result (array of page results)
      for (const pageData of crawledData) {
        if (pageData.jobs && Array.isArray(pageData.jobs)) {
          allJobs.push(...pageData.jobs);
        }
      }
    }

    // Normalize job format (ensure consistent fields)
    const normalizedJobs = allJobs.map(job => ({
      title: job.title || '',
      description: (job.description || '').substring(0, 2000),
      qualifications: (job.qualifications || '').substring(0, 1000),
      publishDate: job.publishDate || '',
      link: job.link || '',
      company: job.company || company?.name || '',
      country: job.location || company?.country || '',
      language: job.language || 'English'
    })).filter(j => j.title);

    console.log(`  ✓ Firecrawl extracted ${normalizedJobs.length} jobs (from ${allJobs.length} raw)`);
    return normalizedJobs;

  } catch (error) {
    console.error(`  ✗ Firecrawl scraping failed: ${error.message}`);
    return [];
  }
}

module.exports = {
  scrapeWebsite,
  monitorMemoryPressure,
};
