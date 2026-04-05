# Skill: Job Data Extraction

## Purpose
Extract job title, description, qualifications, salary, and metadata from job listing pages and detail pages.

## When to Use
- Parsing individual job cards on listing pages
- Extracting fields from job detail pages
- Handling different HTML structures (tables, divs, custom layouts)
- Cleaning and validating extracted text

## Standard Selectors by Site Type

### Common Patterns
```
Title:        <h1>, <h2>, [data-qa="job-title"], .job-title
Description:  <div class="description">, [role="main"], .job-body
Qualifications: Headers with "require", "qualif", "must have", "what we"
Salary:       [data-salary], text with $, €, £, "K" suffix
Location:     <span class="location">, [data-location], .job-location
Date:         <time>, [data-posted], .posted-date
```

## Extraction Patterns

### Title Extraction
```js
async function extractTitle(page) {
  const selectors = [
    'h1',
    'h2[class*="title"]',
    '[data-qa="job-title"]',
    '.job-title',
    '[itemprop="title"]'
  ];
  
  for (const selector of selectors) {
    const text = await page.locator(selector).first().textContent();
    if (text && text.trim().length > 3) return text.trim();
  }
  return '';
}
```

### Description Extraction
```js
async function extractDescription(page) {
  // Find largest text block (typically job description)
  const text = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('div[class*="desc"], section, [role="main"]'));
    return elements
      .map(el => el.textContent?.trim())
      .filter(t => t && t.length > 200)
      .sort((a, b) => b.length - a.length)[0] || '';
  });
  
  return text.substring(0, 2000); // Max 2000 chars
}
```

### Qualifications Extraction
```js
async function extractQualifications(page) {
  const text = await page.evaluate(() => {
    const keywords = ['require', 'qualif', 'must have', 'what we', 'skills', 'experience'];
    const elements = Array.from(document.querySelectorAll('*'));
    
    for (const el of elements) {
      const heading = el.querySelector('h2, h3, h4');
      if (heading && keywords.some(k => heading.textContent.toLowerCase().includes(k))) {
        return el.textContent;
      }
    }
    return '';
  });
  
  return text.substring(0, 1000);
}
```

### Salary Extraction
```js
async function extractSalary(page) {
  const text = await page.evaluate(() => {
    const salaryPatterns = /(\$|€|£)\s*(\d+[,\d]*)\s*(?:k|K)?/g;
    const pageText = document.body.textContent;
    const match = pageText.match(salaryPatterns);
    return match ? match[0] : '';
  });
  
  return text;
}
```

### Date Extraction
```js
async function extractPublishDate(page) {
  // Try <time> element first
  const timeEl = await page.locator('time').first().getAttribute('datetime');
  if (timeEl) return new Date(timeEl).toISOString().split('T')[0];
  
  // Fallback to text pattern
  const dateText = await page.evaluate(() => {
    const text = document.body.textContent;
    const datePattern = /(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*(\d{4})?/gi;
    const match = text.match(datePattern);
    return match ? match[0] : new Date().toISOString().split('T')[0];
  });
  
  return dateText;
}
```

## Data Validation

```js
function validateJobData(job) {
  return {
    valid: job.title?.length > 3 && job.link?.startsWith('http'),
    errors: [
      !job.title && 'Missing title',
      !job.link && 'Missing link',
      job.title?.length < 3 && 'Title too short',
      !job.description && 'Missing description'
    ].filter(Boolean)
  };
}
```

## Cleaning & Normalization

```js
function cleanText(text) {
  return text
    .replace(/&[a-z]+;/g, '') // Remove HTML entities
    .replace(/\s+/g, ' ')      // Normalize whitespace
    .trim();
}

function normalizeUrl(url, baseUrl) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return new URL(url, baseUrl).href;
}
```

## Best Practices
✓ Try multiple selectors—sites structure HTML differently
✓ Validate extracted data before storing
✓ Truncate long fields (2000 char max for descriptions)
✓ Handle missing fields gracefully (return empty string, not error)
✓ Log failed extractions for debugging: `console.log(`Failed to extract title from ${url}`)`
