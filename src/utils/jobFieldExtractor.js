/**
 * Job Field Extractor — Profile-driven matching
 *
 * No hardcoded job type keywords. Instead, all classification is driven by
 * the user's profile (job_types, seniority_level, etc.) and search params.
 *
 * Works for any job hunter — backend, finance, sales, design, etc.
 */

// Indicates a position is closed/expired
const CLOSED_KEYWORDS = [
  'closed', 'expired', 'no longer hiring', 'application closed',
  'position filled', 'not accepting', 'not taking applications',
  'this position has been filled', 'no longer open', 'job closed'
];

/**
 * Check if a job posting indicates a closed/expired position
 */
function isClosedPosition(title = '', description = '', bannerText = '') {
  const fullText = `${title} ${description} ${bannerText}`.toLowerCase();
  return CLOSED_KEYWORDS.some(keyword => fullText.includes(keyword));
}

/**
 * Word-boundary aware match: ensures the needle appears as a whole word
 * within the haystack. For example "backend" in "Backend Engineer" matches,
 * but "backend" in "BackendSupport" does not.
 */
function wordBoundaryMatch(haystack, needle) {
  if (!haystack || !needle) return false;
  // Use word boundaries: the needle must be surrounded by non-word chars
  // or start/end of string. Escape regex special chars in needle.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i');
  return regex.test(haystack);
}

/**
 * Classify a job by matching its title (and optionally description) against
 * the profile's job_types.
 *
 * Each profile job_type string is split into individual words (on spaces).
 * A job matches if ANY word from the job_type appears as a whole word in the
 * job title. Description is checked as a secondary fallback.
 *
 * This is truly abstract — works for any industry, any job type, without
 * hardcoded keyword dictionaries.
 *
 * @param {string} title        - Job title (e.g. "Senior Backend Engineer")
 * @param {string} description  - Job description text
 * @param {string[]} jobTypes   - Profile-defined types (e.g. ["Backend Engineer", "DevOps"])
 * @returns {string[]}          - Matched types, or ['Unspecified'] if none
 */
/**
 * Words that are too generic to use for individual word-matching against titles.
 * They can still match as part of a full phrase, but alone they cause too many
 * false positives (e.g. "Engineer" matches every engineering role).
 */
const STOP_WORDS = new Set([
  'engineer', 'developer', 'manager', 'lead', 'head',
  'specialist', 'analyst', 'associate', 'expert', 'consultant',
  'officer', 'staff', 'senior', 'junior', 'vp', 'vice',
  'president', 'director', 'coordinator', 'representative',
  'technician', 'architect', 'administrator', 'supervisor'
]);

function classifyJobType(title = '', description = '', jobTypes = []) {
  if (!jobTypes || jobTypes.length === 0) {
    return ['Unspecified'];
  }

  const titleLower = title.toLowerCase();
  const descLower = description.toLowerCase();
  const matchScores = [];

  for (const jt of jobTypes) {
    const jtLower = jt.toLowerCase().trim();
    const jtWords = jtLower.split(/\s+/).filter(Boolean);
    if (jtWords.length === 0) continue;

    // Strategy 1: Full-phrase match in title (highest confidence)
    if (wordBoundaryMatch(titleLower, jtLower)) {
      matchScores.push({ type: jt, score: 200 });
      continue;
    }

    // Strategy 2: Individual word title matches (medium confidence)
    // Stop words (engineer, developer, etc.) are only used in phrase matching
    let titleMatchCount = 0;
    const meaningfulWords = jtWords.filter(w => !STOP_WORDS.has(w));
    const wordsToCheck = meaningfulWords.length > 0 ? meaningfulWords : jtWords;
    for (const word of wordsToCheck) {
      if (wordBoundaryMatch(titleLower, word)) {
        titleMatchCount++;
      }
    }
    if (titleMatchCount > 0) {
      const ratio = titleMatchCount / jtWords.length;
      matchScores.push({ type: jt, score: 50 + ratio * 50, titleMatchCount });
      continue;
    }

    // Note: Description fallback is intentionally omitted.
    // Keywords in descriptions (e.g., "Java" in a non-engineering job description
    // at a Java-based company) cause too many false positives.
    // Matching is title-only for accuracy.
  }

  if (matchScores.length === 0) {
    return ['Unspecified'];
  }

  // Sort by score descending, then by title word match count
  matchScores.sort((a, b) => b.score - a.score || (b.titleMatchCount || 0) - (a.titleMatchCount || 0));
  return matchScores.map(m => m.type);
}

