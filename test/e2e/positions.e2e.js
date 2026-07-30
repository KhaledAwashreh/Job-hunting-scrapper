// E2E against a SEEDED isolated database.
//
// dashboard.e2e.js proves the shell loads and navigates on an empty database.
// This file proves that when data exists it actually reaches the screen intact —
// the "data extraction" and "scoring exists" concerns.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, findBrowser, realDbFingerprint, assertRealDbUntouched } = require('./helpers/harness');
const { POSITIONS, COMPANIES } = require('./helpers/seed');

const browserEnv = findBrowser();

describe('seeded data reaches the UI intact', { skip: browserEnv.available ? false : browserEnv.reason }, () => {
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

  test('the API returns every seeded position', async () => {
    const rows = await (await fetch(`${server.baseUrl}/api/positions`)).json();
    assert.equal(rows.length, POSITIONS.length);
  });

  test('every rendered row carries a title, company, country and link', async () => {
    const rows = await page.locator('[data-testid="position-row"]').all();
    assert.ok(rows.length > 0, 'expected at least one rendered position');

    for (const row of rows) {
      const title = (await row.locator('[data-testid="position-title"]').innerText()).trim();
      const company = (await row.locator('[data-testid="position-company"]').innerText()).trim();
      const country = (await row.locator('[data-testid="position-country"]').innerText()).trim();
      const href = await row.locator('[data-testid="position-link"]').getAttribute('href');

      assert.ok(title.length > 0, 'a position rendered with an empty title');
      assert.ok(company.length > 0 && company !== '—', `"${title}" rendered with no company`);
      assert.ok(country.length > 0 && country !== '—', `"${title}" rendered with no country`);
      assert.match(href || '', /^https?:\/\//, `"${title}" rendered a non-URL link: ${href}`);
    }
  });

  test('the seeded titles and companies are the ones displayed', async () => {
    const titles = await page.locator('[data-testid="position-title"]').allInnerTexts();
    const trimmed = titles.map(t => t.trim());
    for (const p of POSITIONS) {
      assert.ok(trimmed.includes(p.title), `"${p.title}" was seeded but is not on screen`);
    }

    const companies = (await page.locator('[data-testid="position-company"]').allInnerTexts()).map(c => c.trim());
    for (const c of COMPANIES) {
      assert.ok(companies.includes(c.name), `company "${c.name}" was seeded but is not on screen`);
    }
  });

  test('every position shows a score that is a number in range', async () => {
    const scores = await page.locator('[data-testid="position-score"]').allInnerTexts();
    assert.equal(scores.length, POSITIONS.length, 'every position should render a score');

    for (const raw of scores) {
      const text = raw.trim();
      assert.ok(!/undefined|NaN|null/.test(text), `a score rendered as "${text}"`);
      const n = Number(text);
      assert.ok(Number.isFinite(n), `score "${text}" is not a number`);
      assert.ok(n >= 0 && n <= 100, `score ${n} is outside 0-100`);
    }
  });

  test('the seeded countries survive the round trip', async () => {
    const shown = (await page.locator('[data-testid="position-country"]').allInnerTexts()).map(c => c.trim());
    for (const p of POSITIONS) {
      assert.ok(shown.includes(p.country), `country "${p.country}" was seeded but is not displayed`);
    }
  });

  test('the companies tab lists the seeded companies', async () => {
    await page.locator('[data-testid="tab-companies"]').click();
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="panel-companies"]')?.classList.contains('active'));

    const text = await page.locator('[data-testid="companies-table"]').innerText();
    for (const c of COMPANIES) {
      assert.ok(text.includes(c.name), `company "${c.name}" missing from the companies table`);
      assert.ok(text.includes(c.country), `country "${c.country}" missing from the companies table`);
    }
    assert.equal(await page.locator('[data-testid="companies-table"] [data-testid="empty-state"]').count(), 0,
      'the companies table should not show its empty state when companies exist');
  });

  test('the run log shows the seeded run', async () => {
    await page.locator('[data-testid="tab-runs"]').click();
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="panel-runs"]')?.classList.contains('active'));
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="runs-list"]');
      return el && !/Loading/i.test(el.innerText);
    });

    const text = await page.locator('[data-testid="runs-list"]').innerText();
    assert.ok(!/undefined|NaN|\[object Object\]/.test(text), `run log rendered a raw value:\n${text.slice(0, 300)}`);
    assert.ok(text.trim().length > 0, 'run log rendered nothing at all');
  });

  test('the profiles tab lists the seeded profiles', async () => {
    await page.locator('[data-testid="tab-profiles"]').click();
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="panel-profiles"]')?.classList.contains('active'));
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="profiles-list"]');
      return el && !/Loading/i.test(el.innerText);
    });

    const text = await page.locator('[data-testid="profiles-list"]').innerText();
    assert.ok(text.includes('Java Backend Engineer'), `seeded profile missing from the profiles tab:\n${text.slice(0, 300)}`);
  });
});
