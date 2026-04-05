const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const resumesDir = path.join(__dirname, '../../data/resumes');
const MAX_RESUME_LENGTH = 10000;

async function parseResumes() {
  try {
    if (!fs.existsSync(resumesDir)) {
      return [];
    }

    const files = fs.readdirSync(resumesDir)
      .filter(f => f.endsWith('.pdf') || f.endsWith('.docx') || f.endsWith('.txt'))
      .sort();

    const resumes = [];
    let index = 1;

    for (const filename of files) {
      const filepath = path.join(resumesDir, filename);

      try {
        let text = '';

        if (filename.endsWith('.txt')) {
          text = fs.readFileSync(filepath, 'utf-8');
        } else if (filename.endsWith('.pdf')) {
          const buffer = fs.readFileSync(filepath);
          const data = await pdfParse(buffer);
          text = data.text;
        } else if (filename.endsWith('.docx')) {
          const buffer = fs.readFileSync(filepath);
          const result = await mammoth.extractRawText({ buffer });
          text = result.value;
        }

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
