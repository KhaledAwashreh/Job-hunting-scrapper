// issue #35 — Puppeteer fallback assigned the career-listing page's own URL
// as a job's `link` whenever no `<a>` anchor was found for that job card.
// That value feeds both the UI's "View" link and the dedup hash, so
// multiple link-less jobs from the same listing page could end up pointing
// at the wrong page and, if they also shared title/description, collide in
// dedup. Fix: fall back to '' (matches this file's own convention
// elsewhere, e.g. scrapeWithFirecrawlAgent's `link: job.link || ''`)
// instead of the listing `url`.
//
// issue #36 — after extracting jobs from the listing page, the Puppeteer
// path visits each job's detail URL to refine the title/description, but
// never checked the HTTP response status of that navigation. A 404 (or any
// other non-2xx) detail page still resolves normally from `page.goto()` —
// it doesn't throw — so its error-page `<title>` (e.g. "Page Not Found")
// silently overwrote the correct listing-page title. Fix: capture the
// `page.goto()` response and skip the title/description overwrite unless
// the response status is 2xx.
//
// issue #39 — `tryDirectAPIScrape` had its own naive regex-based slug
// detection for Greenhouse/Lever career URLs, duplicating (badly) logic
// already fixed correctly in apiAgent.js's `detectGreenhouseSlug` /
// `detectLeverSlug`. The naive regexes mis-extract the slug for the
// `{slug}.boards.greenhouse.io` (no path) and `api.lever.co/v0/postings/
// {slug}` URL shapes — both common in this codebase's company list — which
// silently defeated the fast/free Direct API strategy for exactly those
// shapes. Fix: reuse the already-exported, already-correct apiAgent
// functions instead of a third copy of the regex.
//
// No real browser is ever launched: `puppeteer` is replaced in
// `require.cache` with an in-process fake *before* webScrapingAgent.js is
// first required, so `require('puppeteer')` inside it resolves to the fake.
// No real network calls are made either — apiAgent's scrape functions are
// monkey-patched per-test.

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// --- Fake puppeteer, injected before webScrapingAgent.js's top-level
// `require('puppeteer')` runs. -----------------------------------------------

const puppeteerPath = require.resolve('puppeteer');

let gotoLog;
let pageEvalQueue;
let currentUrl;
let pageContentByUrl;
let statusByUrl;

const fakePage = {
  setUserAgent: async () => {},
  goto: async (url) => {
    currentUrl = url;
    gotoLog.push(url);
    const status = Object.prototype.hasOwnProperty.call(statusByUrl, url) ? statusByUrl[url] : 200;
    return { status: () => status };
  },
  evaluate: async () => pageEvalQueue.shift(),
  content: async () => pageContentByUrl[currentUrl] || '<html><head></head><body></body></html>',
};

const fakeBrowser = {
  newPage: async () => fakePage,
  close: async () => {},
};

require.cache[puppeteerPath] = {
  id: puppeteerPath,
  filename: puppeteerPath,
  loaded: true,
  exports: { launch: async () => fakeBrowser },
};

const { scrapeWebsite } = require('../src/agents/webScrapingAgent');
const apiAgent = require('../src/agents/apiAgent');

