const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { matchesProfile } = require('../src/utils/jobFieldExtractor');

// A1.3 — country filter matches on substrings.
//
// matchesProfile()'s country branch used `jobCountry.includes(tc) ||
// tc.includes(jobCountry)`. Plain substring checks let a short country name
// match anywhere inside an unrelated longer one, e.g. "Niger" inside
// "Nigeria". Reproduced with the exact cases from the confirmed defect
// report (docs/review/confirmed/A1-dedup-and-matching.md).
const PROFILE = { job_types: ['Backend Engineer'] };

function jobFields(country) {
  return { _title: 'Backend Engineer', _description: '', _country: country };
}

describe('matchesProfile — country branch does not match on substrings', () => {
  test('search=Niger, job=Nigeria -> reject', () => {
    const result = matchesProfile(
      jobFields('Nigeria'),
      PROFILE,
      { country: 'Niger', remote: false },
      ''
    );
    assert.equal(result, false);
  });

  test('search=Oman, job=Romania -> reject', () => {
    const result = matchesProfile(
      jobFields('Romania'),
      PROFILE,
      { country: 'Oman', remote: false },
      ''
    );
    assert.equal(result, false);
  });

  test('search=Mali, job=Somalia -> reject', () => {
    const result = matchesProfile(
      jobFields('Somalia'),
      PROFILE,
      { country: 'Mali', remote: false },
      ''
    );
    assert.equal(result, false);
  });

  test('search=India, job=British Indian Ocean Territory -> reject', () => {
    const result = matchesProfile(
      jobFields('British Indian Ocean Territory'),
      PROFILE,
      { country: 'India', remote: false },
      ''
    );
    assert.equal(result, false);
  });

  test('sanity: search=France, job=Germany -> reject', () => {
    const result = matchesProfile(
      jobFields('Germany'),
      PROFILE,
      { country: 'France', remote: false },
      ''
    );
    assert.equal(result, false);
  });

  test('sanity: exact match still accepts (search=Nigeria, job=Nigeria)', () => {
    const result = matchesProfile(
      jobFields('Nigeria'),
      PROFILE,
      { country: 'Nigeria', remote: false },
      ''
    );
    assert.equal(result, true);
  });

  test('same false-positive pair, but as the company-country fallback branch (job country absent)', () => {
    const result = matchesProfile(
      jobFields(''),
      PROFILE,
      { country: 'Niger', remote: false },
      'Nigeria'
    );
    assert.equal(result, false);
  });
});
