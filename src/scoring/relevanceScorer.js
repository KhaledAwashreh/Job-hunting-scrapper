const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function scorePosition(job, resumes) {
  if (!job.title || !job.description) {
    return {
      score: 0,
      matched_resume: null,
      reasoning: 'Incomplete job data'
    };
  }

  if (resumes.length === 0) {
    return {
      score: 0,
      matched_resume: null,
      reasoning: 'No resumes available for scoring'
    };
  }

  const resumeTexts = resumes.map((r, i) => `--- RESUME ${i + 1} (${r.filename}) ---\n${r.text}`).join('\n\n');
  const maxResumeIndex = Math.min(resumes.length, 10);
  const resumeRange = `1-${maxResumeIndex}`;

  const prompt = `You are a job-resume relevance scorer.

You will be given a job posting and candidate resumes. Your job is to:
1. Score how well the job matches each candidate's background (0–100)
2. Identify which resume (${resumeRange}) is the best match
3. Write a one-sentence reasoning

Respond ONLY with valid JSON in this exact shape:
{"score": <number 0-100>, "matched_resume": <${resumeRange}>, "reasoning": "<one sentence>"}

--- JOB ---
Title: ${job.title}
Description: ${job.description}
Qualifications: ${job.qualifications || 'Not specified'}

${resumeTexts}`

  try {
    const message = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const parsed = JSON.parse(text);

    return {
      score: Math.min(100, Math.max(0, parseInt(parsed.score) || 0)),
      matched_resume: parsed.matched_resume || null,
      reasoning: parsed.reasoning || 'No reasoning provided'
    };
  } catch (error) {
    console.error('Error scoring position:', error.message);
    return {
      score: 0,
      matched_resume: null,
      reasoning: `Error: ${error.message}`
    };
  }
}

module.exports = { scorePosition };
