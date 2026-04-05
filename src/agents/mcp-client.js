const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function invokeMCPScraperAgent(careerUrl, criteria = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null; // MCP not available without API key
  }

  const {
    maxJobs = 50,
    country = null,
    seniority = null,
    keywords = null,
    timeout = 60000
  } = criteria;

  let taskDescription = `Navigate to ${careerUrl} and extract job postings. `;

  if (country) {
    taskDescription += `Filter for jobs in: ${country}. `;
  }
  if (seniority) {
    taskDescription += `Prefer ${seniority} level positions. `;
  }
  if (keywords) {
    taskDescription += `Look for keywords: ${Array.isArray(keywords) ? keywords.join(', ') : keywords}. `;
  }

  taskDescription += `
Extract the following for each job (limit to ${maxJobs} jobs):
- title: Job title (string)
- description: Full job description or posting text (max 2000 chars)
- qualifications: Required qualifications/experience (max 1000 chars)
- publishDate: Publication date in YYYY-MM-DD format if available
- link: Direct URL to job posting (must be valid HTTP URL)
- country: Country where job is located
- location: City/region if available

Return ONLY a valid JSON array of job objects. No markdown, no explanation, just the JSON array.
Example format:
[
  {
    "title": "Senior Engineer",
    "description": "...",
    "qualifications": "...",
    "publishDate": "2026-04-05",
    "link": "https://example.com/job/123",
    "country": "Netherlands",
    "location": "Amsterdam"
  }
]
`;

  try {
    const message = await client.messages.create(
      {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8192,
        messages: [
          {
            role: 'user',
            content: taskDescription
          }
        ]
      },
      {
        timeout
      }
    );

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

    // Try to extract JSON from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const jobs = JSON.parse(jsonMatch[0]);
      if (Array.isArray(jobs)) {
        return jobs.slice(0, maxJobs);
      }
    }

    console.warn('MCP agent did not return valid JSON:', responseText.substring(0, 200));
    return null;
  } catch (error) {
    console.error(`MCP scraper agent error: ${error.message}`);
    return null;
  }
}

// Alternative: invoke with full agent context (if using Claude directly as agent)
async function invokeMCPWithReasoning(careerUrl, criteria = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null;
  }

  const systemPrompt = `You are a web scraping specialist. Your task is to extract job postings from websites.

You have access to a browser and can:
- Navigate to URLs
- Click buttons and links
- Fill search fields
- Wait for content to load
- Extract data from HTML

Always:
1. Navigate to the given URL
2. Wait for content to fully load
3. Look for job listings
4. Extract structured data
5. Return valid JSON

If blocked or unable to access, return empty array with error message.`;

  try {
    const message = await client.messages.create(
      {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8192,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Extract jobs from: ${careerUrl}\n\nCriteria: ${JSON.stringify(criteria)}\n\nReturn JSON array of jobs.`
          }
        ]
      }
    );

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);

    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return null;
  } catch (error) {
    console.error(`MCP reasoning agent error: ${error.message}`);
    return null;
  }
}

module.exports = {
  invokeMCPScraperAgent,
  invokeMCPWithReasoning
};
