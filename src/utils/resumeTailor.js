const { createClient, getProviderForUseCase } = require('../utils/llmFactory');
const { MODELS } = require('../config');

/**
 * Tailor a base resume to match a job description in Harvard CV format
 * @param {string} baseResumeText - Full text of the base resume
 * @param {object} job - Job object with title, company_name, description, qualifications, job_type, seniority_level
 * @param {object} profile - Profile object with job_types, seniority_level
 * @param {Array} jobTags - Tags extracted from the job posting
 * @param {Array} profileTags - Tags from the user's profile
 * @returns {Promise<string>} Tailored resume text in Harvard format
 */
async function tailorResume(baseResumeText, job, profile, jobTags = [], profileTags = []) {
  if (!baseResumeText || !job?.title) {
    throw new Error('Base resume text and job title are required for tailoring');
  }

  try {
    // Create LLM client using tailoring provider (defaults to anthropic)
    const client = createClient(getProviderForUseCase('tailoring'));

    // System prompt with strict agent rules from .opencode/agents/resume-tailor.md
    const systemPrompt = `You are a professional resume tailoring agent specializing in Harvard CV format.
STRICT RULES:
1. ONLY use information present in the base resume - never add new skills, experience, or qualifications
2. Highlight relevant experience using job keywords (only if those keywords/experiences exist in the base resume)
3. Reorder sections to put job-matching experience first
4. Keep the same professional tone and formatting as the base resume
5. Return ONLY the tailored resume text, no explanations or comments
6. Prioritize content matching job tags: ${jobTags.join(', ') || 'None'}
7. Prioritize content matching profile tags: ${profileTags.join(', ') || 'None'}
8. **Harvard Format Compliance**: Structure the tailored resume in standard Harvard CV format:
   - Header: Full name, contact info (email, phone, LinkedIn, location) at top
   - Sections in order: Education, Work Experience (reverse chronological), Skills, Certifications, Projects, Awards
   - Use clear section headings (bold, 12pt, consistent font: Arial/Times New Roman)
   - 1-inch margins, 10-12pt font size, no graphics/fancy formatting
   - Reverse chronological order for all dated entries (most recent first)
Temperature: 0.2 (strict, no creativity)`;

    // User prompt with base resume and job details
    const userPrompt = `--- BASE RESUME ---
${baseResumeText}

--- JOB DETAILS ---
Title: ${job.title}
Company: ${job.company_name || 'Unknown'}
Description: ${job.description || 'Not specified'}
Required Skills: ${job.qualifications || 'Not specified'}
Job Type: ${job.job_type || 'Not specified'}
Seniority Level: ${Array.isArray(job.seniority_level) ? job.seniority_level.join(', ') : job.seniority_level || 'Not specified'}

--- TAILORED RESUME (Harvard Format) ---`;

    // Call LLM with fast model for low latency/cost
    const response = await client.complete(userPrompt, {
      model: MODELS.CLAUDE_FAST,
      maxTokens: 15000, // Match 15k char limit
      systemPrompt,
      temperature: 0.2
    });

    let tailoredText = response.text.trim();

    // Clean up any accidental preambles the LLM might add
    if (tailoredText.includes('--- TAILORED RESUME (Harvard Format) ---')) {
      tailoredText = tailoredText.split('--- TAILORED RESUME (Harvard Format) ---')[1].trim();
    }

    // Enforce length limit
    return tailoredText.substring(0, 15000);
  } catch (error) {
    console.error('Resume tailoring failed:', error.message);
    throw new Error(`Failed to tailor resume: ${error.message}`);
  }
}

module.exports = { tailorResume };
