// Issue #13 — the Companies tab's country filter checkboxes carry ISO codes
// (value="IE", from /countries.json) but company.country is free text
// ("Ireland", entered via prompt()) — comparing the two directly never
// matched anything, so selecting a country hid every company instead of
// narrowing to matches. This was invisible to test/e2e/dashboard.e2e.js
// because it only asserted the checkbox toggles and the counter updates,
// never that the rendered table changes.
//
// Uses the shared seed.js fixture, which already has realistic free-text
// country data: 'Nimbus Data BV' / Netherlands and 'Shannon Systems' /
// Ireland — exactly the shape that reproduced the bug.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, findBrowser, realDbFingerprint, assertRealDbUntouched } = require('./helpers/harness');
const { COMPANIES } = require('./helpers/seed');

const browserEnv = findBrowser();

async function companyNames(page) {
  return page.locator('#companiesTableContainer table tbody tr td:first-child').allInnerTexts();
}

describe('Companies tab country filter actually filters (issue #13)', { skip: browserEnv.available ? false : browserEnv.reason }, () => {
  let server;
  let browser;
  let page;
  let dbBefore;

  before(async () => {
    dbBefore = realDbFingerprint();
    server = await startServer({ seed: true });
    browser = await browserEnv.chromium.launch(browserEnv.launchOptions);
    page = await browser.newPage();
    await page.goto(server.baseUrl, { waitUntil: 'networkidle' });
    await page.locator('[data-testid="tab-companies"]').click();
    await page.waitForSelector('[data-testid="countries-checkboxes"]');
    await page.waitForSelector('#companiesTableContainer table');
  });

  after(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop();
  });

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('sanity: both seeded companies render before any filter is applied', async () => {
    const names = (await companyNames(page)).sort();
    assert.deepEqual(names, COMPANIES.map(c => c.name).sort());
  });

  test('selecting "Ireland" narrows the table to the Irish company, not to nothing', async () => {
    const ireland = page.locator('[data-country-code="IE"] input.country-checkbox');
    await ireland.check();

    await page.waitForFunction(() =>
      document.querySelectorAll('#companiesTableContainer table tbody tr').length === 1
    );

    const names = await companyNames(page);
    assert.deepEqual(names, ['Shannon Systems'], 'only the Ireland-headquartered company should remain');

    await ireland.uncheck();
    await page.waitForFunction(() =>
      document.querySelectorAll('#companiesTableContainer table tbody tr').length === 2
    );
  });

  test('selecting "Netherlands" narrows the table to the Dutch company', async () => {
    const netherlands = page.locator('[data-country-code="NL"] input.country-checkbox');
    await netherlands.check();

    await page.waitForFunction(() =>
      document.querySelectorAll('#companiesTableContainer table tbody tr').length === 1
    );

    const names = await companyNames(page);
    assert.deepEqual(names, ['Nimbus Data BV']);

    await netherlands.uncheck();
    await page.waitForFunction(() =>
      document.querySelectorAll('#companiesTableContainer table tbody tr').length === 2
    );
  });

  test('selecting a country with no matching company shows the empty state, not a stale table', async () => {
    const portugal = page.locator('[data-country-code="PT"] input.country-checkbox');
    await portugal.check();

    await page.waitForSelector('#companiesTableContainer [data-testid="empty-state"]');
    assert.equal(await page.locator('#companiesTableContainer table').count(), 0);

    await portugal.uncheck();
    await page.waitForFunction(() =>
      document.querySelectorAll('#companiesTableContainer table tbody tr').length === 2
    );
  });
});
