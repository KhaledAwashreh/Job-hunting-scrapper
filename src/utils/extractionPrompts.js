/**
 * Extraction Prompts
 * Centralized prompt templates for intelligent job extraction
 */

const EXTRACT_JOBS_PROMPT = `You are a job listing analyzer for career pages. Your task is to extract job postings from the provided HTML.

INSTRUCTIONS:
1. Analyze the HTML and identify all job listings
2. For each job, extract these fields:
   - job_title: The position title (required)
   - job_description: First 300-500 characters of description (required)
   - location: City, region, or "Remote" (if visible)
   - job_type: One of: Full-time, Part-time, Contract, Internship, Temporary (if visible)
   - years_required: Years of experience required (if visible, e.g., "3-5")
   - salary: Salary range as string (if visible, e.g., "$80k-100k")
   - link: Full absolute URL to the job posting (if available)

3. Handle these cases:
   - If salary visible: include it
   - If salary ranges ($X-Y): keep exact format
   - If location is "Remote", set location: "Remote"
   - If job type not visible, omit the field (don't guess)
   - If years_required shows range, include as string (e.g., "5-10")

4. CRITICAL: Return ONLY valid JSON array, no markdown, no code blocks, no explanation

5. If NO jobs found, return: []

EXAMPLE OUTPUT FORMAT:
[
  {
    "job_title": "Senior Backend Engineer",
    "job_description": "We are looking for an experienced backend engineer to join our platform team. You will work with Node.js, PostgreSQL, and cloud services...",
    "location": "San Francisco, CA",
    "job_type": "Full-time",
    "years_required": "5+",
    "salary": "$120k-150k",
    "link": "https://company.com/jobs/backend-engineer-123"
  }
]

Now analyze this HTML and extract all visible jobs:`;

const VALIDATE_EXTRACTION_PROMPT = `You are a data quality validator. Check if this JSON array of job listings is valid and complete.

For each job, verify:
1. job_title exists and is meaningful (not empty, not "null", not an error message)
2. job_description exists and has substance (not empty, not "Failed to extract", not generic filler)
3. If location/job_type/salary exist, they look correct (not gibberish)

CRITICAL RULES:
- Reject any job if title or description is missing
- Reject any job with error text like "Failed", "Unable", "Error"
- Accept partial data (location/type/salary can be missing)

Return ONLY this JSON response with no explanation:
{
  "valid": true/false,
  "rejected_indices": [0, 2],
  "reason": "Brief reason if invalid"
}

If the input is valid JSON and looks reasonable, return:
{
  "valid": true,
  "rejected_indices": [],
  "reason": null
}`;

const EXTRACT_COMPANY_FROM_PAGE_PROMPT = `You are analyzing a careers page. Extract minimal company metadata.

From the HTML, extract:
1. company_name: The company name (usually in logo alt text, header, or title)
2. careers_page_title: The page title or h1 heading

Return ONLY this JSON (no markdown, no explanation):
{
  "company_name": "Company Name",
  "careers_page_title": "Careers at Company"
}`;

const INTELLIGENT_EXTRACTION_CONFIG = {
  model: process.env.OLLAMA_MODEL || 'devstral',
  timeout: 30000, // 30 seconds for LLM
  maxRetries: 2,
  retryDelay: 1000,
  validateExtraction: true,
};

function getExtractionPrompt(htmlContent, companyContext = {}) {
  const company = companyContext.name || 'a company';
  const country = companyContext.country || 'global';
  
  return `${EXTRACT_JOBS_PROMPT}

CONTEXT:
- Company: ${company}
- Country: ${country}
- Page URL: ${companyContext.url || 'unknown'}

HTML CONTENT:
${htmlContent}`;
}

function getValidationPrompt(jsonArray) {
  return `${VALIDATE_EXTRACTION_PROMPT}

JSON to validate:
${JSON.stringify(jsonArray, null, 2)}`;
}

function getCompanyExtractionPrompt(htmlContent) {
  return `${EXTRACT_COMPANY_FROM_PAGE_PROMPT}

HTML CONTENT:
${htmlContent}`;
}

module.exports = {
  EXTRACT_JOBS_PROMPT,
  VALIDATE_EXTRACTION_PROMPT,
  EXTRACT_COMPANY_FROM_PAGE_PROMPT,
  INTELLIGENT_EXTRACTION_CONFIG,
  getExtractionPrompt,
  getValidationPrompt,
  getCompanyExtractionPrompt,
};
