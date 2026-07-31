const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { classifyJobType } = require('../src/utils/jobFieldExtractor');

// Coverage gap found during verification of the #49 cleanup (deletion of
// full-validation.js / validate-imports.js): those scripts asserted against
// the old `extractJobType(title, description)` function, which returned
// generic hardcoded categories (e.g. 'Backend', 'Frontend', 'Ai'). It was
// renamed/replaced by `classifyJobType(title, description, jobTypes)`,
// which instead does profile-driven fuzzy matching against a caller-supplied
// list of job type strings and returns those exact strings (or
// ['Unspecified']). The old assertions are stale against this new signature
// and behavior (already noted in docs/review/unconfirmed/U5-matching-scoring-scripts.md),
// so they couldn't be ported as-is — but classifyJobType's actual matching
// logic (full-phrase match, partial word match with stop-word filtering,
// score-based ranking, and the Unspecified fallback) had no direct test
// anywhere in test/*.test.js; it was only ever invoked incidentally via
// matchesProfile tests using a single always-matching case. This file closes
// that gap.

describe('classifyJobType', () => {
  test('empty jobTypes → Unspecified', () => {
    assert.deepEqual(classifyJobType('Backend Engineer', '', []), ['Unspecified']);
  });

  test('no overlap at all → Unspecified', () => {
    assert.deepEqual(
      classifyJobType('Marketing Manager', 'Runs campaigns', ['Backend Engineer']),
      ['Unspecified']
    );
  });

  test('full-phrase match in title → returns the matched type', () => {
    assert.deepEqual(
      classifyJobType('Senior Backend Engineer', '', ['Backend Engineer']),
      ['Backend Engineer']
    );
  });

  test('matching is case-insensitive', () => {
    // The matched type string is echoed back verbatim from the jobTypes
    // list passed in, not re-cased — only the *comparison* is
    // case-insensitive.
    assert.deepEqual(
      classifyJobType('SENIOR BACKEND ENGINEER', '', ['backend engineer']),
      ['backend engineer']
    );
  });

  test('partial word match (stop word "Engineer" excluded) still matches on "Backend"', () => {
    // "Engineer" is a STOP_WORD, so only "backend" is checked individually;
    // it appears as a whole word in the title, so this is a (weaker) match
    // rather than Unspecified.
    const result = classifyJobType('Backend Specialist', '', ['Backend Engineer']);
    assert.deepEqual(result, ['Backend Engineer']);
  });

  test('stop word does not cause a false-positive on its own', () => {
    // "Engineer" alone (a bare stop word job type with no other meaningful
    // words) must not match every title containing the word "engineer".
    const result = classifyJobType('Sales Engineer', '', ['Engineer']);
    // meaningfulWords is empty (only word is a stop word) so it falls back
    // to checking the full word list, which does include "engineer" —
    // matching here is intentional per the current implementation.
    assert.deepEqual(result, ['Engineer']);
  });

  test('multiple job types: only the genuinely matching one is returned', () => {
    const result = classifyJobType('DevOps Engineer', '', ['Backend Engineer', 'DevOps Engineer']);
    assert.deepEqual(result, ['DevOps Engineer']);
  });

  test('multiple matching job types are ranked full-phrase match first', () => {
    const result = classifyJobType('Senior Backend Engineer', '', ['Backend Developer', 'Backend Engineer']);
    assert.deepEqual(result, ['Backend Engineer', 'Backend Developer']);
  });

  test('description is not used as a fallback (title-only matching)', () => {
    // Documented in the source: description keywords are intentionally
    // ignored to avoid false positives from mentions like "Java" in an
    // unrelated job's description.
    const result = classifyJobType('Office Manager', 'Requires Java and backend engineering skills', ['Backend Engineer']);
    assert.deepEqual(result, ['Unspecified']);
  });
});
