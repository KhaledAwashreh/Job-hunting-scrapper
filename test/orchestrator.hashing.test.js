const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { buildStorableJob } = require('../src/agents/orchestrator');
const { hashJob } = require('../src/utils/hasher');

// A1.1 — dedup hash collides across companies.
//
// hasher.js keys on job.company_id, but orchestrator.js built the storable
// job object from `{...job, country, jobType, locationType, ...}` and never
// set company_id on it. Two different companies posting an identical role
// therefore hashed identically, and checkPositionExists() treated the
// second company's genuine posting as a duplicate.
describe('buildStorableJob (A1.1)', () => {
  const job = {
    title: 'Backend Engineer',
    description: 'Build things',
    qualifications: 'CS degree',
    link: 'https://boards.example.com/jobs/1', // same ATS template link path for both companies
    publishDate: '2026-07-01',
    country: 'Netherlands'
  };
  const extracted = { locationType: ['Unspecified'], yearsExperience: ['Unspecified'], seniorityLevel: ['Unspecified'] };
  const classifiedTypes = ['Backend Engineer'];

  test('sets company_id from the company argument', () => {
    const companyA = { id: 1, name: 'Acme', country: 'Netherlands' };
    const record = buildStorableJob(job, companyA, extracted, classifiedTypes);
    assert.equal(record.company_id, 1);
  });

  test('two different companies posting an identical job hash differently', () => {
    const companyA = { id: 1, name: 'Acme', country: 'Netherlands' };
    const companyB = { id: 2, name: 'Globex', country: 'Netherlands' };

    const recordA = buildStorableJob(job, companyA, extracted, classifiedTypes);
    const recordB = buildStorableJob(job, companyB, extracted, classifiedTypes);

    const hashA = hashJob(recordA);
    const hashB = hashJob(recordB);

    assert.notEqual(hashA, hashB, 'identical job at two different companies must not collide');
  });
});
