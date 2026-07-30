const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { extractCountry } = require('../src/agents/apiAgent');

// Table-driven so a new case is one line. `label` exists only for cases where
// the input alone does not explain what is being checked.
function cases(name, rows) {
  describe(name, () => {
    for (const [input, expected, label] of rows) {
      test(label ? `${JSON.stringify(input)} → ${expected} (${label})` : `${JSON.stringify(input)} → ${expected}`, () => {
        assert.equal(extractCountry(input), expected);
      });
    }
  });
}

cases('extractCountry — city resolution', [
  ['Amsterdam', 'Netherlands'],
  ['Barcelona', 'Spain'],
  ['Dublin', 'Ireland'],
  ['Bengaluru', 'India'],
  ['Chicago', 'United States'],
  ['Lisbon', 'Portugal'],
  ['Cork', 'Ireland'],
  ['Amsterdam, North Holland, Netherlands', 'Netherlands', 'country name and city agree'],
  ['Hybrid (Madrid or Buenos Aires)', 'Spain', 'the word "or" must not read as the Oregon state code'],
]);

// --- issue #7: short keys used to match as bare substrings -----------------
// Every input below resolved to "United States" before the fix, because the
// 'us' key matched inside the word. The 'austria' key was unreachable entirely,
// since the string "austria" itself contains "us".

cases('extractCountry — substring collisions (issue #7)', [
  ['Austria', 'Austria', "the 'austria' key used to be unreachable dead code"],
  ['Vienna, Austria', 'Austria'],
  ['Toulouse, France', 'France', 'city containing "us", explicit country present'],
  ['Toulouse', 'Toulouse', 'city containing "us", unmapped, so passed through'],
  ['Syracuse, Italy', 'Italy'],
  ['Aarhus, Denmark', 'Denmark'],
  ['Aarhus', 'Aarhus', 'unmapped city containing "us"'],
  ['Melbourne, Australia', 'Australia', '"australia" contains "us"'],
  ['Australia', 'Australia'],
  ['Belarus', 'Belarus', 'unmapped, must not resolve to the US'],
  ['Cyprus', 'Cyprus', 'now mapped; used to resolve to the US'],
  ['Mauritius', 'Mauritius', 'unmapped, must not resolve to the US'],
  ['Columbus', 'Columbus', 'unmapped US city — must not resolve via the "us" substring'],
  ['Houston', 'Houston', 'unmapped, and "houston" contains no whole-token "us"'],
]);

// The 'uk' and 'uae' keys have the same shape as 'us'.
cases('extractCountry — other short keys', [
  ['Ukraine', 'Ukraine', "must not match the 'uk' key"],
  ['Dukinfield', 'Dukinfield', "must not match the 'uk' key"],
  ['United Kingdom', 'United Kingdom'],
  ['London, UK', 'United Kingdom'],
  ['UAE', 'United Arab Emirates'],
  ['Dubai, UAE', 'United Arab Emirates'],
]);

// --- US state disambiguation ----------------------------------------------
// Several mapped cities are ambiguous between countries. A trailing uppercase
// state code resolves them; anything looser would misfire on ordinary words.

cases('extractCountry — "City, ST" disambiguation', [
  ['Cambridge, MA', 'United States', 'Cambridge, Massachusetts — not the UK one'],
  ['Cambridge, UK', 'United Kingdom', 'explicit country still wins over the state rule'],
  ['Cambridge', 'United Kingdom', 'bare name keeps the mapped default'],
  ['Valencia, CA', 'United States'],
  ['Valencia', 'Spain', 'bare name keeps the mapped default'],
  ['Austin, TX', 'United States'],
  ['New York, NY 10001', 'United States', 'trailing ZIP tolerated'],
  ['Portland, OR', 'United States', 'OR as a real state code in the final segment'],
  ['Indianapolis, IN', 'United States', 'IN as a real state code'],
]);

cases('extractCountry — the state rule must not over-fire', [
  ['Remote (US or EU)', 'United States', 'explicit "US" token wins before the state rule'],
  ['Madrid or Lisbon', 'Spain', '"or" is not a state code here'],
  ['Berlin, Germany', 'Germany'],
  ['Delft, in the Netherlands', 'Netherlands', '"in" must not read as Indiana'],
  ['Cork, Ireland', 'Ireland'],
]);

// --- longest-key-first -----------------------------------------------------
// Ordering inside the maps is no longer load-bearing; specificity is.

cases('extractCountry — more specific key wins', [
  ['Porto Alegre', 'Brazil', 'must beat the "porto" key'],
  ['Porto Alegre, Brazil', 'Brazil'],
  ['Porto', 'Portugal'],
  ['Porto, Portugal', 'Portugal'],
  ['New Zealand', 'New Zealand', 'must beat "new york"-style partial matches'],
  ['United Arab Emirates', 'United Arab Emirates'],
]);

