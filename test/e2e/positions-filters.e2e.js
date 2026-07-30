// Issue #11 / U1.3 — the top filter bar's #jobTypeFilter had a change handler
// that called loadPositions(), but loadPositions() never read its value, so
// selecting a job type had no effect on the rendered list.
//
// Issue #12 / U1.4 — #filterJobType, #filterLocation and #filterLevel
// (dashboard.html, second filter row) shipped with only a placeholder option
// and nothing ever populated them, so — even though their change handlers and
// renderPositions() filter predicate were already correct — the user could
// never select a real value.
//
// Both are exercised against test/e2e/helpers/seed-filters.js, a fixture with
// DIVERSE job_type/location_type/seniority_level values (unlike the shared
// seed.js fixture, which uses the same location_type/seniority_level for
// every position), so narrowing is actually observable.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { startServer, findBrowser, realDbFingerprint, assertRealDbUntouched } = require('./helpers/harness');
const { POSITIONS } = require('./helpers/seed-filters');

const SEED_SCRIPT = path.join(__dirname, 'helpers/seed-filters.js');
const browserEnv = findBrowser();

async function renderedTitles(page) {
  return (await page.locator('[data-testid="position-title"]').allInnerTexts()).map(t => t.trim());
}

async function optionValues(page, selector) {
  return page.locator(`${selector} option`).evaluateAll(opts => opts.map(o => o.value));
}

describe('job type / location / level filters actually filter (issues #11, #12)', { skip: browserEnv.available ? false : browserEnv.reason }, () => {
  let server;
  let browser;
  let page;
  let dbBefore;

  before(async () => {
    dbBefore = realDbFingerprint();
    server = await startServer({ seed: SEED_SCRIPT });
    browser = await browserEnv.chromium.launch(browserEnv.launchOptions);
    page = await browser.newPage();
    await page.goto(server.baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="position-row"]');
  });

  after(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop();
  });

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('sanity: all three seeded positions render before any filter is applied', async () => {
    const titles = await renderedTitles(page);
    assert.equal(titles.length, POSITIONS.length);
  });

  test('issue #11: selecting the top-bar #jobTypeFilter value narrows the rendered positions', async () => {
    const before_ = await renderedTitles(page);
    assert.equal(before_.length, 3, 'expected all 3 seeded positions before filtering');

    await page.selectOption('[data-testid="filter-job-type"]', 'Backend');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="position-row"]').length === 2);

    const after_ = await renderedTitles(page);
    assert.deepEqual(
      after_.sort(),
      ['Remote Backend Engineer', 'Remote Senior Backend Engineer'].sort(),
      'jobTypeFilter=Backend should keep only the two Backend positions'
    );

    await page.selectOption('[data-testid="filter-job-type"]', '');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="position-row"]').length === 3);
  });

  test('issue #12: #filterJobType, #filterLocation, #filterLevel are populated with real options after data loads', async () => {
    const jobTypeOptions = await optionValues(page, '#filterJobType');
    const locationOptions = await optionValues(page, '#filterLocation');
    const levelOptions = await optionValues(page, '#filterLevel');

    // Each select keeps its placeholder ('') plus the distinct seeded values.
    assert.deepEqual(jobTypeOptions.sort(), ['', 'Backend', 'Platform'].sort());
    assert.deepEqual(locationOptions.sort(), ['', 'Onsite', 'Remote'].sort());
    assert.deepEqual(levelOptions.sort(), ['', 'Mid', 'Senior'].sort());
  });

  test('issue #12: selecting #filterLocation narrows results correctly', async () => {
    await page.selectOption('#filterLocation', 'Remote');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="position-row"]').length === 2);

    const titles = (await renderedTitles(page)).sort();
    assert.deepEqual(titles, ['Remote Backend Engineer', 'Remote Senior Backend Engineer'].sort());

    await page.selectOption('#filterLocation', '');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="position-row"]').length === 3);
  });

  test('issue #12: selecting #filterLevel narrows results correctly', async () => {
    await page.selectOption('#filterLevel', 'Senior');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="position-row"]').length === 2);

    const titles = (await renderedTitles(page)).sort();
    assert.deepEqual(titles, ['Onsite Platform Engineer', 'Remote Senior Backend Engineer'].sort());

    await page.selectOption('#filterLevel', '');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="position-row"]').length === 3);
  });

  test('issue #12: selecting #filterJobType narrows results correctly', async () => {
    await page.selectOption('#filterJobType', 'Platform');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="position-row"]').length === 1);

    const titles = await renderedTitles(page);
    assert.deepEqual(titles, ['Onsite Platform Engineer']);

    await page.selectOption('#filterJobType', '');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="position-row"]').length === 3);
  });
});
