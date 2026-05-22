require('dotenv').config();

const logger = require('../utils/logger');
const { parseSearchParams } = require('../utils/csvParser');
const { parseResumes } = require('../utils/resumeParser');
const { detectLanguage } = require('../utils/languageDetector');



const { scrapeByPlatform } = require('./apiAgent');
const { scrapeWebsite } = require('./webScrapingAgent');
const { scorePosition } = require('../scoring/relevanceScorer');
const { hashJob } = require('../utils/hasher');
const {
  extractAllFields,
  matchesProfile,
  classifyJobType,
  extractSeniorityLevel,
  extractLocationType,
  parseJobTypes
} = require('../utils/jobFieldExtractor');
const { isWithinTimeWindow } = require('../utils/timeWindow');
const {
  getActiveCompanies,
  checkPositionExists,
  addPosition,
  createScrapeRun,
  updateScrapeRun,
  getAllProfiles,
  addProfile,
  linkPositionToProfile,
  updatePositionProfileScore,
  setTimeWindowPreference,
  getTimeWindowPreference
} = require('../db/queries');

let currentRunId = null;
let isRunning = false;
let timeWindow = 30;
let scrapeTimeoutHandle = null;
const SCRAPER_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes max for 49 companies

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
  setTimeWindowPreference(window);
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

/**
 * Ensure profiles exist. If the DB has no profiles, create them from
 * search-params.csv so filtering works correctly.
 */
function ensureProfilesFromSearchParams(searchParams, resumes) {
  const existing = getAllProfiles();
  if (existing.length > 0) return existing;

  console.log('  → No profiles found in DB. Creating from search-params.csv...');

  const created = [];
  for (let i = 0; i < searchParams.length; i++) {
    const sp = searchParams[i];
    // Use the search-param title as job_type
    const jobTypes = [sp.title];
    // Pick a resume file name if available
    const resumeFile = resumes.length > 0 ? resumes[0].filename : '';
    const profileName = `Profile ${i + 1}: ${sp.title}`;

    const id = addProfile(
      profileName,
      resumeFile,
      jobTypes,
      null, // secondaryCategory
      sp.seniority || null,
      [],
      sp.remote ? ['Remote'] : []
    );
    console.log(`  → Created profile: "${profileName}" (id=${id})`);
    created.push({
      id,
      name: profileName,
      resume_file: resumeFile,
      job_types: JSON.stringify(jobTypes),
      secondary_category: null,
      seniority_level: sp.seniority || null,
      years_of_experience: '[]',
      work_location_preference: sp.remote ? '["Remote"]' : '[]',
      parsed_job_types: jobTypes
    });
  }
  return created;
}