// --- non-ASCII -------------------------------------------------------------
// The token boundaries are Unicode-aware; `\b` would have broken these.

cases('extractCountry — accented keys', [
  ['München', 'Germany'],
  ['München, Deutschland', 'Germany'],
  ['São Paulo', 'Brazil'],
  ['São José dos Campos', 'Brazil'],
  ['Málaga', 'Málaga', 'accented spelling is not a key; passed through unchanged'],
]);

// --- passthrough and edge cases -------------------------------------------

cases('extractCountry — passthrough', [
  ['', ''],
  ['Atlantis', 'Atlantis'],
  ['N/A', 'N/A'],
  ['Remote - EMEA', 'Remote - EMEA'],
  ['Remote', 'Remote'],
  ['US', 'United States'],
  ['U.S.', 'United States', 'dotted abbreviation'],
  ['usa', 'United States', 'matching is case-insensitive'],
  ['NETHERLANDS', 'Netherlands'],
]);

describe('extractCountry — non-string and empty inputs', () => {
  for (const falsy of [null, undefined, 0, false, NaN, '']) {
    test(`${String(falsy)} → empty string`, () => {
      assert.equal(extractCountry(falsy), '');
    });
  }
});

describe('extractCountry — properties that must hold across the whole map', () => {
  test('no input resolves to United States unless it names the US, a US city, or a US state', () => {
    // These previously all resolved to United States via the 'us' substring.
    const offenders = ['Austria', 'Vienna, Austria', 'Toulouse, France', 'Syracuse, Italy',
      'Aarhus, Denmark', 'Melbourne, Australia', 'Belarus', 'Cyprus', 'Mauritius'];
    for (const input of offenders) {
      assert.notEqual(extractCountry(input), 'United States', `${input} must not resolve to the US`);
    }
  });

  test('an explicit country name always beats a city from a different country', () => {
    // "Amsterdam" maps to Netherlands, but the stated country must win.
    assert.equal(extractCountry('Amsterdam office, relocating to Portugal'), 'Portugal');
    assert.equal(extractCountry('Dublin, Ohio, United States'), 'United States');
  });

  test('resolution is stable regardless of surrounding punctuation and spacing', () => {
    for (const variant of ['Berlin', ' Berlin ', '(Berlin)', 'Berlin,', '- Berlin -', 'Berlin/Remote']) {
      assert.equal(extractCountry(variant), 'Germany', `failed for ${JSON.stringify(variant)}`);
    }
  });
});

// --- reachability ----------------------------------------------------------
// The defect behind issue #7 was a key no input could ever reach: 'austria' sat
// after 'us', and the string "austria" contains "us".
//
// These run against the real exported maps, so they fail if a key added later is
// swallowed by another. Note what they do NOT prove: reverting to bare substring
// matching leaves them green, because longest-key-first ordering alone is enough
// to reach 'austria'. The substring behaviour is pinned by the collision cases
// above (Toulouse, Aarhus, Belarus, Ukraine…), not by these. Kept because they
// guard the maps as they grow, which is cheap, not because they re-test the fix.

describe('extractCountry — every map key is reachable', () => {
  const { COUNTRY_NAMES, CITY_NAMES } = require('../src/agents/apiAgent');

  test('every country key resolves to its own country', () => {
    const unreachable = [];
    for (const [key, expected] of Object.entries(COUNTRY_NAMES)) {
      const actual = extractCountry(key);
      if (actual !== expected) unreachable.push(`${key} → ${actual} (expected ${expected})`);
    }
    assert.deepEqual(unreachable, [], `country keys that cannot be reached:\n${unreachable.join('\n')}`);
  });

  test('every city key resolves to its own country', () => {
    const unreachable = [];
    for (const [key, expected] of Object.entries(CITY_NAMES)) {
      const actual = extractCountry(key);
      if (actual !== expected) unreachable.push(`${key} → ${actual} (expected ${expected})`);
    }
    assert.deepEqual(unreachable, [], `city keys that cannot be reached:\n${unreachable.join('\n')}`);
  });

  test('no city key is silently shadowed by a country key', () => {
    // A city whose name contains a country name is fine as long as it still
    // resolves to the right country; this catches the case where it does not.
    const conflicts = [];
    for (const [city, expected] of Object.entries(CITY_NAMES)) {
      const withCountrySuffix = `${city}, ${expected}`;
      const actual = extractCountry(withCountrySuffix);
      if (actual !== expected) conflicts.push(`${withCountrySuffix} → ${actual}`);
    }
    assert.deepEqual(conflicts, [], `city+country strings that resolve wrongly:\n${conflicts.join('\n')}`);
  });
});
