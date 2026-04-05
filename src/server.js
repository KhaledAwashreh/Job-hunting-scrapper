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

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Track resumes for API access
let loadedResumes = [];

// Initialize database and resumes on startup
async function startup() {
  try {
    console.log('Initializing database...');
    await initializeDatabase();
    console.log('Database initialized');

    console.log('Loading resumes...');
    loadedResumes = await parseResumes();
    console.log(`Loaded ${loadedResumes.length} resume(s)`);
  } catch (error) {
    console.error('Startup error:', error);
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
    res.json(positions);
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

app.post('/api/companies', (req, res) => {
  try {
    const { name, country, career_url, platform } = req.body;

    if (!name || !country || !career_url) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

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

    // Start scraper asynchronously
    runScraper().catch(error => {
      console.error('Scraper error:', error);
    });

    res.status(202).json({ message: 'Scraper started', status: getRunStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    // Parse job_types JSON for each profile
    const parsed = profiles.map(p => ({
      ...p,
      job_types: JSON.parse(p.job_types || '[]')
    }));
    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/profiles', (req, res) => {
  try {
    const { name, resume_file, job_types, secondary_category } = req.body;

    if (!name || !resume_file || !job_types || job_types.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const id = addProfile(name, resume_file, job_types, secondary_category || null);
    const profile = getProfileById(id);
    res.status(201).json({ ...profile, job_types: JSON.parse(profile.job_types) });
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
    res.json({ ...profile, job_types: JSON.parse(profile.job_types) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/profiles/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, resume_file, job_types, secondary_category } = req.body;

    if (!name || !resume_file || !job_types) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    updateProfile(id, name, resume_file, job_types, secondary_category || null);
    const updated = getProfileById(id);
    res.json({ ...updated, job_types: JSON.parse(updated.job_types) });
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

// ===== Health check =====
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    resumes_loaded: loadedResumes.length,
    timestamp: new Date().toISOString()
  });
});

// ===== Error handling =====
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
startup().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

module.exports = app;
