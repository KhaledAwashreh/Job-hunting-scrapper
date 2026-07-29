const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { extractCountry } = require('../src/agents/apiAgent');

describe('extractCountry — city resolution', () => {
  test('Amsterdam → Netherlands', () => {
    assert.equal(extractCountry('Amsterdam'), 'Netherlands');
  });

  test('Barcelona → Spain', () => {
    assert.equal(extractCountry('Barcelona'), 'Spain');
  });

  test('Dublin → Ireland', () => {
    assert.equal(extractCountry('Dublin'), 'Ireland');
  });

  test('Bengaluru → India', () => {
    assert.equal(extractCountry('Bengaluru'), 'India');
  });

  test('Chicago → United States', () => {
    assert.equal(extractCountry('Chicago'), 'United States');
  });

  test('Amsterdam, North Holland, Netherlands → Netherlands (country name and city agree)', () => {
    assert.equal(extractCountry('Amsterdam, North Holland, Netherlands'), 'Netherlands');
  });

  test('Hybrid (Madrid or Buenos Aires) → Spain (ordering: city map reached before Buenos Aires would be considered)', () => {
    assert.equal(extractCountry('Hybrid (Madrid or Buenos Aires)'), 'Spain');
  });

  test('empty string → empty string (unchanged behavior)', () => {
    assert.equal(extractCountry(''), '');
  });

  test('unrecognized input → returns raw text unchanged', () => {
    assert.equal(extractCountry('Atlantis'), 'Atlantis');
  });
});
