require('dotenv').config();
const express = require('express');
const path = require('path');
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
} = require('./db/queries');
const { parseResumes } = require('./utils/resumeParser');
const { runScraper, getRunStatus, setTimeWindow, getTimeWindow } = require('./agents/orchestrator');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Rate limiting for scraper
let lastScrapeStartTime = null;
const MIN_SCRAPE_INTERVAL_MS = 60000; // 1 minute

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// Database initialization guard
let dbInitialized = false;
app.use((req, res, next) => {
  if (!dbInitialized && !req.path.startsWith('/health')) {
    return res.status(503).json({ error: 'Database not initialized' });
  }
  next();
});

// Track resumes for API access
let loadedResumes = [];

// Input validation middleware
const validateCompanyInput = (req, res, next) => {
  const { name, country, career_url, platform } = req.body;
  
  if (!name || typeof name !== 'string' || name.length === 0 || name.length > 255) {
    return res.status(400).json({ error: 'Invalid name (1-255 characters required)' });
  }
  if (!country || typeof country !== 'string' || country.length === 0 || country.length > 100) {
    return res.status(400).json({ error: 'Invalid country (1-100 characters required)' });
  }
  if (!isValidHttpUrl(career_url)) {
    return res.status(400).json({ error: 'Invalid URL format (must be http/https)' });
  }
  if (platform && !['greenhouse', 'lever', 'workday', 'custom'].includes(platform)) {
    return res.status(400).json({ error: 'Invalid platform' });
  }
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
  if (seniority_level && typeof seniority_level !== 'string') {
    return res.status(400).json({ error: 'seniority_level must be a string' });
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
    loadedResumes = await parseResumes();
    console.log(`Loaded ${loadedResumes.length} resume(s)`);
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
    const { name, country, career_url, platform } = req.body;

    const id = addCompany(name, country, career_url, platform || 'custom');
    const company = getCompanyById(id);
    res.status(201).json(company);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/companies/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, country, career_url, platform, active } = req.body;

    // Build updates object with only provided fields
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (country !== undefined) updates.country = country;
    if (career_url !== undefined) updates.career_url = career_url;
    if (platform !== undefined) updates.platform = platform;

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
      console.error('Scraper error:', error);
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
    deleteProfile(id);
    res.json({ message: 'Profile deleted' });
  } catch (error) {
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
    const truncatedCount = loadedResumes.filter(r => r.isTruncated).length;
    return res.json({
      resumes: loadedResumes,
      summary: {
        total: loadedResumes.length,
        truncated: truncatedCount,
        warning: truncatedCount > 0 ? `${truncatedCount} resume(s) truncated` : null
      }
    });
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
      resumes_loaded: loadedResumes.length,
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
app.use((err, req, res, next) => {
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

  function gracefulShutdown() {
    console.log('\nGraceful shutdown initiated...');

    // Stop accepting new requests
    server.close(() => {
      console.log('HTTP server closed');
    });

    // Wait for ongoing scrape to finish (with timeout)
    const shutdownTimeout = setTimeout(() => {
      console.error('Forced shutdown: scrape took too long');
      process.exit(1);
    }, 30000); // 30 second timeout

    // Check scraper status
    const status = getRunStatus();
    if (status.running) {
      console.log('Scraper is running, waiting for completion...');
      const waitInterval = setInterval(() => {
        if (!getRunStatus().running) {
          clearInterval(waitInterval);
          clearTimeout(shutdownTimeout);
          console.log('Scrape completed, shutting down');
          process.exit(0);
        }
      }, 1000);
    } else {
      clearTimeout(shutdownTimeout);
      process.exit(0);
    }
  }
}).catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

module.exports = app;
