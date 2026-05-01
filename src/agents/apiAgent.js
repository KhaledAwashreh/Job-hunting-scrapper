const axios = require('axios');

// Rate limiting: minimum delay between API requests (ms)
const API_RATE_LIMIT_MS = 1000;

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeGreenhouse(slug) {
  try {
    // Apply rate limiting
    await delay(API_RATE_LIMIT_MS);
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
    const response = await axios.get(url, { timeout: 10000 });

    if (!response.data || !response.data.jobs) {
      return [];
    }

    return response.data.jobs.map(job => ({
      title: job.title || '',
      description: job.content || '',
      qualifications: extractQualifications(job.content),
      publishDate: job.updated_at ? new Date(job.updated_at).toISOString().split('T')[0] : '',
      link: job.absolute_url || '',
      country: extractCountry(job.location?.name) || ''
    })).filter(j => j.title);
  } catch (error) {
    console.error('Greenhouse API error:', error.message);
    return [];
  }
}

async function scrapeLever(slug) {
  try {
    // Apply rate limiting
    await delay(API_RATE_LIMIT_MS);
    const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
    const response = await axios.get(url, { timeout: 10000 });

    if (!response.data || !response.data.postings) {
      return [];
    }

    return response.data.postings.map(job => ({
      title: job.text || '',
      description: job.content?.text || '',
      qualifications: extractQualifications(job.content?.text),
      publishDate: job.createdAt ? new Date(job.createdAt).toISOString().split('T')[0] : '',
      link: job.hostedUrl || '',
      country: extractCountry(job.locations?.[0]?.name) || ''
    })).filter(j => j.title);
  } catch (error) {
    console.error('Lever API error:', error.message);
    return [];
  }
}

async function scrapeWorkday(company, careerUrl) {
  // Workday URLs are complex and company-specific
  // In production, would need custom parsing or Playwright fallback
  console.warn(`Workday scraping not implemented - falling back to Playwright: ${company}`);
  return null;
}

async function scrapeByPlatform(company) {
  const { platform, platform_slug, career_url } = company;

  if (!career_url) {
    return null;
  }

  if (platform === 'greenhouse' && platform_slug) {
    return await scrapeGreenhouse(platform_slug);
  }

  if (platform === 'lever' && platform_slug) {
    return await scrapeLever(platform_slug);
  }

  if (platform === 'workday') {
    return await scrapeWorkday(company.name, career_url);
  }

  return null;
}

function extractQualifications(text) {
  if (!text) return '';

  const qualLines = text.match(/(?:requirements|qualifications|must have|required|we're looking for)[\s\S]{0,500}?(?=\n\n|$)/gi) || [];
  return qualLines.join('\n').substring(0, 500);
}

function extractCountry(locationText) {
  if (!locationText) return '';

  const countryMap = {
    // Western Europe
    'netherlands': 'Netherlands',
    'spain': 'Spain',
    'germany': 'Germany',
    'uk': 'United Kingdom',
    'united kingdom': 'United Kingdom',
    'great britain': 'United Kingdom',
    'us': 'United States',
    'usa': 'United States',
    'united states': 'United States',
    'france': 'France',
    'canada': 'Canada',
    'italy': 'Italy',
    'portugal': 'Portugal',
    'belgium': 'Belgium',
    'switzerland': 'Switzerland',
    'austria': 'Austria',
    'sweden': 'Sweden',
    'norway': 'Norway',
    'denmark': 'Denmark',
    'finland': 'Finland',
    'ireland': 'Ireland',
    'poland': 'Poland',
    'greece': 'Greece',
    // North America
    'mexico': 'Mexico',
    // Asia
    'japan': 'Japan',
    'south korea': 'South Korea',
    'singapore': 'Singapore',
    'india': 'India',
    'china': 'China',
    'australia': 'Australia',
    'new zealand': 'New Zealand',
    // Middle East
    'uae': 'United Arab Emirates',
    'saudi arabia': 'Saudi Arabia',
    'jordan': 'Jordan',
    'lebanon': 'Lebanon',
    'israel': 'Israel',
  };

  const lower = locationText.toLowerCase();
  for (const [key, country] of Object.entries(countryMap)) {
    if (lower.includes(key)) {
      return country;
    }
  }

  return locationText;
}

module.exports = {
  scrapeByPlatform,
  scrapeGreenhouse,
  scrapeLever,
  extractQualifications,
  extractCountry
};
