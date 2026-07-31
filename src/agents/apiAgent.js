const axios = require('axios');
const logger = require('../utils/logger');

// Rate limiting: minimum delay between API requests (ms). Overridable via env
// so tests exercising multi-page pagination don't have to burn real wall-clock
// time — production always gets the 1000ms default.
const API_RATE_LIMIT_MS = process.env.JOB_API_RATE_LIMIT_MS !== undefined
  ? Number(process.env.JOB_API_RATE_LIMIT_MS)
  : 1000;

// scrapeJSONAPI pagination: sane cap so a misbehaving/looping API can't cause
// an unbounded number of requests (issue #40).
const MAX_JSON_API_PAGES = 20;

// Retry/backoff for transient failures (issue #43). Overridable via env for
// tests, same pattern as API_RATE_LIMIT_MS above.
const RETRY_ATTEMPTS = process.env.JOB_API_RETRY_ATTEMPTS !== undefined
  ? Number(process.env.JOB_API_RETRY_ATTEMPTS)
  : 3;
const RETRY_BASE_DELAY_MS = process.env.JOB_API_RETRY_BASE_DELAY_MS !== undefined
  ? Number(process.env.JOB_API_RETRY_BASE_DELAY_MS)
  : 500;

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// A failure is "transient" (worth retrying) if it's a network-level error
// with no response at all (timeout, DNS failure, connection reset), a 5xx
// server error, or a 429 rate limit. Any other HTTP status (400, 401, 403,
// 404, ...) is a client error that will fail identically on every retry, so
// it's re-thrown immediately instead of burning attempts on it (issue #43).
function isTransientError(error) {
  if (!error.response) return true;
  const status = error.response.status;
  return status === 429 || status >= 500;
}

/**
 * Run a single network call (`fn`) with retry + exponential backoff on
 * transient failures (issue #43). Non-transient errors are re-thrown on the
 * first attempt. Once attempts are exhausted, the last error is re-thrown so
 * the caller's own try/catch can distinguish "the call failed" from
 * "the call succeeded with zero results" (issue #38).
 */
async function withRetry(fn, label) {
  let lastError;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === RETRY_ATTEMPTS) {
        throw error;
      }
      const backoffMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`  ⚠ Transient error${label ? ` (${label})` : ''}, retrying in ${backoffMs}ms (attempt ${attempt}/${RETRY_ATTEMPTS}): ${error.message}`);
      await delay(backoffMs);
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Platform auto-detection from career URL
// ---------------------------------------------------------------------------

/**
 * Extract the Greenhouse board slug from a career URL.
 * Supports:
 *   https://boards.greenhouse.io/{slug}
 *   https://{slug}.boards.greenhouse.io
 *   https://boards.greenhouse.io/{slug}/jobs
 *   https://careers.example.com (custom domain that points to Greenhouse)
 */
function detectGreenhouseSlug(url) {
  const u = new URL(url);
  // boards.greenhouse.io/{slug}
  const m1 = u.pathname.match(/^\/?(greenhouse\.io\/)?([^/]+)(?:\/|$)/);
  if (m1 && u.hostname.includes('greenhouse')) {
    return m1[2];
  }
  // {slug}.boards.greenhouse.io
  const m2 = u.hostname.match(/^(.+)\.boards\.greenhouse\.io$/);
  if (m2) return m2[1];
  return null;
}

/**
 * Extract the Lever board slug from a career URL.
 * Supports:
 *   https://jobs.lever.co/{slug}
 *   https://api.lever.co/v0/postings/{slug}
 *   https://{slug}.jobs.lever.co
 */
function detectLeverSlug(url) {
  const u = new URL(url);
  // api.lever.co/v0/postings/{slug} — most specific pattern, checked first so
  // it isn't shadowed by the generic first-path-segment match below (which
  // would otherwise grab "v0" off /v0/postings/{slug}).
  const m1 = u.pathname.match(/\/postings\/([^/?]+)/);
  if (m1) return m1[1];
  // {slug}.jobs.lever.co
  const m2 = u.hostname.match(/^(.+)\.jobs\.lever\.co$/);
  if (m2) return m2[1];
  // jobs.lever.co/{slug} — generic first-segment match. Deliberately scoped to
  // hostnames containing "jobs.lever" (not the broader "lever.co") so it never
  // fires for api.lever.co.
  const m3 = u.pathname.match(/^\/([^/]+)/);
  if (m3 && u.hostname.includes('jobs.lever')) {
    return m3[1];
  }
  return null;
}

