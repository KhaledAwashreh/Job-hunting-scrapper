const { getDatabase, saveDatabase, flushDatabase, beginBatch, endBatch } = require('./schema');
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

// #29 — companies now has a UNIQUE(name, career_url) constraint (schema.js).
// INSERT OR IGNORE means a duplicate (name, career_url) pair no longer
// throws — it silently matches zero rows, and we re-select the existing
// row's id instead. This keeps addCompany's contract identical for every
// existing caller (always returns a real numeric id, never throws on a
// duplicate), so bulk-add-companies.js and POST /api/companies can call it
// repeatedly with the same company and just get the same id back rather
// than crashing or creating a second row.
function addCompany(name, country, careerUrl, platform = 'custom', platformSlug = null, apiUrl = null) {
  const db = getDatabase();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO companies (name, country, career_url, platform, platform_slug, api_url) VALUES (?, ?, ?, ?, ?, ?)`
  );
  stmt.bind([name, country, careerUrl, platform, platformSlug, apiUrl]);
  stmt.step();
  stmt.free();

  if (db.getRowsModified() === 0) {
    // UNIQUE(name, career_url) collision — INSERT OR IGNORE skipped it.
    const existing = runQuery(
      'SELECT id FROM companies WHERE name = ? AND career_url = ?',
      [name, careerUrl]
    );
    return existing[0]?.id || null;
  }

  const id = db.exec("SELECT last_insert_rowid()")[0].values[0][0];
  saveDatabase();
  return id;
}

// #29 — lets a caller (bulk-add-companies.js) check whether a company would
// be a duplicate before doing expensive work (e.g. platform detection) for
// it, and report "skipped" accurately instead of always claiming "added".
function companyExists(name, careerUrl) {
  const result = runQuery(
    'SELECT id FROM companies WHERE name = ? AND career_url = ? LIMIT 1',
    [name, careerUrl]
  );
  return result.length > 0;
}

function updateCompanyActive(companyId, active) {
  runWrite(
    'UPDATE companies SET active = ? WHERE id = ?',
    [active ? 1 : 0, companyId]
  );
}

function updateCompany(companyId, updates) {
  const { name, country, career_url, platform, platform_slug, api_url } = updates;
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
  if (platform_slug !== undefined) {
    fields.push('platform_slug = ?');
    values.push(platform_slug);
  }
  if (api_url !== undefined) {
    fields.push('api_url = ?');
    values.push(api_url);
  }

  if (fields.length === 0) return;

  values.push(companyId);
  const query = `UPDATE companies SET ${fields.join(', ')} WHERE id = ?`;
  runWrite(query, values);
}

function deleteCompany(companyId) {
  // #30 — schema.js now sets PRAGMA foreign_keys = ON, so this manual
  // positions delete also cascades (via the declared ON DELETE CASCADE
  // FKs) to position_profiles and tailored_resumes rows that pointed at
  // those positions — no orphans left behind in either table.
  runWrite('DELETE FROM positions WHERE company_id = ?', [companyId]);
  // Then delete the company
  runWrite('DELETE FROM companies WHERE id = ?', [companyId]);
}

function getCompanyById(companyId) {
  const result = runQuery('SELECT * FROM companies WHERE id = ?', [companyId]);
  // #32 — standardize "not found" on null across query functions (was
  // undefined here, null in getPositionById); every caller uses a truthy
  // check so this is purely for consistency, not a behavior change.
  return result[0] || null;
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
    // Fetch the inserted position by hash to get the id (more reliable than last_insert_rowid in sql.js)
    const inserted = runQuery('SELECT id FROM positions WHERE hash = ? LIMIT 1', [hash]);
    const positionId = inserted[0]?.id || null;
    return { id: positionId, isDuplicate: false };
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
  // scrape_runs has no natural unique key to re-select on (unlike addPosition's
  // hash workaround), so the id MUST be captured via last_insert_rowid() before
  // saveDatabase() runs. saveDatabase() calls database.export(), which resets
  // the connection's last_insert_rowid() to 0 — reading it after runWrite()
  // (which calls saveDatabase() internally) always returned 0, and the old
  // `|| 1` fallback then masked that by hardcoding row 1 for every run.
  const db = getDatabase();
  db.run('INSERT INTO scrape_runs (started_at) VALUES (?)', [startedAt]);
  const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  saveDatabase();
  return id;
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
  return result[0] || null; // #32 — standardize "not found" on null
}

// Profile functions
function addProfile(name, resumeFile, jobTypes, secondaryCategory, seniorityLevel, yearsOfExperience = [], workLocationPreference = []) {
  const db = getDatabase();
  db.run(
    `INSERT INTO profiles (name, resume_file, job_types, secondary_category, seniority_level, years_of_experience, work_location_preference)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, resumeFile, JSON.stringify(jobTypes), secondaryCategory, seniorityLevel || null, JSON.stringify(yearsOfExperience), JSON.stringify(workLocationPreference)]
  );
  const id = db.exec("SELECT last_insert_rowid()")[0].values[0][0];
  saveDatabase();
  return id;
}

function getAllProfiles() {
  return runQuery('SELECT * FROM profiles ORDER BY name');
}

function getProfileById(profileId) {
  const result = runQuery('SELECT * FROM profiles WHERE id = ?', [profileId]);
  return result[0] || null; // #32 — standardize "not found" on null
}

