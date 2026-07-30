const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { detectLeverSlug, detectGreenhouseSlug, detectPlatformAndSlug } = require('../src/agents/apiAgent');

// --- A2.1: api.lever.co URLs used to resolve to the wrong company ----------
//
// detectLeverSlug had a generic "first path segment" branch that matched any
// hostname containing "lever.co" — including api.lever.co — and returned
// before the dedicated /postings/{slug} branch was ever reached. So
// https://api.lever.co/v0/postings/acme resolved to slug "v0" instead of
// "acme", even though the function's own docstring lists that URL form as
// supported.

describe('detectLeverSlug — acceptance list from docs/review/confirmed/A2-scraper-slug.md', () => {
  test('https://jobs.lever.co/acme -> acme', () => {
    assert.equal(detectLeverSlug('https://jobs.lever.co/acme'), 'acme');
  });

  test('https://api.lever.co/v0/postings/acme?mode=json -> acme (previously "v0")', () => {
    assert.equal(detectLeverSlug('https://api.lever.co/v0/postings/acme?mode=json'), 'acme');
  });

  test('https://api.lever.co/v0/postings/acme -> acme (previously "v0")', () => {
    assert.equal(detectLeverSlug('https://api.lever.co/v0/postings/acme'), 'acme');
  });

  test('https://acme.jobs.lever.co -> acme (subdomain form)', () => {
    assert.equal(detectLeverSlug('https://acme.jobs.lever.co'), 'acme');
  });

  test('a non-Lever URL returns null', () => {
    assert.equal(detectLeverSlug('https://example.com/careers/acme'), null);
  });
});

describe('detectLeverSlug — additional shapes', () => {
  test('trailing slash on jobs.lever.co/{slug}/ still resolves', () => {
    assert.equal(detectLeverSlug('https://jobs.lever.co/acme/'), 'acme');
  });

  test('postings form wins even if a hostname superficially looks like jobs.lever.co in the path', () => {
    // Regression guard for the exact bug: the postings/{slug} branch must be
    // consulted before the generic first-path-segment branch, regardless of
    // what host-based condition gates the latter.
    assert.equal(detectLeverSlug('https://api.lever.co/v0/postings/jobs.lever.co'), 'jobs.lever.co');
  });
});

describe('detectPlatformAndSlug — end-to-end through the Lever branch', () => {
  test('api.lever.co postings URL resolves to platform lever, slug acme', () => {
    assert.deepEqual(
      detectPlatformAndSlug('https://api.lever.co/v0/postings/acme?mode=json'),
      { platform: 'lever', platform_slug: 'acme' }
    );
  });

  test('jobs.lever.co URL resolves to platform lever, slug acme', () => {
    assert.deepEqual(
      detectPlatformAndSlug('https://jobs.lever.co/acme'),
      { platform: 'lever', platform_slug: 'acme' }
    );
  });

  test('a non-Lever, non-Greenhouse, non-Workday, non-Workable URL returns nulls', () => {
    assert.deepEqual(
      detectPlatformAndSlug('https://example.com/careers'),
      { platform: null, platform_slug: null }
    );
  });
});

// --- Guard: detectGreenhouseSlug's own documented forms must be unaffected -
// This file only touches detectLeverSlug; these are a cheap safety net to
// confirm the sibling function's documented behaviour did not regress.

describe('detectGreenhouseSlug — documented forms unaffected by the Lever fix', () => {
  test('https://boards.greenhouse.io/acme -> acme', () => {
    assert.equal(detectGreenhouseSlug('https://boards.greenhouse.io/acme'), 'acme');
  });

  test('https://acme.boards.greenhouse.io -> acme', () => {
    assert.equal(detectGreenhouseSlug('https://acme.boards.greenhouse.io'), 'acme');
  });

  test('https://boards.greenhouse.io/acme/jobs -> acme', () => {
    assert.equal(detectGreenhouseSlug('https://boards.greenhouse.io/acme/jobs'), 'acme');
  });
});
