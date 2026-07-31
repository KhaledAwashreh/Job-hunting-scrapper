require('./utils/loadEnv'); // loads .env from the project root, not process.cwd()
const express = require('express');
const path = require('path');
const multer = require('multer');
const { initializeDatabase } = require('./db/schema');
const {
  getAllPositions,
  getPositionsByFilters,
  updatePositionStatus,
  getPositionById,
  getAllCompanies,
  addCompany,
  updateCompanyActive,
  updateCompany,
  deleteCompany,
  getCompanyById,
  getAllScrapeRuns,
  getScrapeRunById,
  addProfile,
  getAllProfiles,
  getProfileById,
  updateProfile,
  deleteProfile,
  addTailoredResume,
  getTailoredResumesForPosition,
  getTailoredResumeById,
  getNextVersionForPositionProfile,
  deleteTailoredResume,
} = require('./db/queries');
const resumeCache = require('./utils/resumeCache');
const { VALID_SENIORITY } = require('./utils/csvParser');
const { tailorResume } = require('./utils/resumeTailor');
const { runScraper, getRunStatus, setTimeWindow, getTimeWindow } = require('./agents/orchestrator');
const logger = require('./utils/logger');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx'); // For DOCX generation
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib'); // For PDF generation

const app = express();
const PORT = process.env.PORT || 3000;

// Resumes live here. RESUMES_DIR overrides the default so tests can point
// uploads/deletes/cache-refreshes at an isolated temp directory instead of
// the repo's real data/resumes/ — the same pattern JOBS_DB_PATH uses for the
// database (see src/db/schema.js).
const RESUMES_DIR = path.resolve(process.env.RESUMES_DIR || path.join(__dirname, '../data/resumes'));

// Constants for validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Helper function: validate HTTP(S) URLs only
function isValidHttpUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Build a safe `Content-Disposition: attachment` header value from an untrusted
// filename (e.g. one derived from a scraped job title). Strips control characters
// (CR/LF etc., which would otherwise let a title inject arbitrary headers or crash
// res.setHeader) and provides both a legacy ASCII-only filename="..." and a
// percent-encoded filename*=UTF-8''... per RFC 6266, so non-ASCII titles still
// round-trip for clients that support the extended form.
function contentDispositionHeader(filename) {
  const noControlChars = String(filename).replace(/[\x00-\x1F\x7F]/g, '');
  const asciiFallback = noControlChars
    .replace(/[^\x20-\x7E]/g, '_') // non-ASCII -> underscore
    .replace(/["\\]/g, '_'); // quotes/backslashes would break the quoted-string form
  const encoded = encodeURIComponent(noControlChars);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

// Resolve a user-supplied resume filename to an absolute path guaranteed to
// live inside RESUMES_DIR, or return null if it does not.
//
// path.basename(filename) is the common answer here, but it's incomplete:
// it doesn't reject a traversal attempt, it silently *rewrites* it. Given
// '../../etc/passwd', basename() quietly returns 'passwd' and the caller
// goes on to operate on data/resumes/passwd — a real file the attacker
// didn't ask for, deleted (or read) without any indication that the
// original request was bogus. That's worse than doing nothing: a 404 for a
// substituted filename looks identical to a 404 for a typo, so a traversal
// probe and an honest mistake are indistinguishable. basename() also does
// nothing about a null byte embedded in the string, an absolute path
// (basename('/etc/passwd') is still 'passwd', so no signal there either),
// or drive-qualified Windows paths.
//
// Resolving the full path and checking containment via path.relative()
// instead lets us tell traversal apart from "not found" and reject it
// outright (400) rather than silently substituting a different target.
function resolveResumePath(rawFilename) {
  if (typeof rawFilename !== 'string' || rawFilename.length === 0) {
    return null;
  }
  // fs syscalls reject embedded null bytes with a raw, uncaught-looking
  // TypeError; check explicitly so this is a clean 400 instead.
  if (rawFilename.indexOf('\0') !== -1) {
    return null;
  }

  const resolved = path.resolve(RESUMES_DIR, rawFilename);
  const relative = path.relative(RESUMES_DIR, resolved);

  // relative === '' means rawFilename resolved to RESUMES_DIR itself (e.g.
  // '.' or ''); relative.startsWith('..') or an absolute relative path both
  // mean the resolved path escaped RESUMES_DIR entirely.
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

// Rate limiting for scraper
let lastScrapeStartTime = null;

// Multer configuration for resume uploads
const resumeStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, RESUMES_DIR);
  },
  filename: (req, file, cb) => {
    // Sanitize filename - replace spaces with underscores, remove special chars
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, sanitized);
  }
});