async function runScraper() {
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

  scrapeTimeoutHandle = setTimeout(() => {
    stopScraperGracefully();
  }, SCRAPER_TIMEOUT_MS);

  try {
    timeWindow = getTimeWindowPreference() || 30;

    console.log(`[${new Date().toLocaleTimeString()}] Starting scraper run...`);
    console.log(`Time window: ${timeWindow} days`);

    currentRunId = createScrapeRun(startedAt);
    console.log(`Run ID: ${currentRunId}`);

    // Load resumes once
    const resumes = await parseResumes();
    console.log(`Loaded ${resumes.length} resume(s)`);

    if (resumes.length === 0) {
      logger.warn('No resumes found - scoring will be limited');
    }

    // Load search params (country, seniority, remote preferences)
    const searchParams = await parseSearchParams();
    console.log(`Loaded ${searchParams.length} search parameter(s)`);

    // Load profiles — auto-create from search-params.csv if none exist
    let profiles = getAllProfiles();
    if (profiles.length === 0 && searchParams.length > 0) {
      profiles = ensureProfilesFromSearchParams(searchParams, resumes);
    }
    console.log(`Loaded ${profiles.length} profile(s)`);

    // Parse each profile's job_types
    const profilesWithParsed = profiles.map(p => ({
      ...p,
      parsed_job_types: parseJobTypes(p.job_types)
    }));

    // Build a merged list of target countries from search params
    const targetCountries = searchParams
      .map(sp => sp.country)
      .filter(Boolean)
      .map(c => c.trim().toLowerCase());

    // Build a merged list of required job types from all profiles
    const requiredJobTypes = [
      ...new Set(
        profilesWithParsed.flatMap(p => p.parsed_job_types)
      )
    ];

    console.log(`  Target countries: ${targetCountries.join(', ') || 'none (all)'}`);
    console.log(`  Required job types: ${requiredJobTypes.join(', ') || 'none (all)'}`);

    const companies = getActiveCompanies();
    console.log(`Found ${companies.length} active companies`);

    let totalCompaniesVisited = 0;
    let totalPositionsFound = 0;
    let totalPositionsNew = 0;
    let totalSkippedNoMatch = 0;
    let totalSkippedCountry = 0;
    let totalSkippedOld = 0;
    const errors = [];

    // Scrape each company
    for (const company of companies) {
      try {
        console.log(`\nScraping: ${company.name}`);
        totalCompaniesVisited++;

        let jobs = null;

        // Try API first
        if (company.platform && company.platform !== 'unknown' && company.platform !== 'custom') {
          try {
            jobs = await scrapeByPlatform(company);
            if (jobs) {
              console.log(`  ✓ API scraper found ${jobs.length} positions`);
            }
          } catch (apiError) {
            console.log(`  API failed: ${apiError.message}`);
            logger.error(`API scrape failed for ${company.name}: ${apiError.stack || apiError.message}`);
          }
        }

        // Fall back to WebScraping
        if (!jobs) {
          try {
            jobs = await scrapeWebsite(company.career_url, company);
            if (jobs && jobs.length > 0) {
              console.log(`  ✓ Playwright found ${jobs.length} positions`);
            } else {
              console.log(`  ✗ Playwright found no positions`);
              jobs = [];
            }
          } catch (browserError) {
            console.log(`  Playwright failed: ${browserError.message}`);
            logger.error(`Web scrape failed for ${company.name}: ${browserError.stack || browserError.message}`);
            jobs = [];
          }
        }

        // Process each job
        for (const job of jobs) {
          let extracted;
          try {
            extracted = extractAllFields(
              job.title || '',
              job.description || '',
              job.bannerText || ''
            );
          } catch (extractError) {
            logger.error(`Field extraction failed for "${job.title || 'unknown'}": ${extractError.stack || extractError.message}`);
            continue;
          }

          try {
            // Check if position is closed
            if (extracted.isClosed) {
              console.log(`  ⊗ Skipped closed position: ${job.title}`);
              continue;
            }

            // Check time window
            if (!isWithinTimeWindow(job.publishDate, timeWindow)) {
              totalSkippedOld++;
              continue;
            }

            // ---- PROFILE-DRIVEN FILTERING ----

            // Build candidate job fields for matching
            const jobForMatching = {
              _title: job.title || '',
              _description: job.description || '',
              _country: job.country || company.country || '',
              ...extracted
            };

            // Find if this job matches any profile
            let matchedProfile = null;
            let matchedSearchParam = null;
            let classifiedTypes = [];

            // Try each profile+search-param combination
            for (const profile of profilesWithParsed) {
              for (const sp of searchParams) {
                if (matchesProfile(jobForMatching, profile, sp, company.country)) {
                  matchedProfile = profile;
                  matchedSearchParam = sp;
                  classifiedTypes = jobForMatching.jobType; // Set by matchesProfile
                  break;
                }
              }
              if (matchedProfile) break;
            }

            if (!matchedProfile) {
              // Determine reason for logging
              const titleLower = (job.title || '').toLowerCase();
              const hasType = requiredJobTypes.length === 0 || requiredJobTypes.some(jt => {
                const words = jt.toLowerCase().trim().split(/\s+/);
                return words.some(w => {
                  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  return new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i').test(titleLower);
                });
              });
              let reason = '';
              if (!hasType) reason = '(type)';
              else if (targetCountries.length > 0 && job.country) {
                const jobCountryLower = job.country.toLowerCase();
                const companyCountryLower = (company.country || '').toLowerCase();
                const countryMatch = [jobCountryLower, companyCountryLower].filter(Boolean).some(cc =>
                  targetCountries.some(tc => cc.includes(tc) || tc.includes(cc))
                );
                if (!countryMatch) {
                  reason = `(country: ${job.country})`;
                  totalSkippedCountry++;
                }
              }
              console.log(`  ⊗ Skipped no match ${reason}: ${job.title}`);
              totalSkippedNoMatch++;
              continue;
            }

            // ---- JOB PASSES ALL FILTERS ----

            totalPositionsFound++;

            // Build job data for storage
            const jobWithCompany = {
              ...job,
              country: job.country || company.country,
              jobType: classifiedTypes.length > 0 ? classifiedTypes : ['Unspecified'],
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

            // Detect language
            const langInfo = detectLanguage(jobWithCompany.description || '');

            // Score position
            let scoreData = { score: 0, matched_resume: null, reasoning: 'No resumes loaded' };
            if (resumes.length > 0) {
              try {
                scoreData = await scorePosition(jobWithCompany, resumes, langInfo.language);
              } catch (scoreError) {
                logger.error(`Scoring failed for "${job.title}": ${scoreError.stack || scoreError.message}`);
                scoreData = { score: 0, matched_resume: null, reasoning: 'Scoring error' };
              }
            }

            // Insert position
            const result = addPosition(
              hash,
              company.id,
              jobWithCompany.country,
              jobWithCompany.title,
              jobWithCompany.description,
              jobWithCompany.qualifications,
              jobWithCompany.publishDate,
              jobWithCompany.link,
              jobWithCompany.jobType[0] || 'Unspecified',
              jobWithCompany.locationType,
              jobWithCompany.yearsExperience,
              jobWithCompany.seniorityLevel,
              scoreData.score,
              scoreData.matched_resume
            );

            if (result.id) {
              totalPositionsNew++;
              console.log(`  ✓ New: ${job.title} [${jobWithCompany.jobType[0]}] (Score: ${scoreData.score})`);

              // Link to matched profile
              if (matchedProfile) {
                try {
                  linkPositionToProfile(result.id, matchedProfile.id, scoreData.score);
                } catch (linkErr) {
                  // Already linked
                }
              }
            } else if (result.isDuplicate) {
              console.log(`  ✓ Skipped duplicate: ${job.title}`);
            } else {
              logger.error(`Failed to insert job: ${job.title}`);
              errors.push(`Failed to insert job: ${job.title}`);
            }
          } catch (jobError) {
            errors.push(`Error processing job: ${jobError.message}`);
            logger.error(`Job processing error: ${jobError.stack || jobError.message}`);
          }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (companyError) {
        errors.push(`Error processing ${company.name}: ${companyError.message}`);
        logger.error(`Company scrape error (${company.name}): ${companyError.stack || companyError.message}`);
      }
    }

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
    console.log(`Positions found (after filters): ${totalPositionsFound}`);
    console.log(`New positions stored: ${totalPositionsNew}`);
    console.log(`Skipped (no profile match): ${totalSkippedNoMatch}`);
    console.log(`Skipped (country): ${totalSkippedCountry}`);
    console.log(`Skipped (old): ${totalSkippedOld}`);
    if (errors.length > 0) {
      console.log(`Errors: ${errors.length}`);
    }

    return {
      runId: currentRunId,
      companiesVisited: totalCompaniesVisited,
      positionsFound: totalPositionsFound,
      positionsNew: totalPositionsNew,
      skippedNoMatch: totalSkippedNoMatch,
      skippedCountry: totalSkippedCountry,
      skippedOld: totalSkippedOld,
      errors,
      timeWindow
    };
  } catch (error) {
    console.error('Critical scraper error:', error.stack || error.message);
    if (currentRunId) {
      updateScrapeRun(currentRunId, new Date().toISOString(), 0, 0, 0, JSON.stringify([error.message]));
    }
    throw error;
  } finally {
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
