/**
 * Form Navigator Sub-Agent
 * Intelligently fills forms, clicks buttons, navigates pages
 * Includes human-like delays and intelligent wait strategies
 *
 * Called by playwrightAgent.js to traverse career pages
 */

const Anthropic = require('@anthropic-ai/sdk');

// Real-world interaction delays (milliseconds)
const INTERACTION_DELAYS = {
  AFTER_INPUT_FILL: 500,        // User types, UI debounces
  AFTER_CLICK: 2000,             // Network latency + rendering
  BETWEEN_INTERACTIONS: 1000,    // Be respectful to server
  AFTER_PAGE_LOAD: 3000,         // Wait for dynamic content
};

/**
 * Detect and analyze form structure
 * Returns form fields that can be filled intelligently
 */
async function analyzePageForms(page, htmlContent) {
  try {
    console.log('    → Analyzing form structure...');

    // Extract form fields via JavaScript execution
    const formFields = await page.evaluate(() => {
      const fields = [];
      
      // Get all input fields
      document.querySelectorAll('input[type="text"], input[type="search"], input[type="email"]').forEach(input => {
        fields.push({
          type: 'text_input',
          name: input.name || input.id || input.placeholder,
          selector: getUniqueSelector(input),
          label: getFieldLabel(input),
          placeholder: input.placeholder,
        });
      });

      // Get all select dropdowns
      document.querySelectorAll('select').forEach(select => {
        const options = Array.from(select.options).map(o => o.text);
        fields.push({
          type: 'select',
          name: select.name || select.id,
          selector: getUniqueSelector(select),
          label: getFieldLabel(select),
          options,
        });
      });

      // Get buttons
      document.querySelectorAll('button, input[type="submit"]').forEach(btn => {
        if (btn.textContent.trim() || btn.value) {
          fields.push({
            type: 'button',
            name: btn.textContent.trim() || btn.value,
            selector: getUniqueSelector(btn),
            label: btn.textContent.trim() || btn.value,
          });
        }
      });

      return fields;

      // Utility function to escape special CSS characters
      function escapeSelector(str) {
        return str.replace(/[!"#$%&'()*+,./:;?@\[\\\]^`{|}~]/g, '\\$&');
      }

      // Utility functions for selector generation
      function getUniqueSelector(element) {
        if (element.id) {
          return `#${escapeSelector(element.id)}`;
        }
        if (element.name) {
          const escaped = escapeSelector(element.name);
          return `[name="${escaped}"]`;
        }
        if (element.className) {
          const firstClass = element.className.split(' ')[0];
          return `.${escapeSelector(firstClass)}`;
        }
        
        // Fallback: nth-of-type
        let index = 0;
        let sibling = element;
        while ((sibling = sibling.previousElementSibling)) {
          if (sibling.tagName === element.tagName) index++;
        }
        return `${element.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
      }

      function getFieldLabel(element) {
        // Check for label element
        const labels = document.querySelectorAll(`label[for="${element.id}"]`);
        if (labels.length > 0) {
          return labels[0].textContent.trim();
        }
        
        // Check parent for label
        let parent = element.parentElement;
        while (parent) {
          const parentLabel = parent.textContent.substring(0, 50);
          if (parentLabel.toLowerCase().includes('location') || 
              parentLabel.toLowerCase().includes('type') ||
              parentLabel.toLowerCase().includes('level') ||
              parentLabel.toLowerCase().includes('experience')) {
            return parentLabel;
          }
          parent = parent.parentElement;
        }
        
        return element.placeholder || element.label || '';
      }
    });

    if (formFields.length === 0) {
      console.log('    ✓ No interactive forms found (extraction-only page)');
      return null;
    }

    console.log(`    ✓ Detected ${formFields.length} form fields`);
    return formFields;
  } catch (error) {
    console.warn(`    ⚠ Form analysis failed: ${error.message}`);
    return null;
  }
}

/**
 * Use Claude to understand form semantics and generate fill strategy
 */
async function generateFillStrategy(formFields, profile) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    console.log('    → Claude analyzing form semantics...');

    const prompt = `You are analyzing a job search form. Match form fields to profile criteria.

PROFILE:
- Country: ${profile.country || 'not specified'}
- Job Types: ${(profile.job_types || []).join(', ') || 'any'}
- Target Level: ${profile.seniority_level || 'any'}

FORM FIELDS:
${JSON.stringify(formFields, null, 2)}

For each field that matches profile criteria, suggest what to fill:
- Return ONLY valid JSON
- Only include fields you can confidently match
- For selects, choose from available options that match profile

RESPONSE FORMAT:
{
  "fill_strategy": [
    {
      "field_name": "location",
      "selector": "[name='location']",
      "value": "Netherlands",
      "reason": "Matches profile country"
    }
  ],
  "submit_button": "Search",
  "confidence": 0.9
}`;

    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: prompt,
      }],
    });

    const content = response.content[0].type === 'text' ? response.content[0].text : '';
    const strategy = JSON.parse(content);

    console.log(`    ✓ Generated fill strategy (${strategy.fill_strategy?.length || 0} fields)`);
    return strategy;
  } catch (error) {
    console.warn(`    ⚠ Strategy generation failed: ${error.message}`);
    return null;
  }
}

/**
 * Execute fill strategy with proper delays
 */
async function executeFillStrategy(page, strategy) {
  if (!strategy || !strategy.fill_strategy) return false;

  try {
    console.log(`    → Filling ${strategy.fill_strategy.length} form fields...`);

    for (const field of strategy.fill_strategy) {
      try {
        const selector = field.selector;
        
        // Wait for field to be visible
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.locator(selector).scrollIntoViewIfNeeded();
        
        // Fill field
        if (field.selector.includes('select')) {
          // Select dropdown
          await page.selectOption(selector, field.value);
        } else {
          // Text input
          await page.fill(selector, field.value);
        }

        console.log(`      ✓ Filled: ${field.field_name} = "${field.value}"`);
        
        // Delay between interactions (user-like behavior)
        await page.waitForTimeout(INTERACTION_DELAYS.AFTER_INPUT_FILL);
      } catch (error) {
        console.warn(`      ⚠ Failed to fill ${field.field_name}: ${error.message}`);
        // Continue with other fields
      }

      // Delay between fields
      await page.waitForTimeout(INTERACTION_DELAYS.BETWEEN_INTERACTIONS);
    }

    return true;
  } catch (error) {
    console.error(`    ✗ Fill strategy execution failed: ${error.message}`);
    return false;
  }
}

/**
 * Find and click the search/apply/submit button
 */
async function clickSearchButton(page, buttonSelector) {
  try {
    console.log('    → Searching for submit button...');

    let selector = buttonSelector;
    
    if (!selector) {
      // Auto-detect common button selectors
      const commonSelectors = [
        'button:has-text("Search")',
        'button:has-text("Find")',
        'button:has-text("Apply")',
        'input[type="submit"]',
        'button[type="submit"]',
        'button.btn-primary',
      ];

      for (const sel of commonSelectors) {
        if (await page.isVisible(sel).catch(() => false)) {
          selector = sel;
          break;
        }
      }
    }

    if (!selector) {
      console.warn('    ⚠ No submit button found');
      return false;
    }

    console.log(`    → Clicking search button: ${selector}`);
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.click(selector);

    // Wait for page navigation/content update
    await page.waitForTimeout(INTERACTION_DELAYS.AFTER_CLICK);
    
    // Wait for job listings to potentially load
    await waitForJobListings(page);

    console.log('    ✓ Page navigated after search');
    return true;
  } catch (error) {
    console.error(`    ✗ Button click failed: ${error.message}`);
    return false;
  }
}

/**
 * Wait intelligently for job listings to load
 */
async function waitForJobListings(page) {
  try {
    // Try common job listing selectors
    const selectors = [
      '.job-item',
      '[data-qa="job"]',
      '[data-test="job-posting"]',
      'li.job',
      'div.position',
      'article.job-listing',
    ];

    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 }).catch(() => null);
        if (await page.isVisible(selector).catch(() => false)) {
          console.log('    ✓ Job listings detected');
          await page.waitForTimeout(INTERACTION_DELAYS.AFTER_PAGE_LOAD);
          return;
        }
      } catch (e) {
        // Try next selector
      }
    }

    // Generic wait for content update
    await page.waitForTimeout(INTERACTION_DELAYS.AFTER_PAGE_LOAD);
  } catch (error) {
    console.warn(`    ⚠ Job listing wait failed: ${error.message}`);
  }
}

/**
 * Detect if pagination exists and return next page action
 */
async function detectPaginationControl(page, htmlContent) {
  try {
    console.log('    → Checking for pagination...');

    const paginationControls = await page.evaluate(() => {
      const controls = [];

      // Look for next button
      const nextButtons = document.querySelectorAll(
        'a:has-text("Next"), button:has-text("Next"), a[rel="next"], button.next'
      );
      if (nextButtons.length > 0 && !nextButtons[0].disabled) {
        controls.push({
          type: 'next_button',
          visible: true,
          selector: getSelector(nextButtons[0]),
        });
      }

      // Look for page numbers
      const pageNumbers = document.querySelectorAll('a[aria-label*="Page"], .page-number, .pagination a');
      if (pageNumbers.length > 1) {
        const currentPage = Array.from(pageNumbers).find(p => p.className.includes('active'));
        const nextPage = currentPage ? currentPage.nextElementSibling : null;
        if (nextPage) {
          controls.push({
            type: 'page_number',
            visible: true,
            selector: getSelector(nextPage),
          });
        }
      }

      // Look for load more button
      const loadMore = document.querySelector('button:has-text("Load More"), button.load-more');
      if (loadMore) {
        controls.push({
          type: 'load_more',
          visible: !loadMore.disabled,
          selector: getSelector(loadMore),
        });
      }

      return controls;

      function getSelector(el) {
        return el.id ? `#${el.id}` : el.className ? `.${el.className.split(' ')[0]}` : 'button';
      }
    });

    if (paginationControls.length > 0) {
      console.log(`    ✓ Pagination found: ${JSON.stringify(paginationControls)}`);
      return paginationControls[0];
    }

    console.log('    ℹ No pagination - single page results');
    return null;
  } catch (error) {
    console.warn(`    ⚠ Pagination detection failed: ${error.message}`);
    return null;
  }
}

/**
 * Navigate to next page if pagination exists
 */
async function navigateToNextPage(page, paginationControl) {
  if (!paginationControl) return false;

  try {
    console.log(`    → Navigating to next page via ${paginationControl.type}...`);

    await page.locator(paginationControl.selector).scrollIntoViewIfNeeded();
    await page.click(paginationControl.selector);

    // Wait for new content
    await page.waitForTimeout(INTERACTION_DELAYS.AFTER_CLICK);
    await waitForJobListings(page);

    console.log('    ✓ Navigated to next page');
    return true;
  } catch (error) {
    console.error(`    ✗ Page navigation failed: ${error.message}`);
    return false;
  }
}

module.exports = {
  analyzePageForms,
  generateFillStrategy,
  executeFillStrategy,
  clickSearchButton,
  waitForJobListings,
  detectPaginationControl,
  navigateToNextPage,
  INTERACTION_DELAYS,
};
