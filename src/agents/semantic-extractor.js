/**
 * Semantic Extractor Sub-Agent
 * Intelligently extracts job listings from page HTML using configurable LLM
 * Encapsulates all LLM reasoning - called by webScrapingAgent
 */

const { createClient } = require('../utils/llmFactory');
const { MODELS } = require('../config');
const {
  getExtractionPrompt,
  getValidationPrompt,
  getCompanyExtractionPrompt,
  INTELLIGENT_EXTRACTION_CONFIG,
} = require('../utils/extractionPrompts');

/**
 * Extract jobs from HTML content intelligently using configured LLM
 * @param {string} htmlContent - Full page HTML
 * @param {object} companyContext - { name, country, url }
 * @returns {Promise<Array>} Array of extracted jobs
 */
async function extractJobsIntelligently(htmlContent, companyContext = {}) {
  // Truncate huge HTML payloads (some pages are 10MB+)
  const truncatedHtml = htmlContent.length > 200000
    ? extractVisibleText(htmlContent).substring(0, 200000)
    : htmlContent;

  try {
    // Try primary LLM (Claude by default, configurable via env)
    const provider = process.env.EXTRACTION_PROVIDER || 'anthropic';
    try {
      console.log(`  → Attempting ${provider} for extraction...`);
      return await extractWithLLM(truncatedHtml, companyContext, provider);
    } catch (error) {
      console.warn(`  ⚠ ${provider} extraction failed (${error.message}), trying fallback...`);
    }

    // Fallback to Ollama
    if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL) {
      try {
        console.log('  → Attempting Ollama for extraction...');
        return await extractWithLLM(truncatedHtml, companyContext, 'ollama');
      } catch (error) {
        console.warn(`  ⚠ Ollama extraction failed (${error.message})`);
      }
    }

    console.error('  ✗ No LLM available for extraction');
    return [];
  } catch (error) {
    console.error(`Extraction error: ${error.message}`);
    return [];
  }
}

/**
 * Call any LLM via the factory for intelligent extraction
 */
async function extractWithLLM(htmlContent, companyContext, provider) {
  const client = createClient(provider, {
    apiKey: provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : null
  });

  const prompt = getExtractionPrompt(htmlContent, companyContext);

  try {
    const response = await client.complete(prompt, {
      model: provider === 'anthropic' ? MODELS.CLAUDE_MAIN : MODELS.OLLAMA_DEFAULT,
      maxTokens: 4096
    });

    const content = response.text;
    const jobs = parseExtractionResponse(content);

    // Validate results using same LLM
    await validateExtractionResults(jobs, client);

    return jobs;
  } catch (error) {
    throw new Error(`${provider} extraction failed: ${error.message}`);
  }
}

/**
 * Parse LLM response into job array
 * Handles markdown code blocks, escaped JSON, etc.
 */
function parseExtractionResponse(content) {
  if (!content) return [];

  try {
    // Remove markdown code blocks if present
    let jsonStr = content;
    if (jsonStr.includes('```json')) {
      jsonStr = jsonStr.split('```json')[1].split('```')[0];
    } else if (jsonStr.includes('```')) {
      jsonStr = jsonStr.split('```')[1].split('```')[0];
    }

    jsonStr = jsonStr.trim();

    // Try to parse as JSON
    const parsed = JSON.parse(jsonStr);

    // Ensure it's an array
    if (!Array.isArray(parsed)) {
      console.warn('LLM returned non-array response');
      return [];
    }

    // Sanitize each job
    return parsed
      .filter(job => job.job_title && job.job_description)
      .map(job => ({
        title: String(job.job_title).trim(),
        description: String(job.job_description).trim(),
        location: job.location ? String(job.location).trim() : null,
        job_type: job.job_type ? String(job.job_type).trim() : null,
        years_required: job.years_required ? String(job.years_required).trim() : null,
        salary: job.salary ? String(job.salary).trim() : null,
        link: job.link ? String(job.link).trim() : null,
      }));
  } catch (error) {
    console.error(`Failed to parse extraction response: ${error.message}`);
    return [];
  }
}

/**
 * Validate extraction results using LLM
 * Ensures data quality by asking LLM to check its own work
 */
async function validateExtractionResults(jobs, llmClient) {
  if (jobs.length === 0) return;

  try {
    const validationPrompt = getValidationPrompt(jobs);

    const response = await llmClient.complete(validationPrompt, {
      model: MODELS.CLAUDE_MAIN,
      maxTokens: 1024
    });

    const content = response.text;
    const validation = JSON.parse(content);

    if (!validation.valid) {
      console.warn(`Validation detected issues: ${validation.reason}`);
      // Filter out rejected jobs
      validation.rejected_indices.forEach(idx => {
        jobs[idx] = null;
      });
      return jobs.filter(j => j !== null);
    }
  } catch (error) {
    console.warn(`Validation check failed (non-critical): ${error.message}`);
  }
}

/**
 * Extract visible text from HTML for token efficiency
 * Removes scripts, styles, and extracts meaningful content
 */
function extractVisibleText(html) {
  // Remove script and style elements
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');

  // Remove HTML tags but keep structure
  text = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

/**
 * Extract company metadata from page
 */
async function extractCompanyMetadata(htmlContent) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const client = createClient('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = getCompanyExtractionPrompt(htmlContent);

    const response = await client.complete(prompt, {
      model: MODELS.CLAUDE_MAIN,
      maxTokens: 512
    });

    const content = response.text;
    const metadata = JSON.parse(content);
    return metadata;
  } catch (error) {
    console.warn(`Could not extract company metadata: ${error.message}`);
    return null;
  }
}

module.exports = {
  extractJobsIntelligently,
  extractCompanyMetadata,
  parseExtractionResponse,
  extractVisibleText,
};
