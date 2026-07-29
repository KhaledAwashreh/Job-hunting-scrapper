const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { ensureProfilesFromSearchParams } = require('../src/agents/orchestrator');
const { parseSearchParams } = require('../src/utils/csvParser');

// Fake DB dependencies — no mocking library, no jobs.db access. addProfile
// assigns incrementing ids and records every call so tests can assert on it;
// getAllProfiles returns whatever the test configures as "already in the DB".
function createFakeDb({ existing = [] } = {}) {
  const addProfileCalls = [];
  let nextId = 1;
  return {
    getAllProfiles: () => existing,
    addProfile: (...args) => {
      addProfileCalls.push(args);
      return nextId++;
    },
    addProfileCalls
  };
}

describe('ensureProfilesFromSearchParams — grouping real search-params.csv rows', () => {
  // The real 10-row CSV: each of 4 distinct titles repeated once per target
  // country/region. Reading it via parseSearchParams (not hardcoding it here)
  // keeps this test honest to what's actually on disk.
  const searchParams = parseSearchParams();

  test('the fixture CSV really has 10 rows across 4 distinct titles (sanity check)', () => {
    assert.equal(searchParams.length, 10);
  });

  test('creates exactly 4 profiles, not one per row', () => {
    const { getAllProfiles, addProfile } = createFakeDb();
    const result = ensureProfilesFromSearchParams(searchParams, [], { getAllProfiles, addProfile });
    assert.equal(result.length, 4);
  });

  test('profile names are the bare titles in first-seen order, no "Profile N:" prefix', () => {
    const { getAllProfiles, addProfile } = createFakeDb();
    const result = ensureProfilesFromSearchParams(searchParams, [], { getAllProfiles, addProfile });
    assert.deepEqual(result.map(p => p.name), [
      'Java Backend Engineer',
      'Backend Engineer',
      'Platform Engineer',
      'AI/ML Engineer'
    ]);
  });

  test('job_types is a single-element JSON array matching the profile name', () => {
    const { getAllProfiles, addProfile } = createFakeDb();
    const result = ensureProfilesFromSearchParams(searchParams, [], { getAllProfiles, addProfile });
    for (const profile of result) {
      assert.deepEqual(JSON.parse(profile.job_types), [profile.name]);
    }
  });

  test('Platform Engineer gets seniority_level "mid"; Java Backend Engineer gets "senior"', () => {
    const { getAllProfiles, addProfile } = createFakeDb();
    const result = ensureProfilesFromSearchParams(searchParams, [], { getAllProfiles, addProfile });
    const byName = Object.fromEntries(result.map(p => [p.name, p]));
    assert.equal(byName['Platform Engineer'].seniority_level, 'mid');
    assert.equal(byName['Java Backend Engineer'].seniority_level, 'senior');
  });

  test('every profile gets work_location_preference ["Remote"] since every CSV row is remote=yes', () => {
    const { getAllProfiles, addProfile } = createFakeDb();
    const result = ensureProfilesFromSearchParams(searchParams, [], { getAllProfiles, addProfile });
    for (const profile of result) {
      assert.equal(profile.work_location_preference, '["Remote"]');
    }
  });

  test('years_of_experience is always []', () => {
    const { getAllProfiles, addProfile } = createFakeDb();
    const result = ensureProfilesFromSearchParams(searchParams, [], { getAllProfiles, addProfile });
    for (const profile of result) {
      assert.equal(profile.years_of_experience, '[]');
    }
  });

  test('resume_file falls back to "" when no resumes are supplied', () => {
    const { getAllProfiles, addProfile } = createFakeDb();
    const result = ensureProfilesFromSearchParams(searchParams, [], { getAllProfiles, addProfile });
    for (const profile of result) {
      assert.equal(profile.resume_file, '');
    }
  });

  test('resume_file uses the first resume filename when resumes are supplied', () => {
    const { getAllProfiles, addProfile } = createFakeDb();
    const resumes = [{ filename: 'resume-a.pdf' }, { filename: 'resume-b.pdf' }];
    const result = ensureProfilesFromSearchParams(searchParams, resumes, { getAllProfiles, addProfile });
    for (const profile of result) {
      assert.equal(profile.resume_file, 'resume-a.pdf');
    }
  });

  test('addProfile is called once per distinct title, in first-seen order', () => {
    const { getAllProfiles, addProfile, addProfileCalls } = createFakeDb();
    ensureProfilesFromSearchParams(searchParams, [], { getAllProfiles, addProfile });
    assert.equal(addProfileCalls.length, 4);
    assert.deepEqual(
      addProfileCalls.map(args => args[0]),
      ['Java Backend Engineer', 'Backend Engineer', 'Platform Engineer', 'AI/ML Engineer']
    );
  });
});

