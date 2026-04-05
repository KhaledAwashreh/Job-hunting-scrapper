/**
 * Job Field Extractor - Extract job type, location type, level from job postings
 */

const CLOSED_KEYWORDS = [
  'closed', 'expired', 'no longer hiring', 'application closed', 
  'position filled', 'not accepting', 'not taking applications',
  'this position has been filled', 'no longer open', 'job closed'
];

const JOB_TYPES = {
  backend: ['backend', 'back-end', 'server-side', 'api', 'node', 'python', 'java', 'c#', 'golang', 'rust'],
  frontend: ['frontend', 'front-end', 'react', 'vue', 'angular', 'javascript', 'typescript', 'ui/ux', 'web developer'],
  fullstack: ['fullstack', 'full-stack', 'full stack'],
  devops: ['devops', 'dev-ops', 'devop', 'kubernetes', 'docker', 'ci/cd', 'infrastructure'],
  qa: ['qa ', 'quality assurance', 'test', 'automation', 'qe ', 'test engineer'],
  ai: ['ai ', 'machine learning', 'ml ', 'deep learning', 'nlp', 'computer vision', 'llm', 'gpt'],
  mobile: ['mobile', 'ios', 'android', 'react native', 'flutter'],
  data: ['data engineer', 'data scientist', 'dba', 'database', 'sql', 'analytics']
};

const LOCATION_TYPES = {
  remote: ['remote', 'work from home', 'wfh', 'distributed'],
  'on-site': ['on-site', 'on site', 'onsite', 'office', 'in-office', 'in office'],
  hybrid: ['hybrid', 'flexible', 'hybrid work', 'flexible work']
};

const SENIORITY_LEVELS = {
  junior: ['junior', 'graduate', 'entry-level', 'entry level', 'fresh', 'trainee'],
  mid: ['mid-level', 'mid level', 'intermediate', 'experienced'],
  senior: ['senior', 'sr. ', 'sr '],
  lead: ['lead', 'principal', 'staff engineer', 'architect']
};

const YEARS_EXPERIENCE = {
  '0-2': ['0-2 year', '1-2 year', 'entry level', 'entry-level', 'fresh'],
  '3-5': ['3-5 year', '4-5 year', '3 year', '4 year', '5 year'],
  '5-10': ['5-10 year', '6-8 year', '7-10 year', '5+ year', '6+ year', '7+ year', '8+ year', '9+ year'],
  '10+': ['10+ year', '10 year', '12+ year', '15+ year', 'senior']
};

/**
 * Check if a job posting indicates a closed/expired position
 */
function isClosedPosition(title = '', description = '', bannerText = '') {
  const fullText = `${title} ${description} ${bannerText}`.toLowerCase();
  
  return CLOSED_KEYWORDS.some(keyword => fullText.includes(keyword));
}

/**
 * Extract job type(s) from job posting
 */
function extractJobType(title = '', description = '') {
  const fullText = `${title} ${description}`.toLowerCase();
  const found = [];

  for (const [type, keywords] of Object.entries(JOB_TYPES)) {
    if (keywords.some(kw => fullText.includes(kw))) {
      found.push(type.charAt(0).toUpperCase() + type.slice(1));
    }
  }

  return found.length > 0 ? found : ['Unspecified'];
}

/**
 * Extract location type(s) from job posting
 */
function extractLocationType(title = '', description = '') {
  const fullText = `${title} ${description}`.toLowerCase();
  const found = [];

  for (const [type, keywords] of Object.entries(LOCATION_TYPES)) {
    if (keywords.some(kw => fullText.includes(kw))) {
      found.push(type.charAt(0).toUpperCase() + type.slice(1));
    }
  }

  return found.length > 0 ? found : ['Unspecified'];
}

/**
 * Extract seniority level(s) from job posting
 */
function extractSeniorityLevel(title = '', description = '') {
  const fullText = `${title} ${description}`.toLowerCase();
  const found = [];

  for (const [level, keywords] of Object.entries(SENIORITY_LEVELS)) {
    if (keywords.some(kw => fullText.includes(kw))) {
      found.push(level.charAt(0).toUpperCase() + level.slice(1));
    }
  }

  return found.length > 0 ? found : ['Unspecified'];
}

/**
 * Extract years of experience from job posting
 */
function extractYearsExperience(title = '', description = '') {
  const fullText = `${title} ${description}`.toLowerCase();
  const found = [];

  for (const [range, keywords] of Object.entries(YEARS_EXPERIENCE)) {
    if (keywords.some(kw => fullText.includes(kw))) {
      found.push(range);
    }
  }

  return found.length > 0 ? found : ['Unspecified'];
}

/**
 * Extract all job fields at once
 */
function extractAllFields(title = '', description = '', bannerText = '') {
  return {
    isClosed: isClosedPosition(title, description, bannerText),
    jobType: extractJobType(title, description),
    locationType: extractLocationType(title, description),
    seniorityLevel: extractSeniorityLevel(title, description),
    yearsExperience: extractYearsExperience(title, description)
  };
}

/**
 * Filter job matches by profile job types
 */
function matchesProfile(jobFields, profileJobTypes) {
  if (!profileJobTypes || profileJobTypes.length === 0) return true;
  if (!jobFields.jobType || jobFields.jobType.length === 0) return true; // If no job type, might still match

  return jobFields.jobType.some(jt => 
    profileJobTypes.some(pjt => jt.toLowerCase() === pjt.toLowerCase())
  );
}

module.exports = {
  isClosedPosition,
  extractJobType,
  extractLocationType,
  extractSeniorityLevel,
  extractYearsExperience,
  extractAllFields,
  matchesProfile,
  JOB_TYPES,
  LOCATION_TYPES,
  SENIORITY_LEVELS,
  YEARS_EXPERIENCE,
  CLOSED_KEYWORDS
};
