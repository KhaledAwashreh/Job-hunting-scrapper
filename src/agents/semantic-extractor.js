/**
 * Semantic Extractor Sub-Agent
 * Intelligently extracts job listings from page HTML using Claude/Ollama
 * Encapsulates all LLM reasoning - called by playwrightAgent
 */

const { Anthropic } = require('@anthropic-ai/sdk');
const axios = require('axios');
const {
  getExtractionPrompt,
  getValidationPrompt,
  getCompanyExtractionPrompt,
  INTELLIGENT_EXTRACTION_CONFIG,
} = require('../utils/extractionPrompts');

/**
 * Extract jobs from HTML content intelligently using Claude/Ollama
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
    // Try Claude first (if API key available)
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        console.log('  → Attempting Claude for extraction...');
        return await extractWithClaude(truncatedHtml, companyContext);
      } catch (error) {
        console.warn(`  ⚠ Claude extraction failed (${error.message}), trying Ollama...`);
      }
    }

    // Fallback to Ollama
    if (process.env.OLLAMA_API_KEY || process.env.OLLAMA_BASE_URL) {
      try {
        console.log('  → Attempting Ollama for extraction...');
        return await extractWithOllama(truncatedHtml, companyContext);
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
 * Call Claude API for intelligent extraction
 */
async function extractWithClaude(htmlContent, companyContext) {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const prompt = getExtractionPrompt(htmlContent, companyContext);

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = response.content[0].type === 'text' ? response.content[0].text : '';
    const jobs = parseExtractionResponse(content);

    // Validate results
    await validateExtractionResults(jobs, client);

    return jobs;
  } catch (error) {
    throw new Error(`Claude extraction failed: ${error.message}`);
  }
}

/**
 * Call Ollama API for intelligent extraction
 */
async function extractWithOllama(htmlContent, companyContext) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'devstral';
  const prompt = getExtractionPrompt(htmlContent, companyContext);

  try {
    const response = await axios.post(
      `${baseUrl}/api/generate`,
      {
        model,
        prompt,
        stream: false,
      },
      { timeout: INTELLIGENT_EXTRACTION_CONFIG.timeout }
    );

    const content = response.data.response || '';
    const jobs = parseExtractionResponse(content);
    return jobs;
  } catch (error) {
    throw new Error(`Ollama extraction failed: ${error.message}`);
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
        job_title: String(job.job_title).trim(),
        job_description: String(job.job_description).trim(),
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
 * Validate extraction results using Claude
 * Ensures data quality by asking Claude to check its own work
 */
async function validateExtractionResults(jobs, claudeClient) {
  if (jobs.length === 0) return;

  try {
    const validationPrompt = getValidationPrompt(jobs);
    
    const response = await claudeClient.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: validationPrompt,
        },
      ],
    });

    const content = response.content[0].type === 'text' ? response.content[0].text : '{}';
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
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const prompt = getCompanyExtractionPrompt(htmlContent);

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = response.content[0].type === 'text' ? response.content[0].text : '{}';
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
