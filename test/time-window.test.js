const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { isWithinTimeWindow } = require('../src/utils/timeWindow');

// A1.4 — unparseable dates silently drop jobs.
//
// `new Date('N/A')` never throws — it yields an Invalid Date, so daysDiff is
// NaN and `NaN <= window.days` is false, rejecting the job. The catch block
// (commented "Invalid date format, accept it") never actually runs.
describe('isWithinTimeWindow (A1.4)', () => {
  test('"N/A" is accepted, not rejected', () => {
    assert.equal(isWithinTimeWindow('N/A', '7'), true);
  });

  test('"not-a-date" is accepted, not rejected', () => {
    assert.equal(isWithinTimeWindow('not-a-date', '7'), true);
  });

  test('empty string is still accepted (existing early-return behavior)', () => {
    assert.equal(isWithinTimeWindow('', '7'), true);
  });

  test('a real old date is still rejected for a 7-day window', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 30);
    assert.equal(isWithinTimeWindow(oldDate.toISOString(), '7'), false);
  });

  test('a real recent date is still accepted for a 7-day window', () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 1);
    assert.equal(isWithinTimeWindow(recentDate.toISOString(), '7'), true);
  });

  test('"all" window accepts everything regardless of date validity', () => {
    assert.equal(isWithinTimeWindow('N/A', 'all'), true);
  });
});
