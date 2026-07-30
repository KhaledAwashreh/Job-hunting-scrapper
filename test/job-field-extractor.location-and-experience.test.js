const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { extractLocationType, extractYearsExperience } = require('../src/utils/jobFieldExtractor');

describe('extractLocationType — negation handling (#51)', () => {
  test('"This is not a remote position" does not include Remote', () => {
    const result = extractLocationType('Backend Engineer', 'This is not a remote position.');
    assert.ok(!result.includes('Remote'), `expected no Remote tag, got ${JSON.stringify(result)}`);
  });

  test('"Remote work is not available for this role" does not include Remote', () => {
    const result = extractLocationType('Backend Engineer', 'Remote work is not available for this role.');
    assert.ok(!result.includes('Remote'), `expected no Remote tag, got ${JSON.stringify(result)}`);
  });

  test('a genuinely remote description still returns Remote (true positive preserved)', () => {
    const result = extractLocationType('Backend Engineer', 'This is a fully remote position based anywhere in the EU.');
    assert.ok(result.includes('Remote'), `expected Remote tag, got ${JSON.stringify(result)}`);
  });

  test('a genuinely remote description without negation nearby still returns Remote', () => {
    const result = extractLocationType('Backend Engineer', 'We offer remote work options for this role.');
    assert.ok(result.includes('Remote'), `expected Remote tag, got ${JSON.stringify(result)}`);
  });

  test('an unrelated negation in an earlier clause does not suppress a genuine Remote claim (QA follow-up)', () => {
    const result = extractLocationType('Backend Engineer', 'This role does not require travel; fully remote.');
    assert.ok(result.includes('Remote'), `expected Remote tag despite unrelated "not" earlier in the sentence, got ${JSON.stringify(result)}`);
  });

  test('an unrelated negation in an earlier sentence does not suppress a genuine Remote claim (QA follow-up)', () => {
    const result = extractLocationType('Backend Engineer', 'Does not require a degree. Remote work available for the right candidate.');
    assert.ok(result.includes('Remote'), `expected Remote tag despite unrelated "not" in a prior sentence, got ${JSON.stringify(result)}`);
  });

  test('"not wfh eligible" does not include Remote (negation covers wfh keyword too)', () => {
    const result = extractLocationType('Backend Engineer', 'This role is not wfh eligible.');
    assert.ok(!result.includes('Remote'), `expected no Remote tag, got ${JSON.stringify(result)}`);
  });

  test('"not a distributed team" does not include Remote (negation covers distributed keyword too)', () => {
    const result = extractLocationType('Backend Engineer', 'This is not a distributed team role.');
    assert.ok(!result.includes('Remote'), `expected no Remote tag, got ${JSON.stringify(result)}`);
  });

  test('a genuinely distributed-team description still returns Remote', () => {
    const result = extractLocationType('Backend Engineer', 'We are a fully distributed team.');
    assert.ok(result.includes('Remote'), `expected Remote tag, got ${JSON.stringify(result)}`);
  });
});

describe('extractYearsExperience — "exp" word boundary (#53)', () => {
  test('"5 years of expertise" does not match as years-of-experience', () => {
    const result = extractYearsExperience('Backend Engineer', '5 years of expertise in distributed systems required.');
    assert.ok(!result.includes('3-5'), `expected no years-of-experience match from "expertise", got ${JSON.stringify(result)}`);
  });

  test('a genuine "5 years of experience" phrase still matches correctly', () => {
    const result = extractYearsExperience('Backend Engineer', 'Requires 5 years of experience in distributed systems.');
    assert.ok(result.includes('3-5'), `expected 3-5 match, got ${JSON.stringify(result)}`);
  });

  test('a genuine "5 years exp" (abbreviated) phrase still matches correctly', () => {
    const result = extractYearsExperience('Backend Engineer', 'Requires 5 years exp in distributed systems.');
    assert.ok(result.includes('3-5'), `expected 3-5 match, got ${JSON.stringify(result)}`);
  });
});
