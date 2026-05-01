const { getDatabase, saveDatabase } = require('./schema');
const { ensureArray } = require('../utils/typeHelpers');

function runQuery(query, params = []) {
  const db = getDatabase();
  const stmt = db.prepare(query);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function runWrite(query, params = []) {
  const db = getDatabase();
  db.run(query, params);
  saveDatabase();
}

function getAllCompanies() {
  return runQuery('SELECT * FROM companies ORDER BY name');
}

function getActiveCompanies() {
  return runQuery('SELECT * FROM companies WHERE active = 1 ORDER BY name');
}

function addCompany(name, country, careerUrl, platform = 'custom') {
  runWrite(
    `INSERT INTO companies (name, country, career_url, platform) VALUES (?, ?, ?, ?)`,
    [name, country, careerUrl, platform]
  );
  const result = runQuery('SELECT last_insert_rowid() as id');
  return result[0]?.id || 1;
}

function updateCompanyActive(companyId, active) {
  runWrite(
    'UPDATE companies SET active = ? WHERE id = ?',
    [active ? 1 : 0, companyId]
  );
}

function updateCompany(companyId, updates) {
  const { name, country, career_url, platform } = updates;
  const fields = [];
  const values = [];

  if (name !== undefined) {
    fields.push('name = ?');
    values.push(name);
  }
  if (country !== undefined) {
    fields.push('country = ?');
    values.push(country);
  }
  if (career_url !== undefined) {
    fields.push('career_url = ?');
    values.push(career_url);
  }
  if (platform !== undefined) {
    fields.push('platform = ?');
    values.push(platform);
  }

  if (fields.length === 0) return;

  values.push(companyId);
  const query = `UPDATE companies SET ${fields.join(', ')} WHERE id = ?`;
  runWrite(query, values);
}

function deleteCompany(companyId) {
  // Delete associated positions first (foreign key constraint)
  runWrite('DELETE FROM positions WHERE company_id = ?', [companyId]);
  // Then delete the company
  runWrite('DELETE FROM companies WHERE id = ?', [companyId]);
}

function getCompanyById(companyId) {
  const result = runQuery('SELECT * FROM companies WHERE id = ?', [companyId]);
  return result[0];
}

function getAllPositions() {
  const raw = runQuery(`
    SELECT p.*, c.name as company_name
    FROM positions p
    LEFT JOIN companies c ON p.company_id = c.id
    ORDER BY p.match_score DESC
  `);
  
  return raw.map(p => ({
    ...p,
    location_type: ensureArray(p.location_type),
    years_experience: ensureArray(p.years_experience),
    seniority_level: ensureArray(p.seniority_level)
  }));
}

function getPositionsByFilters(country, status) {
  let query = `
    SELECT p.*, c.name as company_name
    FROM positions p
    LEFT JOIN companies c ON p.company_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (country) {
    query += ' AND p.country = ?';
    params.push(country);
  }

  if (status) {
    query += ' AND p.status = ?';
    params.push(status);
  }

  query += ' ORDER BY p.match_score DESC';
  const raw = runQuery(query, params);
  
  return raw.map(p => ({
    ...p,
    location_type: ensureArray(p.location_type),
    years_experience: ensureArray(p.years_experience),
    seniority_level: ensureArray(p.seniority_level)
  }));
}

function checkPositionExists(hash) {
  const result = runQuery('SELECT 1 FROM positions WHERE hash = ? LIMIT 1', [hash]);
  return result.length > 0;
}

function addPosition(hash, companyId, country, title, description, qualifications, publishDate, link, jobType, locationTypes, yearsExp, seniorityLevels, matchScore, matchedResume) {
  try {
    runWrite(
      `INSERT INTO positions (hash, company_id, country, title, description, qualifications, publish_date, link, job_type, location_type, years_experience, seniority_level, match_score, matched_resume)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [hash, companyId, country, title, description, qualifications, publishDate, link, jobType, JSON.stringify(locationTypes || []), JSON.stringify(yearsExp || []), JSON.stringify(seniorityLevels || []), matchScore, matchedResume]
    );
    const result = runQuery('SELECT last_insert_rowid() as id');
    return { id: result[0]?.id || null, isDuplicate: false };
  } catch (e) {
    // Duplicate hash - UNIQUE constraint violation (sql.js throws "UNIQUE constraint failed")
    const errMsg = e.message || '';
    if (errMsg.includes('UNIQUE constraint failed') || errMsg.includes('UNIQUE')) {
      return { id: null, isDuplicate: true };
    }
    // Unexpected error - re-throw
    throw e;
  }
}

function updatePositionStatus(positionId, status) {
  runWrite('UPDATE positions SET status = ? WHERE id = ?', [status, positionId]);
}

function getPositionById(positionId) {
  const raw = runQuery(`
    SELECT p.*, c.name as company_name
    FROM positions p
    LEFT JOIN companies c ON p.company_id = c.id
    WHERE p.id = ?
  `, [positionId]);
  
  if (raw.length === 0) return null;
  
  const p = raw[0];
  return {
    ...p,
    location_type: ensureArray(p.location_type),
    years_experience: ensureArray(p.years_experience),
    seniority_level: ensureArray(p.seniority_level)
  };
}

