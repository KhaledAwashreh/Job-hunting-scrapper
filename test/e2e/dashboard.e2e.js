// E2E: the dashboard loads, navigates, and renders well-formed data.
//
// What these assert, per the agreed criteria: data extraction, scoring being
// present, components loading, navigation, and malformed markup. What they
// deliberately do NOT assert: that the UI looks good.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  startServer,
  findBrowser,
  realDbFingerprint,
  assertRealDbUntouched,
} = require('./helpers/harness');

const browserEnv = findBrowser();

describe('dashboard end-to-end', { skip: browserEnv.available ? false : browserEnv.reason }, () => {
  let server;
  let browser;
  let page;
  let consoleErrors;
  let failedRequests;
  let dbBefore;

  before(async () => {
    dbBefore = realDbFingerprint();
    server = await startServer();
    browser = await browserEnv.chromium.launch(browserEnv.launchOptions);
    page = await browser.newPage();

    consoleErrors = [];
    failedRequests = [];

    // A bare "Failed to load resource" console line carries no URL, so it can't
    // be triaged. Track the responses themselves and ignore only the favicon,
    // which this app genuinely does not ship.
    const IGNORED = /\/favicon\.ico$/;

    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      if (/Failed to load resource/.test(msg.text())) return; // covered by the response listener
      consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(`uncaught: ${err.message}`));
    page.on('response', res => {
      if (res.status() >= 400 && !IGNORED.test(res.url())) {
        failedRequests.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto(server.baseUrl, { waitUntil: 'networkidle' });
  });

  after(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop();
  });

  // --- isolation ---------------------------------------------------------

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('the server is running against the isolated temp database', async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.db_initialized, true);
    assert.match(server.dbPath, /jobhunter-e2e-/);
  });

  // --- components load ---------------------------------------------------

  test('all four tab panels are present', async () => {
    for (const name of ['positions', 'companies', 'profiles', 'runs']) {
      assert.equal(
        await page.locator(`[data-testid="panel-${name}"]`).count(), 1,
        `expected exactly one panel for "${name}"`
      );
      assert.equal(
        await page.locator(`[data-testid="tab-${name}"]`).count(), 1,
        `expected exactly one tab button for "${name}"`
      );
    }
  });

  test('exactly one panel is active at a time', async () => {
    const active = await page.locator('.tab-content.active').count();
    assert.equal(active, 1, 'exactly one tab panel should be active');
  });

  // --- navigation --------------------------------------------------------

  test('every tab navigates to its own panel', async () => {
    for (const name of ['companies', 'profiles', 'runs', 'positions']) {
      await page.locator(`[data-testid="tab-${name}"]`).click();
      await page.waitForFunction(
        n => document.querySelector(`[data-testid="panel-${n}"]`)?.classList.contains('active'),
        name
      );

      assert.equal(await page.locator('.tab-content.active').count(), 1,
        `clicking "${name}" should leave exactly one panel active`);
      const activeId = await page.locator('.tab-content.active').getAttribute('id');
      assert.equal(activeId, name, `clicking "${name}" should activate the "${name}" panel`);
    }
  });

  // --- the regression this suite exists to prevent -----------------------

  test('the country picker offers a full list, including Ireland and Portugal', async () => {
    await page.locator('[data-testid="tab-companies"]').click();
    await page.waitForSelector('[data-testid="countries-checkboxes"]');

    assert.equal(
      await page.locator('[data-testid="countries-error"]').count(), 0,
      'the country list should load without an error state'
    );

    const count = await page.locator('[data-testid="country-option"]').count();
    assert.ok(count > 200, `expected a full country list, got ${count} options`);

    for (const code of ['IE', 'PT', 'NL', 'ES']) {
      assert.equal(
        await page.locator(`[data-testid="country-option"][data-country-code="${code}"]`).count(), 1,
        `"${code}" must be selectable — it is one of the target countries`
      );
    }
  });

  test('a target country can actually be selected', async () => {
    await page.locator('[data-testid="tab-companies"]').click();
    await page.waitForSelector('[data-testid="countries-checkboxes"]');

    const ireland = page.locator('[data-country-code="IE"] input.country-checkbox');
    await ireland.check();
    assert.equal(await ireland.isChecked(), true, 'Ireland should be checkable');

    await page.waitForFunction(() =>
      /Selected: [1-9]/.test(document.querySelector('[data-testid="countries-count"]')?.textContent || '')
    );
    await ireland.uncheck();
  });

  // --- malformed markup --------------------------------------------------

  test('no undefined / NaN / [object Object] is rendered anywhere', async () => {
    for (const name of ['positions', 'companies', 'profiles', 'runs']) {
      await page.locator(`[data-testid="tab-${name}"]`).click();
      await page.waitForFunction(
        n => document.querySelector(`[data-testid="panel-${n}"]`)?.classList.contains('active'),
        name
      );

      const text = await page.locator(`[data-testid="panel-${name}"]`).innerText();
      for (const bad of ['undefined', 'NaN', '[object Object]', 'null']) {
        assert.ok(
          !text.includes(bad),
          `panel "${name}" renders the literal "${bad}" — a value reached the DOM unformatted:\n${text.slice(0, 400)}`
        );
      }
    }
  });

  test('the page does not scroll horizontally', async () => {
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert.ok(
      overflow.scrollWidth <= overflow.clientWidth + 1,
      `body scrolls sideways: scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`
    );
  });

  test('no uncaught errors or CSP violations in the console', () => {
    // This is the assertion that would have caught both the blocked countries
    // API and the "PositionsTab is not defined" load-order bug.
    assert.deepEqual(consoleErrors, [], `console reported errors:\n${consoleErrors.join('\n')}`);
  });

  test('every request the page makes succeeds', () => {
    assert.deepEqual(failedRequests, [], `requests failed:\n${failedRequests.join('\n')}`);
  });
});
