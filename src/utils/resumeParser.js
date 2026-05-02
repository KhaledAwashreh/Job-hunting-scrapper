const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const resumesDir = path.join(__dirname, '../../data/resumes');
// Truncate resumes to 10k chars to fit within Claude API token limits
const MAX_RESUME_LENGTH = 10000;
// In-memory cache for parsed resumes (key: filename, value: { mtime, text })
const resumeCache = new Map();

async function parseResumes() {
  try {
    try {
      await fs.access(resumesDir);
    } catch {
      return [];
    }

    const files = await fs.readdir(resumesDir);
    const filteredFiles = files
      .filter(f => f.endsWith('.pdf') || f.endsWith('.docx') || f.endsWith('.txt'))
      .sort();

    const resumes = [];
    let index = 1;

    for (const filename of filteredFiles) {
      const filepath = path.join(resumesDir, filename);

      try {
        // Check cache first: if file hasn't changed, use cached text
        const stats = await fs.stat(filepath);
        const cached = resumeCache.get(filename);
        if (cached && cached.mtime === stats.mtimeMs) {
          // Use cached text
          const text = cached.text;
          if (text.trim()) {
            const isTruncated = text.length > MAX_RESUME_LENGTH;
            resumes.push({
              index,
              filename,
              text: text.substring(0, MAX_RESUME_LENGTH),
              isTruncated,
              originalLength: text.length
            });
            if (isTruncated) {
              console.warn(
                `Resume truncated: ${filename} (${text.length} chars → ${MAX_RESUME_LENGTH} chars)`
              );
            }
            index++;
          }
          continue;
        }

        // Not cached or file changed: parse
        let text = '';

        if (filename.endsWith('.txt')) {
          text = await fs.readFile(filepath, 'utf-8');
        } else if (filename.endsWith('.pdf')) {
          const buffer = await fs.readFile(filepath);
          const data = await pdfParse(buffer);
          text = data.text;
        } else if (filename.endsWith('.docx')) {
          const buffer = await fs.readFile(filepath);
          const result = await mammoth.extractRawText({ buffer });
          text = result.value;
        }

        if (text.trim()) {
          const isTruncated = text.length > MAX_RESUME_LENGTH;
          // Update cache
          resumeCache.set(filename, { mtime: stats.mtimeMs, text });
          resumes.push({
            index,
            filename,
            text: text.substring(0, MAX_RESUME_LENGTH),
            isTruncated,
            originalLength: text.length
          });

          if (isTruncated) {
            console.warn(
              `Resume truncated: ${filename} (${text.length} chars → ${MAX_RESUME_LENGTH} chars)`
            );
          }
          index++;
        }
      } catch (error) {
        console.error(`Error parsing resume ${filename}:`, error.message);
      }
    }

    return resumes;
  } catch (error) {
    console.error('Error in parseResumes:', error.message);
    return [];
  }
}

module.exports = { parseResumes };