/**
 * Detect if the URL points to a known platform and return the slug.
 */
function detectPlatformAndSlug(careerUrl) {
  const lower = careerUrl.toLowerCase();

  if (lower.includes('greenhouse.io') || lower.includes('boards.greenhouse')) {
    const slug = detectGreenhouseSlug(careerUrl);
    if (slug) return { platform: 'greenhouse', platform_slug: slug };
  }

  if (lower.includes('jobs.lever.co') || lower.includes('api.lever.co')) {
    const slug = detectLeverSlug(careerUrl);
    if (slug) return { platform: 'lever', platform_slug: slug };
  }

  if (lower.includes('myworkdayjobs') || lower.includes('workday.com') || lower.includes('wd5.myworkdayjobs')) {
    return { platform: 'workday', platform_slug: null };
  }

  if (lower.includes('apply.workable.com')) {
    const slug = new URL(careerUrl).pathname.split('/').filter(Boolean)[0];
    return { platform: 'workable', platform_slug: slug || null };
  }

  // Not a known standard platform
  return { platform: null, platform_slug: null };
}

// ---------------------------------------------------------------------------
// Standard ATS API scrapers
// ---------------------------------------------------------------------------

/**
 * Greenhouse API scraper.
 * GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 */
async function scrapeGreenhouse(slug) {
  try {
    await delay(API_RATE_LIMIT_MS);
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
    const response = await withRetry(() => axios.get(url, { timeout: 15000 }), 'Greenhouse');

    if (!response.data || !response.data.jobs) {
      console.warn(`  ⚠ Greenhouse API returned no jobs for slug "${slug}"`);
      return [];
    }

    return response.data.jobs.map(job => ({
      title: job.title || '',
      description: job.content || '',
      qualifications: extractQualifications(job.content),
      publishDate: job.updated_at ? new Date(job.updated_at).toISOString().split('T')[0] : '',
      link: job.absolute_url || '',
      country: extractCountry(job.location?.name) || ''
    })).filter(j => j.title);
  } catch (error) {
    // The request itself failed (network error, timeout, 5xx, 429 that
    // exhausted retries, ...) — return null, distinct from the `[]` above
    // (a successful call that genuinely found zero jobs), so callers can
    // tell "failed, maybe fall back / retry" from "succeeded, zero results"
    // (issue #38).
    console.error(`  ⚠ Greenhouse API error for ${slug}: ${error.message}`);
    logger.error(`Greenhouse API failed for ${slug}: ${error.stack || error.message}`);
    return null;
  }
}

/**
 * Lever API scraper.
 *
 * The public Lever API returns a **flat array** of postings:
 *   GET https://api.lever.co/v0/postings/{slug}?mode=json
 *   => [{ text, hostedUrl, createdAt, content: { text, ... }, ... }, ...]
 *
 * NOTE: The Lever API used to wrap this in { postings: [...] } but now
 * returns the array directly. Both formats are handled.
 */
