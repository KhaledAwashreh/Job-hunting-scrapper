// issue #38 — scrapeByPlatform (and the scrapers it dispatches to) must not
// return `[]` for a transient API failure. `[]` is truthy in JS, so the
// orchestrator's `if (!jobs) { ...fall back to web scraping... }` check
// treats it exactly like a successful "genuinely zero jobs" scrape and skips
// the fallback entirely. The fix: a failed call returns `null` (falsy,
// distinguishable), while a successful call with zero results still returns
// `[]` (truthy, a legitimate "done, no jobs" answer).
//
// issue #43 — none of the scrapers retried a transient failure (network
// error, timeout, 5xx, 429) before giving up. The fix adds a small
// retry-with-backoff wrapper around the actual HTTP calls, but only for
// transient errors — a 4xx client error (bad slug, auth failure, ...) will
// fail identically on every retry, so it must fail fast instead of burning
// attempts.
//
// axios.get is monkey-patched with an in-process fake — no real socket is
// ever opened and no real company API is ever contacted.

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

// Skip the real inter-request rate limit and use tiny retry backoffs so this
// suite runs fast. Must be set before requiring apiAgent (read at load time).
process.env.JOB_API_RATE_LIMIT_MS = '0';
process.env.JOB_API_RETRY_ATTEMPTS = '3';
process.env.JOB_API_RETRY_BASE_DELAY_MS = '1';

const { scrapeGreenhouse, scrapeJSONAPI, scrapeByPlatform } = require('../src/agents/apiAgent');

function networkError(message = 'socket hang up') {
  // No `.response` at all — this is what axios throws for connection resets,
  // DNS failures and timeouts, distinct from an HTTP error status.
  return new Error(message);
}

function httpError(status, message) {
  const err = new Error(message || `Request failed with status code ${status}`);
  err.response = { status };
  return err;
}

describe('apiAgent — issues #38 and #43 (transient-failure signaling + retry)', () => {
  let originalGet;
  let originalConsoleLog, originalConsoleWarn, originalConsoleError;
  let requests;
  let handler;

  before(() => {
    originalGet = axios.get;
    axios.get = (url, config) => {
      requests.push({ url, config });
      const result = handler(url, config);
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    };

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
    handler = () => ({ data: { jobs: [] } });
  });

  // --- issue #38: failure vs. genuinely-empty-success must be distinguishable

  describe('issue #38 — failed call vs. genuinely empty successful call', () => {
    test('a network failure (retries exhausted) returns null, not []', async () => {
      handler = () => networkError();

      const jobs = await scrapeGreenhouse('any-slug');

      assert.equal(jobs, null, 'a failed call must signal failure distinguishably from []');
      assert.equal(requests.length, 3, 'all retry attempts were exhausted before giving up');
    });

    test('a genuinely successful call with zero results still returns [] (not null)', async () => {
      handler = () => ({ data: { jobs: [] } });

      const jobs = await scrapeGreenhouse('any-slug');

      assert.deepEqual(jobs, [], 'a successful empty result is still a successful result');
      assert.equal(requests.length, 1, 'no retries for a successful call');
    });

    test('scrapeByPlatform: custom api_url branch falls back (returns null) when the JSON API call fails', async () => {
      handler = () => networkError();

      const company = {
        name: 'Acme',
        career_url: 'https://careers.acme.example/jobs',
        platform: 'json_api',
        api_url: 'https://careers.acme.example/api/jobs',
      };

      const jobs = await scrapeByPlatform(company);

      assert.equal(jobs, null, 'orchestrator\'s `if (!jobs)` fallback must engage on a real failure');
    });

    test('scrapeByPlatform: custom api_url branch also normalizes a genuinely-empty success to null (matches the rest of the function)', async () => {
      handler = () => ({ data: { data: [] } });

      const company = {
        name: 'Acme',
        career_url: 'https://careers.acme.example/jobs',
        platform: 'json_api',
        api_url: 'https://careers.acme.example/api/jobs',
      };

      const jobs = await scrapeByPlatform(company);

      assert.equal(jobs, null);
    });

    test('scrapeByPlatform: custom api_url branch returns the jobs array when the call succeeds with results', async () => {
      handler = () => ({ data: { data: [{ title: 'Backend Engineer' }] } });

      const company = {
        name: 'Acme',
        career_url: 'https://careers.acme.example/jobs',
        platform: 'json_api',
        api_url: 'https://careers.acme.example/api/jobs',
      };

      const jobs = await scrapeByPlatform(company);

      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].title, 'Backend Engineer');
    });
  });

  // --- issue #43: retry with backoff, only for transient errors --------------

  describe('issue #43 — retry with backoff on transient failures only', () => {
    test('a transient failure that succeeds on the Nth retry eventually returns success data', async () => {
      let callCount = 0;
      handler = () => {
        callCount++;
        if (callCount < 3) return httpError(503, 'Service Unavailable');
        return { data: { jobs: [{ title: 'Platform Engineer', absolute_url: 'https://x/1' }] } };
      };

      const jobs = await scrapeGreenhouse('any-slug');

      assert.equal(callCount, 3, 'failed twice, succeeded on the 3rd attempt');
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].title, 'Platform Engineer');
    });

    test('a 429 is treated as transient and retried', async () => {
      let callCount = 0;
      handler = () => {
        callCount++;
        if (callCount < 2) return httpError(429, 'Too Many Requests');
        return { data: { jobs: [{ title: 'SRE', absolute_url: 'https://x/2' }] } };
      };

      const jobs = await scrapeGreenhouse('any-slug');

      assert.equal(callCount, 2);
      assert.equal(jobs.length, 1);
    });

    test('a 4xx client error (e.g. 404) fails fast — no retries, since retrying cannot help', async () => {
      handler = () => httpError(404, 'Not Found');

      const jobs = await scrapeGreenhouse('any-slug');

      assert.equal(jobs, null, 'still signals failure distinguishably from []');
      assert.equal(requests.length, 1, 'a non-transient 4xx must not be retried');
    });

    test('retry also applies to scrapeJSONAPI', async () => {
      let callCount = 0;
      handler = () => {
        callCount++;
        if (callCount < 3) return networkError('ECONNRESET');
        return { data: { data: [{ title: 'Data Engineer' }] }, headers: {} };
      };

      const jobs = await scrapeJSONAPI('https://careers.acme.example/api/jobs', { name: 'Acme' });

      assert.equal(callCount, 3);
      assert.equal(jobs.length, 1);
    });

    test('scrapeJSONAPI returns null (not []) once retries are exhausted on a persistent transient error', async () => {
      handler = () => httpError(500, 'Internal Server Error');

      const jobs = await scrapeJSONAPI('https://careers.acme.example/api/jobs', { name: 'Acme' });

      assert.equal(jobs, null);
      assert.equal(requests.length, 3);
    });
  });
});
