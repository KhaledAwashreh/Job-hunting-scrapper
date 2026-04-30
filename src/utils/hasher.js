const crypto = require('crypto');

function hashJob(job) {
  // Include company_id and link to prevent false duplicates across companies
  const raw = [
    job.company_id || '',
    job.title || '',
    job.description || '',
    job.qualifications || '',
    job.publishDate || '',
    job.link || ''
  ].join('|');

  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = { hashJob };