describe('ensureProfilesFromSearchParams — case/whitespace grouping', () => {
  test('titles differing only by case or surrounding whitespace group together', () => {
    const params = [
      { title: 'Java Backend Engineer', seniority: 'senior', remote: true },
      { title: ' java backend engineer ', seniority: null, remote: false },
      { title: 'JAVA BACKEND ENGINEER', seniority: 'senior', remote: false }
    ];
    const { getAllProfiles, addProfile } = createFakeDb();
    const result = ensureProfilesFromSearchParams(params, [], { getAllProfiles, addProfile });

    assert.equal(result.length, 1);
    // Name/job_types come from the FIRST row's original (untrimmed-case) title.
    assert.equal(result[0].name, 'Java Backend Engineer');
    assert.deepEqual(JSON.parse(result[0].job_types), ['Java Backend Engineer']);
    // "first non-null seniority in the group" — first row is already non-null.
    assert.equal(result[0].seniority_level, 'senior');
    // remote===true on any row in the group → ["Remote"].
    assert.equal(result[0].work_location_preference, '["Remote"]');
  });

  test('first non-null seniority is picked from a later row when the first row has none', () => {
    const params = [
      { title: 'Backend Engineer', seniority: null, remote: false },
      { title: 'backend engineer', seniority: 'lead', remote: false },
      { title: 'BACKEND ENGINEER', seniority: 'senior', remote: true }
    ];
    const { getAllProfiles, addProfile } = createFakeDb();
    const result = ensureProfilesFromSearchParams(params, [], { getAllProfiles, addProfile });

    assert.equal(result.length, 1);
    assert.equal(result[0].seniority_level, 'lead');
  });

  test('seniority_level is null when no row in the group has a non-null seniority', () => {
    const params = [
      { title: 'Backend Engineer', seniority: null, remote: false },
      { title: 'backend engineer', seniority: null, remote: false }
    ];
    const { getAllProfiles, addProfile } = createFakeDb();
    const result = ensureProfilesFromSearchParams(params, [], { getAllProfiles, addProfile });

    assert.equal(result.length, 1);
    assert.equal(result[0].seniority_level, null);
  });

  test('work_location_preference is [] when no row in the group is remote', () => {
    const params = [
      { title: 'Backend Engineer', seniority: 'senior', remote: false },
      { title: 'backend engineer', seniority: 'senior', remote: false }
    ];
    const { getAllProfiles, addProfile } = createFakeDb();
    const result = ensureProfilesFromSearchParams(params, [], { getAllProfiles, addProfile });

    assert.equal(result.length, 1);
    assert.equal(result[0].work_location_preference, '[]');
  });
});

describe('ensureProfilesFromSearchParams — early return when profiles already exist', () => {
  test('returns the existing profiles untouched and never calls addProfile', () => {
    const existing = [
      { id: 1, name: 'Existing Profile', job_types: '["Existing"]' }
    ];
    const { getAllProfiles, addProfile, addProfileCalls } = createFakeDb({ existing });

    const result = ensureProfilesFromSearchParams(
      [{ title: 'Java Backend Engineer', seniority: 'senior', remote: true }],
      [],
      { getAllProfiles, addProfile }
    );

    assert.equal(result, existing);
    assert.equal(addProfileCalls.length, 0);
  });
});