async function scrapeLever(slug) {
  try {
    await delay(API_RATE_LIMIT_MS);
    const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
    const response = await withRetry(() => axios.get(url, { timeout: 15000 }), 'Lever');

    // Lever returns a flat array. Handle both formats:
    //   [{...}, {...}]                                    (current)
    //   { postings: [{...}, {...}] }                       (legacy/rare)
    //   { data: [{...}, {...}] }                           (alternative)
    let postings = null;

    if (Array.isArray(response.data)) {
      postings = response.data;
    } else if (Array.isArray(response.data.postings)) {
      postings = response.data.postings;
    } else if (Array.isArray(response.data.data)) {
      postings = response.data.data;
    }

    if (!postings || postings.length === 0) {
      console.warn(`  ⚠ Lever API returned no jobs for slug "${slug}"`);
      return [];
    }

    console.log(`  → Lever API returned ${postings.length} jobs`);

    return postings.map(job => ({
      title: job.text || job.title || '',
      description: (job.content?.text || job.description || '').substring(0, 2000),
      qualifications: extractQualifications(job.content?.text || job.description || ''),
      publishDate: job.createdAt ? new Date(job.createdAt).toISOString().split('T')[0] :
                   job.publishDate || '',
      link: job.hostedUrl || job.absolute_url || '',
      country: extractCountry(
        (job.locations?.[0]?.name) ||
        (job.categories?.location) ||
        (job.country) ||
        ''
      )
    })).filter(j => j.title);
  } catch (error) {
    // See scrapeGreenhouse above: null (call failed) is kept distinct from
    // the `[]` returned when the API genuinely has no postings (issue #38).
    console.error(`  ⚠ Lever API error for ${slug}: ${error.message}`);
    logger.error(`Lever API failed for ${slug}: ${error.stack || error.message}`);
    return null;
  }
}

/**
 * Workable API scraper (limited).
 * Workable's public API doesn't expose per-company job listings easily,
 * but we try the account endpoint to find job board URLs.
 */
async function scrapeWorkable(slug) {
  try {
    await delay(API_RATE_LIMIT_MS);
    // Try Workable's public API
    const url = `https://apply.workable.com/api/v1/accounts/${slug}`;
    const response = await axios.get(url, { timeout: 10000 });
    // Account metadata only - doesn't return jobs directly.
    // Jobs require browser rendering of the SPA.
    console.log(`  → Workable account found for "${slug}", but jobs require browser rendering`);
    return null; // Signal fallback
  } catch (error) {
    // Not an error - just means Workable API can't serve jobs directly
    return null;
  }
}

/**
 * Workday scraping is complex due to custom per-company URLs.
 * Returns null to trigger web scraping fallback.
 */
async function scrapeWorkday(company, careerUrl) {
  console.warn(`  ⚠ Workday scraping not implemented - falling back to web scraping: ${company}`);
  return null;
}

// ---------------------------------------------------------------------------
// RSS feed scraper (used by ING, Salesforce, and many enterprise ATS)
// ---------------------------------------------------------------------------

/**
 * Parse an RSS XML string into job objects.
 */
function parseRSSJobs(xmlText, baseUrl) {
  const jobs = [];

  // Extract each <item> block. Allow attributes on the opening tag (e.g. RSS 1.0/RDF
  // feeds use <item rdf:about="..."> instead of plain <item>).
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(xmlText)) !== null) {
    const itemXml = itemMatch[1];

    const getField = (tag) => {
      const m = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      if (!m) return '';
      let val = m[1].trim();
      // Strip CDATA if present
      val = val.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '').trim();
      return val;
    };

    const rawTitle = getField('title').replace(/<[^>]+>/g, '').trim();
    const title = rawTitle;
    if (!title) continue;

    let description = getField('description');
    // Strip HTML from description
    description = description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 2000);

    const link = getField('link') || baseUrl || '';
    const pubDate = getField('pubDate');
    // Guard per-item: a single malformed pubDate must not throw and discard the
    // whole feed (RangeError from toISOString() on an invalid date string).
    let publishDate = '';
    if (pubDate) {
      try {
        publishDate = new Date(pubDate).toISOString().split('T')[0];
      } catch (err) {
        publishDate = '';
      }
    }
    const category = getField('category');

    // Try to extract country/location from title (common in RSS: "Title - City, Country")
    let country = '';
    const locationMatch = title.match(/-\s*\(?([^)]+)\)?\s*$/);
    if (locationMatch) {
      country = extractCountry(locationMatch[1]);
    }

    jobs.push({
      title,
      description,
      qualifications: extractQualifications(description),
      publishDate,
      link,
      country: country || '',
      category
    });
  }

  return jobs;
}

/**
 * Scrape from an RSS feed URL.
 */