const resumeUpload = multer({
  storage: resumeStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.docx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      // Marked with .status so the error-handling middleware (see bottom of
      // this file) recognizes this as a client-input error (400) rather than
      // falling through to the generic 500 handler.
      const err = new Error('Invalid file type. Only PDF, DOCX, and TXT allowed.');
      err.status = 400;
      cb(err);
    }
  }
});
const MIN_SCRAPE_INTERVAL_MS = 60000; // 1 minute

app.use(express.json());

// Security headers middleware. Registered before express.static (#24) so
// static assets (styles.css, countries.json, etc.) carry the same
// Content-Security-Policy/X-Frame-Options/X-Content-Type-Options headers as
// every other response instead of short-circuiting out of express.static
// before ever reaching this middleware.
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use(express.static(path.join(__dirname, '../public')));

// CORS middleware. The dashboard is served same-origin by this same process
// (see the '/' route below), so a browser visiting it never needs a CORS
// grant at all. ALLOWED_ORIGIN exists only for the case of a separate
// frontend (e.g. a dev server on another port) that legitimately needs
// cross-origin access; left unset, no Access-Control-Allow-Origin header is
// ever sent, so a same-site-only browser (any origin, including a page an
// attacker got the user to open) fails CORS preflight on every
// state-changing request and the browser refuses to send it.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || null;
app.use((req, res, next) => {
  if (ALLOWED_ORIGIN && req.headers.origin === ALLOWED_ORIGIN) {
    res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Token');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Shared-secret auth for state-changing requests. Off by default (no
// friction for the common case: a single local user hitting the dashboard
// on localhost), but set API_TOKEN to require every POST/PATCH/DELETE to
// carry a matching X-API-Token header — e.g. when exposing this server
// beyond localhost, since it holds real personal data and a paid LLM
// endpoint. CORS restriction alone only stops *browser* cross-origin
// requests; it does nothing against a direct curl/script request, which is
// what this closes.
const API_TOKEN = process.env.API_TOKEN || null;
if (!API_TOKEN) {
  console.warn('API_TOKEN is not set: mutating API routes are unauthenticated. Set API_TOKEN to require a shared secret on POST/PATCH/DELETE requests.');
}
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE']);
app.use((req, res, next) => {
  if (!API_TOKEN || !MUTATING_METHODS.has(req.method)) return next();
  if (req.header('X-API-Token') !== API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// Database initialization guard. /api/health is exempt on purpose: its whole
// job is to report that the database is down, so it must run the real
// handler (which reports db_initialized/error/timestamp) instead of being
// shortcut into this generic 503.
let dbInitialized = false;
app.use((req, res, next) => {
  if (!dbInitialized && !req.path.startsWith('/api/health')) {
    return res.status(503).json({ error: 'Database not initialized' });
  }
  next();
});

// Shared company-field validation, used by both POST (full body, every
// field required) and PATCH (partial body — #22: PATCH used to skip
// validation entirely, letting invalid values like a bogus platform or an
// empty name silently persist). In partial mode a field that is simply
// absent from the request body is skipped (PATCH allows partial updates);
// a field that IS present is validated with the exact same rule as POST.
function validateCompanyFields(fields, { partial = false } = {}) {
  const { name, country, career_url, platform } = fields;

  if (!partial || name !== undefined) {
    if (!name || typeof name !== 'string' || name.length === 0 || name.length > 255) {
      return 'Invalid name (1-255 characters required)';
    }
  }
  if (!partial || country !== undefined) {
    if (!country || typeof country !== 'string' || country.length === 0 || country.length > 100) {
      return 'Invalid country (1-100 characters required)';
    }
  }
  if (!partial || career_url !== undefined) {
    if (!isValidHttpUrl(career_url)) {
      return 'Invalid URL format (must be http/https)';
    }
  }
  if (platform && !['greenhouse', 'lever', 'workday', 'custom', 'rss', 'json_api', 'workable'].includes(platform)) {
    return 'Invalid platform';
  }
  return null;
}

// Input validation middleware
const validateCompanyInput = (req, res, next) => {
  const error = validateCompanyFields(req.body, { partial: false });
  if (error) return res.status(400).json({ error });
  next();
};

const validateProfileInput = (req, res, next) => {
  const { name, resume_file, job_types, secondary_category, seniority_level } = req.body;
  
  if (!name || typeof name !== 'string' || name.length === 0 || name.length > 255) {
    return res.status(400).json({ error: 'Invalid name' });
  }
  if (!resume_file || typeof resume_file !== 'string' || resume_file.length === 0) {
    return res.status(400).json({ error: 'Invalid resume_file' });
  }
  if (seniority_level) {
    if (typeof seniority_level !== 'string') {
      return res.status(400).json({ error: 'seniority_level must be a string' });
    }
    // Reject unrecognized seniority values instead of silently accepting them,
    // which would disable seniority filtering downstream (mirrors csvParser's check).
    if (!VALID_SENIORITY.includes(seniority_level.trim().toLowerCase())) {
      return res.status(400).json({ error: `Invalid seniority_level (must be one of: ${VALID_SENIORITY.join(', ')})` });
    }
  }
  if (!job_types || !Array.isArray(job_types) || job_types.length === 0) {
    return res.status(400).json({ error: 'job_types must be a non-empty array' });
  }
  if (!job_types.every(t => typeof t === 'string' && t.length > 0)) {
    return res.status(400).json({ error: 'All job_types must be non-empty strings' });
  }
  if (secondary_category) {
    if (typeof secondary_category !== 'string') {
      return res.status(400).json({ error: 'Invalid secondary_category: must be string' });
    }
    // If it looks like an email, validate it
    if (secondary_category.includes('@')) {
      if (!EMAIL_REGEX.test(secondary_category)) {
        return res.status(400).json({ error: 'Invalid email format in secondary_category' });
      }
    }
  }
  next();
};

// Initialize database and resumes on startup
async function startup() {
  try {
    console.log('Initializing database...');
    await initializeDatabase();
    dbInitialized = true;
    console.log('Database initialized');

    console.log('Loading resumes...');
    const resumes = await resumeCache.refresh(RESUMES_DIR);
    console.log(`Loaded ${resumes.length} resume(s)`);
  } catch (error) {
    console.error('Startup error:', error);
    dbInitialized = false;
  }
}

// ===== Static files =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

// ===== Positions API =====
app.get('/api/positions', (req, res) => {
  try {
    const { country, status } = req.query;
    const positions = country || status
      ? getPositionsByFilters(country, status)
      : getAllPositions();
    return res.json(positions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/positions/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['new', 'applied', 'rejected', 'accepted'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    if (!getPositionById(id)) {
      return res.status(404).json({ error: 'Position not found' });
    }

    updatePositionStatus(id, status);
    const updated = getPositionById(id);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== Companies API =====
app.get('/api/companies', (req, res) => {
  try {
    const companies = getAllCompanies();
    res.json(companies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/companies', validateCompanyInput, (req, res) => {
  try {
    const { name, country, career_url, platform, platform_slug, api_url } = req.body;

    const id = addCompany(name, country, career_url, platform || 'custom', platform_slug || null, api_url || null);
    const company = getCompanyById(id);
    res.status(201).json(company);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/companies/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, country, career_url, platform, platform_slug, api_url, active } = req.body;

    // #22: apply the same validation POST uses (in partial mode — only
    // fields actually present in the body are checked), so an invalid
    // career_url/platform/name can no longer silently persist via PATCH.
    const validationError = validateCompanyFields(req.body, { partial: true });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    if (!getCompanyById(id)) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // Build updates object with only provided fields
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (country !== undefined) updates.country = country;
    if (career_url !== undefined) updates.career_url = career_url;
    if (platform !== undefined) updates.platform = platform;
    if (platform_slug !== undefined) updates.platform_slug = platform_slug;
    if (api_url !== undefined) updates.api_url = api_url;

    // Update using the general updateCompany function
    if (Object.keys(updates).length > 0) {
      updateCompany(id, updates);
    }

    // Handle active separately if provided (for backward compatibility)
    if (active !== undefined) {
      updateCompanyActive(id, active);
    }

    const updated = getCompanyById(id);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/companies/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!getCompanyById(id)) {
      return res.status(404).json({ error: 'Company not found' });
    }
    deleteCompany(id);
    res.json({ success: true, message: 'Company deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== Scrape Runs API =====
app.get('/api/runs', (req, res) => {
  try {
    const runs = getAllScrapeRuns();
    res.json(runs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/scrape/run', (req, res) => {
  try {
    const status = getRunStatus();
    if (status.running) {
      return res.status(409).json({ error: 'Scraper already running' });
    }

    // Rate limit: prevent scrape spam
    if (lastScrapeStartTime && Date.now() - lastScrapeStartTime < MIN_SCRAPE_INTERVAL_MS) {
      const retryAfter = Math.ceil((MIN_SCRAPE_INTERVAL_MS - (Date.now() - lastScrapeStartTime)) / 1000);
      return res.status(429).json({
        error: 'Too many scrape requests. Please wait before starting another scrape.',
        retryAfter
      });
    }

    lastScrapeStartTime = Date.now();
    // Start scraper asynchronously
    runScraper().catch(error => {
      logger.error(`Scraper error: ${error.stack || error.message}`);
    });

    return res.status(202).json({ message: 'Scraper started', status: getRunStatus() });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/scrape/status', (req, res) => {
  try {
    const status = getRunStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== Profiles API =====
app.get('/api/profiles', (req, res) => {
  try {
    const profiles = getAllProfiles();
    // Parse JSON fields for each profile
    const parsed = profiles.map(p => ({
      ...p,
      job_types: JSON.parse(p.job_types || '[]'),
      years_of_experience: JSON.parse(p.years_of_experience || '[]'),
      work_location_preference: JSON.parse(p.work_location_preference || '[]')
    }));
    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== Resume Upload API =====
// Wrap multer's middleware so its rejection reason (bad file type vs. too
// large) surfaces as a distinguishable 400 instead of falling through to the
// generic 500 handler (issue #16).
function handleResumeUpload(req, res, next) {
  resumeUpload.single('resume')(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File is too large. Maximum allowed size is 10MB.' });
    }
    if (err.message && err.message.startsWith('Invalid file type')) {
      return res.status(400).json({ error: 'Invalid file type. Only PDF, DOCX, and TXT files are allowed.' });
    }
    return res.status(400).json({ error: err.message || 'Upload failed' });
  });
}

app.post('/api/resumes/upload', handleResumeUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Refresh the resume cache so the new file is picked up immediately
    try {
      await resumeCache.refresh();
    } catch (refreshError) {
      console.error('Failed to refresh resume cache after upload:', refreshError);
    }

    res.json({
      success: true,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      path: `/data/resumes/${req.file.filename}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/resumes/:filename', async (req, res) => {
  try {
    const fs = require('fs');
    const filename = req.params.filename;
    const filepath = resolveResumePath(filename);

    if (!filepath) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    fs.unlinkSync(filepath);

    // Refresh the resume cache so the removed file drops out immediately
    try {
      await resumeCache.refresh();
    } catch (refreshError) {
      console.error('Failed to refresh resume cache after delete:', refreshError);
    }

    res.json({ success: true, deleted: filename });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/profiles', validateProfileInput, (req, res) => {
  try {
    const { name, resume_file, job_types, secondary_category, seniority_level, years_of_experience = [], work_location_preference = [] } = req.body;

    const id = addProfile(name, resume_file, job_types, secondary_category || null, seniority_level || null, years_of_experience, work_location_preference);
    const profile = getProfileById(id);
    res.status(201).json({ 
      ...profile, 
      job_types: JSON.parse(profile.job_types),
      years_of_experience: JSON.parse(profile.years_of_experience || '[]'),
      work_location_preference: JSON.parse(profile.work_location_preference || '[]')
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/profiles/:id', (req, res) => {
  try {
    const { id } = req.params;
    const profile = getProfileById(id);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    try {
      return res.json({ 
        ...profile, 
        job_types: JSON.parse(profile.job_types || '[]'),
        years_of_experience: JSON.parse(profile.years_of_experience || '[]'),
        work_location_preference: JSON.parse(profile.work_location_preference || '[]')
      });
    } catch (parseErr) {
      console.error('JSON parse error for profile:', parseErr);
      return res.json({ ...profile, job_types: [], years_of_experience: [], work_location_preference: [] });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/profiles/:id', validateProfileInput, (req, res) => {
  try {
    const { id } = req.params;
    const { name, resume_file, job_types, secondary_category, seniority_level, years_of_experience = [], work_location_preference = [] } = req.body;

    if (!getProfileById(id)) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    updateProfile(id, name, resume_file, job_types, secondary_category || null, seniority_level || null, years_of_experience, work_location_preference);
    const updated = getProfileById(id);
    try {
      res.json({ 
        ...updated, 
        job_types: JSON.parse(updated.job_types || '[]'),
        years_of_experience: JSON.parse(updated.years_of_experience || '[]'),
        work_location_preference: JSON.parse(updated.work_location_preference || '[]')
      });
    } catch (parseErr) {
      console.error('JSON parse error for updated profile:', parseErr);
      res.json({ ...updated, job_types: [], years_of_experience: [], work_location_preference: [] });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/profiles/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!getProfileById(id)) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    deleteProfile(id);
    res.json({ message: 'Profile deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== Tailored Resumes API =====

// Rate limiting for the resume-tailor endpoint (#23). It invokes a paid
// Anthropic LLM call on every request with no other throttle, unlike
// POST /api/scrape/run above -- a bug (retry loop, double-click) or an
// unauthenticated caller (see the CORS/API_TOKEN comments earlier in this
// file) could otherwise run up unbounded LLM spend. Simple in-process
// sliding-window counter keyed by client IP; a Map of timestamps is enough
// for a single-user local tool and needs no new dependency. TAILOR_RATE_LIMIT_MAX
// of 10 requests per minute is generous for normal interactive use (a person
// clicking "Tailor" a few times while comparing profiles/versions) but caps
// runaway cost from automation or abuse.
const TAILOR_RATE_LIMIT_MAX = 10;
const TAILOR_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const tailorRequestLog = new Map(); // ip -> array of request timestamps (ms)

function tailorRateLimit(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const windowStart = now - TAILOR_RATE_LIMIT_WINDOW_MS;
  const timestamps = (tailorRequestLog.get(key) || []).filter(t => t > windowStart);

  if (timestamps.length >= TAILOR_RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((timestamps[0] + TAILOR_RATE_LIMIT_WINDOW_MS - now) / 1000);
    tailorRequestLog.set(key, timestamps);
    return res.status(429).json({
      error: 'Too many resume-tailoring requests. Please wait before trying again.',
      retryAfter
    });
  }

  timestamps.push(now);
  tailorRequestLog.set(key, timestamps);
  next();
}

// #27 — same-process version race on POST /api/positions/:id/tailor.
// The handler reads the current version synchronously, awaits a (slow, paid)
// LLM call, then inserts. Two concurrent requests for the same position+
// profile (double click, two tabs, a client retry) both read the same next
// version before either finishes its await, then race to insert — the loser
// hits the UNIQUE(position_id, profile_id, version) constraint and gets a
// 500 after already paying for an LLM call it can't save. Node is
// single-threaded and there is no `await` between the guard check and the
// guard being set below, so this in-memory Set is enough to serialize
// concurrent requests for the same position+profile within this one
// process — no cross-process locking needed here (that's what #26's
// DB-level lock already covers).
const tailoringInFlight = new Set();

// Generate a new tailored resume for a position
app.post('/api/positions/:positionId/tailor', tailorRateLimit, async (req, res) => {
  let tailorKey = null;
  try {
    const { positionId } = req.params;
    const { profileId } = req.body;

    // 1. Validate position exists
    const position = getPositionById(positionId);
    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }

    // 2. Determine which profile to use
    let targetProfileId = profileId;
    if (!targetProfileId) {
      // Use position's matched_resume index to find profile
      if (!position.matched_resume) {
        return res.status(400).json({ error: 'No profile specified and no matched resume for this position' });
      }
      // Find profile matching the resume index
      const profiles = getAllProfiles();
      const targetResume = resumeCache.get().find(r => r.index === position.matched_resume);
      if (!targetResume) {
        return res.status(404).json({ error: 'Matched resume not found in loaded resumes' });
      }
      const profile = profiles.find(p => p.resume_file === targetResume.filename);
      if (!profile) {
        return res.status(404).json({ error: 'No profile matches the matched resume' });
      }
      targetProfileId = profile.id;
    }

    // 3. Validate profile exists
    const profile = getProfileById(targetProfileId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // #27 — reject a second concurrent tailor request for this exact
    // position+profile instead of racing it: this check-and-set is
    // synchronous (no `await` in between), so it is safe against Node's
    // single-threaded event loop even though the rest of this handler is
    // async. Guards before any version read or LLM call, so the rejected
    // request never pays for a wasted LLM call.
    tailorKey = `${positionId}:${targetProfileId}`;
    if (tailoringInFlight.has(tailorKey)) {
      tailorKey = null; // don't release a guard this request never acquired
      return res.status(409).json({ error: 'A tailor request for this position and profile is already in progress' });
    }
    tailoringInFlight.add(tailorKey);

    // 4. Get base resume text
    const targetResume = resumeCache.get().find(r => r.filename === profile.resume_file);
    if (!targetResume) {
      return res.status(404).json({ error: 'Base resume file not found for this profile' });
    }
    const baseResumeText = targetResume.text;

    // 5. Get job tags and profile tags
    const jobTags = [
      position.job_type,
      ...(Array.isArray(position.seniority_level) ? position.seniority_level : [position.seniority_level]).filter(Boolean)
    ].filter(Boolean);
    
    let profileTags = [];
    try {
      profileTags = JSON.parse(profile.job_types || '[]');
      const profileSeniority = profile.seniority_level ? [profile.seniority_level] : [];
      profileTags = [...profileTags, ...profileSeniority].filter(Boolean);
    } catch (e) {
      console.warn('Failed to parse profile tags:', e.message);
    }

    // 6. Get next version number
    const version = getNextVersionForPositionProfile(positionId, targetProfileId);

    // 7. Generate tailored resume
    const tailoredText = await tailorResume(
      baseResumeText,
      position,
      profile,
      jobTags,
      profileTags
    );

    // 8. Save to database
    const result = addTailoredResume(
      positionId,
      targetProfileId,
      baseResumeText,
      tailoredText,
      version
    );

    if (!result.id) {
      return res.status(500).json({ error: 'Failed to save tailored resume' });
    }

    // 9. Return the tailored resume
    res.status(201).json({
      id: result.id,
      position_id: positionId,
      profile_id: targetProfileId,
      version,
      tailored_text: tailoredText,
      message: 'Tailored resume generated successfully'
    });

  } catch (error) {
    console.error('Tailoring error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    // #27 — always release the guard, whether this request succeeded,
    // errored, or returned early (e.g. position/profile not found) after
    // having acquired it. tailorKey stays null if this request never
    // acquired the guard (rejected with 409, or returned before reaching it).
    if (tailorKey) tailoringInFlight.delete(tailorKey);
  }
});

// List all tailored resumes for a position
app.get('/api/positions/:positionId/tailored-resumes', (req, res) => {
  try {
    const { positionId } = req.params;
    const tailoredResumes = getTailoredResumesForPosition(positionId);
    res.json(tailoredResumes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a single tailored resume
app.get('/api/tailored-resumes/:id', (req, res) => {
  try {
    const { id } = req.params;
    const tailoredResume = getTailoredResumeById(id);
    if (!tailoredResume) {
      return res.status(404).json({ error: 'Tailored resume not found' });
    }
    res.json(tailoredResume);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a tailored resume
app.delete('/api/tailored-resumes/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!getTailoredResumeById(id)) {
      return res.status(404).json({ error: 'Tailored resume not found' });
    }
    deleteTailoredResume(id);
    res.json({ message: 'Tailored resume deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Download tailored resume as TXT/DOCX/PDF
app.get('/api/tailored-resumes/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'txt' } = req.query;

    const tailoredResume = getTailoredResumeById(id);
    if (!tailoredResume) {
      return res.status(404).json({ error: 'Tailored resume not found' });
    }

    const filename = `tailored-resume-${tailoredResume.position_title}-v${tailoredResume.version}.${format}`;

    if (format === 'txt') {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', contentDispositionHeader(filename));
      return res.send(tailoredResume.tailored_text);
    }

    if (format === 'docx') {
      // Generate DOCX in Harvard format
      // Parse tailored text into paragraphs (split by newlines)
      const paragraphs = tailoredResume.tailored_text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return new Paragraph({ text: '' });

        // Detect section headings (all caps, short lines)
        if (trimmed === trimmed.toUpperCase() && trimmed.length < 50 && !trimmed.includes(' ')) {
          return new Paragraph({
            text: trimmed,
            heading: HeadingLevel.HEADING_2,
            bold: true,
            spacing: { before: 200, after: 100 }
          });
        }

        // Detect bullet points
        if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
          return new Paragraph({
            text: trimmed.substring(2),
            bullet: { level: 0 },
            spacing: { before: 50, after: 50 }
          });
        }

        // Regular text
        return new Paragraph({
          children: [new TextRun(trimmed)],
          spacing: { before: 50, after: 50 }
        });
      });

      const doc = new Document({
        sections: [{
          properties: {},
          children: paragraphs
        }]
      });

      const buffer = await Packer.toBuffer(doc);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', contentDispositionHeader(filename));
      return res.send(buffer);
    }

    if (format === 'pdf') {
      // Generate PDF in Harvard format
      const pdfDoc = await PDFDocument.create();
      const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
      const timesRomanBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
      
      let page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      const fontSize = 11;
      const margin = 50;
      let y = height - margin;

      // Split text into lines
      const lines = tailoredResume.tailored_text.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          y -= 10;
          continue;
        }

        // Check if we need a new page
        if (y < margin) {
          page = pdfDoc.addPage();
          y = height - margin;
        }

        // Detect section headings (all caps)
        const isHeading = trimmed === trimmed.toUpperCase() && trimmed.length < 50 && !trimmed.includes(' ');
        const font = isHeading ? timesRomanBold : timesRomanFont;
        const size = isHeading ? 12 : fontSize;
        const yOffset = isHeading ? 15 : 10;

        page.drawText(trimmed, {
          x: margin,
          y,
          font,
          size,
          color: rgb(0, 0, 0)
        });

        y -= yOffset;
      }

      const pdfBytes = await pdfDoc.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', contentDispositionHeader(filename));
      return res.send(Buffer.from(pdfBytes));
    }

    return res.status(400).json({ error: 'Invalid format. Use txt, docx, or pdf' });
  } catch (error) {
    console.error('Download error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ===== Time Window API =====
app.get('/api/scrape/time-window', (req, res) => {
  try {
    res.json({ time_window: getTimeWindow() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/scrape/time-window', (req, res) => {
  try {
    const { time_window } = req.body;
    if (!['7', '30', '90', '180', 'all'].includes(time_window)) {
      return res.status(400).json({ error: 'Invalid time window' });
    }
    setTimeWindow(time_window);
    res.json({ time_window: getTimeWindow() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== Resumes API =====
app.get('/api/resumes', (req, res) => {
  try {
    return res.json(resumeCache.getSummary());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// ===== Health check =====
app.get('/api/health', (req, res) => {
  try {
    // Test database connection
    getAllPositions();
    return res.json({
      status: 'ok',
      db_initialized: dbInitialized,
      resumes_loaded: resumeCache.get().length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(503).json({
      status: 'error',
      db_initialized: dbInitialized,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ===== 404 Catch-All Route =====
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

// ===== Error handling =====
// #21: malformed JSON bodies and rejected uploads were both reaching this
// handler and being coerced to a generic 500, discarding the specific
// client-input error (and, for JSON, actively downgrading a 400 into a 500).
// body-parser (used by express.json()) sets err.status = 400 and
// err.type = 'entity.parse.failed' on malformed JSON; multer sets
// err instanceof MulterError for its own rule violations (e.g. the file size
// limit); the fileFilter above marks its own rejection errors with
// err.status = 400 so they're recognized the same way. Anything else
// (unexpected exceptions, DB failures, etc.) still falls through to 500.
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode;
  const isClientError =
    err.type === 'entity.parse.failed' ||
    err instanceof multer.MulterError ||
    (typeof status === 'number' && status >= 400 && status < 500);

  if (isClientError) {
    return res.status(status || 400).json({ error: err.message || 'Invalid request' });
  }

  console.error('Express error:', err);
  return res.status(500).json({ error: 'Internal server error' });
});

// Start server with graceful shutdown
let server = null;

startup().then(() => {
  server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Graceful shutdown handler
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  // Global error handlers - write to errors.log
  process.on('uncaughtException', (err) => {
    logger.error(`UNCAUGHT_EXCEPTION: ${err.stack || err.message}`);
    console.error('Uncaught exception:', err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    const reasonStr = reason instanceof Error ? reason.stack : String(reason);
    logger.error(`UNHANDLED_REJECTION: ${reasonStr}`);
    console.error('Unhandled rejection:', reason);
  });

  function gracefulShutdown() {
    console.log('\nGraceful shutdown initiated...');

    // #25: previously process.exit(0) ran synchronously right after issuing
    // server.close(), without ever awaiting its callback -- under a real
    // SIGTERM the process exited before in-flight requests finished, dropping
    // roughly a third of them in testing. Now we track both "HTTP server
    // fully closed" and "no scrape still running" and only exit once both are
    // true, with a hard timeout as a fallback for requests/scrapes that never
    // finish.
    let serverClosed = false;
    let scraperDone = false;
    let forced = false;

    const shutdownTimeout = setTimeout(() => {
      forced = true;
      console.error('Forced shutdown: server close / scrape took too long');
      process.exit(1);
    }, 30000); // 30 second timeout

    function maybeExit() {
      if (forced || !serverClosed || !scraperDone) return;
      clearTimeout(shutdownTimeout);
      console.log('Shutting down');
      process.exit(0);
    }

    // Stop accepting new connections; wait for in-flight requests to finish.
    server.close(() => {
      serverClosed = true;
      console.log('HTTP server closed');
      maybeExit();
    });
    // Idle keep-alive sockets (no request in progress) would otherwise sit
    // open until the keep-alive timeout and delay the close() callback above
    // for no reason; closing them immediately doesn't affect in-flight
    // requests, which keep their own sockets until their response is sent.
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }

    // Check scraper status
    const status = getRunStatus();
    if (status.running) {
      console.log('Scraper is running, waiting for completion...');
      const waitInterval = setInterval(() => {
        if (!getRunStatus().running) {
          clearInterval(waitInterval);
          scraperDone = true;
          console.log('Scrape completed');
          maybeExit();
        }
      }, 1000);
    } else {
      scraperDone = true;
      maybeExit();
    }
  }
}).catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

module.exports = app;