describe('webScrapingAgent — issues #35, #36, #39', () => {
  let originalConsoleLog, originalConsoleWarn, originalSetTimeout;

  before(() => {
    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};

    // The real code paces itself with real setTimeout delays (scroll waits,
    // detail-page settle time). Collapse those to 0 so this suite runs fast;
    // nothing under test depends on real wall-clock time.
    originalSetTimeout = global.setTimeout;
    global.setTimeout = (fn, _ms, ...args) => originalSetTimeout(fn, 0, ...args);

    // Deterministic strategy path: force Strategy 0 (Direct API) / Strategy 3
    // (Puppeteer) regardless of the local environment.
    delete process.env.FIRECRAWL_API_KEY;
  });

  after(() => {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    global.setTimeout = originalSetTimeout;
  });

  beforeEach(() => {
    gotoLog = [];
    pageEvalQueue = [];
    currentUrl = null;
    pageContentByUrl = {};
    statusByUrl = {};
  });

  describe('#35 and #36 — Puppeteer job extraction (scrapeWithPuppeteer via scrapeWebsite Strategy 3)', () => {
    const listingUrl = 'https://example.test/careers';

    beforeEach(() => {
      // 3 page.evaluate calls happen before extraction is checked: scroll to
      // bottom, scroll back to top, then the actual DOM-extraction call.
      pageEvalQueue = [
        undefined,
        undefined,
        [
          { title: 'Backend Engineer', link: 'https://example.test/jobs/1', containerText: 'Backend Engineer - great role' },
          { title: 'Frontend Engineer', link: 'https://example.test/jobs/2', containerText: 'Frontend Engineer - great role' },
          { title: 'Data Engineer', link: undefined, containerText: 'Data Engineer - no anchor found on this card' },
        ],
      ];

      statusByUrl = {
        [listingUrl]: 200,
        'https://example.test/jobs/1': 200,
        'https://example.test/jobs/2': 404,
      };

      pageContentByUrl = {
        'https://example.test/jobs/1':
          '<html><head><title>Backend Engineer II - Acme</title>' +
          '<meta name="description" content="Updated description from detail page"></head><body></body></html>',
        'https://example.test/jobs/2':
          '<html><head><title>404 Not Found - Careers</title></head><body></body></html>',
      };
    });

    test('a job card with no anchor gets link \'\' , not the listing page URL (#35)', async () => {
      const jobs = await scrapeWebsite(listingUrl, { name: 'Acme', country: 'NL' });

      const dataEngineer = jobs.find(j => j.title === 'Data Engineer');
      assert.ok(dataEngineer, 'expected the link-less job card to be present');
      assert.equal(dataEngineer.link, '', 'link-less job must get \'\' , not the listing URL');
      assert.notEqual(dataEngineer.link, listingUrl);
    });

    test('a 404 detail page does not overwrite the good listing-page title/description (#36)', async () => {
      const jobs = await scrapeWebsite(listingUrl, { name: 'Acme', country: 'NL' });

      const frontend = jobs.find(j => j.title.startsWith('Frontend'));
      assert.ok(frontend, 'expected the Frontend Engineer job to be present');
      assert.equal(frontend.title, 'Frontend Engineer', '404 page title must not overwrite the listing title');
      assert.equal(
        frontend.description,
        'Frontend Engineer - great role',
        '404 page must not overwrite the listing description either'
      );
    });

    test('a 200 detail page still refines the title/description as before (sanity: fix is not overly broad)', async () => {
      const jobs = await scrapeWebsite(listingUrl, { name: 'Acme', country: 'NL' });

      const backend = jobs.find(j => j.title.startsWith('Backend'));
      assert.ok(backend, 'expected the Backend Engineer job to be present');
      assert.equal(backend.title, 'Backend Engineer II - Acme');
      assert.equal(backend.description, 'Updated description from detail page');
    });

    test('all three job cards are still returned', async () => {
      const jobs = await scrapeWebsite(listingUrl, { name: 'Acme', country: 'NL' });
      assert.equal(jobs.length, 3);
    });
  });

  describe('#39 — tryDirectAPIScrape reuses apiAgent\'s slug detection (via scrapeWebsite Strategy 0)', () => {
    let originalScrapeGreenhouse, originalScrapeLever;

    before(() => {
      originalScrapeGreenhouse = apiAgent.scrapeGreenhouse;
      originalScrapeLever = apiAgent.scrapeLever;
    });

    afterEach(() => {
      apiAgent.scrapeGreenhouse = originalScrapeGreenhouse;
      apiAgent.scrapeLever = originalScrapeLever;
    });

    test('Greenhouse {slug}.boards.greenhouse.io (no path) resolves to the correct slug', async () => {
      let capturedSlug = null;
      apiAgent.scrapeGreenhouse = async (slug) => {
        capturedSlug = slug;
        return [{ title: 'Engineer', absolute_url: 'https://acme.boards.greenhouse.io/jobs/1' }];
      };

      const jobs = await scrapeWebsite('https://acme.boards.greenhouse.io/', null);

      assert.equal(capturedSlug, 'acme');
      assert.equal(jobs.length, 1);
    });

    test('Lever api.lever.co/v0/postings/{slug} resolves to "acme", not "v0"', async () => {
      let capturedSlug = null;
      apiAgent.scrapeLever = async (slug) => {
        capturedSlug = slug;
        return [{ title: 'Engineer', hostedUrl: 'https://jobs.lever.co/acme/1' }];
      };

      const jobs = await scrapeWebsite('https://api.lever.co/v0/postings/acme?mode=json', null);

      assert.equal(capturedSlug, 'acme');
      assert.equal(jobs.length, 1);
    });

    test('Lever fallback (detectLeverSlug returns null) still extracts a company name from the URL path', async () => {
      let capturedSlug = null;
      apiAgent.scrapeLever = async (slug) => {
        capturedSlug = slug;
        return [{ title: 'Engineer', hostedUrl: 'https://careers.example.com/apply/1' }];
      };

      const jobs = await scrapeWebsite('https://careers.example.com/lever.co/apply', null);

      assert.equal(capturedSlug, 'apply', 'the pre-existing path-based fallback must still work');
      assert.equal(jobs.length, 1);
    });
  });
});