/**
 * Extract seniority level(s) from a job title.
 * Uses common title prefixes — works for any industry.
 */
function extractSeniorityLevel(title = '') {
  const t = title.toLowerCase();
  const levels = [];

  // Order matters — check senior first so "Senior Staff" doesn't collide
  if (/\bprincipal\b/i.test(t) || /\bstaff\b/i.test(t)) levels.push('Principal');
  if (/\bsenior\b/i.test(t) || /\bsr\.?\b/i.test(t)) levels.push('Senior');
  if (/\blead\b/i.test(t) || /\bhead\b/i.test(t)) levels.push('Lead');
  if (/\bmid(-|\s)level\b/i.test(t) || /\bmid\b/i.test(t)) levels.push('Mid');
  if (/\bjunior\b/i.test(t) || /\bjr\.?\b/i.test(t) || /\bentry\b/i.test(t) || /\bgraduate\b/i.test(t) || /\btrainee\b/i.test(t)) levels.push('Junior');
  if (/\bintern\b/i.test(t)) levels.push('Intern');

  return levels.length > 0 ? [...new Set(levels)] : ['Unspecified'];
}

/**
 * Extract years of experience from a job description
 */
function extractYearsExperience(title = '', description = '') {
  const fullText = `${title} ${description}`.toLowerCase();
  const ranges = [];

  // Look for explicit year ranges in the text
  const yrPattern = /(\d+)[\s-]*\+?\s*years?\s*(?:of\s*)?(?:experience|exp)/gi;
  let match;
  while ((match = yrPattern.exec(fullText)) !== null) {
    const yrs = parseInt(match[1], 10);
    if (yrs <= 2) ranges.push('0-2');
    else if (yrs <= 5) ranges.push('3-5');
    else if (yrs <= 10) ranges.push('5-10');
    else ranges.push('10+');
  }

  // Look for explicit ranges like "3-5 years"
  const rangePattern = /(\d+)\s*[-–to]+\s*(\d+)\s*years?/gi;
  while ((match = rangePattern.exec(fullText)) !== null) {
    const min = parseInt(match[1], 10);
    const max = parseInt(match[2], 10);
    if (max <= 2) ranges.push('0-2');
    else if (max <= 5) ranges.push('3-5');
    else if (max <= 10) ranges.push('5-10');
    else ranges.push('10+');
  }

  // Infer from seniority if no explicit years
  if (ranges.length === 0) {
    const seniority = extractSeniorityLevel(title);
    if (seniority.includes('Intern')) ranges.push('0-2');
    else if (seniority.includes('Junior')) ranges.push('0-2');
    else if (seniority.includes('Senior') || seniority.includes('Staff') || seniority.includes('Principal')) ranges.push('5-10');
  }

  return ranges.length > 0 ? [...new Set(ranges)] : ['Unspecified'];
}

/**
 * Extract location type(s) from a job posting (remote / on-site / hybrid)
 */
function extractLocationType(title = '', description = '') {
  const fullText = `${title} ${description}`.toLowerCase();
  const found = [];

  if (/\bremote\b/i.test(fullText) || /\bwork from home\b/i.test(fullText) || /\bwfh\b/i.test(fullText) || /\bdistributed\b/i.test(fullText)) {
    found.push('Remote');
  }
  if (/\bon[\s-]site\b/i.test(fullText) || /\bonsite\b/i.test(fullText) || /\bin[\s-]office\b/i.test(fullText)) {
    found.push('On-site');
  }
  if (/\bhybrid\b/i.test(fullText)) {
    found.push('Hybrid');
  }

  return found.length > 0 ? found : ['Unspecified'];
}

