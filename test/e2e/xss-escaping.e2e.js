// Issue #9 / U1.1 — stored XSS via scraped job titles, company names and
// profile names rendered unescaped into innerHTML.
//
// Before the fix, positions-tab.js:113-114, companies-countries.js:172-173
// and profiles-tab.js:90 interpolated these untrusted strings directly into
// innerHTML with no escaping, so a title/name containing
// `<img src=x onerror="...">` executed with zero clicks. A second vector let
// a `javascript:` URL through as-is in `href`.
//
// This suite seeds exactly that kind of payload (test/e2e/helpers/seed-xss.js)
// into an isolated database, drives the real app in a real browser, and
// proves neither payload executes and the text renders as inert text.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { startServer, findBrowser, realDbFingerprint, assertRealDbUntouched } = require('./helpers/harness');
const {
  COMPANY_PAYLOAD,
  POSITION_TITLE_PAYLOAD,
  PROFILE_NAME_PAYLOAD,
} = require('./helpers/seed-xss');

const SEED_SCRIPT = path.join(__dirname, 'helpers/seed-xss.js');
const browserEnv = findBrowser();

describe('stored XSS payloads in scraped data are neutralized (issue #9)', { skip: browserEnv.available ? false : browserEnv.reason }, () => {
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

  test('a hostile position title does not execute on the Positions tab', async () => {
    const fired = await page.evaluate(() => window.__positionXss);
    assert.equal(fired, undefined, 'the onerror payload in the position title must not have fired');

    const title = (await page.locator('[data-testid="position-title"]').first().innerText()).trim();
    assert.equal(title, POSITION_TITLE_PAYLOAD, 'the payload should render as literal text, not markup');

    // If the <img> tag had been parsed as an element, it would not show up as
    // text content and there would be a stray <img> node in the row.
    const imgCount = await page.locator('[data-testid="position-title"] img').count();
    assert.equal(imgCount, 0, 'the payload must not have been parsed into a real <img> element');
  });

  test('a hostile company name does not execute on the Positions tab (company_name column)', async () => {
    const fired = await page.evaluate(() => window.__companyXss);
    assert.equal(fired, undefined, 'the onerror payload in the company name must not have fired');

    const company = (await page.locator('[data-testid="position-company"]').first().innerText()).trim();
    assert.equal(company, COMPANY_PAYLOAD, 'the payload should render as literal text, not markup');
  });

  test('a javascript: link is rejected and not rendered as an executable href', async () => {
    const href = await page.locator('[data-testid="position-link"]').first().getAttribute('href');
    assert.doesNotMatch(href || '', /^javascript:/i, 'href must not carry a javascript: URL through to the DOM');
  });

  test('a hostile company name does not execute on the Companies tab', async () => {
    await page.click('[data-tab="companies"]');
    await page.waitForSelector('#companiesTableContainer table', { timeout: 5000 });

    const fired = await page.evaluate(() => window.__companyXss);
    assert.equal(fired, undefined, 'the onerror payload in the company name must not have fired on the Companies tab');

    const bodyText = await page.locator('#companiesTableContainer').innerText();
    assert.ok(bodyText.includes(COMPANY_PAYLOAD), 'the payload should be visible as literal text in the companies table');

    const imgCount = await page.locator('#companiesTableContainer img').count();
    assert.equal(imgCount, 0, 'the payload must not have been parsed into a real <img> element');
  });

  test('a hostile profile name does not execute on the Profiles tab', async () => {
    await page.click('[data-tab="profiles"]');
    await page.waitForSelector('#profilesAccordion .accordion-item', { timeout: 5000 });

    const fired = await page.evaluate(() => window.__profileXss);
    assert.equal(fired, undefined, 'the onerror payload in the profile name must not have fired on the Profiles tab');

    const heading = (await page.locator('#profilesAccordion h4').first().innerText()).trim();
    assert.equal(heading, PROFILE_NAME_PAYLOAD, 'the payload should render as literal text, not markup');

    const imgCount = await page.locator('#profilesAccordion img').count();
    assert.equal(imgCount, 0, 'the payload must not have been parsed into a real <img> element');
  });

  test('a hostile tailored-resume text cannot break out of the <textarea> in the tailoring modal', async () => {
    // showTailoredModal() interpolates tailored_text (LLM output derived from
    // the job title/description — attacker-influenceable via prompt
    // injection) into a <textarea> via innerHTML. A payload containing a
    // literal `</textarea>` closes the element early and anything after it
    // is parsed as live markup — a distinct injection site from the ones
    // above, in the same file, same vulnerability class.
    const breakoutPayload = 'Some tailored resume text</textarea><img src=x onerror="window.__tailoredResumeXss=true">';

    await page.evaluate((text) => {
      window.__tailoredResumeXss = undefined;
      PositionsTab.showTailoredModal(1, text, 1);
    }, breakoutPayload);

    // Image loading (and therefore onerror firing) is asynchronous even once
    // the element is in the DOM.
    await page.waitForTimeout(300);

    const fired = await page.evaluate(() => window.__tailoredResumeXss);
    assert.equal(fired, undefined, 'the onerror payload must not have fired from a <textarea> breakout');

    const imgCount = await page.locator('#tailoredResumeModal img').count();
    assert.equal(imgCount, 0, 'the payload must not have been parsed into a real <img> element');

    const value = await page.locator('#tailoredText').inputValue();
    assert.equal(value, breakoutPayload, 'the textarea should still contain the literal payload as its value');
  });
});
