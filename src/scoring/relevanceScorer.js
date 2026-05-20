const { createClient } = require('../utils/llmFactory');
const { MODELS } = require('../config');

/**
 * Extract key information from resume text for better matching
 * @param {string} resumeText - The full resume text
 * @returns {object} Summary of resume key points
 */
function extractResumeSummary(resumeText) {
  const text = resumeText.toLowerCase();
  
  // Extract target job titles/roles
  const rolePatterns = [
    /software engineer/i, /backend developer/i, /frontend developer/i,
    /full stack developer/i, /devops engineer/i, /data engineer/i,
    /machine learning engineer/i, /ai engineer/i, /ml engineer/i,
    /data scientist/i, /product manager/i, /technical lead/i,
    /architect/i, /consultant/i, /sre/i, /platform engineer/i
  ];
  const foundRoles = rolePatterns.filter(p => p.test(text)).map(p => p.source);
  
  // Extract years of experience
  const yearsMatch = text.match(/(\d+)\+?\s*years?\s*(of\s*)?experience/i);
  const years = yearsMatch ? parseInt(yearsMatch[1]) : null;
  
  // Extract seniority keywords
  const seniorityPatterns = {
    'Junior': /junior|jr\.|entry.?level|graduate|intern/i,
    'Mid-Level': /mid.?level|intermediate|mid.?senior/i,
    'Senior': /senior|sr\.|lead|principal|staff/i,
    'Principal/Architect': /principal|architect|director|head|chief/i
  };
  let seniority = 'Not specified';
  for (const [level, pattern] of Object.entries(seniorityPatterns)) {
    if (pattern.test(text)) {
      seniority = level;
      break;
    }
  }
  
  // Extract key skills (tech stack)
  const skillPatterns = [
    /java\s*(?:spring|springboot)?/i, /python/i, /javascript/i, /typescript/i,
    /react/i, /node\.?js/i, /golang|go\s+lang/i, /rust/i, /c\+\+/i,
    /aws|amazon\s*web\s*services/i, /azure/i, /gcp|google\s*cloud/i,
    /kubernetes|k8s/i, /docker/i, /terraform/i, /ansible/i,
    /sql/i, /postgresql|mysql|mongodb/i, /redis/i,
    /machine learning|ml|deep learning/i, /tensorflow|pytorch/i,
    /ai|artificial intelligence|llm|generative ai/i,
    /spark|hadoop|kafka/i, /data pipeline/i
  ];
  const foundSkills = skillPatterns.filter(p => p.test(text)).map(p => p.source.replace(/[()]/g, '').trim());
  
  return {
    targetRoles: foundRoles.length > 0 ? foundRoles.join(', ') : 'Not specified',
    yearsExperience: years ? `${years}+ years` : 'Not specified',
    seniority: seniority,
    keySkills: foundSkills.length > 0 ? foundSkills.slice(0, 10).join(', ') : 'Not specified'
  };
}

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
      jobQualifications = await translateToEnglish(jobQualifications, language);
    }
  }

  // Build resume summaries with extracted key info
  const resumeSummaries = resumes.map((r, i) => {
    const summary = extractResumeSummary(r.text);
    return `--- RESUME ${i + 1} (${r.filename}) ---
SUMMARY:
- Target Roles: ${summary.targetRoles}
- Experience: ${summary.yearsExperience}
- Seniority Level: ${summary.seniority}
- Key Skills: ${summary.keySkills}

FULL TEXT:
${r.text.substring(0, 5000)}`; // Limit text length
  }).join('\n\n');

  const maxResumeIndex = Math.min(resumes.length, 10);
  const resumeRange = `1-${maxResumeIndex}`;

  const prompt = `You are a job-resume relevance scorer.
  
You will be given a job posting and candidate resumes. Your job is to:
1. Score how well the job matches each candidate's background (0-100)
2. Identify which resume (${resumeRange}) is the best match
3. Write a one-sentence reasoning

IMPORTANT MATCHING CRITERIA:
- Job title should align with resume target roles
- Required experience level should match resume seniority
- Required skills should overlap with resume key skills
- Consider years of experience requirements

Respond ONLY with valid JSON in this exact shape:
{"score": <number 0-100>, "matched_resume": <${resumeRange}>, "reasoning": "<one sentence>"}

--- JOB ---
Title: ${job.title}
Description: ${jobDescription}
Qualifications: ${jobQualifications}
Required Seniority: ${job.seniorityLevel || 'Not specified'}
Required Skills: ${job.jobType || 'Not specified'}

${resumeSummaries}`;

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
