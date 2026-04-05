# Skill: Search & Filter Interaction

## Purpose
Interact with job site search forms, filters, and multi-select inputs to narrow job listings.

## When to Use
- Filling in job title/keyword search boxes
- Applying location/country filters
- Selecting seniority levels (Junior, Mid, Senior)
- Managing remote work preferences
- Filtering by date range, salary range
- Handling multi-select tech stacks

## Search & Input Patterns

### Text Input (Job Title/Keywords)
```js
async function searchJobs(page, keyword) {
  const input = await page.locator('[aria-label="Search"], input[type="search"], input[placeholder*="job"]').first();
  
  await input.fill(keyword);
  await page.waitForTimeout(500); // Debounce
  
  // Some sites auto-submit, others need Enter
  await input.press('Enter');
  await page.waitForNavigation({ timeout: 10000 }).catch(() => null);
}
```

### Select/Dropdown Filters
```js
async function selectFilter(page, filterLabel, value) {
  // Click filter button/label
  await page.locator(`label:has-text("${filterLabel}")`).click();
  
  // Select option
  const option = await page.locator(`[role="option"]:has-text("${value}")`);
  if (await option.isVisible()) {
    await option.click();
  } else {
    // Try checkbox
    await page.locator(`input[value="${value}"]`).check();
  }
  
  // Wait for filtered results
  await page.waitForSelector('[data-qa="job-result"], .job-card', { timeout: 5000 });
}
```

### Multi-Select Tech Stack
```js
async function selectTechStack(page, technologies) {
  // Open tech filter
  await page.locator('button:has-text("Technologies"), [aria-label*="tech"]').click();
  
  for (const tech of technologies) {
    const chip = await page.locator(`label:has-text("${tech}")`);
    if (await chip.isVisible()) {
      await chip.click();
    }
  }
  
  // Close and apply
  await page.locator('button:has-text("Apply"), button:has-text("Done")').click();
  await page.waitForTimeout(1000);
}
```

### Location/Country Filter
```js
async function filterByLocation(page, countries) {
  const locationFilter = await page.locator('[aria-label*="location"], label:has-text("Location")');
  await locationFilter.click();
  
  for (const country of countries) {
    const option = page.locator(`input[value="${country}"], label:has-text("${country}")`);
    await option.check();
  }
  
  await page.locator('button:has-text("Apply")').click({ timeout: 5000 }).catch(() => null);
  await page.waitForTimeout(1500);
}
```

### Date Range Filter
```js
async function filterByDate(page, daysAgo) {
  // Click date filter
  await page.locator('button:has-text("Posted"), [aria-label*="date"]').click();
  
  // Select "Last N days" option
  const option = await page.locator(`:has-text("Last ${daysAgo} days"), :has-text("${daysAgo} day")`);
  await option.click();
  
  await page.waitForTimeout(1000);
}
```

### Salary Range Filter
```js
async function filterBySalary(page, minSalary, maxSalary) {
  await page.locator('button:has-text("Salary")').click();
  
  // Fill min
  const minInput = page.locator('input[placeholder*="Min"]').first();
  await minInput.fill(String(minSalary));
  
  // Fill max
  const maxInput = page.locator('input[placeholder*="Max"]').last();
  await maxInput.fill(String(maxSalary));
  
  await page.locator('button:has-text("Apply")').click({ timeout: 5000 }).catch(() => null);
}
```

## Handling Filter States

```js
async function applyAllFilters(page, filters) {
  const errors = [];
  
  for (const [filterType, value] of Object.entries(filters)) {
    try {
      switch (filterType) {
        case 'keyword':
          await searchJobs(page, value);
          break;
        case 'country':
          await filterByLocation(page, [value]);
          break;
        case 'seniority':
          await selectFilter(page, 'Level', value);
          break;
        case 'remote':
          await selectFilter(page, 'Remote', value);
          break;
        default:
          console.warn(`Unknown filter: ${filterType}`);
      }
    } catch (e) {
      errors.push(`Failed to apply ${filterType}: ${e.message}`);
    }
  }
  
  return { success: errors.length === 0, errors };
}
```

## Clear Filters

```js
async function clearAllFilters(page) {
  const clearBtn = page.locator('button:has-text("Clear"), a:has-text("Reset")');
  if (await clearBtn.isVisible()) {
    await clearBtn.click();
    await page.waitForTimeout(1000);
  }
}
```

## Best Practices
✓ Add delays between filter changes (1-2s) to let site process filters
✓ Verify filters applied by checking result count changed
✓ Handle sites that don't update instantly (wait for results to change)
✓ Save filter state before applying to detect if change worked
✓ Log which filters were successfully applied vs. skipped
✓ Handle "no results" state gracefully
