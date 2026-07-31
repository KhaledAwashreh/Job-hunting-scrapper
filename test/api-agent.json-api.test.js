// scrapeJSONAPI — issues #34, #40, #42.
//
// axios.get is monkey-patched with an in-process fake that returns canned
// fixture responses keyed off the request URL/params — no real socket is
// ever opened and no real company API is ever contacted.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

// Skip the real 1000ms inter-request rate limit for this suite — several
// tests below exercise multi-page pagination. Must be set before requiring
// apiAgent so the module picks it up at load time.
process.env.JOB_API_RATE_LIMIT_MS = '0';

const { scrapeJSONAPI, extractCountry } = require('../src/agents/apiAgent');

const API_URL = 'https://careers.acme.example/api/jobs';

describe('scrapeJSONAPI', () => {
  let originalGet;
  let originalConsoleLog, originalConsoleWarn, originalConsoleError;
  let requests;
  let handler;

  before(() => {
    originalGet = axios.get;
    axios.get = (url, config) => {
      requests.push({ url, params: config && config.params });
      return Promise.resolve(handler(url, config));
    };

    // scrapeJSONAPI logs progress via console.log/warn/error on every call
    // (by design, for operators watching real scrape runs). Under the
    // `node:test` runner, that console output can race with the runner's
    // own IPC/TAP reporting channel and intermittently corrupt it ("Unable
    // to deserialize cloned data..."), which is a node:test flakiness
    // trigger unrelated to this suite's assertions. Silence it here — we
    // assert on return values, not log text.
    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
  });

  after(() => {
    axios.get = originalGet;
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  beforeEach(() => {
    requests = [];
    handler = () => ({ data: { data: [] }, headers: {} });
  });

  // --- issue #34: object-shaped location must not crash the batch --------

  describe('issue #34 — object-shaped `location` does not crash the batch', () => {
    test('extractCountry itself degrades safely instead of throwing', () => {
      assert.doesNotThrow(() => extractCountry({ city: 'Amsterdam', country: 'Netherlands' }));
      assert.equal(extractCountry({ city: 'Amsterdam', country: 'Netherlands' }), 'Netherlands');
      assert.equal(extractCountry({ name: 'Dublin, Ireland' }), 'Ireland');
      assert.equal(extractCountry({ city: 'Nowhereville' }), 'Nowhereville');
      assert.equal(extractCountry({}), '');
    });

    test('scrapeJSONAPI keeps the whole batch when one item has an object location', async () => {
      handler = () => ({
        data: {
          data: [
            { title: 'Backend Engineer', location: { city: 'Amsterdam', country: 'Netherlands' } },
            { title: 'Frontend Engineer', location: 'Dublin, Ireland' },
          ],
        },
        headers: {},
      });

      const jobs = await scrapeJSONAPI(API_URL, { name: 'Acme' });

      assert.equal(jobs.length, 2, 'neither job is dropped');
      const byTitle = Object.fromEntries(jobs.map(j => [j.title, j]));
      assert.equal(byTitle['Backend Engineer'].country, 'Netherlands');
      assert.equal(byTitle['Frontend Engineer'].country, 'Ireland');
    });
  });

  // --- issue #40: pagination -----------------------------------------------

  describe('issue #40 — pagination is followed instead of stopping at page 1', () => {
    test('nextPage/totalPages field: all pages are fetched and merged', async () => {
      // 5 pages of 10 items each = 50 items total, matching the issue repro.
      const totalPages = 5;
      const perPage = 10;

      handler = (url, config) => {
        const page = (config && config.params && config.params.page) || 1;
        const items = Array.from({ length: perPage }, (_, i) => ({ title: `Job p${page}-${i}` }));
        return {
          data: { data: items, page, totalPages, nextPage: page < totalPages ? page + 1 : null },
          headers: {},
        };
      };

      const jobs = await scrapeJSONAPI(API_URL, { name: 'Acme' });

      assert.equal(jobs.length, totalPages * perPage, 'items from every page are collected');
      assert.equal(requests.length, totalPages, 'one HTTP request was issued per page');
    });

    test('a single-page response (no pagination fields) issues exactly one request', async () => {
      handler = () => ({ data: { data: [{ title: 'Only Job' }] }, headers: {} });

      const jobs = await scrapeJSONAPI(API_URL, { name: 'Acme' });

      assert.equal(jobs.length, 1);
      assert.equal(requests.length, 1);
    });

    test('pagination is capped so a runaway nextPage cannot loop forever', async () => {
      // Server always claims there's a next page — the cap must stop us anyway.
      handler = (url, config) => {
        const page = (config && config.params && config.params.page) || 1;
        return { data: { data: [{ title: `Job ${page}` }], nextPage: page + 1 }, headers: {} };
      };

      const jobs = await scrapeJSONAPI(API_URL, { name: 'Acme' });

      assert.ok(requests.length <= 20, `expected the page-count cap to hold, got ${requests.length} requests`);
      assert.equal(jobs.length, requests.length);
    });

    test('a Link: rel="next" response header is followed', async () => {
      handler = (url) => {
        if (url === API_URL) {
          return {
            data: { data: [{ title: 'Page 1 Job' }] },
            headers: { link: `<${API_URL}?cursor=abc>; rel="next"` },
          };
        }
        return { data: { data: [{ title: 'Page 2 Job' }] }, headers: {} };
      };

      const jobs = await scrapeJSONAPI(API_URL, { name: 'Acme' });

      assert.equal(jobs.length, 2);
      assert.equal(requests.length, 2);
      assert.equal(requests[1].url, `${API_URL}?cursor=abc`);
    });
  });

  // --- issue #42: relative link resolution ---------------------------------

  describe('issue #42 — relative job links are resolved to absolute URLs', () => {
    test('a relative link is resolved against the company career_url', async () => {
      handler = () => ({
        data: { data: [{ title: 'Data Engineer', link: '/careers/data-engineer-123' }] },
        headers: {},
      });

      const jobs = await scrapeJSONAPI(API_URL, {
        name: 'Acme',
        career_url: 'https://careers.acme.example/jobs',
      });

      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].link, 'https://careers.acme.example/careers/data-engineer-123');
    });

    test('an already-absolute link is left untouched', async () => {
      handler = () => ({
        data: { data: [{ title: 'Data Engineer', link: 'https://other-host.example/jobs/9' }] },
        headers: {},
      });

      const jobs = await scrapeJSONAPI(API_URL, {
        name: 'Acme',
        career_url: 'https://careers.acme.example/jobs',
      });

      assert.equal(jobs[0].link, 'https://other-host.example/jobs/9');
    });

    test('with no career_url/api_url available, falls back to resolving against the API URL', async () => {
      handler = () => ({
        data: { data: [{ title: 'Data Engineer', link: '/careers/data-engineer-123' }] },
        headers: {},
      });

      const jobs = await scrapeJSONAPI(API_URL, { name: 'Acme' });

      assert.equal(jobs[0].link, 'https://careers.acme.example/careers/data-engineer-123');
    });
  });
});