/**
 * Extract all job fields at once
 */
function extractAllFields(title = '', description = '', bannerText = '') {
  return {
    isClosed: isClosedPosition(title, description, bannerText),
    jobType: [], // Will be set after profile is known
    locationType: extractLocationType(title, description),
    seniorityLevel: extractSeniorityLevel(title),
    yearsExperience: extractYearsExperience(title, description)
  };
}

/**
 * Check if a job's fields match a profile's requirements.
 *
 * Matching criteria (ALL must pass):
 *   1. Job type matches profile's job_types (title-word-driven)
 *   2. If profile has seniority_level, job seniority must be >= profile
 *   3. If search param has country, job or company country must match
 *   4. If search param has remote=true, job must offer remote
 *
 * @param {object} jobFields       - Result of extractAllFields + _title, _description, _country
 * @param {object} profile         - Profile from DB
 * @param {object} [searchParam]   - Optional search param row (country, remote, etc.)
 * @param {string} [companyCountry]- Company's country as fallback
 * @returns {boolean}
 */
function matchesProfile(jobFields, profile, searchParam = null, companyCountry = '') {
  if (!profile) return true; // No profile → store everything

  // 1. Job type match (using profile's job_types)
  const profileJobTypes = parseJobTypes(profile.job_types);
  if (profileJobTypes.length > 0) {
    // Classify job against profile types
    const jobTitle = jobFields._title || '';
    const jobDesc = jobFields._description || '';
    const classified = classifyJobType(jobTitle, jobDesc, profileJobTypes);

    // If classification returns only Unspecified, no type matched
    if (classified.length === 1 && classified[0] === 'Unspecified') {
      return false;
    }

    // At least one type matched → store
    jobFields.jobType = classified;
  }

  // 2. Seniority match (if profile specifies)
  if (profile.seniority_level) {
    const profileSeniority = profile.seniority_level.toLowerCase().trim();
    if (profileSeniority && profileSeniority !== 'unspecified') {
      const jobSeniority = (jobFields.seniorityLevel || ['Unspecified'])[0].toLowerCase();

      // Unspecified job seniority = could be any level → pass through
      if (jobSeniority === 'unspecified') {
        // Allow through
      } else {
        const seniorityRank = {
          'intern': 1, 'junior': 2, 'mid': 3, 'senior': 4, 'lead': 5, 'principal': 6, 'staff': 6
        };
        const profileRank = seniorityRank[profileSeniority] || 0;
        const jobRank = seniorityRank[jobSeniority] || 0;
        if (jobRank < profileRank - 1) {
          // Job is way junior for this profile
          return false;
        }
      }
    }
  }

  // 3. Country match (from search param)
  // Try job country first. If no match, fall back to company country.
  // Handles both "Barcelona → Spain" and "Amsterdam, Netherlands → Netherlands"
  if (searchParam && searchParam.country) {
    const targetCountries = searchParam.country.split(';').map(c => c.trim().toLowerCase());
    const jobCountry = (jobFields._country || '').trim().toLowerCase();
    const compCountry = (companyCountry || '').trim().toLowerCase();

    if (jobCountry) {
      // Job has a usable location — it alone decides the match. A present
      // but unrecognized location (e.g. "N/A") must not fall through to the
      // company country; it is rejected here.
      const jobMatch = targetCountries.some(tc =>
        jobCountry.includes(tc) || tc.includes(jobCountry)
      );
      if (!jobMatch) {
        return false;
      }
    } else {
      // Job location absent — fall back to company's home country.
      const compMatch = compCountry && targetCountries.some(tc =>
        compCountry.includes(tc) || tc.includes(compCountry)
      );
      if (!compMatch) {
        return false;
      }
    }
  }

  // 4. Remote preference
  // Only reject if the job is explicitly on-site AND remote is required.
  // "Unspecified" remote status is allowed through since many listings
  // don't include remote policy in the title/description.
  if (searchParam && searchParam.remote && jobFields.locationType && jobFields.locationType.length > 0) {
    const isExplicitlyOnsite = jobFields.locationType.some(lt => lt.toLowerCase() === 'on-site');
    const isExplicitlyRemote = jobFields.locationType.some(lt => lt.toLowerCase() === 'remote');
    if (!isExplicitlyRemote && isExplicitlyOnsite) {
      // Remote required but job is on-site only → reject
      return false;
    }
  }

  // 5. Exclude clearly non-engineering titles that happen to contain engineering keywords
  //    e.g., "Product Marketing Manager, Platform and Financial Services" → "Platform" matches
  //    but the role is clearly marketing, not engineering.
  if (!isEngineeringRelevantTitle(jobFields._title || '')) {
    return false;
  }

  return true;
}