async function scrapeRSSFeed(rssUrl) {
  try {
    await delay(API_RATE_LIMIT_MS);
    console.log(`  → Fetching RSS feed: ${rssUrl}`);
    const response = await withRetry(() => axios.get(rssUrl, { timeout: 20000, responseType: 'text' }), 'RSS');
    const jobs = parseRSSJobs(response.data, rssUrl);
    console.log(`  → RSS feed returned ${jobs.length} jobs`);
    return jobs;
  } catch (error) {
    // null (call failed, retries exhausted) vs. an empty array from
    // parseRSSJobs (call succeeded, feed genuinely has zero items) — see
    // scrapeGreenhouse above (issue #38).
    console.error(`  ⚠ RSS feed error for ${rssUrl}: ${error.message}`);
    logger.error(`RSS feed failed: ${error.stack || error.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generic JSON API scraper (TomTom, custom Next.js APIs, etc.)
// ---------------------------------------------------------------------------

/**
 * Pull the job-items array out of a JSON API response body, regardless of
 * which of the supported shapes it used.
 */
function extractItemsArray(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.jobs)) return data.jobs;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.results)) return data.results;
  if (data && Array.isArray(data.postings)) return data.postings;
  return null;
}

/**
 * Look for a `Link: <url>; rel="next"` response header (standard REST
 * pagination convention). Returns an absolute URL to fetch next, or null.
 */
function getNextLinkFromHeader(headers, currentUrl) {
  const linkHeader = headers && (headers.link || headers.Link);
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
  if (!match) return null;
  try {
    return new URL(match[1], currentUrl).href;
  } catch {
    return null;
  }
}

/**
 * Look for page-number or cursor pagination fields in the response body
 * (e.g. `{ page: 1, totalPages: 5, nextPage: 2 }` or `{ nextCursor: '...' }`).
 * Returns query params to send on the next request, or null if the body
 * gives no indication there's another page.
 */
function getNextPageParams(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  if (data.nextPage) {
    return { page: data.nextPage };
  }

  if (Number.isFinite(data.page) && Number.isFinite(data.totalPages) && data.page < data.totalPages) {
    return { page: data.page + 1 };
  }

  const cursor = data.nextCursor || data.next_cursor || data.cursor;
  if (cursor) {
    return { cursor };
  }

  return null;
}

/**
 * Resolve a job's link against the company's career/API URL, the same way
 * webScrapingAgent.js resolves relative hrefs found in HTML. Custom JSON
 * APIs commonly return relative paths (e.g. "/careers/data-engineer-123"),
 * which are useless verbatim in the UI and dedup hashing (issue #42).
 */
function resolveJobLink(link, base) {
  if (!link) return '';
  if (!base) return link;
  try {
    return new URL(link, base).href;
  } catch {
    return link;
  }
}

/**
 * Scrape a JSON API endpoint that returns job listings.
 * Handles various response shapes:
 *   { jobs: [...] }
 *   { data: [...] }
 *   [...] (flat array)
 *   { results: [...] }
 *
 * Follows pagination if the response signals more pages are available, via
 * (checked in order) a `Link: rel="next"` header, a `nextPage`/`page`+
 * `totalPages` field, or a cursor field — capped at MAX_JSON_API_PAGES
 * requests so a misbehaving API can't cause unbounded fetching.
 */
async function scrapeJSONAPI(apiUrl, company) {
  const linkBase = company?.career_url || company?.api_url || apiUrl;
  try {
    let allItems = [];
    let fetchUrl = apiUrl;
    let fetchParams;
    let pageCount = 0;

    console.log(`  → Fetching JSON API: ${apiUrl}`);

    for (;;) {
      await delay(API_RATE_LIMIT_MS);

      const response = await withRetry(() => axios.get(fetchUrl, { timeout: 15000, params: fetchParams }), 'JSON API');
      pageCount++;

      const items = extractItemsArray(response.data);
      if (items && items.length > 0) {
        allItems = allItems.concat(items);
      }

      if (!items || items.length === 0 || pageCount >= MAX_JSON_API_PAGES) break;

      const nextLink = getNextLinkFromHeader(response.headers, fetchUrl);
      if (nextLink) {
        fetchUrl = nextLink;
        fetchParams = undefined;
        continue;
      }

      const nextPageParams = getNextPageParams(response.data);
      if (nextPageParams) {
        fetchUrl = apiUrl;
        fetchParams = nextPageParams;
        continue;
      }

      break;
    }

    if (allItems.length === 0) {
      console.warn(`  ⚠ JSON API returned no jobs for ${apiUrl}`);
      return [];
    }

    console.log(`  → JSON API returned ${allItems.length} items${pageCount > 1 ? ` across ${pageCount} pages` : ''}`);

    return allItems.map(item => ({
      title: item.title || item.job_title || item.name || item.text || '',
      description: truncate(
        (item.description || item.job_description || item.content?.text || item.content || ''), 2000),
      qualifications: extractQualifications(
        (item.qualifications || item.requirements || item.content?.text || item.description || '')),
      publishDate: formatDate(
        item.publishDate || item.published_at || item.createdAt || item.date || item.updated_at || ''),
      link: resolveJobLink(
        item.link || item.url || item.applicationLink || item.absolute_url || item.hostedUrl || item.job_url || '',
        linkBase),
      country: extractCountry(
        item.country || item.location || item.locations?.[0]?.name || item.categories?.location || company?.country || '')
    })).filter(j => j.title);
  } catch (error) {
    // null (call failed, retries exhausted) vs. an empty array above (call
    // succeeded, API genuinely returned zero items) — see scrapeGreenhouse
    // above (issue #38).
    console.error(`  ⚠ JSON API error for ${apiUrl}: ${error.message}`);
    logger.error(`JSON API failed for ${apiUrl}: ${error.stack || error.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orchestrator — main entry point
// ---------------------------------------------------------------------------

/**
 * Platform-specific scraping strategy definitions.
 * Maps platform names to scaper functions with auto-detected metadata.
 *
 * When adding a company via dashboard, the platform + career_url are used to
 * determine the best scraping strategy automatically.
 */
const PLATFORM_SCRAPERS = {
  greenhouse: { fn: (company) => scrapeGreenhouse(company.platform_slug),               needsSlug: true },
  lever:      { fn: (company) => scrapeLever(company.platform_slug),                    needsSlug: true },
  workday:    { fn: (company) => scrapeWorkday(company.name, company.career_url),       needsSlug: false },
  workable:   { fn: (company) => scrapeWorkable(company.platform_slug),                 needsSlug: true },
  rss:        { fn: (company) => scrapeRSSFeed(company.platform_slug),                  needsSlug: true },
  json_api:   { fn: (company) => scrapeJSONAPI(company.platform_slug, company),         needsSlug: true },
};

/**
 * Main entry point: scrape a company by platform.
 * 1. Extract platform + slug from the company object.
 * 2. Auto-detect platform from career URL if not explicitly set.
 * 3. Dispatch to the right scraper.
 * 4. Return null if no API scraper applies (triggers web scraping fallback).
 *
 * @param {object} company - { id, name, country, career_url, platform, platform_slug }
 * @returns {Promise<Array|null>} Array of jobs or null (fallback to web scraping)
 */
async function scrapeByPlatform(company) {
  if (!company || !company.career_url) {
    return null;
  }

  // Resolve platform and slug (explicit > auto-detected)
  let { platform, platform_slug } = company;

  if (!platform || platform === 'unknown' || platform === 'custom') {
    // Try auto-detection from URL
    const detected = detectPlatformAndSlug(company.career_url);
    if (detected.platform) {
      platform = detected.platform;
      platform_slug = platform_slug || detected.platform_slug;
      console.log(`  → Auto-detected platform: ${platform} (slug: ${platform_slug || 'none'})`);
    }
  }

  if (!platform || platform === 'unknown' || platform === 'custom') {
    console.log(`  → No API platform detected for ${company.name}, will use web scraping`);
    return null;
  }

  // Dispatch to platform-specific scraper
  const scraper = PLATFORM_SCRAPERS[platform];
  if (!scraper) {
    console.log(`  → Unknown platform "${platform}", falling back to web scraping`);
    return null;
  }

  // Some scrapers need a slug — if missing, try api_url as a fallback
  if (scraper.needsSlug && !platform_slug) {
    // If the platform needs a slug but we have an api_url, use it directly
    if (company.api_url) {
      console.log(`  → Using custom API URL for ${company.name}: ${company.api_url}`);
      // Normalized the same way as the scraper.fn() dispatch below (issue
      // #38): an empty/failed result — whether the call itself failed
      // (null) or genuinely found zero jobs ([]) — becomes null here so the
      // caller's `if (!jobs)` fallback-to-web-scraping check actually
      // engages instead of silently treating `[]` as a successful scrape.
      const jobs = platform === 'rss'
        ? await scrapeRSSFeed(company.api_url)
        : await scrapeJSONAPI(company.api_url, company);
      return (jobs && jobs.length > 0) ? jobs : null;
    }
    
    // Check if we need to try RSS-based scraping for known patterns
    // (ING, Salesforce, and many enterprise sites use RSS)
    const rssUrl = tryRSSScraping(company);
    if (rssUrl) {
      const jobs = await scrapeRSSFeed(rssUrl);
      if (jobs && jobs.length > 0) {
        return jobs;
      }
    }
    
    console.log(`  → Platform "${platform}" requires a slug but none found, falling back`);
    return null;
  }

  // Attach the platform_slug to the company for scrapers that need it
  company.platform_slug = platform_slug;

  console.log(`  → Using ${platform} API for ${company.name} (slug: ${platform_slug || 'none'})`);
  const jobs = await scraper.fn(company);

  if (jobs && jobs.length > 0) {
    return jobs;
  }

  // If API returned empty, try web scraping fallback
  console.log(`  → ${platform} API returned no jobs for ${company.name}, will fall back`);
  return null;
}

// ---------------------------------------------------------------------------
// RSS URL detection — tries common RSS patterns for known domains
// ---------------------------------------------------------------------------

/**
 * Try to discover an RSS feed for a company's career page.
 * Many enterprise ATS platforms expose RSS feeds at predictable URLs.
 */
function tryRSSScraping(company) {
  const url = company.career_url || '';
  const domain = url ? new URL(url).hostname : '';

  // Known RSS patterns per domain
  const rssPatterns = [
    { match: 'ing.jobs',              path: '/en/rss' },
    { match: 'careers.ing.com',        path: '/en/rss' },
    { match: 'salesforce.com',         path: '/en/jobs/xml/?rss=true' },
    { match: 'careers.salesforce.com', path: '/en/jobs/xml/?rss=true' },
    { match: 'ing.com',                path: '/en/rss' },
  ];

  for (const pattern of rssPatterns) {
    if (domain.includes(pattern.match)) {
      const origin = new URL(url).origin;
      return `${origin}${pattern.path}`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

function extractQualifications(text) {
  if (!text) return '';

  const qualLines = text.match(
    /(?:requirements|qualifications|must have|required|we're looking for|what you.*need|about you|your background)[\s\S]{0,800}?(?=\n\n|<br\s*\/?>|$)/gi
  ) || [];
  return qualLines.join('\n').replace(/<[^>]+>/g, '').substring(0, 800);
}

// Country names. Unlike the previous implementation, the order of these entries
// does not matter: keys are matched as whole tokens, longest key first.
const COUNTRY_NAMES = {
  'netherlands': 'Netherlands', 'the netherlands': 'Netherlands', 'holland': 'Netherlands',
  'spain': 'Spain', 'germany': 'Germany', 'uk': 'United Kingdom', 'u.k.': 'United Kingdom',
  'united kingdom': 'United Kingdom', 'great britain': 'United Kingdom', 'england': 'United Kingdom',
  'scotland': 'United Kingdom', 'wales': 'United Kingdom',
  'us': 'United States', 'usa': 'United States', 'united states': 'United States',
  'u.s.': 'United States', 'u.s.a.': 'United States',
  'france': 'France', 'canada': 'Canada', 'italy': 'Italy',
  'portugal': 'Portugal', 'belgium': 'Belgium', 'switzerland': 'Switzerland',
  'austria': 'Austria', 'sweden': 'Sweden', 'norway': 'Norway',
  'denmark': 'Denmark', 'finland': 'Finland', 'ireland': 'Ireland',
  'poland': 'Poland', 'greece': 'Greece', 'czech republic': 'Czech Republic',
  'czechia': 'Czech Republic', 'romania': 'Romania', 'hungary': 'Hungary',
  'luxembourg': 'Luxembourg', 'mexico': 'Mexico', 'brazil': 'Brazil', 'brasil': 'Brazil',
  'japan': 'Japan', 'south korea': 'South Korea', 'singapore': 'Singapore',
  'india': 'India', 'china': 'China', 'australia': 'Australia',
  'new zealand': 'New Zealand', 'uae': 'United Arab Emirates',
  'saudi arabia': 'Saudi Arabia', 'jordan': 'Jordan', 'lebanon': 'Lebanon',
  'israel': 'Israel', 'croatia': 'Croatia', 'slovenia': 'Slovenia',
  'slovakia': 'Slovakia', 'lithuania': 'Lithuania', 'latvia': 'Latvia',
  'estonia': 'Estonia', 'bulgaria': 'Bulgaria', 'cyprus': 'Cyprus', 'malta': 'Malta',
  'united arab emirates': 'United Arab Emirates',
};

// Cities, consulted only when no explicit country name is present.
const CITY_NAMES = {
  // Netherlands
  'amsterdam': 'Netherlands', 'rotterdam': 'Netherlands', 'eindhoven': 'Netherlands',
  'utrecht': 'Netherlands', 'the hague': 'Netherlands', 'den haag': 'Netherlands',
  'delft': 'Netherlands', 'groningen': 'Netherlands', 'hilversum': 'Netherlands',

  // Spain
  'barcelona': 'Spain', 'madrid': 'Spain', 'valencia': 'Spain', 'seville': 'Spain',
  'sevilla': 'Spain', 'malaga': 'Spain', 'bilbao': 'Spain', 'zaragoza': 'Spain',

  // Ireland
  'dublin': 'Ireland', 'cork': 'Ireland', 'galway': 'Ireland', 'limerick': 'Ireland',

  // Portugal
  'lisbon': 'Portugal', 'lisboa': 'Portugal', 'porto': 'Portugal',
  'braga': 'Portugal', 'coimbra': 'Portugal',

  // United States (non-EU hub, resolved deliberately rather than by accident)
  'chicago': 'United States', 'san francisco': 'United States', 'seattle': 'United States',
  'new york': 'United States', 'boston': 'United States', 'austin': 'United States',
  'denver': 'United States',

  // India (non-EU hub)
  'bengaluru': 'India', 'bangalore': 'India', 'hyderabad': 'India',
  'pune': 'India', 'mumbai': 'India', 'chennai': 'India',

  // Canada (non-EU hub)
  'toronto': 'Canada', 'vancouver': 'Canada', 'montreal': 'Canada', 'ottawa': 'Canada',

  // United Kingdom (non-EU hub)
  'london': 'United Kingdom', 'manchester': 'United Kingdom', 'edinburgh': 'United Kingdom',
  'cambridge': 'United Kingdom', 'bristol': 'United Kingdom',

  // Brazil (non-EU hub). "porto alegre" must beat the "porto" entry above; the
  // longest-key-first ordering below guarantees that without manual sequencing.
  'sao paulo': 'Brazil', 'são paulo': 'Brazil', 'porto alegre': 'Brazil',
  'sao jose dos campos': 'Brazil', 'são josé dos campos': 'Brazil',

  // Germany
  'berlin': 'Germany', 'munich': 'Germany', 'münchen': 'Germany',
  'hamburg': 'Germany', 'frankfurt': 'Germany', 'cologne': 'Germany',
};

// Two-letter USPS state codes, used only to disambiguate "City, XX" — see
// hasUsStateSuffix below for why the rule is deliberately narrow.
const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV',
  'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN',
  'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

function escapeForRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Match a key only as a whole token. `\b` is ASCII-only and would break keys
// like "münchen" and "são paulo", so the boundaries are Unicode letter/number
// lookarounds instead. This is the fix for the old `includes()` behaviour, where
// 'us' matched inside "Toulouse", "Aarhus" and even "Austria" itself — which
// made the 'austria' key unreachable dead code.
function wholeTokenRegex(key) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeForRegex(key)}(?![\\p{L}\\p{N}])`, 'iu');
}

// Longest key first, so a more specific key always wins over a prefix of it
// ("porto alegre" over "porto"). This is what lets the maps above be ordered
// for readability rather than for correctness.
function compileMap(map) {
  return Object.entries(map)
    .sort((a, b) => b[0].length - a[0].length)
    .map(([key, country]) => [wholeTokenRegex(key), country]);
}

// Compiled once at module load rather than on every call — extractCountry runs
// for every scraped job.
const COMPILED_COUNTRIES = compileMap(COUNTRY_NAMES);
const COMPILED_CITIES = compileMap(CITY_NAMES);

// True for "Cambridge, MA" but not for "Hybrid (Madrid or Buenos Aires)".
//
// The state code must be uppercase AND occupy the whole final comma-separated
// segment. Without both conditions this is actively harmful: OR, IN, ME, OK, DE
// and LA are state codes and ordinary English words, so a looser rule resolves
// "Madrid or Buenos Aires" to the United States.
function hasUsStateSuffix(locationText) {
  const segments = locationText.split(',').map(s => s.trim());
  if (segments.length < 2) return false;
  // Tolerate a trailing ZIP: "New York, NY 10001".
  const last = segments[segments.length - 1].replace(/\s+\d{5}(-\d{4})?$/, '');
  return US_STATE_CODES.has(last);
}

// Some JSON APIs return location as an object instead of a plain string
// (e.g. `{ city: 'Amsterdam', country: 'Netherlands' }`). extractCountry is
// called from several sites (Greenhouse/Lever/RSS already drill into `.name`
// first), and scrapeJSONAPI's response shape is inherently unpredictable, so
// the defensive coercion lives here once rather than at each call site.
function coerceLocationToString(locationText) {
  if (typeof locationText === 'string') return locationText;
  if (typeof locationText.name === 'string' && locationText.name) return locationText.name;
  if (locationText.city || locationText.state || locationText.country) {
    return [locationText.city, locationText.state, locationText.country].filter(Boolean).join(', ');
  }
  return '';
}

function extractCountry(locationText) {
  if (!locationText) return '';

  if (typeof locationText !== 'string') {
    locationText = coerceLocationToString(locationText);
    if (!locationText) return '';
  }

  // 1. An explicit country name always wins.
  for (const [regex, country] of COMPILED_COUNTRIES) {
    if (regex.test(locationText)) return country;
  }

  // 2. "City, ST" is a US location even when the city name is ambiguous.
  if (hasUsStateSuffix(locationText)) return 'United States';

  // 3. Otherwise fall back to the city map.
  for (const [regex, country] of COMPILED_CITIES) {
    if (regex.test(locationText)) return country;
  }

  // Unrecognised: hand the original text back, as before.
  return locationText;
}

function truncate(text, maxLen) {
  if (!text) return '';
  return text.substring(0, maxLen);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toISOString().split('T')[0];
  } catch {
    return dateStr;
  }
}

module.exports = {
  scrapeByPlatform,
  scrapeGreenhouse,
  scrapeLever,
  scrapeWorkable,
  scrapeRSSFeed,
  scrapeJSONAPI,
  extractQualifications,
  extractCountry,
  detectPlatformAndSlug,
  detectLeverSlug,
  detectGreenhouseSlug,
  parseRSSJobs,
  PLATFORM_SCRAPERS,
  // Exported so tests can assert that every key is reachable. The original bug
  // here was a key ('austria') that no input could ever reach, so that property
  // is worth checking against the real maps rather than a copy of them.
  COUNTRY_NAMES,
  CITY_NAMES
};
