# Skill: Modal & Popup Handling

## Purpose
Interact with modals, popups, and overlays that display job details without navigating to a new page.

## When to Use
- Job details in modal windows (LinkedIn, internal recruiters)
- Expandable job cards
- Lightbox galleries of job posts
- Dialog boxes with "Apply" or "View Details" buttons
- Overlays that cover page content

## Modal Detection & Navigation

### Detect Modal Job Details
```js
async function isJobInModal(page) {
  const modal = page.locator('[role="dialog"], .modal, .popup, [class*="overlay"]').first();
  return await modal.isVisible();
}
```

### Open Job in Modal
```js
async function openJobModal(page, jobElement) {
  const button = jobElement.locator('button:has-text("View"), a:has-text("Details"), [data-qa="open-job"]');
  
  if (await button.isVisible()) {
    await button.click();
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    return true;
  }
  
  return false;
}
```

## Modal Content Extraction

### Extract from Modal
```js
async function extractJobFromModal(page) {
  const modal = page.locator('[role="dialog"], .modal').first();
  
  // Make sure modal is visible
  if (!(await modal.isVisible())) {
    throw new Error('Modal not visible');
  }
  
  const title = await modal.locator('h1, h2').first().textContent();
  const description = await modal.locator('[class*="description"], p').allTextContents().then(texts => texts.join('\n'));
  const link = await modal.locator('a[href*="job"], button:has-text("Apply")').getAttribute('href');
  
  return {
    title: title?.trim(),
    description: description.substring(0, 2000),
    link
  };
}
```

### Scroll Within Modal
```js
async function scrollModalContent(page) {
  const modal = page.locator('[role="dialog"] [class*="body"], .modal-content').first();
  
  await modal.evaluate(el => {
    el.scrollTop = el.scrollHeight;
  });
  
  await page.waitForTimeout(500);
}
```

## Modal Management

### Close Modal
```js
async function closeModal(page) {
  // Try Escape key first (universal)
  await page.press('Escape');
  await page.waitForTimeout(300);
  
  // Check if still open
  const modal = page.locator('[role="dialog"]');
  if (await modal.isVisible()) {
    // Try close button
    const closeBtn = modal.locator('button[aria-label="Close"], [class*="close"], button:first');
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    } else {
      // Click outside modal (on backdrop)
      const backdrop = page.locator('[class*="backdrop"], [class*="overlay"]');
      if (await backdrop.isVisible()) {
        await backdrop.click();
      }
    }
  }
  
  await page.waitForTimeout(300);
}
```

### Check Modal State
```js
async function isModalOpen(page) {
  const modal = page.locator('[role="dialog"], .modal');
  return await modal.first().isVisible();
}
```

## Workflow: Modal Job Processing

```js
async function processJobsInModals(page, jobLinks, maxJobs = 50) {
  const jobs = [];
  
  for (let i = 0; i < Math.min(jobLinks.length, maxJobs); i++) {
    try {
      const link = jobLinks[i];
      
      // Navigate to job (may open modal)
      await page.goto(link, { waitUntil: 'networkidle', timeout: 10000 });
      
      // Check if modal or detail page
      const inModal = await isJobInModal(page);
      
      let jobData;
      if (inModal) {
        jobData = await extractJobFromModal(page);
        await closeModal(page);
      } else {
        // Regular detail page
        jobData = await extractJobDetails(page);
      }
      
      if (jobData.title) {
        jobs.push(jobData);
        console.log(`[${i + 1}/${Math.min(jobLinks.length, maxJobs)}] Extracted: ${jobData.title}`);
      }
      
      await page.waitForTimeout(1000); // Rate limit
    } catch (error) {
      console.error(`Error processing job ${i}: ${error.message}`);
      await closeModal(page).catch(() => null);
    }
  }
  
  return jobs;
}
```

## Expanding Collapsible Sections

```js
async function expandallSections(page) {
  const expandBtns = page.locator('button[aria-expanded="false"]');
  const count = await expandBtns.count();
  
  for (let i = 0; i < count; i++) {
    const btn = expandBtns.nth(i);
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(300);
    }
  }
}
```

## Best Practices
✓ Always close modal before navigating to next job (prevent state buildup)
✓ Use Escape key as universal close method
✓ Verify modal is actually visible before extracting (not just in DOM)
✓ Handle "Apply" buttons separately—don't click them during scraping
✓ If modal blocks page interaction, click backdrop or use Escape
✓ Log modal operations for debugging: `console.log('Opened modal for job: ' + title)`
✓ Set timeout on modal wait (5s max)—some sites don't open modals
