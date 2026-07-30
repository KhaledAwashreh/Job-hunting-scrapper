// Issue #14 — editProfile() cleared #profileResume.value but left `required`
// set on the input, so native form validation silently blocked the submit
// event before saveProfile() ever ran: editing a profile's name with no
// intent to touch its resume just did nothing, with no error shown.
//
// Issue #15 — .accordion-header was a bare <div onclick="..."> with no
// tabindex/role/keydown handler, and the Edit/Delete buttons it reveals stay
// display:none until that same unreachable click handler toggles them open —
// so a keyboard-only user could never focus, let alone activate, either
// control.
//
// Both are exercised against test/e2e/helpers/seed-profiles.js, a fixture
// with one profile carrying a real (non-empty) resume_file — the shared
// seed.js fixture's profiles have resume_file: '', which the server's
// validateProfileInput (server.js) rejects with 400 regardless of what the
// frontend sends, so a test built on those profiles could pass for the wrong
// reason.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { startServer, findBrowser, realDbFingerprint, assertRealDbUntouched } = require('./helpers/harness');
const { PROFILE } = require('./helpers/seed-profiles');

const SEED_SCRIPT = path.join(__dirname, 'helpers/seed-profiles.js');
const browserEnv = findBrowser();

// Presses Tab up to maxSteps times, returning the number of presses it took
// for the active element to satisfy `matches` (a page.evaluate predicate
// returning a boolean), or throws if it never does. This proves an element
// is reachable by keyboard alone, without hard-coding the exact tab order.
async function tabUntil(page, matches, maxSteps = 25) {
  for (let i = 1; i <= maxSteps; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(matches);
    if (hit) return i;
  }
  throw new Error(`target not reached by keyboard within ${maxSteps} Tab presses`);
}

describe('Profiles tab: edit without re-selecting a resume, and keyboard access (issues #14, #15)', { skip: browserEnv.available ? false : browserEnv.reason }, () => {
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
    await page.locator('[data-testid="tab-profiles"]').click();
    await page.waitForSelector('.accordion-item');
  });

  after(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop();
  });

  test('the real jobs.db is never touched', () => {
    assertRealDbUntouched(dbBefore, assert);
  });

  test('issue #15: Tab reaches the accordion header, and Enter opens it', async () => {
    // Profiles is already the active tab (from `before`) — re-clicking its
    // tab button would call ProfilesTab.init() again, which re-fetches and
    // re-renders #profilesAccordion asynchronously and can race with the Tab
    // presses below. Just blur whatever has focus and tab forward from there.
    await page.evaluate(() => document.activeElement.blur());

    const steps = await tabUntil(page, () =>
      document.activeElement && document.activeElement.id === 'accordion-header-0'
    );
    assert.ok(steps > 0, 'the accordion header must be a real Tab stop');

    assert.equal(await page.locator('#accordion-header-0').getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('accordion-0').classList.contains('active'));
    assert.equal(await page.locator('#accordion-header-0').getAttribute('aria-expanded'), 'true');
  });

  test('issue #15: continuing to Tab reaches the Edit button, and Enter activates it', async () => {
    const steps = await tabUntil(page, () =>
      document.activeElement && document.activeElement.tagName === 'BUTTON' &&
      document.activeElement.textContent.trim() === 'Edit'
    );
    assert.ok(steps > 0, 'Edit must become a real Tab stop once the accordion is open');

    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('profileModal').classList.contains('open'));
    assert.equal(await page.locator('#profileName').inputValue(), PROFILE.name,
      'activating Edit by keyboard should open the modal pre-filled for the right profile');

    await page.locator('.modal-actions button.button-muted').click(); // Cancel, back to a clean state
  });

  test('issue #14: saving an edit without touching the resume file keeps the existing resume', async () => {
    // The accordion is still open from the previous test (Cancel only closes
    // the modal), so Edit is already visible — no need to reopen it.
    await page.locator('.row-actions button:has-text("Edit")').click();
    await page.waitForFunction(() => document.getElementById('profileModal').classList.contains('open'));

    // The file input must not still be required in edit mode, or native
    // validation blocks the submit before saveProfile() ever runs.
    assert.equal(await page.locator('#profileResume').evaluate(el => el.required), false);
    assert.equal(await page.locator('#profileResume').inputValue(), '', 'file input starts cleared in edit mode');

    await page.locator('#profileName').fill('Backend Profile (renamed)');

    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/profiles/') && res.request().method() === 'PATCH'),
      page.locator('#profileForm button[type="submit"]').click(),
    ]);

    assert.equal(response.status(), 200, 'the PATCH must actually reach the server, not be blocked client-side');
    const body = await response.json();
    assert.equal(body.name, 'Backend Profile (renamed)');
    assert.equal(body.resume_file, PROFILE.resume_file, 'the resume on file must be preserved, not overwritten');

    await page.waitForFunction(() => !document.getElementById('profileModal').classList.contains('open'));
    await page.waitForSelector('text=Backend Profile (renamed)');
  });

  test('issue #15: Tab reaches Delete too, and Enter activates it', async () => {
    // renderProfiles() rebuilt the DOM after the save above, so the
    // accordion is closed again — reopen it by keyboard, same as the first
    // test, to prove Delete is reachable from a cold start too. (Not
    // re-clicking the tab button here either — see the comment in the first
    // Tab-reachability test above.)
    await page.evaluate(() => document.activeElement.blur());
    await tabUntil(page, () => document.activeElement && document.activeElement.id === 'accordion-header-0');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('accordion-0').classList.contains('active'));

    await tabUntil(page, () =>
      document.activeElement && document.activeElement.tagName === 'BUTTON' &&
      document.activeElement.textContent.trim() === 'Delete'
    );

    page.once('dialog', dialog => dialog.accept());
    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/profiles/') && res.request().method() === 'DELETE'),
      page.keyboard.press('Enter'),
    ]);

    assert.equal(response.status(), 200);
    await page.waitForSelector('#profilesAccordion [data-testid="empty-state"]');
  });
});
