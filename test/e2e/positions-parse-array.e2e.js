// A6 — positions-tab.js's parseArray() double-parses arrays the server already
// parsed. `src/db/queries.js` runs ensureArray() on location_type/seniority_level
// before the API responds, so the client receives real arrays. The old
// parseArray() ran JSON.parse() on them anyway: JSON.parse(["Remote"]) first
// stringifies the array to the bare word `Remote`, which is invalid JSON, so it
// throws and the catch silently returns []. That made the Location and Level
// columns render "—" for every row and made filterLocation/filterLevel unable to
// ever match anything.
//
// positions.e2e.js already proves title/company/country/link survive the round
// trip, but its only text-sanity check forbids the literal strings
// undefined/NaN/null — "—" is none of those, so it missed this bug. This file
// asserts the real seeded values are present, not merely that forbidden ones are
// absent.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, findBrowser } = require('./helpers/harness');
const { POSITIONS } = require('./helpers/seed');

const browserEnv = findBrowser();

describe('parseArray handles arrays the server already parsed', { skip: browserEnv.available ? false : browserEnv.reason }, () => {
  let server;
  let browser;
  let page;

  before(async () => {
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

  test('parseArray(["Remote"]) returns the array unchanged, not []', async () => {
    const result = await page.evaluate(() => PositionsTab.parseArray(['Remote']));
    assert.deepEqual(result, ['Remote']);
  });

  test('parseArray still parses the legacy JSON-string form', async () => {
    const result = await page.evaluate(() => PositionsTab.parseArray('["Remote"]'));
    assert.deepEqual(result, ['Remote']);
  });

  test('parseArray returns [] for null, undefined, empty string and garbage', async () => {
    const results = await page.evaluate(() => ([
      PositionsTab.parseArray(null),
      PositionsTab.parseArray(undefined),
      PositionsTab.parseArray(''),
      PositionsTab.parseArray('garbage'),
    ]));
    for (const r of results) assert.deepEqual(r, []);
  });

  test('every rendered row shows the real seeded Location and Level, not "—"', async () => {
    const rows = await page.locator('[data-testid="position-row"]').all();
    assert.equal(rows.length, POSITIONS.length, 'expected one row per seeded position');

    for (const row of rows) {
      const title = (await row.locator('[data-testid="position-title"]').innerText()).trim();
      const cells = await row.locator('td').allInnerTexts();
      // Column order from renderFlat: Score, Country, Company, Title, Job Type,
      // Location, Level, Link, Status, Actions.
      const location = cells[5].trim();
      const level = cells[6].trim();

      assert.equal(location, 'Remote', `"${title}" rendered Location as "${location}", expected the seeded "Remote"`);
      assert.equal(level, 'Mid', `"${title}" rendered Level as "${level}", expected the seeded "Mid"`);
    }
  });

  test('the filterLocation client-side filter matches real array data', async () => {
    // The <select id="filterLocation"> in dashboard.html is never populated with
    // options (a separate, out-of-scope gap), so drive the same code path the
    // change listener would: set the filter and re-render.
    const matchingCount = await page.evaluate(() => {
      PositionsTab.filterLocation = 'Remote';
      PositionsTab.renderPositions();
      PositionsTab.filterLocation = null;
      return document.querySelectorAll('[data-testid="position-row"]').length;
    });
    assert.equal(matchingCount, POSITIONS.length, 'filtering by the seeded "Remote" location should keep every row');

    const nonMatchingCount = await page.evaluate(() => {
      PositionsTab.filterLocation = 'Onsite';
      PositionsTab.renderPositions();
      const count = document.querySelectorAll('[data-testid="position-row"]').length;
      PositionsTab.filterLocation = null;
      PositionsTab.renderPositions();
      return count;
    });
    assert.equal(nonMatchingCount, 0, 'filtering by a location no position has should exclude every row');
  });

  test('the filterLevel client-side filter matches real array data', async () => {
    const matchingCount = await page.evaluate(() => {
      PositionsTab.filterLevel = 'Mid';
      PositionsTab.renderPositions();
      PositionsTab.filterLevel = null;
      return document.querySelectorAll('[data-testid="position-row"]').length;
    });
    assert.equal(matchingCount, POSITIONS.length, 'filtering by the seeded "Mid" level should keep every row');

    const nonMatchingCount = await page.evaluate(() => {
      PositionsTab.filterLevel = 'Senior';
      PositionsTab.renderPositions();
      const count = document.querySelectorAll('[data-testid="position-row"]').length;
      PositionsTab.filterLevel = null;
      PositionsTab.renderPositions();
      return count;
    });
    assert.equal(nonMatchingCount, 0, 'filtering by a level no position has should exclude every row');
  });
});
