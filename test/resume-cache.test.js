const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const resumeCache = require('../src/utils/resumeCache');

// Real, file-driven tests against src/utils/resumeCache.js — the module
// extracted out of src/server.js so the resume-cache logic (refresh/get/
// getSummary) can be exercised without a database or HTTP listener.
// `resumeCache.refresh(dir)` accepts an optional directory (threaded through
// to resumeParser.parseResumes(dir), which now defaults its dir argument
// instead of hardcoding it), so these tests point at a temp directory and
// never touch data/resumes/ or jobs.db.

async function makeTempResumesDir(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-cache-test-'));
  for (const [filename, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, filename), content, 'utf-8');
  }
  return dir;
}

describe('resumeCache — refresh() against real files on disk', () => {
  test('refresh(dir) with N resume files populates get() with N entries', async () => {
    const dir = await makeTempResumesDir({
      'alice.txt': 'Alice resume content',
      'bob.txt': 'Bob resume content'
    });
    try {
      const result = await resumeCache.refresh(dir);
      assert.equal(result.length, 2);
      assert.equal(resumeCache.get().length, 2);
      assert.deepEqual(
        resumeCache.get().map(r => r.filename).sort(),
        ['alice.txt', 'bob.txt']
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('acceptance (b): uploading (writing) a new file then refreshing reflects it', async () => {
    const dir = await makeTempResumesDir({
      'alice.txt': 'Alice resume content',
      'bob.txt': 'Bob resume content'
    });
    try {
      await resumeCache.refresh(dir);
      assert.equal(resumeCache.get().length, 2);

      // Simulate what the upload handler does: a new file lands on disk,
      // then the handler awaits resumeCache.refresh().
      await fs.writeFile(path.join(dir, 'carol.txt'), 'Carol resume content', 'utf-8');
      await resumeCache.refresh(dir);

      const filenames = resumeCache.get().map(r => r.filename).sort();
      assert.equal(resumeCache.get().length, 3);
      assert.deepEqual(filenames, ['alice.txt', 'bob.txt', 'carol.txt']);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('acceptance (c): deleting a file then refreshing reflects its removal', async () => {
    const dir = await makeTempResumesDir({
      'alice.txt': 'Alice resume content',
      'bob.txt': 'Bob resume content',
      'carol.txt': 'Carol resume content'
    });
    try {
      await resumeCache.refresh(dir);
      assert.equal(resumeCache.get().length, 3);

      // Simulate what the delete handler does: fs.unlinkSync the file, then
      // await resumeCache.refresh().
      await fs.unlink(path.join(dir, 'bob.txt'));
      await resumeCache.refresh(dir);

      const filenames = resumeCache.get().map(r => r.filename).sort();
      assert.equal(resumeCache.get().length, 2);
      assert.deepEqual(filenames, ['alice.txt', 'carol.txt']);
      assert.ok(!filenames.includes('bob.txt'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('getSummary() matches the {resumes, summary: {total, truncated, warning}} shape GET /api/resumes serves', async () => {
    const dir = await makeTempResumesDir({
      'short.txt': 'a short resume',
      // MAX_RESUME_LENGTH in resumeParser.js is 10000; this forces isTruncated.
      'long.txt': 'x'.repeat(10500)
    });
    try {
      await resumeCache.refresh(dir);
      const summary = resumeCache.getSummary();

      assert.equal(summary.resumes, resumeCache.get());
      assert.equal(summary.summary.total, 2);
      assert.equal(summary.summary.truncated, 1);
      assert.match(summary.summary.warning, /1 resume\(s\) truncated/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('getSummary() reports no warning when nothing is truncated', async () => {
    const dir = await makeTempResumesDir({
      'short.txt': 'a short resume'
    });
    try {
      await resumeCache.refresh(dir);
      const summary = resumeCache.getSummary();

      assert.equal(summary.summary.total, 1);
      assert.equal(summary.summary.truncated, 0);
      assert.equal(summary.summary.warning, null);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('refresh(dir) on an empty directory yields an empty cache', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-cache-test-'));
    try {
      const result = await resumeCache.refresh(dir);
      assert.deepEqual(result, []);
      assert.deepEqual(resumeCache.get(), []);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
