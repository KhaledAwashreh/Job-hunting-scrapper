require('dotenv').config();
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
const { tailorResume } = require('./utils/resumeTailor');
const { runScraper, getRunStatus, setTimeWindow, getTimeWindow } = require('./agents/orchestrator');
const logger = require('./utils/logger');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx'); // For DOCX generation
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib'); // For PDF generation

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

// Multer configuration for resume uploads
const resumeStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../data/resumes'));
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
      cb(new Error('Invalid file type. Only PDF, DOCX, and TXT allowed.'));
    }
  }
});
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
  if (platform && !['greenhouse', 'lever', 'workday', 'custom', 'rss', 'json_api', 'workable'].includes(platform)) {
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
    const resumes = await resumeCache.refresh();
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
app.post('/api/resumes/upload', resumeUpload.single('resume'), async (req, res) => {
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
    const filepath = path.join(__dirname, '../data/resumes', filename);

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

// ===== Tailored Resumes API =====
// Generate a new tailored resume for a position
app.post('/api/positions/:positionId/tailor', async (req, res) => {
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
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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
        const font = isHeading ? timesRomanBold : timesRoman;
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
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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
