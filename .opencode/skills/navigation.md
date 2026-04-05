# Skill: Dynamic Content Navigation

## Purpose
Navigate complex, dynamically-loaded job sites with pagination, infinite scroll, and AJAX-loaded listings.

## When to Use
- Sites with "Load More" buttons
- Infinite scroll (LinkedIn, Twitter-style feeds)
- Multi-page results (page numbers at bottom)
- Pagination via URL parameters (`?page=1,2,3...`)
- AJAX-loaded job cards without page reload

## Techniques

### Detect Pagination Type
```js
// Check for pagination controls
const hasNextButton = await page.locator('a:has-text("Next")').isVisible();
const hasLoadMore = await page.locator('button:has-text("Load More")').isVisible();
const hasInfiniteScroll = await page.evaluate(() => {
  return window.getComputedStyle(document.body).overflowY === 'auto';
});
```

### Handle "Load More" Pattern
```js
let jobCount = 0;
while (jobCount < targetCount) {
  const loadMoreBtn = await page.locator('button:has-text("Load More")');
  if (!(await loadMoreBtn.isVisible())) break;
  
  await loadMoreBtn.click();
  await page.waitForTimeout(2000); // Wait for AJAX
  jobCount = await page.locator('.job-card').count();
}
```

### Handle Infinite Scroll
```js
async function scrollToLoadMore(page, maxScrolls = 10) {
  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(1500);
    
    const newCards = await page.locator('[data-qa="job-card"]').count();
    if (newCards < (i + 1) * 20) break; // No new items loaded
  }
}
```

### Handle URL-based Pagination
```js
const baseUrl = 'https://example.com/jobs';
for (let page = 1; page <= 5; page++) {
  const url = `${baseUrl}?page=${page}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  const jobs = await extractJobsFromPage(page);
  allJobs.push(...jobs);
  
  const hasNextPage = await page.locator('a[data-next]').isVisible();
  if (!hasNextPage) break;
}
```

## Error Handling
- If pagination button not found: assume single page, return all visible jobs
- If scroll doesn't load new items after 3 attempts: stop scrolling
- If timeout on AJAX load: retry with longer wait (5s max)

## Best Practices
✓ Add 1-2s delay between page loads to avoid rate limiting
✓ Check for "end of results" message before continuing
✓ Log pagination steps: `console.log(`Page ${i}: Found ${jobs.length} jobs`)`
✓ Set max limit (e.g., first 50 jobs) to avoid infinite loops
✓ Reuse page object across pages (don't create new browser per page)
