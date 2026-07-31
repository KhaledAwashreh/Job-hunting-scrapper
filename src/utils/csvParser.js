const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const csvPath = path.join(__dirname, '../../data/search-params.csv');
// Required columns for valid CSV format
const REQUIRED_CSV_COLUMNS = ['title', 'country'];
// Valid seniority levels
const VALID_SENIORITY = ['junior', 'mid', 'senior', 'lead', 'principal', 'staff'];
// Accepted spellings for the "remote" column (case-insensitive, trimmed)
const REMOTE_TRUE_VALUES = ['yes', 'true', '1'];
const REMOTE_FALSE_VALUES = ['no', 'false', '0', ''];

// Normalizes the CSV "remote" column into a boolean, warning on anything unrecognized
// (matches the seniority column's warn-and-fall-back-to-safe-default pattern).
function parseRemoteFlag(rawValue, idx) {
  const normalized = (rawValue || '').trim().toLowerCase();
  if (REMOTE_TRUE_VALUES.includes(normalized)) {
    return true;
  }
  if (REMOTE_FALSE_VALUES.includes(normalized)) {
    return false;
  }
  console.warn(`Row ${idx + 1}: Invalid remote value "${rawValue}" - treating as not remote`);
  return false;
}

function parseSearchParams() {
  try {
    if (!fs.existsSync(csvPath)) {
      return [];
    }

    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (records.length === 0) {
      console.warn('CSV file is empty');
      return [];
    }

    // Validate that all required columns exist
    const firstRecord = records[0];
    const missingCols = REQUIRED_CSV_COLUMNS.filter(col => !(col in firstRecord));
    if (missingCols.length > 0) {
      throw new Error(`Missing required CSV columns: ${missingCols.join(', ')}`);
    }

    const validatedRecords = [];
    records.forEach((record, idx) => {
      try {
        // Validate each required field
        if (!record.title || typeof record.title !== 'string' || record.title.trim() === '') {
          throw new Error(`Row ${idx + 1}: title is required and cannot be empty`);
        }
        if (!record.country || typeof record.country !== 'string' || record.country.trim() === '') {
          throw new Error(`Row ${idx + 1}: country is required and cannot be empty`);
        }

        // Validate seniority if present - an invalid value is dropped (null), not stored,
        // so it doesn't silently disable downstream seniority filtering.
        let seniority = null;
        if (record.seniority) {
          const normalizedSeniority = record.seniority.trim().toLowerCase();
          if (VALID_SENIORITY.includes(normalizedSeniority)) {
            seniority = normalizedSeniority;
          } else {
            console.warn(`Row ${idx + 1}: Invalid seniority "${record.seniority}" - ignoring`);
          }
        }

        validatedRecords.push({
          title: record.title.trim(),
          keywords: record.keywords
            ? record.keywords.split(',').map(k => k.trim()).filter(k => k.length > 0)
            : [],
          country: record.country.trim(),
          seniority,
          remote: parseRemoteFlag(record.remote, idx)
        });
      } catch (rowErr) {
        console.error(`CSV validation error: ${rowErr.message}`);
      }
    });

    console.info(`CSV validated: ${validatedRecords.length}/${records.length} rows are valid`);
    return validatedRecords;
  } catch (error) {
    console.error('Error parsing search params CSV:', error.message);
    return [];
  }
}

module.exports = { parseSearchParams, VALID_SENIORITY };
