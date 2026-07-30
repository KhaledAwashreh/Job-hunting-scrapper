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
