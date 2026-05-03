const { createClient } = require('../utils/llmFactory');
const { MODELS } = require('../config');

/**
 * Translate text to English using configured LLM
 * @param {string} text - Text to translate
 * @param {string} sourceLang - Source language name
 * @returns {Promise<string>} Translated text
 */
async function translateToEnglish(text, sourceLang) {
  if (!text || sourceLang === 'English') return text;

  try {
    const client = createClient('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.complete(
      `Translate the following job posting from ${sourceLang} to English. 
Keep technical terms, company names, and job titles intact. 
Return ONLY the translated text, no explanations.\n\n${text}`,
      {
        model: MODELS.CLAUDE_FAST, // Use fast model for translation
        maxTokens: 4000
      }
    );

    const translated = response.text;
    console.log(`  ✓ Translated from ${sourceLang} to English (${text.length} → ${translated.length} chars)`);
    return translated;
  } catch (error) {
    console.error(`  ⚠ Translation failed: ${error.message}`);
    return text; // Return original on failure
  }
}

async function scorePosition(job, resumes, language = 'English') {
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

  // Translate job description and qualifications if not in English
  let jobDescription = job.description;
  let jobQualifications = job.qualifications || 'Not specified';

  if (language !== 'English') {
    console.log(`  → Translating job from ${language} to English...`);
    jobDescription = await translateToEnglish(jobDescription, language);
    if (job.qualifications) {
      jobQualifications = await translateToEnglish(job.qualifications, language);
    }
  }

  const resumeTexts = resumes.map((r, i) => `--- RESUME ${i + 1} (${r.filename}) ---\n${r.text}`).join('\n\n');
  const maxResumeIndex = Math.min(resumes.length, 10);
  const resumeRange = `1-${maxResumeIndex}`;

  const prompt = `You are a job-resume relevance scorer.
  
You will be given a job posting and candidate resumes. Your job is to:
1. Score how well the job matches each candidate's background (0-100)
2. Identify which resume (${resumeRange}) is the best match
3. Write a one-sentence reasoning

Respond ONLY with valid JSON in this exact shape:
{"score": <number 0-100>, "matched_resume": <${resumeRange}>, "reasoning": "<one sentence>"}

--- JOB ---
Title: ${job.title}
Description: ${jobDescription}
Qualifications: ${jobQualifications}

${resumeTexts}`;

  try {
    const client = createClient('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.complete(prompt, {
      model: MODELS.CLAUDE_MAIN,
      maxTokens: 200
    });

    const text = response.text;
    
    // Handle JSON parsing with fallback
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseErr) {
      console.warn('Failed to parse scoring response as JSON:', parseErr.message);
      return {
        score: 0,
        matched_resume: null,
        reasoning: 'Scoring response parsing failed'
      };
    }

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
