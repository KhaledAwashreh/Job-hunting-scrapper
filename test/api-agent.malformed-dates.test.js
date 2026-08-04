// issue #54 (U4.1, Greenhouse/Lever half) — one malformed date in a feed must
// not discard every other job from the same company.
//
// scrapeGreenhouse and scrapeLever build publishDate with an unguarded
// `new Date(x).toISOString()` inside `.map()`. A single job whose
// updated_at/createdAt is unparseable throws `RangeError: Invalid time value`,
// which is only caught by the try/catch wrapping the whole request+map — so
// every valid job alongside it is lost.
//
// Since commit c18b95e (issue #38) that outer catch returns `null`, not `[]`,
// which makes this strictly worse than when it was first reported: the
// orchestrator reads `null` as "the API call failed" and falls through to the
// slow Firecrawl/Puppeteer path for a company whose API actually answered
// correctly.
//
// The RSS half of this finding was already fixed (see api-agent.rss.test.js,
// issue #33). This covers the two paths that were missed.
//
// axios.get is monkey-patched with an in-process fake — no real socket is ever
// opened and no real company API is ever contacted.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

// Skip the real inter-request rate limit so this suite runs fast. Must be set
// before requiring apiAgent (read at load time).
process.env.JOB_API_RATE_LIMIT_MS = '0';

const { scrapeGreenhouse, scrapeLever } = require('../src/agents/apiAgent');

describe('apiAgent — issue #54: a malformed date must not discard a company feed', () => {
  let originalGet;
  let originalConsoleLog, originalConsoleWarn, originalConsoleError;
  let payload;

  before(() => {
    originalGet = axios.get;
    axios.get = () => Promise.resolve(payload);

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
    payload = null;
  });

  describe('Greenhouse', () => {
    beforeEach(() => {
      payload = {
        data: {
          jobs: [
            {
              title: 'Java Backend Engineer',
              content: 'Build services.',
              updated_at: '2024-07-01T10:00:00Z',
              absolute_url: 'https://boards.greenhouse.io/acme/jobs/1',
              location: { name: 'Amsterdam, Netherlands' }
            },
            {
              title: 'Platform Engineer',
              content: 'Run platforms.',
              updated_at: 'Not A Real Date',
              absolute_url: 'https://boards.greenhouse.io/acme/jobs/2',
              location: { name: 'Dublin, Ireland' }
            },
            {
              title: 'AI Engineer',
              content: 'Train models.',
              updated_at: '2024-07-03T10:00:00Z',
              absolute_url: 'https://boards.greenhouse.io/acme/jobs/3',
              location: { name: 'Lisbon, Portugal' }
            }
          ]
        }
      };
    });

    test('the two jobs with valid dates survive a sibling with a malformed date', async () => {
      const jobs = await scrapeGreenhouse('acme');
      assert.ok(Array.isArray(jobs), 'a successful API call must not report failure');
      const titles = jobs.map((j) => j.title);
      assert.ok(titles.includes('Java Backend Engineer'));
      assert.ok(titles.includes('AI Engineer'));
    });

    test('the malformed-date job is kept, with an empty publishDate', async () => {
      const jobs = await scrapeGreenhouse('acme');
      const bad = jobs.find((j) => j.title === 'Platform Engineer');
      assert.ok(bad, 'the job itself is still usable — only its date is unparseable');
      assert.equal(bad.publishDate, '');
    });

    test('a malformed date is not reported to the orchestrator as a failed API call', async () => {
      const jobs = await scrapeGreenhouse('acme');
      assert.notEqual(jobs, null, 'null makes the orchestrator fall back to browser scraping');
    });

    test('valid updated_at values are still parsed to YYYY-MM-DD', async () => {
      const jobs = await scrapeGreenhouse('acme');
      const good = jobs.find((j) => j.title === 'Java Backend Engineer');
      assert.equal(good.publishDate, '2024-07-01');
    });
  });

  describe('Lever', () => {
    beforeEach(() => {
      payload = {
        data: [
          {
            text: 'Backend Engineer',
            content: { text: 'Build services.' },
            createdAt: 1719828000000,
            hostedUrl: 'https://jobs.lever.co/acme/1',
            categories: { location: 'Amsterdam, Netherlands' }
          },
          {
            text: 'Data Engineer',
            content: { text: 'Build pipelines.' },
            createdAt: 'Not A Real Date',
            hostedUrl: 'https://jobs.lever.co/acme/2',
            categories: { location: 'Madrid, Spain' }
          },
          {
            text: 'Site Reliability Engineer',
            content: { text: 'Keep it up.' },
            createdAt: 1719914400000,
            hostedUrl: 'https://jobs.lever.co/acme/3',
            categories: { location: 'Berlin, Germany' }
          }
        ]
      };
    });

    test('the two jobs with valid dates survive a sibling with a malformed date', async () => {
      const jobs = await scrapeLever('acme');
      assert.ok(Array.isArray(jobs), 'a successful API call must not report failure');
      const titles = jobs.map((j) => j.title);
      assert.ok(titles.includes('Backend Engineer'));
      assert.ok(titles.includes('Site Reliability Engineer'));
    });

    test('the malformed-date job is kept, with an empty publishDate', async () => {
      const jobs = await scrapeLever('acme');
      const bad = jobs.find((j) => j.title === 'Data Engineer');
      assert.ok(bad, 'the job itself is still usable — only its date is unparseable');
      assert.equal(bad.publishDate, '');
    });

    test('a malformed date is not reported to the orchestrator as a failed API call', async () => {
      const jobs = await scrapeLever('acme');
      assert.notEqual(jobs, null, 'null makes the orchestrator fall back to browser scraping');
    });

    test('valid createdAt values are still parsed to YYYY-MM-DD', async () => {
      const jobs = await scrapeLever('acme');
      const good = jobs.find((j) => j.title === 'Backend Engineer');
      assert.equal(good.publishDate, '2024-07-01');
    });
  });
});
