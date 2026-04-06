const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const csvPath = path.join(__dirname, '../../data/search-params.csv');

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

    return records.map(record => ({
      title: record.title,
      keywords: record.keywords ? record.keywords.split(',').map(k => k.trim()) : [],
      country: record.country,
      seniority: record.seniority,
      remote: record.remote === 'yes' || record.remote === 'true'
    }));
  } catch (error) {
    console.error('Error parsing search params CSV:', error.message);
    return [];
  }
}

module.exports = { parseSearchParams };
