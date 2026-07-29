const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { matchesProfile } = require('../src/utils/jobFieldExtractor');

const PROFILE = { job_types: ['Backend Engineer'] };
const SEARCH_PARAM = { country: 'Netherlands', remote: false };

function jobFields(country) {
  return {
    _title: 'Backend Engineer',
    _description: '',
    _country: country
  };
}

describe('matchesProfile — country branch', () => {
  test('job country present and matches target → accept', () => {
    const result = matchesProfile(
      jobFields('Amsterdam, North Holland, Netherlands'),
      PROFILE,
      SEARCH_PARAM,
      'Netherlands'
    );
    assert.equal(result, true);
  });

  test('job country present and does not match target, company does → reject (regression)', () => {
    const result = matchesProfile(
      jobFields('Bengaluru'),
      PROFILE,
      SEARCH_PARAM,
      'Netherlands'
    );
    assert.equal(result, false);
  });

  test('same job with a matching country instead of Bengaluru passes, confirming the country check is what rejected it', () => {
    const result = matchesProfile(
      jobFields('Amsterdam, Netherlands'),
      PROFILE,
      SEARCH_PARAM,
      'Netherlands'
    );
    assert.equal(result, true);
  });

  test('job country present (Chicago) and does not match target → reject', () => {
    const result = matchesProfile(
      jobFields('Chicago'),
      PROFILE,
      SEARCH_PARAM,
      'Netherlands'
    );
    assert.equal(result, false);
  });

  test('job country empty string → falls back to company country → accept', () => {
    const result = matchesProfile(
      jobFields(''),
      PROFILE,
      SEARCH_PARAM,
      'Netherlands'
    );
    assert.equal(result, true);
  });

  test('job country whitespace-only counts as absent → falls back to company country → accept', () => {
    const result = matchesProfile(
      jobFields('   '),
      PROFILE,
      SEARCH_PARAM,
      'Netherlands'
    );
    assert.equal(result, true);
  });

  test('job country present but unrecognized ("N/A") → reject, no fallback to company', () => {
    const result = matchesProfile(
      jobFields('N/A'),
      PROFILE,
      SEARCH_PARAM,
      'Netherlands'
    );
    assert.equal(result, false);
  });

  test('multi-country search param, job country matches one of them → accept', () => {
    const result = matchesProfile(
      jobFields('Dublin, Ireland'),
      PROFILE,
      { country: 'Netherlands;Ireland', remote: false },
      'Netherlands'
    );
    assert.equal(result, true);
  });

  test('no searchParam.country at all → country check skipped → accept', () => {
    const result = matchesProfile(
      jobFields('Bengaluru'),
      PROFILE,
      { remote: false },
      'Netherlands'
    );
    assert.equal(result, true);
  });
});
