require('dotenv').config();

const { parseSearchParams } = require('../utils/csvParser');
const { parseResumes } = require('../utils/resumeParser');



const { scrapeByPlatform } = require('./apiAgent');
const { scrapeBrowser } = require('./playwrightAgent');
const { scorePosition } = require('../scoring/relevanceScorer');
const { hashJob } = require('../utils/hasher');
const { extractAllFields, matchesProfile } = require('../utils/jobFieldExtractor');
const { isWithinTimeWindow } = require('../utils/timeWindow');
const {
  getActiveCompanies,
  checkPositionExists,
  addPosition,
  createScrapeRun,
  updateScrapeRun,
  getAllProfiles,
  linkPositionToProfile,
  updatePositionProfileScore,
  setTimeWindowPreference,
  getTimeWindowPreference
} = require('../db/queries');

let currentRunId = null;
let isRunning = false;
let timeWindow = 30; // Default: last 30 days (will be loaded from DB in runScraper)
let scrapeTimeoutHandle = null;
const SCRAPER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max

// Thread safety: simple mutex for state changes
const stateMutex = { locked: false };

async function acquireStateLock() {
  while (stateMutex.locked) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  stateMutex.locked = true;
}

function releaseStateLock() {
  stateMutex.locked = false;
}

function setTimeWindow(window) {
  timeWindow = window;
  setTimeWindowPreference(window); // Persist to DB
}

function getTimeWindow() {
  return timeWindow;
}

function stopScraperGracefully() {
  console.log('[TIMEOUT] Scraper timeout reached - force stopping');
  isRunning = false;
  if (scrapeTimeoutHandle) {
    clearTimeout(scrapeTimeoutHandle);
  }
}