function createScrapeRun(startedAt) {
  runWrite('INSERT INTO scrape_runs (started_at) VALUES (?)', [startedAt]);
  const result = runQuery('SELECT last_insert_rowid() as id');
  return result[0]?.id || 1;
}

function updateScrapeRun(runId, finishedAt, companiesVisited, positionsFound, positionsNew, errorsJson) {
  runWrite(
    `UPDATE scrape_runs SET finished_at = ?, companies_visited = ?, positions_found = ?, positions_new = ?, errors_json = ? WHERE id = ?`,
    [finishedAt, companiesVisited, positionsFound, positionsNew, errorsJson, runId]
  );
}

function getAllScrapeRuns() {
  return runQuery('SELECT * FROM scrape_runs ORDER BY id DESC');
}

function getScrapeRunById(runId) {
  const result = runQuery('SELECT * FROM scrape_runs WHERE id = ?', [runId]);
  return result[0];
}

// Profile functions
function addProfile(name, resumeFile, jobTypes, secondaryCategory, seniorityLevel, yearsOfExperience = [], workLocationPreference = []) {
  runWrite(
    `INSERT INTO profiles (name, resume_file, job_types, secondary_category, seniority_level, years_of_experience, work_location_preference)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, resumeFile, JSON.stringify(jobTypes), secondaryCategory, seniorityLevel || null, JSON.stringify(yearsOfExperience), JSON.stringify(workLocationPreference)]
  );
  const result = runQuery('SELECT last_insert_rowid() as id');
  return result[0]?.id || 1;
}

function getAllProfiles() {
  return runQuery('SELECT * FROM profiles ORDER BY name');
}

function getProfileById(profileId) {
  const result = runQuery('SELECT * FROM profiles WHERE id = ?', [profileId]);
  return result[0];
}

function updateProfile(profileId, name, resumeFile, jobTypes, secondaryCategory, seniorityLevel, yearsOfExperience = [], workLocationPreference = []) {
  runWrite(
    `UPDATE profiles SET name = ?, resume_file = ?, job_types = ?, secondary_category = ?, seniority_level = ?, years_of_experience = ?, work_location_preference = ? WHERE id = ?`,
    [name, resumeFile, JSON.stringify(jobTypes), secondaryCategory, seniorityLevel || null, JSON.stringify(yearsOfExperience), JSON.stringify(workLocationPreference), profileId]
  );
}

function deleteProfile(profileId) {
  // Delete position_profiles links first (cascade would handle this, but being explicit)
  runWrite('DELETE FROM position_profiles WHERE profile_id = ?', [profileId]);
  runWrite('DELETE FROM profiles WHERE id = ?', [profileId]);
}

// Position-Profile join functions
function linkPositionToProfile(positionId, profileId, matchScore = 0) {
  try {
    runWrite(
      `INSERT INTO position_profiles (position_id, profile_id, match_score)
       VALUES (?, ?, ?)`,
      [positionId, profileId, matchScore]
    );
    return true;
  } catch (e) {
    return false;
  }
}

function getProfilesForPosition(positionId) {
  return runQuery(`
    SELECT p.*, pp.match_score
    FROM profiles p
    INNER JOIN position_profiles pp ON p.id = pp.profile_id
    WHERE pp.position_id = ?
    ORDER BY pp.match_score DESC
  `, [positionId]);
}

function getPositionsForProfile(profileId) {
  return runQuery(`
    SELECT pos.*, c.name as company_name, pp.match_score as profile_match_score
    FROM positions pos
    INNER JOIN position_profiles pp ON pos.id = pp.position_id
    LEFT JOIN companies c ON pos.company_id = c.id
    WHERE pp.profile_id = ?
    ORDER BY pp.match_score DESC
  `, [profileId]);
}

function updatePositionProfileScore(positionId, profileId, matchScore) {
  runWrite(
    'UPDATE position_profiles SET match_score = ? WHERE position_id = ? AND profile_id = ?',
    [matchScore, positionId, profileId]
  );
}

function unlinkPositionFromProfile(positionId, profileId) {
  runWrite(
    'DELETE FROM position_profiles WHERE position_id = ? AND profile_id = ?',
    [positionId, profileId]
  );
}

// App Preferences functions
function setTimeWindowPreference(preference) {
  runWrite(
    `INSERT OR REPLACE INTO app_preferences (key, value) VALUES (?, ?)`,
    ['timeWindow', preference]
  );
}

function getTimeWindowPreference() {
  const result = runQuery(`SELECT value FROM app_preferences WHERE key = ?`, ['timeWindow']);
  return result[0]?.value || '30';
}

module.exports = {
  getAllCompanies,
  getActiveCompanies,
  addCompany,
  updateCompanyActive,
  updateCompany,
  deleteCompany,
  getCompanyById,
  getAllPositions,
  getPositionsByFilters,
  checkPositionExists,
  addPosition,
  updatePositionStatus,
  getPositionById,
  createScrapeRun,
  updateScrapeRun,
  getAllScrapeRuns,
  getScrapeRunById,
  addProfile,
  getAllProfiles,
  getProfileById,
  updateProfile,
  deleteProfile,
  linkPositionToProfile,
  getProfilesForPosition,
  getPositionsForProfile,
  updatePositionProfileScore,
  unlinkPositionFromProfile,
  setTimeWindowPreference,
  getTimeWindowPreference
};
