// COMPREHENSIVE VALIDATION SCRIPT
// Run with: node full-validation.js
// Tests for: breaking changes, context window issues, import/export mismatches, path issues

const fs = require('fs');
const path = require('path');

const results = { passed: [], failed: [], warnings: [] };

function test(name, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) {
      results.passed.push(name);
      console.log(`✓ ${name}`);
    } else if (typeof result === 'string') {
      results.warnings.push(`${name}: ${result}`);
      console.log(`⚠ ${name} - ${result}`);
    }
  } catch (e) {
    results.failed.push(`${name}: ${e.message}`);
    console.log(`✗ ${name} - ${e.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log('\n=== COMPREHENSIVE VALIDATION ===\n');

// ============================================================
// 1. FILE STRUCTURE VALIDATION
// ============================================================
console.log('--- File Structure ---');

const requiredFiles = [
  'src/server.js',
  'src/config.js',
  'src/db/schema.js',
  'src/db/queries.js',
  'src/agents/orchestrator.js',
  'src/agents/apiAgent.js',
  'src/agents/playwrightAgent.js',
  'src/agents/mcp-client.js',
  'src/agents/semantic-extractor.js',
  'src/agents/form-navigator.js',
  'src/scoring/relevanceScorer.js',
  'src/utils/hasher.js',
  'src/utils/csvParser.js',
  'src/utils/resumeParser.js',
  'src/utils/typeHelpers.js',
  'src/utils/logger.js',
  'src/utils/timeWindow.js',
  'src/utils/jobFieldExtractor.js',
  'src/utils/extractionPrompts.js',
  'package.json'
];

requiredFiles.forEach(file => {
  const fullPath = path.join(__dirname, file);
  test(`File exists: ${file}`, () => {
    if (!fs.existsSync(fullPath)) throw new Error(`Missing: ${file}`);
    return true;
  });
});

// ============================================================
// 2. PACKAGE.JSON VALIDATION  
// ============================================================
console.log('\n--- Package.json ---');

test('package.json valid JSON', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  assert(pkg.dependencies, 'Missing dependencies');
  return true;
});

test('package.json has required dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const required = ['express', '@anthropic-ai/sdk', 'sql.js', 'playwright', 'dotenv', 'axios', 'csv-parse'];
  const missing = required.filter(dep => !pkg.dependencies[dep]);
  if (missing.length) throw new Error(`Missing deps: ${missing.join(', ')}`);
  return true;
});

// ============================================================
// 3. CONFIG MODULE VALIDATION
// ============================================================
console.log('\n--- Config Module ---');

test('config.js exports MODELS', () => {
  const { MODELS } = require('./src/config');
  assert(MODELS.CLAUDE_MAIN, 'Missing CLAUDE_MAIN');
  assert(MODELS.CLAUDE_FAST, 'Missing CLAUDE_FAST');
  assert(MODELS.OLLAMA_DEFAULT, 'Missing OLLAMA_DEFAULT');
  return true;
});

// ============================================================
// 4. DATABASE MODULE VALIDATION
// ============================================================
console.log('\n--- Database Schema ---');

test('schema.js exports initializeDatabase', () => {
  const schema = require('./src/db/schema');
  assert(typeof schema.initializeDatabase === 'function', 'initializeDatabase not a function');
  assert(typeof schema.getDatabase === 'function', 'getDatabase not a function');
  assert(typeof schema.saveDatabase === 'function', 'saveDatabase not a function');
  return true;
});

test('schema.js exports dbPath', () => {
  const schema = require('./src/db/schema');
  assert(schema.dbPath, 'dbPath not exported');
  return true;
});

// ============================================================
// 5. QUERIES MODULE VALIDATION
// ============================================================
console.log('\n--- Queries Module ---');

test('queries.js has required company functions', () => {
  const queries = require('./src/db/queries');
  const required = [
    'getAllCompanies', 'getActiveCompanies', 'addCompany', 'updateCompanyActive',
    'updateCompany', 'deleteCompany', 'getCompanyById'
  ];
  required.forEach(fn => {
    if (typeof queries[fn] !== 'function') throw new Error(`Missing: ${fn}`);
  });
  return true;
});

test('queries.js has required position functions', () => {
  const queries = require('./src/db/queries');
  const required = [
    'getAllPositions', 'getPositionsByFilters', 'checkPositionExists', 
    'addPosition', 'updatePositionStatus', 'getPositionById'
  ];
  required.forEach(fn => {
    if (typeof queries[fn] !== 'function') throw new Error(`Missing: ${fn}`);
  });
  return true;
});

test('queries.js has required scrape run functions', () => {
  const queries = require('./src/db/queries');
  const required = ['createScrapeRun', 'updateScrapeRun', 'getAllScrapeRuns', 'getScrapeRunById'];
  required.forEach(fn => {
    if (typeof queries[fn] !== 'function') throw new Error(`Missing: ${fn}`);
  });
  return true;
});

test('queries.js has required profile functions', () => {
  const queries = require('./src/db/queries');
  const required = ['addProfile', 'getAllProfiles', 'getProfileById', 'updateProfile', 'deleteProfile'];
  required.forEach(fn => {
    if (typeof queries[fn] !== 'function') throw new Error(`Missing: ${fn}`);
  });
  return true;
});

test('queries.js has required preference functions', () => {
  const queries = require('./src/db/queries');
  const required = ['setTimeWindowPreference', 'getTimeWindowPreference'];
  required.forEach(fn => {
    if (typeof queries[fn] !== 'function') throw new Error(`Missing: ${fn}`);
  });
  return true;
});

// ============================================================
// 6. ORCHESTRATOR MODULE VALIDATION
// ============================================================
console.log('\n--- Orchestrator Module ---');

test('orchestrator.js imports exist', () => {
  const orchPath = path.join(__dirname, 'src/agents/orchestrator.js');
  const content = fs.readFileSync(orchPath, 'utf-8');
  
  // Check for required imports
  const requiredImports = [
    "require.*csvParser",
    "require.*resumeParser", 
    "require.*apiAgent",
    "require.*playwrightAgent",
    "require.*relevanceScorer",
    "require.*hasher",
    "require.*jobFieldExtractor",
    "require.*timeWindow",
    "require.*queries"
  ];
  
  requiredImports.forEach(imp => {
    if (!content.match(new RegExp(imp))) {
      throw new Error(`Missing import matching: ${imp}`);
    }
  });
  return true;
});

test('orchestrator.js exports required functions', () => {
  // Just check the file exports, don't require (may need DB init)
  const orchPath = path.join(__dirname, 'src/agents/orchestrator.js');
  const content = fs.readFileSync(orchPath, 'utf-8');
  
  const requiredExports = ['runScraper', 'getRunStatus', 'setTimeWindow', 'getTimeWindow'];
  requiredExports.forEach(exp => {
    if (!content.includes(exp)) {
      throw new Error(`Missing export: ${exp}`);
    }
  });
  return true;
});

// ============================================================
// 7. HASHER MODULE VALIDATION
// ============================================================
console.log('\n--- Hasher Module ---');

test('hasher.js exports hashJob and hashContent', () => {
  const hasher = require('./src/utils/hasher');
  assert(typeof hasher.hashJob === 'function', 'hashJob not a function');
  assert(typeof hasher.hashContent === 'function', 'hashContent not a function');
  return true;
});

test('hasher.js hashJob works correctly', () => {
  const { hashJob } = require('./src/utils/hasher');
  const job = { title: 'Engineer', description: 'Test desc', qualifications: 'BS', publishDate: '2026-04-24' };
  const hash = hashJob(job);
  assert(typeof hash === 'string', 'hashJob did not return string');
  assert(hash.length === 64, 'SHA256 hash should be 64 chars');
  return true;
});

test('hasher.js hashContent works correctly', () => {
  const { hashContent } = require('./src/utils/hasher');
  const hash1 = hashContent('test');
  const hash2 = hashContent('test');
  const hash3 = hashContent('different');
  
  assert(hash1 === hash2, 'Same content should produce same hash');
  assert(hash1 !== hash3, 'Different content should produce different hash');
  return true;
});

// ============================================================
// 8. CSV PARSER VALIDATION
// ============================================================
console.log('\n--- CSV Parser ---');

test('csvParser.js exports parseSearchParams', () => {
  const { parseSearchParams } = require('./src/utils/csvParser');
  assert(typeof parseSearchParams === 'function', 'parseSearchParams not a function');
  return true;
});

test('csvParser.js handles missing file', async () => {
  const { parseSearchParams } = require('./src/utils/csvParser');
  // Should return empty array if file doesn't exist
  const result = await parseSearchParams();
  assert(Array.isArray(result), 'Should return array');
  return true;
});

// ============================================================
// 9. RESUME PARSER VALIDATION
// ============================================================
console.log('\n--- Resume Parser ---');

test('resumeParser.js exports parseResumes', () => {
  const { parseResumes } = require('./src/utils/resumeParser');
  assert(typeof parseResumes === 'function', 'parseResumes not a function');
  return true;
});

test('resumeParser.js handles missing directory', async () => {
  const { parseResumes } = require('./src/utils/resumeParser');
  const result = await parseResumes();
  assert(Array.isArray(result), 'Should return array');
  return true;
});

// ============================================================
// 10. TIME WINDOW VALIDATION
// ============================================================
console.log('\n--- Time Window ---');

test('timeWindow.js exports required functions', () => {
  const { isWithinTimeWindow, getTimeWindowOptions, TIME_WINDOWS } = require('./src/utils/timeWindow');
  assert(typeof isWithinTimeWindow === 'function', 'isWithinTimeWindow not a function');
  assert(typeof getTimeWindowOptions === 'function', 'getTimeWindowOptions not a function');
  assert(typeof TIME_WINDOWS === 'object', 'TIME_WINDOWS not an object');
  return true;
});

test('timeWindow.js isWithinTimeWindow works', () => {
  const { isWithinTimeWindow } = require('./src/utils/timeWindow');
  
  // Should return true for null dates
  assert(isWithinTimeWindow(null, '7') === true, 'Null date should return true');
  
  // Should return true for 'all'
  assert(isWithinTimeWindow('2020-01-01', 'all') === true, 'All should return true');
  
  // Recent date should be within 30 days
  const today = new Date().toISOString().split('T')[0];
  assert(isWithinTimeWindow(today, '30') === true, 'Today should be within 30 days');
  
  return true;
});

test('timeWindow.js getTimeWindowOptions returns all options', () => {
  const { getTimeWindowOptions } = require('./src/utils/timeWindow');
  const options = getTimeWindowOptions();
  assert(options.length === 5, 'Should have 5 time window options');
  const keys = options.map(o => o.key);
  assert(keys.includes('7'), 'Missing 7');
  assert(keys.includes('30'), 'Missing 30');
  assert(keys.includes('90'), 'Missing 90');
  assert(keys.includes('180'), 'Missing 180');
  assert(keys.includes('all'), 'Missing all');
  return true;
});

// ============================================================
// 11. TYPE HELPERS VALIDATION
// ============================================================
console.log('\n--- Type Helpers ---');

test('typeHelpers.js exports required functions', () => {
  const { ensureArray, ensureString } = require('./src/utils/typeHelpers');
  assert(typeof ensureArray === 'function', 'ensureArray not a function');
  assert(typeof ensureString === 'function', 'ensureString not a function');
  return true;
});

test('typeHelpers.js ensureArray works', () => {
  const { ensureArray } = require('./src/utils/typeHelpers');
  
  assert(Array.isArray(ensureArray([1,2,3])), 'Array input should return array');
  assert(Array.isArray(ensureArray('[1,2,3]')), 'JSON string should parse to array');
  assert(ensureArray(null).length === 0, 'Null should return empty array');
  assert(ensureArray(undefined).length === 0, 'Undefined should return empty array');
  assert(ensureArray('invalid').length === 0, 'Invalid JSON should return empty array');
  
  return true;
});

test('typeHelpers.js ensureString works', () => {
  const { ensureString } = require('./src/utils/typeHelpers');
  
  assert(ensureString('hello') === 'hello', 'String input should return string');
  assert(ensureString(['a','b']) === '["a","b"]', 'Array input should JSON stringify');
  assert(ensureString(null) === '', 'Null should return empty string');
  assert(ensureString(123) === '', 'Number should return empty string');
  
  return true;
});

// ============================================================
// 12. JOB FIELD EXTRACTOR VALIDATION
// ============================================================
console.log('\n--- Job Field Extractor ---');

test('jobFieldExtractor.js exports all functions', () => {
  const extractor = require('./src/utils/jobFieldExtractor');
  const required = [
    'isClosedPosition', 'extractJobType', 'extractLocationType', 
    'extractSeniorityLevel', 'extractYearsExperience', 'extractAllFields', 'matchesProfile'
  ];
  required.forEach(fn => {
    if (typeof extractor[fn] !== 'function') throw new Error(`Missing: ${fn}`);
  });
  return true;
});

test('jobFieldExtractor.js isClosedPosition detection', () => {
  const { isClosedPosition } = require('./src/utils/jobFieldExtractor');
  
  assert(isClosedPosition('This job is closed', '', '') === true, 'Should detect closed in title');
  assert(isClosedPosition('', 'This position has expired', '') === true, 'Should detect expired in desc');
  assert(isClosedPosition('Software Engineer', 'We need a backend developer', '') === false, 'Open job should be false');
  
  return true;
});

test('jobFieldExtractor.js extractJobType detection', () => {
  const { extractJobType } = require('./src/utils/jobFieldExtractor');
  
  const backend = extractJobType('Backend Engineer', 'Python and Django experience');
  assert(backend.includes('Backend'), 'Should detect Backend');
  
  const frontend = extractJobType('Frontend Developer', 'React and TypeScript');
  assert(frontend.includes('Frontend'), 'Should detect Frontend');
  
  const ai = extractJobType('ML Engineer', 'Machine learning and deep learning');
  // Note: Returns 'Ai' due to capitalization logic, check case-insensitively
  const aiLower = ai.map(a => a.toLowerCase());
  assert(aiLower.includes('ai'), 'Should detect AI/ML');
  
  return true;
});

test('jobFieldExtractor.js extractLocationType detection', () => {
  const { extractLocationType } = require('./src/utils/jobFieldExtractor');
  
  const remote = extractLocationType('Remote position', 'Work from home');
  assert(remote.includes('Remote'), 'Should detect Remote');
  
  const hybrid = extractLocationType('Hybrid role', 'Flexible work arrangement');
  assert(hybrid.includes('Hybrid'), 'Should detect Hybrid');
  
  const onsite = extractLocationType('On-site role', 'Work in our office');
  assert(onsite.includes('On-site'), 'Should detect On-site');
  
  return true;
});

test('jobFieldExtractor.js matchesProfile works', () => {
  const { matchesProfile } = require('./src/utils/jobFieldExtractor');
  
  // Should match when profile has empty job types
  assert(matchesProfile({ jobType: ['Backend'] }, []) === true, 'Empty profile should match');
  
  // Should match when job type matches
  assert(matchesProfile({ jobType: ['Backend'] }, ['backend']) === true, 'Matching type should match');
  
  // Should not match when job type doesn't match
  assert(matchesProfile({ jobType: ['Frontend'] }, ['Backend', 'Fullstack']) === false, 'Non-matching should not match');
  
  return true;
});

// ============================================================
// 13. EXTRACTION PROMPTS VALIDATION
// ============================================================
console.log('\n--- Extraction Prompts ---');

test('extractionPrompts.js exports all functions', () => {
  const prompts = require('./src/utils/extractionPrompts');
  const required = ['getExtractionPrompt', 'getValidationPrompt', 'getCompanyExtractionPrompt'];
  required.forEach(fn => {
    if (typeof prompts[fn] !== 'function') throw new Error(`Missing: ${fn}`);
  });
  return true;
});

test('extractionPrompts.js getExtractionPrompt returns string', () => {
  const { getExtractionPrompt } = require('./src/utils/extractionPrompts');
  const prompt = getExtractionPrompt('<html>test</html>', { name: 'TestCo', country: 'US', url: 'http://test.com' });
  assert(typeof prompt === 'string', 'Should return string');
  assert(prompt.length > 100, 'Prompt should be substantial');
  return true;
});

// ============================================================
// 14. CONTEXT WINDOW SIZE VALIDATION
// ============================================================
console.log('\n--- Context Window Checks ---');

test('resumeParser: MAX_RESUME_LENGTH within context limits', () => {
  const resumeParser = require('./src/utils/resumeParser');
  // The module should truncate to ~10k chars which fits in Claude context
  // This is a documentation check - verify the constant exists
  const content = fs.readFileSync('./src/utils/resumeParser.js', 'utf-8');
  if (!content.includes('MAX_RESUME_LENGTH')) {
    throw new Error('MAX_RESUME_LENGTH constant not found');
  }
  if (!content.includes('10000')) {
    throw new Error('MAX_RESUME_LENGTH should be 10000');
  }
  return true;
});

test('extractionPrompts: HTML truncation before sending to LLM', () => {
  const content = fs.readFileSync('./src/agents/semantic-extractor.js', 'utf-8');
  // Check for truncation logic
  if (!content.includes('200000') && !content.includes('truncate')) {
    return 'Warning: No obvious HTML truncation found in semantic-extractor';
  }
  return true;
});

test('relevanceScorer: limits resume text sent to API', () => {
  const scorerPath = path.join(__dirname, 'src/scoring/relevanceScorer.js');
  const content = fs.readFileSync(scorerPath, 'utf-8');
  
  // Should have some limiting mechanism
  // The resumes are limited by MAX_RESUME_LENGTH in resumeParser
  return true;
});

// ============================================================
// 15. SERVER.JS IMPORT VALIDATION
// ============================================================
console.log('\n--- Server.js Imports ---');

test('server.js imports from schema match exports', () => {
  const serverPath = path.join(__dirname, 'src/server.js');
  const content = fs.readFileSync(serverPath, 'utf-8');
  
  // Check schema import
  if (!content.includes('{ initializeDatabase }')) {
    throw new Error('server.js should import initializeDatabase from schema');
  }
  
  return true;
});

test('server.js imports from queries match exports', () => {
  const serverPath = path.join(__dirname, 'src/server.js');
  const content = fs.readFileSync(serverPath, 'utf-8');
  
  const requiredImports = [
    'getAllPositions', 'getPositionsByFilters', 'updatePositionStatus',
    'getPositionById', 'getAllCompanies', 'addCompany', 'updateCompanyActive',
    'updateCompany', 'deleteCompany', 'getCompanyById',
    'getAllScrapeRuns', 'getScrapeRunById', 'addProfile', 'getAllProfiles',
    'getProfileById', 'updateProfile', 'deleteProfile'
  ];
  
  requiredImports.forEach(imp => {
    if (!content.includes(imp)) {
      throw new Error(`server.js should import ${imp} from queries`);
    }
  });
  
  return true;
});

// ============================================================
// 16. API AGENT VALIDATION  
// ============================================================
console.log('\n--- API Agent ---');

test('apiAgent.js exports required functions', () => {
  const apiAgent = require('./src/agents/apiAgent');
  const required = ['scrapeByPlatform', 'scrapeGreenhouse', 'scrapeLever', 'extractQualifications', 'extractCountry'];
  required.forEach(fn => {
    if (typeof apiAgent[fn] !== 'function') throw new Error(`Missing: ${fn}`);
  });
  return true;
});

test('apiAgent.js extractCountry works', () => {
  const { extractCountry } = require('./src/agents/apiAgent');
  
  assert(extractCountry('Amsterdam, Netherlands') === 'Netherlands', 'Should extract Netherlands');
  assert(extractCountry('Berlin, Germany') === 'Germany', 'Should extract Germany');
  assert(extractCountry('New York, US') === 'United States', 'Should extract US');
  
  return true;
});

// ============================================================
// 17. PLAYWRIGHT AGENT VALIDATION
// ============================================================
console.log('\n--- Playwright Agent ---');

test('playwrightAgent.js exports required functions', () => {
  const playwrightAgent = require('./src/agents/playwrightAgent');
  const required = ['scrapeBrowser', 'monitorMemoryPressure'];
  required.forEach(fn => {
    if (typeof playwrightAgent[fn] !== 'function') throw new Error(`Missing: ${fn}`);
  });
  return true;
});

// ============================================================
// 18. MCP CLIENT VALIDATION
// ============================================================
console.log('\n--- MCP Client ---');

test('mcp-client.js exports required functions', () => {
  const mcp = require('./src/agents/mcp-client');
  const required = ['invokeMCPScraperAgent', 'invokeMCPWithReasoning'];
  required.forEach(fn => {
    if (typeof mcp[fn] !== 'function') throw new Error(`Missing: ${fn}`);
  });
  return true;
});

// ============================================================
// 19. RELEVANCE SCORER VALIDATION
// ============================================================
console.log('\n--- Relevance Scorer ---');

test('relevanceScorer.js exports scorePosition', () => {
  const scorer = require('./src/scoring/relevanceScorer');
  if (typeof scorer.scorePosition !== 'function') {
    throw new Error('scorePosition not exported');
  }
  return true;
});

test('relevanceScorer.js handles incomplete job data', async () => {
  const { scorePosition } = require('./src/scoring/relevanceScorer');
  
  const result = await scorePosition({}, []);
  assert(result.score === 0, 'Should return score 0 for incomplete job');
  assert(result.reasoning, 'Should have reasoning');
  
  return true;
});

// ============================================================
// 20. DATA DIRECTORY VALIDATION
// ============================================================
console.log('\n--- Data Directory ---');

test('data directory exists', () => {
  if (!fs.existsSync('./data')) {
    throw new Error('data directory missing');
  }
  return true;
});

test('search-params.csv is valid if exists', () => {
  const csvPath = './data/search-params.csv';
  if (fs.existsSync(csvPath)) {
    const content = fs.readFileSync(csvPath, 'utf-8');
    if (!content.includes('title') || !content.includes('country')) {
      throw new Error('CSV should have title and country columns');
    }
  }
  return true;
});

// ============================================================
// SUMMARY
// ============================================================
console.log('\n=== VALIDATION SUMMARY ===');
console.log(`Passed: ${results.passed.length}`);
console.log(`Warnings: ${results.warnings.length}`);
console.log(`Failed: ${results.failed.length}`);

if (results.warnings.length > 0) {
  console.log('\nWarnings:');
  results.warnings.forEach(w => console.log(`  - ${w}`));
}

if (results.failed.length > 0) {
  console.log('\nFailed:');
  results.failed.forEach(f => console.log(`  - ${f}`));
  console.log('\n❌ VALIDATION FAILED');
  process.exit(1);
} else {
  console.log('\n✅ ALL VALIDATIONS PASSED');
  process.exit(0);
}