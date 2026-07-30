const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const resumesDir = path.join(__dirname, '../../data/resumes');
// Truncate resumes to 10k chars to fit within Claude API token limits
const MAX_RESUME_LENGTH = 10000;
// In-memory cache for parsed resumes (key: resolved absolute file path,
// value: { mtime, text }). Keying on the resolved path — not the bare
// filename — matters because two different directories can hold
// same-named files with identical mtimes (cp -p, rsync -a, git checkout,
// coarse-granularity filesystems all produce this); a filename-only key
// would serve one candidate's resume text under another candidate's name.
const resumeCache = new Map();

function clearResumeCache() {
  resumeCache.clear();
}

// `dir` defaults to the app's real resumes directory but can be overridden —
// e.g. by tests pointing this at a temp directory instead of data/resumes/.
async function parseResumes(dir = resumesDir) {
  try {
    try {
      await fs.access(dir);
    } catch {
      return [];
    }

    const files = await fs.readdir(dir);
    const filteredFiles = files
      .filter(f => f.endsWith('.pdf') || f.endsWith('.docx') || f.endsWith('.txt'))
      .sort();

    // Evict cache entries for files that used to live in this directory but
    // are no longer present (deleted, renamed, etc.), so the Map doesn't
    // grow forever. Scoped to this directory's prefix only, so it never
    // touches entries cached for other directories.
    const resolvedDir = path.resolve(dir);
    const currentPaths = new Set(filteredFiles.map(f => path.resolve(resolvedDir, f)));
    const dirPrefix = resolvedDir + path.sep;
    for (const key of resumeCache.keys()) {
      if (key.startsWith(dirPrefix) && !currentPaths.has(key)) {
        resumeCache.delete(key);
      }
    }

    const resumes = [];
    let index = 1;

    for (const filename of filteredFiles) {
      const filepath = path.join(dir, filename);
      const resolvedPath = path.resolve(resolvedDir, filename);

      try {
        // Check cache first: if file hasn't changed, use cached text
        const stats = await fs.stat(filepath);
        const cached = resumeCache.get(resolvedPath);
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
          resumeCache.set(resolvedPath, { mtime: stats.mtimeMs, text });
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

module.exports = { parseResumes, clearResumeCache };
