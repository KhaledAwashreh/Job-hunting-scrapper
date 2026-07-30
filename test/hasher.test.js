const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { hashJob } = require('../src/utils/hasher');

describe('hashJob', () => {
  // A1.1 (acceptance, at the hasher.js level): given a complete job record
  // that does carry company_id, two jobs identical in every other field but
  // with different company_id must hash differently. The actual defect was
  // that orchestrator.js never populated company_id on the object it passed
  // in (see test/orchestrator.hashing.test.js for the caller-side check),
  // but hashJob itself must also honour company_id when present — this
  // guards against that logic ever being weakened.
  test('same job, different company_id -> different hash', () => {
    const base = {
      title: 'Backend Engineer',
      description: 'Build things',
      qualifications: 'CS degree',
      link: 'https://example.com/jobs/1'
    };
    const a = hashJob({ ...base, company_id: 1 });
    const b = hashJob({ ...base, company_id: 2 });
    assert.notEqual(a, b);
  });

  // A1.2
  test('identical job, publishDate bumped -> same hash (stable across date bump)', () => {
    const base = {
      company_id: 1,
      title: 'Backend Engineer',
      description: 'Build things',
      qualifications: 'CS degree',
      link: 'https://example.com/jobs/1'
    };
    const before = hashJob({ ...base, publishDate: '2026-07-01' });
    const after = hashJob({ ...base, publishDate: '2026-07-08' });
    assert.equal(before, after);
  });

  test('company_id missing entirely still hashes deterministically (no crash)', () => {
    const job = {
      title: 'Backend Engineer',
      description: 'Build things',
      qualifications: 'CS degree',
      link: 'https://example.com/jobs/1'
    };
    assert.equal(hashJob(job), hashJob({ ...job }));
  });
});
