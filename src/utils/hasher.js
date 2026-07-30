const crypto = require('crypto');

function hashJob(job) {
  // Include company_id and link to prevent false duplicates across companies.
  // publishDate is deliberately excluded: many ATS bump the posted date to
  // keep a still-open req looking fresh, and identity should be based on
  // company + title + link (+ description/qualifications), not volatile
  // presentation metadata that changes without the job itself changing.
  const raw = [
    job.company_id || '',
    job.title || '',
    job.description || '',
    job.qualifications || '',
    job.link || ''
  ].join('|');

  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = { hashJob };
