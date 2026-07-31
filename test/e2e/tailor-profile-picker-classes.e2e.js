// Issue #17 — the tailor-resume profile picker's option button had two
// `class` attributes:
//
//   <button class="profile-option" data-id="${p.id}" class="choice-card">
//
// HTML parsers keep only the first `class` attribute and silently drop the
// second, so `choice-card`'s styling never applied — confirmed via
// `element.className` being `"profile-option"` only. Click-to-select still
// worked (it's wired via a real event listener on `.profile-option`, not CSS),
// only the styling was missing.
//
// This drives `PositionsTab.promptProfileSelection()` directly in a real
// browser rather than going through the full tailor-resume flow (which needs
// an LLM call to generate tailored text) — the defect lives entirely in the
// static markup this function builds, so exercising it directly is a precise,
// low-cost reproduction of the actual bug.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, findBrowser, realDbFingerprint, assertRealDbUntouched } = require('./helpers/harness');

const browserEnv = findBrowser();

describe('Tailor-resume profile picker button classes (issue #17)', { skip: browserEnv.available ? false : browserEnv.reason }, () => {
  let server;
  let browser;
  let page;
  let dbBefore;

  before(async () => {
    dbBefore = realDbFingerprint();
    server = await startServer();
    browser = await browserEnv.chromium.launch(browserEnv.launchOptions);
    page = await browser.newPage();
    await page.goto(server.baseUrl, { waitUntil: 'networkidle' });
  });

  after(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop();
  });

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('each profile-option button keeps both "profile-option" and "choice-card" classes', async () => {
    // Open the picker directly with fixture profiles; don't resolve/click yet.
    page.evaluate(() => {
      window.__pickerPromise = PositionsTab.promptProfileSelection([
        { id: 1, name: 'Backend Profile', job_types: ['Backend'], seniority_level: 'Senior' },
        { id: 2, name: 'Frontend Profile', job_types: ['Frontend'], seniority_level: 'Mid' },
      ]);
    });

    await page.waitForSelector('.profile-option');

    const classInfo = await page.$$eval('.profile-option', buttons =>
      buttons.map(b => ({ className: b.className, classList: Array.from(b.classList) }))
    );

    assert.equal(classInfo.length, 2, 'both fixture profiles must render a picker button');
    for (const { className, classList } of classInfo) {
      assert.ok(classList.includes('profile-option'), `expected "profile-option" in classList, got "${className}"`);
      assert.ok(classList.includes('choice-card'), `expected "choice-card" in classList (was dropped pre-fix), got "${className}"`);
    }

    // Clean up the still-open picker so it doesn't leak into other assertions.
    await page.locator('.profile-picker-cancel').click();
    const resolved = await page.evaluate(() => window.__pickerPromise);
    assert.equal(resolved, null, 'Cancel must resolve the picker promise with null');
  });
});
