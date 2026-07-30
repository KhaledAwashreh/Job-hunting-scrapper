// DOM-structure snapshots.
//
// The brief was "make sure the UI is not extremely different" — catch structure
// disappearing or being rearranged, not a pixel moving. So the snapshot records
// the shape of each tab (tags, nesting, testids, classes) with all text and all
// other attribute values stripped.
//
// Deliberately NOT a pixel snapshot: comparing images with a tolerance needs
// @playwright/test or pixelmatch, both new dependencies, and hashing a PNG fails
// on any 1-pixel change — exactly the brittleness we are avoiding. Stripping
// text also means the snapshot does not churn when seeded data changes.
//
// To re-baseline after an intentional UI change: UPDATE_SNAPSHOTS=1 npm run test:e2e

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { startServer, findBrowser } = require('./helpers/harness');

const browserEnv = findBrowser();
const SNAPSHOT_DIR = path.join(__dirname, '__snapshots__');
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const TABS = ['positions', 'companies', 'profiles', 'runs'];

// Serialize an element to an indented tree of `tag.class[data-testid]`.
// Runs inside the page, so it must be self-contained.
function serializeInPage(selector) {
  const root = document.querySelector(selector);
  if (!root) return '<<MISSING>>';

  const skip = new Set(['SCRIPT', 'STYLE']);

  const describe = el => {
    const classes = (el.getAttribute('class') || '')
      .split(/\s+/)
      .filter(Boolean)
      // Drop state classes that legitimately toggle at runtime.
      .filter(c => c !== 'active' && c !== 'open')
      .sort()
      .join('.');

    const testid = el.getAttribute('data-testid');
    let s = el.tagName.toLowerCase();
    if (classes) s += '.' + classes;
    if (testid) s += `[${testid}]`;
    return s;
  };

  // Returns the subtree as an array of un-indented lines, with runs of
  // identical sibling SUBTREES collapsed to "…  ×N". Without this the
  // companies tab is ~900 lines of repeated country rows — noise that buries
  // any real structural change. The count is preserved, so a list that empties
  // or changes length still fails the comparison.
  const walk = el => {
    const kids = [];
    for (const child of el.children) {
      if (skip.has(child.tagName)) continue;
      kids.push(walk(child));
    }

    const collapsed = [];
    for (const sub of kids) {
      const key = sub.join('\n');
      const last = collapsed[collapsed.length - 1];
      if (last && last.key === key) last.count += 1;
      else collapsed.push({ key, lines: sub, count: 1 });
    }

    const out = [describe(el)];
    for (const { lines, count } of collapsed) {
      const [head, ...rest] = lines;
      out.push('  ' + head + (count > 1 ? `  ×${count}` : ''));
      for (const line of rest) out.push('  ' + line);
    }
    return out;
  };

  return walk(root).join('\n');
}

describe('DOM structure snapshots', { skip: browserEnv.available ? false : browserEnv.reason }, () => {
  let server;
  let browser;
  let page;

  before(async () => {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    // Seeded, so repeated rows are part of the recorded structure.
    server = await startServer({ seed: true });
    browser = await browserEnv.chromium.launch(browserEnv.launchOptions);
    page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(server.baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="position-row"]');
  });

  after(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop();
  });

  for (const tab of TABS) {
    test(`the "${tab}" tab matches its recorded structure`, async () => {
      await page.locator(`[data-testid="tab-${tab}"]`).click();
      await page.waitForFunction(
        t => document.querySelector(`[data-testid="panel-${t}"]`)?.classList.contains('active'),
        tab
      );
      // Let the tab's fetch settle before recording.
      await page.waitForLoadState('networkidle');

      const actual = await page.evaluate(serializeInPage, `[data-testid="panel-${tab}"]`);
      assert.notEqual(actual, '<<MISSING>>', `panel for "${tab}" was not in the DOM`);

      const file = path.join(SNAPSHOT_DIR, `${tab}.snapshot.txt`);

      if (UPDATE || !fs.existsSync(file)) {
        fs.writeFileSync(file, actual + '\n');
        if (!UPDATE) console.log(`  created baseline: ${path.relative(process.cwd(), file)}`);
        return;
      }

      const expected = fs.readFileSync(file, 'utf8').trimEnd();
      assert.equal(
        actual,
        expected,
        `the "${tab}" tab's structure changed.\n` +
        `If the change was intended, re-baseline with:\n` +
        `  UPDATE_SNAPSHOTS=1 npm run test:e2e`
      );
    });
  }
});
