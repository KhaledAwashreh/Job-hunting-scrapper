const crypto = require('crypto');

function hashJob(job) {
  const raw = [
    job.title || '',
    job.description || '',
    job.qualifications || '',
    job.publishDate || '',
  ].join('|');

  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = { hashJob };