function updateProfile(profileId, name, resumeFile, jobTypes, secondaryCategory, seniorityLevel, yearsOfExperience = [], workLocationPreference = []) {
  runWrite(
    `UPDATE profiles SET name = ?, resume_file = ?, job_types = ?, secondary_category = ?, seniority_level = ?, years_of_experience = ?, work_location_preference = ? WHERE id = ?`,
    [name, resumeFile, JSON.stringify(jobTypes), secondaryCategory, seniorityLevel || null, JSON.stringify(yearsOfExperience), JSON.stringify(workLocationPreference), profileId]
  );
}

function deleteProfile(profileId) {
  // #30 — kept explicit for clarity, though PRAGMA foreign_keys = ON
  // (schema.js) now means deleting the profiles row below would cascade
  // this anyway. tailored_resumes.profile_id (not cleaned up manually
  // anywhere) relies entirely on that cascade to avoid orphans.
  runWrite('DELETE FROM position_profiles WHERE profile_id = ?', [profileId]);
  runWrite('DELETE FROM profiles WHERE id = ?', [profileId]);
}

// Position-Profile join functions
// #31 — previously caught every exception identically and returned false,
// so an expected duplicate link (UNIQUE(position_id, profile_id) collision)
// was indistinguishable from a genuine unexpected error (e.g. a NOT NULL
// violation from a bad positionId/profileId). Mirror the
// addPosition()/addTailoredResume() pattern: only treat the UNIQUE-collision
// case as a harmless no-op; let anything else propagate.
function linkPositionToProfile(positionId, profileId, matchScore = 0) {
  try {
    runWrite(
      `INSERT INTO position_profiles (position_id, profile_id, match_score)
       VALUES (?, ?, ?)`,
      [positionId, profileId, matchScore]
    );
    return true;
  } catch (e) {
    const errMsg = e.message || '';
    if (errMsg.includes('UNIQUE constraint failed') || errMsg.includes('UNIQUE')) {
      return false; // already linked — harmless no-op
    }
    throw e; // unexpected error — surface it rather than swallowing
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

// #32 — getPositionsForProfile removed: it was dead code (zero callers
// repo-wide, confirmed by grep in docs/review/unconfirmed/U3-database.md,
// U3.4) and its JSON columns (location_type/years_experience/seniority_level)
// were never parsed through ensureArray() like every other position
// accessor, unlike getAllPositions/getPositionsByFilters/getPositionById.

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

// Tailored Resumes functions
function addTailoredResume(positionId, profileId, baseResumeText, tailoredText, version = 1) {
  try {
    runWrite(
      `INSERT INTO tailored_resumes (position_id, profile_id, base_resume_text, tailored_text, version)
       VALUES (?, ?, ?, ?, ?)`,
      [positionId, profileId, baseResumeText, tailoredText, version]
    );
    // Fetch by unique constraint fields to get the id
    const inserted = runQuery(
      `SELECT id FROM tailored_resumes WHERE position_id = ? AND profile_id = ? AND version = ? LIMIT 1`,
      [positionId, profileId, version]
    );
    return { id: inserted[0]?.id || null, isDuplicate: false };
  } catch (e) {
    const errMsg = e.message || '';
    if (errMsg.includes('UNIQUE constraint failed') || errMsg.includes('UNIQUE')) {
      return { id: null, isDuplicate: true };
    }
    throw e;
  }
}

function getTailoredResumesForPosition(positionId) {
  return runQuery(`
    SELECT tr.*, p.name as profile_name, p.resume_file
    FROM tailored_resumes tr
    INNER JOIN profiles p ON tr.profile_id = p.id
    WHERE tr.position_id = ?
    ORDER BY tr.version DESC, tr.created_at DESC
  `, [positionId]);
}

function getTailoredResumeById(tailoredResumeId) {
  const result = runQuery(`
    SELECT tr.*, p.name as profile_name, p.resume_file, pos.title as position_title, c.name as company_name
    FROM tailored_resumes tr
    INNER JOIN profiles p ON tr.profile_id = p.id
    INNER JOIN positions pos ON tr.position_id = pos.id
    LEFT JOIN companies c ON pos.company_id = c.id
    WHERE tr.id = ?
  `, [tailoredResumeId]);
  return result[0] || null; // #32 — standardize "not found" on null
}

function getNextVersionForPositionProfile(positionId, profileId) {
  const result = runQuery(
    `SELECT MAX(version) as max_version FROM tailored_resumes WHERE position_id = ? AND profile_id = ?`,
    [positionId, profileId]
  );
  return (result[0]?.max_version || 0) + 1;
}

function deleteTailoredResume(tailoredResumeId) {
  runWrite('DELETE FROM tailored_resumes WHERE id = ?', [tailoredResumeId]);
}

module.exports = {
  getAllCompanies,
  getActiveCompanies,
  addCompany,
  companyExists,
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
  updatePositionProfileScore,
  unlinkPositionFromProfile,
  setTimeWindowPreference,
  getTimeWindowPreference,
  addTailoredResume,
  getTailoredResumesForPosition,
  getTailoredResumeById,
  getNextVersionForPositionProfile,
  deleteTailoredResume,
  // #28 — batched-write controls for bulk callers (see orchestrator.js's
  // runScraper()). Re-exported from schema.js so callers only need one
  // require ('../db/queries') for both querying and write-batching.
  flushDatabase,
  beginBatch,
  endBatch
};
