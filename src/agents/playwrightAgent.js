const { chromium } = require('playwright');
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
  console.log(`\n[Playwright] Starting scraping for ${careerUrl}`);

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

  // STRATEGY 2: Playwright + Intelligent Navigation + Semantic Extraction (fallback)
  console.log('  → Strategy 2: Playwright + Form Navigation + Extraction');
  return await scrapeBrowserWithIntelligentNavigation(careerUrl, company);
}

/**
 * Full pipeline: Load → Analyze Forms → Fill → Extract → Paginate
 */
async function scrapeBrowserWithIntelligentNavigation(careerUrl, company) {
  let browser = null;
  let context = null;
  const allJobs = [];
  let pageCount = 0;
  const maxPages = 5; // Safety limit to prevent infinite loops

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    const page = await context.newPage();

    await page.setDefaultTimeout(15000);
    console.log('  → Loading page with Playwright...');
    
    try {
      await page.goto(careerUrl, { waitUntil: 'networkidle' });
    } catch (navErr) {
      console.error(`Navigation failed: ${navErr.message}`);
      throw new Error(`Failed to load ${careerUrl}: ${navErr.message}`);
    }

    const initialHtml = await page.content();
    console.log(`  ✓ Page loaded (${initialHtml.length} bytes)`);

    // LOOP: Process each page
    while (pageCount < maxPages) {
      pageCount++;
      console.log(`\n  [Page ${pageCount}/${maxPages}]`);

      // Get current HTML
      const htmlContent = await page.content();

      // Phase 1: Analyze forms and fill intelligently
      console.log('  Phase 1: Form Analysis & Filling');
      const formFields = await analyzePageForms(page, htmlContent);

      if (formFields) {
        const strategy = await generateFillStrategy(formFields, {
          country: company?.country,
          job_types: company?.job_types,
          seniority_level: company?.seniority_level,
        });

        if (strategy) {
          const filled = await executeFillStrategy(page, strategy);
          if (filled && strategy.submit_button) {
            await clickSearchButton(page, strategy.submit_button);
          }
        }
      }

      // Phase 2: Extract jobs from current page intelligently
      console.log('  Phase 2: Job Extraction (Semantic)');
      const pageHtml = await page.content();
      const pageJobs = await extractJobsIntelligently(pageHtml, {
        name: company?.name || 'unknown',
        country: company?.country,
        url: careerUrl,
      });

      if (pageJobs && pageJobs.length > 0) {
        allJobs.push(...pageJobs);
        console.log(`  ✓ Extracted ${pageJobs.length} jobs from page ${pageCount} (total: ${allJobs.length})`);
      } else {
        console.log(`  ℹ No jobs found on page ${pageCount}`);
      }

      // Memory pressure check
      if (!monitorMemoryPressure(allJobs)) {
        console.log('  ✗ Memory pressure detected - stopping scraper');
        break;
      }

      // Phase 3: Check for pagination and navigate
      console.log('  Phase 3: Pagination Check');
      const pagination = await detectPaginationControl(page, pageHtml);

      if (pagination) {
        const navigated = await navigateToNextPage(page, pagination);
        if (!navigated) {
          console.log('  ℹ Pagination navigation failed - stopping');
          break;
        }
        
        // Respect rate limits between pages
        await page.waitForTimeout(INTERACTION_DELAYS.BETWEEN_INTERACTIONS);
      } else {
        console.log('  ℹ No pagination - all pages scraped');
        break;
      }
    }

    console.log(`\n  ✓ Scraping complete: ${allJobs.length} total jobs from ${pageCount} page(s)`);
    return allJobs;
  } catch (error) {
    console.error(`  ✗ Scraping failed: ${error.message}`);
    return allJobs.length > 0 ? allJobs : [];
  } finally {
    // Ensure proper resource cleanup regardless of success/failure
    if (context) {
      try {
        await context.close();
      } catch (ctxErr) {
        console.warn(`Warning closing browser context: ${ctxErr.message}`);
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch (brErr) {
        console.warn(`Warning closing browser: ${brErr.message}`);
      }
    }
  }
}

module.exports = {
  scrapeBrowser,
  monitorMemoryPressure,
};
