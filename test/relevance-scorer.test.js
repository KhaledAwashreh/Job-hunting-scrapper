const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { scorePosition, extractResumeSummary } = require('../src/scoring/relevanceScorer');

describe('scorePosition early-return guards', () => {
  test('missing title returns Incomplete job data with score 0', async () => {
    const job = { description: 'Some description' };
    const result = await scorePosition(job, [{ filename: 'r.txt', text: 'resume text' }]);
    assert.deepEqual(result, {
      score: 0,
      matched_resume: null,
      reasoning: 'Incomplete job data'
    });
  });

  test('missing description returns Incomplete job data with score 0', async () => {
    const job = { title: 'Backend Engineer' };
    const result = await scorePosition(job, [{ filename: 'r.txt', text: 'resume text' }]);
    assert.deepEqual(result, {
      score: 0,
      matched_resume: null,
      reasoning: 'Incomplete job data'
    });
  });

  test('empty resumes array returns No resumes available for scoring', async () => {
    const job = { title: 'Backend Engineer', description: 'Some description' };
    const result = await scorePosition(job, []);
    assert.deepEqual(result, {
      score: 0,
      matched_resume: null,
      reasoning: 'No resumes available for scoring'
    });
  });
});

describe('extractResumeSummary', () => {
  const sampleResume = `
    Jane Doe
    Senior Software Engineer

    Summary: Backend developer with 8+ years experience building scalable systems.

    Skills: Java, Spring, AWS, Kubernetes, Docker, PostgreSQL
  `;

  test('extracts years of experience', () => {
    const summary = extractResumeSummary(sampleResume);
    assert.equal(summary.yearsExperience, '8+ years');
  });

  test('extracts seniority level', () => {
    const summary = extractResumeSummary(sampleResume);
    assert.equal(summary.seniority, 'Senior');
  });

  test('returns "Not specified" fields when nothing matches', () => {
    const summary = extractResumeSummary('A short resume with no useful keywords.');
    assert.equal(summary.yearsExperience, 'Not specified');
    assert.equal(summary.seniority, 'Not specified');
    assert.equal(summary.targetRoles, 'Not specified');
    assert.equal(summary.keySkills, 'Not specified');
  });
});