async function runScraper() {
  // Acquire lock before checking/modifying state
  await acquireStateLock();
  try {
    if (isRunning) {
      console.log('Scraper already running');
      return null;
    }
    isRunning = true;
  } finally {
    releaseStateLock();
  }

  const startedAt = new Date().toISOString();

  // Set timeout to prevent infinite hangs
  scrapeTimeoutHandle = setTimeout(() => {
    stopScraperGracefully();
  }, SCRAPER_TIMEOUT_MS);

  try {
    // Load time window preference from database
    timeWindow = getTimeWindowPreference() || 30;

    console.log(`[${new Date().toLocaleTimeString()}] Starting scraper run...`);
    console.log(`Time window: ${timeWindow} days`);

    // Create run record
    currentRunId = createScrapeRun(startedAt);
    console.log(`Run ID: ${currentRunId}`);

    // Load resumes once
    const resumes = await parseResumes();
    console.log(`Loaded ${resumes.length} resume(s)`);

    if (resumes.length === 0) {
      console.warn('No resumes found - scoring will be limited');
    }

    // Load profiles
    const profiles = getAllProfiles();
    console.log(`Loaded ${profiles.length} profile(s)`);

    // Parse job types for each profile
    const profilesWithParsed = profiles.map(p => ({
      ...p,
      parsed_job_types: JSON.parse(p.job_types || '[]')
    }));

    // Load search params
    const searchParams = await parseSearchParams();
    console.log(`Loaded ${searchParams.length} search parameter(s)`);

    // Get active companies
    const companies = getActiveCompanies();
    console.log(`Found ${companies.length} active companies`);

    let totalCompaniesVisited = 0;
    let totalPositionsFound = 0;
    let totalPositionsNew = 0;
    const errors = [];

    // Scrape each company
    for (const company of companies) {
      try {
        console.log(`\nScraping: ${company.name}`);
        totalCompaniesVisited++;

        let jobs = null;

        // Try API first (skip for 'unknown' or 'custom' platforms)
        if (company.platform && company.platform !== 'unknown' && company.platform !== 'custom') {
          try {
            jobs = await scrapeByPlatform(company);
            if (jobs) {
              console.log(`  ✓ API scraper found ${jobs.length} positions`);
            }
          } catch (apiError) {
            console.log(`  API failed: ${apiError.message}`);
          }
        }

        // Fall back to Playwright if API fails or unknown platform
        if (!jobs) {
          try {
            jobs = await scrapeBrowser(company.career_url, company);
            if (jobs && jobs.length > 0) {
              console.log(`  ✓ Playwright found ${jobs.length} positions`);
            } else {
              console.log(`  ✗ Playwright found no positions`);
              jobs = [];
            }
          } catch (browserError) {
            console.log(`  Playwright failed: ${browserError.message}`);
            jobs = [];
          }
        }

        // Process each job
        for (const job of jobs) {
          try {
            // Extract all fields from job posting
            const extracted = extractAllFields(
              job.title || '',
              job.description || '',
              job.bannerText || ''
            );

            // Check if position is closed
            if (extracted.isClosed) {
              console.log(`  ⊗ Skipped closed position: ${job.title}`);
              continue;
            }

            // Check time window
            if (!isWithinTimeWindow(job.publishDate, timeWindow)) {
              console.log(`  ⊗ Skipped old position: ${job.title} (${job.publishDate})`);
              continue;
            }

            totalPositionsFound++;

            // Add company to job data
            const jobWithCompany = {
              ...job,
              country: job.country || company.country,
              jobType: extracted.jobType,
              locationType: extracted.locationType,
              yearsExperience: extracted.yearsExperience,
              seniorityLevel: extracted.seniorityLevel
            };

            // Compute hash
            const hash = hashJob(jobWithCompany);

            // Check dedup
            if (checkPositionExists(hash)) {
              console.log(`  ✓ Skipped duplicate: ${job.title}`);
              continue;
            }

            // Score position (general scoring)
            let scoreData = { score: 0, matched_resume: null, reasoning: 'No resumes loaded' };
            if (resumes.length > 0) {
              try {
                scoreData = await scorePosition(jobWithCompany, resumes);
              } catch (scoreError) {
                console.error(`    Error scoring: ${scoreError.message}`);
                scoreData = { score: 0, matched_resume: null, reasoning: 'Scoring error' };
              }
            }

            // Insert position with extracted fields
            const result = addPosition(
              hash,
              company.id,
              jobWithCompany.country,
              jobWithCompany.title,
              jobWithCompany.description,
              jobWithCompany.qualifications,
              jobWithCompany.publishDate,
              jobWithCompany.link,
              extracted.jobType[0] || 'Unspecified',
              extracted.locationType,
              extracted.yearsExperience,
              extracted.seniorityLevel,
              scoreData.score,
              scoreData.matched_resume
            );

            if (result.id) {
              totalPositionsNew++;
              console.log(`  ✓ New: ${job.title} (Score: ${scoreData.score})`);

              // Link to matching profiles
              if (profilesWithParsed.length > 0) {
                try {
                  for (const profile of profilesWithParsed) {
                    if (matchesProfile(extracted, profile.parsed_job_types)) {
                      try {
                        linkPositionToProfile(result.id, profile.id, scoreData.score);
                        console.log(`    → Linked to profile: ${profile.name}`);
                      } catch (linkErr) {
                        // Already linked, skip
                      }
                    }
                  }
                } catch (profileLinkError) {
                  console.error(`    Error linking profiles: ${profileLinkError.message}`);
                }
              }
            } else if (result.isDuplicate) {
              console.log(`  ✓ Skipped duplicate: ${job.title}`);
            } else {
              console.error(`  ✗ Failed to insert: ${job.title}`);
              errors.push(`Failed to insert job: ${job.title}`);
            }
          } catch (jobError) {
            errors.push(`Error processing job: ${jobError.message}`);
            console.error(`  Error processing job: ${jobError.message}`);
          }
        }

        // Rate limiting: delay between companies
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (companyError) {
        errors.push(`Error processing ${company.name}: ${companyError.message}`);
        console.error(`Error processing ${company.name}: ${companyError.message}`);
      }
    }

    // Update run record
    const finishedAt = new Date().toISOString();
    updateScrapeRun(
      currentRunId,
      finishedAt,
      totalCompaniesVisited,
      totalPositionsFound,
      totalPositionsNew,
      JSON.stringify(errors)
    );

    console.log(`\n[${new Date().toLocaleTimeString()}] Run complete!`);
    console.log(`Companies visited: ${totalCompaniesVisited}`);
    console.log(`Positions found: ${totalPositionsFound}`);
    console.log(`New positions: ${totalPositionsNew}`);
    if (errors.length > 0) {
      console.log(`Errors: ${errors.length}`);
    }

    return {
      runId: currentRunId,
      companiesVisited: totalCompaniesVisited,
      positionsFound: totalPositionsFound,
      positionsNew: totalPositionsNew,
      errors,
      timeWindow
    };
  } catch (error) {
    console.error('Critical scraper error:', error.message);
    if (currentRunId) {
      updateScrapeRun(currentRunId, new Date().toISOString(), 0, 0, 0, JSON.stringify([error.message]));
    }
    throw error;
  } finally {
    // Ensure state is safely released
    await acquireStateLock();
    try {
      isRunning = false;
    } finally {
      releaseStateLock();
    }
  }
}

function getRunStatus() {
  return {
    running: isRunning,
    current_run_id: currentRunId
  };
}

module.exports = {
  runScraper,
  getRunStatus,
  setTimeWindow,
  getTimeWindow
};
