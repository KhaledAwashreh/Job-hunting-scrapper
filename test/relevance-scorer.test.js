const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { scorePosition, extractResumeSummary, parseScoringResponse } = require('../src/scoring/relevanceScorer');

// A stub OpenAI-protocol server, same shape as test/llm-factory.providers.test.js's
// startStub — reused here (not imported, to keep the two test files independent)
// so scorePosition can be exercised end-to-end against canned LLM replies without
// ever hitting a real Anthropic/OpenAI/Ollama endpoint.
function startStub() {
  const state = { reply: '', status: 200 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      res.statusCode = state.status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: state.reply } }] }));
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      state.baseUrl = `http://127.0.0.1:${server.address().port}`;
      state.close = () => new Promise(r => server.close(r));
      resolve(state);
    });
  });
}

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

// Issue #44 — parseScoringResponse must recover JSON from fences/prose instead
// of only handling bare JSON.
describe('parseScoringResponse', () => {
  test('parses bare JSON', () => {
    assert.deepEqual(
      parseScoringResponse('{"score": 80, "matched_resume": 1, "reasoning": "Good fit"}'),
      { score: 80, matched_resume: 1, reasoning: 'Good fit' }
    );
  });

  test('strips a ```json fenced block', () => {
    const text = '```json\n{"score": 65, "matched_resume": 2, "reasoning": "Decent"}\n```';
    assert.deepEqual(parseScoringResponse(text), { score: 65, matched_resume: 2, reasoning: 'Decent' });
  });

  test('strips a plain ``` fenced block (no language tag)', () => {
    const text = '```\n{"score": 40, "matched_resume": null, "reasoning": "Weak"}\n```';
    assert.deepEqual(parseScoringResponse(text), { score: 40, matched_resume: null, reasoning: 'Weak' });
  });

  test('extracts JSON surrounded by prose', () => {
    const text = 'Sure, here is my assessment:\n{"score": 55, "matched_resume": 1, "reasoning": "OK match"}\nHope that helps!';
    assert.deepEqual(parseScoringResponse(text), { score: 55, matched_resume: 1, reasoning: 'OK match' });
  });

  test('returns null for truncated JSON', () => {
    assert.equal(parseScoringResponse('{"score": 80, "matched_resume":'), null);
  });

  test('returns null for an empty string', () => {
    assert.equal(parseScoringResponse(''), null);
  });
});

// Issues #44 and #45, exercised end-to-end through scorePosition() against a
// local stub so the full parse/validate path (not just the helper) is covered.
describe('scorePosition — LLM response parsing and validation', () => {
  let stub;
  let savedEnv;

  before(async () => {
    stub = await startStub();
  });

  after(async () => {
    await stub.close();
  });

  beforeEach(() => {
    savedEnv = {
      SCORING_PROVIDER: process.env.SCORING_PROVIDER,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL
    };
    process.env.SCORING_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'dummy';
    process.env.OPENAI_BASE_URL = stub.baseUrl;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const job = { title: 'Backend Engineer', description: 'Build APIs' };
  const resumes = [
    { filename: 'r1.txt', text: 'Backend engineer with Java experience' },
    { filename: 'r2.txt', text: 'Frontend engineer with React experience' }
  ];

  test('a ```json fenced reply scores correctly, not a silent 0', async () => {
    stub.reply = '```json\n{"score": 82, "matched_resume": 1, "reasoning": "Strong match"}\n```';
    const result = await scorePosition(job, resumes);
    assert.equal(result.score, 82);
    assert.equal(result.matched_resume, 1);
  });

  test('a prose-wrapped reply scores correctly, not a silent 0', async () => {
    stub.reply = 'Based on the posting, here is my scoring:\n{"score": 73, "matched_resume": 2, "reasoning": "Good overlap"}\nLet me know if you need more.';
    const result = await scorePosition(job, resumes);
    assert.equal(result.score, 73);
    assert.equal(result.matched_resume, 2);
  });

  test('unparseable JSON yields sentinel -1, distinguishable from a genuine 0', async () => {
    stub.reply = '{"score": 80, "matched_resume":'; // truncated
    const result = await scorePosition(job, resumes);
    assert.equal(result.score, -1);
    assert.equal(result.matched_resume, null);
    assert.equal(result.reasoning, 'Scoring response parsing failed');
  });

  test('an empty reply yields sentinel -1', async () => {
    stub.reply = '';
    const result = await scorePosition(job, resumes);
    assert.equal(result.score, -1);
  });

  test('a genuine score of 0 is preserved (not confused with the parse-failure sentinel)', async () => {
    stub.reply = '{"score": 0, "matched_resume": null, "reasoning": "No overlap at all"}';
    const result = await scorePosition(job, resumes);
    assert.equal(result.score, 0);
    assert.notEqual(result.score, -1);
  });

  test('an out-of-range matched_resume is rejected, not stored raw', async () => {
    stub.reply = '{"score": 90, "matched_resume": 99, "reasoning": "Great fit"}';
    const result = await scorePosition(job, resumes); // only 2 resumes loaded
    assert.equal(result.matched_resume, null);
    assert.equal(result.score, 90, 'score itself should still be usable');
  });

  test('a non-numeric matched_resume is rejected, not stored raw', async () => {
    stub.reply = '{"score": 90, "matched_resume": "Resume 1", "reasoning": "Great fit"}';
    const result = await scorePosition(job, resumes);
    assert.equal(result.matched_resume, null);
  });

  test('a numeric-string matched_resume within range is coerced to a number', async () => {
    stub.reply = '{"score": 90, "matched_resume": "1", "reasoning": "Great fit"}';
    const result = await scorePosition(job, resumes);
    assert.equal(result.matched_resume, 1);
    assert.equal(typeof result.matched_resume, 'number');
  });
});