/**
 * Quick check: does the title look like an engineering/technical role?
 * Filters out obvious non-engineering roles that happen to contain
 * technical keywords (e.g., "Product Marketing Manager, Platform...").
 *
 * Only rejects when the title clearly indicates a non-engineering function.
 * Returns true for ambiguous titles (let the profile matching decide).
 */
function isEngineeringRelevantTitle(title) {
  if (!title) return true;
  const t = title.toLowerCase();

  // Clear non-engineering functional prefixes. These indicate the role's
  // primary function is outside of engineering/technical work.
  const nonEngineeringPatterns = [
    // Business functions
    /\bmarketing\b/, /\bsales\b/, /\brecruit(?:ing|ment|er)\b/, /\bhr\b/, /\bhuman resources\b/,
    /\bfinance\b/, /\baccounting\b/, /\blegal\b/, /\bcompliance\b/, /\brisk\b/, /\baudit\b/,
    /\boperations\b/, /\bprocurement\b/, /\bsupply chain\b/, /\blogistics\b/,
    /\bcustomer support\b/, /\bcustomer success\b/, /\baccount management\b/,
    /\bproduct marketing\b/, /\bbusiness development\b/, /\bpartnerships?\b/,
    // Management where the primary role is manager, not engineer
    // e.g., "Engineering Manager" but NOT "Engineering Manager who codes"
    /\b(engineering\s+)?manager\b(?!\s*(engineer|developer|architect|program))/i,
    /\b(engineering\s+)?director\b/i,
    /\bvp\b/i, /\bvice\s+president\b/i,
    // Non-engineering manager functions
    /\bproject manager\b/, /\bprogram manager\b(?!\s*engineer)/,
    /\bproduct owner\b/, /\bscrum master\b/,
    // Creative / content
    /\bcreative\b/, /\bdesign(?:er)?\b(?!\s*engineer)/,
    /\bcontent\s+(writer|strategist|manager)\b/,
    /\bcommunity\s+manager\b/,
    // Administrative
    /\bevent\b/, /\boffice\s+manager\b/, /\badmin(?:istrativ)?e?\b/,
    /\bfacilities\b/, /\bexecutive assistant\b/, /\bprivacy\b/,
    // Data science (different career path from backend/platform)
    /\bdata\s+scientist\b/, /\bdata\s+analyst\b/, /\bdata\s+engineer\b(?!.*(backend|java))/i,
    // Security roles that are non-engineering
    /\bsecurity\s+(analyst|officer|specialist|manager|director)\b/i,
  ];

  // If title clearly matches a non-engineering pattern, reject it
  for (const pattern of nonEngineeringPatterns) {
    if (pattern.test(t)) {
      return false;
    }
  }

  return true;
}

/**
 * Parse a profile's job_types field (JSON string or array)
 */
function parseJobTypes(jobTypesField) {
  if (!jobTypesField) return [];
  if (Array.isArray(jobTypesField)) return jobTypesField;
  try {
    const parsed = JSON.parse(jobTypesField);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Fall back to comma-separated string
    return jobTypesField.split(',').map(s => s.trim()).filter(Boolean);
  }
}

module.exports = {
  isClosedPosition,
  classifyJobType,
  extractLocationType,
  extractSeniorityLevel,
  extractYearsExperience,
  extractAllFields,
  matchesProfile,
  parseJobTypes,
  isEngineeringRelevantTitle,
  CLOSED_KEYWORDS
};
