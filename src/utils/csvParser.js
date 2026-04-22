const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const csvPath = path.join(__dirname, '../../data/search-params.csv');
// Required columns for valid CSV format
const REQUIRED_CSV_COLUMNS = ['title', 'country'];

async function parseSearchParams() {
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

        validatedRecords.push({
          title: record.title.trim(),
          keywords: record.keywords
            ? record.keywords.split(',').map(k => k.trim()).filter(k => k.length > 0)
            : [],
          country: record.country.trim(),
          seniority: record.seniority ? record.seniority.trim() : null,
          remote: record.remote === 'yes' || record.remote === 'true'
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

module.exports = { parseSearchParams };
