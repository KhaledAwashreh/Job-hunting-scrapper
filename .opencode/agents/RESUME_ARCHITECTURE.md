# Resume Processing Architecture

## How Resume Reading Works

The agent **does not read PDFs directly**. Instead, the system has an automated resume processing pipeline:

### Phase 1: Server Startup (Automatic)

```
User starts server: npm start
         ↓
src/server.js startup()
         ↓
parseResumes() called
         ↓
Scans data/resumes/ for *.pdf, *.docx, *.txt
         ↓
pdf-parse (for .pdf) → extracts text
mammoth (for .docx) → extracts text  
fs.readFile (for .txt) → reads text directly
         ↓
Stores in memory: [
  { index: 1, filename: 'resume-backend.pdf', text: '...' },
  { index: 2, filename: 'resume-mlops.docx', text: '...' },
  { index: 3, filename: 'resume-general.txt', text: '...' }
]
```

**Result**: Plain text resumes ready in memory. No further file I/O needed.

### Phase 2: Job Scoring (During Scrape)

```
orchestrator.js runs runScraper()
         ↓
Loads resumes from parseResumes() into memory
         ↓
For each new job position:
         ↓
Calls relevanceScorer.scorePosition(job, resumes)
         ↓
Builds prompt with:
  - Job title, description, qualifications
  - Resume 1 text (10k chars max)
  - Resume 2 text (10k chars max)
  - Resume 3 text (10k chars max)
         ↓
Sends to Claude API
         ↓
Claude compares and returns: { score: 85, matched_resume: 1, reasoning: "..." }
         ↓
Stores in database (no PDF needed)
```

**The agent never handles PDF files during scraping** — only the startup process does, once, automatically.

---

## File Structure

```
data/
├── resumes/
│   ├── resume-backend.pdf        ← User drops here
│   ├── resume-mlops.pdf          ← User drops here
│   └── resume-general.txt        ← User drops here
└── search-params.csv
```

When `npm start` runs:
1. parseResumes() scans this directory
2. Extracts text using appropriate parser (pdf-parse, mammoth, or fs)
3. Stores in memory
4. Server starts and resumes are immediately available to scorer

---

## Key Implementation Details

### src/utils/resumeParser.js

```js
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const fs = require('fs');

async function parseResumes() {
  // This function is called ONCE at server startup
  // Returns: Array of { index, filename, text }
  
  // For each file in data/resumes/:
  // - If .pdf: use pdf-parse to extract text
  // - If .docx: use mammoth to extract text
  // - If .txt: use fs.readFile() to read as text
  
  // Truncate each resume to 10,000 characters
  // This ensures Claude API token budget isn't exceeded
}
```

**Called by**: `src/server.js` in `startup()` function at server start
**Stored globally**: Loaded once and reused for all scoring operations
**Updated**: Only when server restarts (user adds/updates resume files)

### src/scoring/relevanceScorer.js

```js
async function scorePosition(job, resumes) {
  // resumes = [
  //   { index: 1, filename: '...', text: '...' },
  //   { index: 2, filename: '...', text: '...' },
  //   { index: 3, filename: '...', text: '...' }
  // ]
  
  // Builds prompt with resume texts (already extracted at startup)
  // No PDF parsing needed here — resumes are plain text
  
  // Calls Claude API
  // Returns: { score, matched_resume, reasoning }
}
```

**Called by**: `src/agents/orchestrator.js` for each new position during scrape
**Frequency**: Once per position (not per resume)
**Performance**: Fast because resumes are already in memory as plain text

---

## How the Agent Improves This

If you ask the agent to improve resume handling:

### Option 1: Better PDF Extraction
- Enhance `src/utils/resumeParser.js`
- Add better formatting preservation (sections, bullet points)
- Handle multi-column layouts better
- Add resume validation (reject if < 100 chars)
- Add resume caching (sha256 of file → cached text)

### Option 2: Smarter Resume Matching
- Enhance `src/scoring/relevanceScorer.js`
- Add resume selection logic (choose best-matching resume per job type)
- Add section-aware scoring (weight experience + skills differently)
- Add resume summary generation (abstract key points for efficiency)

### Option 3: Resume Management API
- Add endpoints to `src/server.js`:
  - `GET /api/resumes` — List loaded resumes with metadata
  - `POST /api/resumes` — Upload new resume (multipart/form-data)
  - `DELETE /api/resumes/:id` — Remove resume
  - `PATCH /api/resumes/:id` — Toggle resume active/inactive
- Add database storage: `resumes` table with `id, filename, text_hash, created_at`

### Option 4: Resume Preview in Dashboard
- Add "Resume" tab to `public/dashboard.html`
- Show preview of loaded resume texts
- Allow in-UI upload of new resumes
- Show which resume matched each position

---

## Key Points

✅ **Resume reading is fully automatic** — no agent intervention needed  
✅ **Zero PDF reader dependency** — `pdf-parse` does it at startup  
✅ **Resumes cached in memory** — fast scoring without repeated parsing  
✅ **No manual file handling** — just drop files in `data/resumes/`  
✅ **Scalable to N resumes** — code supports any number of resume files  
✅ **Plain text pipeline** — Claude API only sees extracted text, not PDFs  

---

## Example Workflow

```bash
$ ls data/resumes/
resume-backend.pdf
resume-mlops.pdf

$ npm start
> Initializing database...
> Database initialized
> Loading resumes...
> ✓ Parsed resume-backend.pdf (8,456 chars)
> ✓ Parsed resume-mlops.pdf (7,234 chars)
> Loaded 2 resume(s)
> Server running on http://localhost:3000

$ # User manually triggers scraper via dashboard
$ # orchestrator.runScraper() starts
$ # For each new job:
$ #   relevanceScorer.scorePosition(job, [resume1_text, resume2_text])
$ #   Claude API compares job to both resumes
$ #   Returns match score

$ # Database stores position with best_match_score and matched_resume_id
```

**User Experience**:
1. Drop PDFs in `data/resumes/`
2. Restart server (`npm start`)
3. Click "Run Scraper" in dashboard
4. AI automatically matches jobs to resumes
5. See scoring results in positions table

No manual PDF reading, no agent involvement in parsing — it's all automatic. ✅

