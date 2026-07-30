// Issue #10 / U1.2 — Positions tab event listeners accumulate on every tab
// revisit, causing stale-response races.
//
// dashboard.html calls PositionsTab.init() on every Positions tab click, and
// the old init() called setupEventListeners() unconditionally, never removing
// prior listeners. Revisiting the tab N times stacked N extra change
// listeners on #statusFilter/#countryFilter/#jobTypeFilter, so a single later
// filter change fired one fetch per past visit (confirmed: 3 revisits + 1
// change = 4 fetches). Worse, loadPositions() applied whichever response
// landed last with no request-sequencing, so a slow response for an earlier
// filter selection could silently overwrite fresh data for a later one.
//
// This suite proves both are fixed: revisiting the tab no longer multiplies
// fetches for a subsequent filter change, and a stale/slow response can no
// longer clobber a fresher one even when two distinct filter changes race.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, findBrowser, realDbFingerprint, assertRealDbUntouched } = require('./helpers/harness');

const browserEnv = findBrowser();

describe('Positions tab listeners do not accumulate on revisit (issue #10)', { skip: browserEnv.available ? false : browserEnv.reason }, () => {
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

  test('revisiting the Positions tab 3x then changing a filter fires exactly one request for that change', async () => {
    for (let i = 0; i < 3; i++) {
      await page.click('[data-testid="tab-companies"]');
      await page.waitForFunction(() =>
        document.querySelector('[data-testid="panel-companies"]')?.classList.contains('active'));
      await page.click('[data-testid="tab-positions"]');
      await page.waitForFunction(() =>
        document.querySelector('[data-testid="panel-positions"]')?.classList.contains('active'));
      await page.waitForSelector('[data-testid="position-row"]');
    }

    let requestCount = 0;
    const onRequest = (req) => {
      if (req.method() === 'GET' && req.url().includes('/api/positions')) requestCount++;
    };
    page.on('request', onRequest);

    await page.selectOption('[data-testid="filter-status"]', 'new');
    // Give any (wrongly) accumulated duplicate listeners a chance to fire.
    await page.waitForTimeout(400);

    page.off('request', onRequest);
    assert.equal(
      requestCount, 1,
      `expected exactly one /api/positions request for a single filter change after 3 revisits, got ${requestCount}`
    );

    // Reset the filter so later tests in this file see the full seeded set.
    await page.selectOption('[data-testid="filter-status"]', '');
    await page.waitForSelector('[data-testid="position-row"]');
  });

  test('a stale slow response no longer overwrites a fresher one', async () => {
    await page.route('**/api/positions*', async (route) => {
      const url = new URL(route.request().url());
      const country = url.searchParams.get('country');
      if (country === 'Netherlands') {
        await new Promise(r => setTimeout(r, 600));
      } else if (country === 'Ireland') {
        await new Promise(r => setTimeout(r, 50));
      }
      await route.continue();
    });

    try {
      await page.selectOption('[data-testid="filter-country"]', 'Netherlands');
      await page.waitForTimeout(30); // fire the second, faster change before the first (slow) one resolves
      await page.selectOption('[data-testid="filter-country"]', 'Ireland');

      // Wait long enough for both in-flight requests, including the slow
      // Netherlands one, to have landed.
      await page.waitForTimeout(900);

      const countries = (await page.locator('[data-testid="position-country"]').allInnerTexts()).map(c => c.trim());
      const unique = [...new Set(countries)];

      assert.deepEqual(
        unique, ['Ireland'],
        `the user's last selection was Ireland; a stale, slower Netherlands response must not win. Got: ${JSON.stringify(unique)}`
      );
    } finally {
      await page.unroute('**/api/positions*');
      await page.selectOption('[data-testid="filter-country"]', '');
      await page.waitForSelector('[data-testid="position-row"]');
    }
  });
});
