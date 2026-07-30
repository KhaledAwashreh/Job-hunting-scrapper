const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { parseResumes, clearResumeCache } = require('../src/utils/resumeParser');

// Regression tests for A5.1 (docs/review/confirmed/A5-resume-cache.md): the
// in-memory resume cache in src/utils/resumeParser.js used to be keyed by
// bare filename, ignoring the `dir` the file lived in. Two directories with
// same-named files and identical mtimes would silently serve each other's
// resume text. These tests build fixtures under the OS temp directory only
// and never touch data/resumes/ or jobs.db.

async function makeTempDir() {
  return fsPromises.mkdtemp(path.join(os.tmpdir(), 'resume-parser-cache-test-'));
}

beforeEach(() => {
  clearResumeCache();
});

describe('resumeParser cache key includes the directory', () => {
  test('same filename, same mtime, different directories: each dir gets its own text back', async () => {
    const dirA = await makeTempDir();
    const dirB = await makeTempDir();
    try {
      await fsPromises.writeFile(path.join(dirA, 'resume.txt'), 'CANDIDATE A TEXT - Java Backend Engineer', 'utf-8');
      await fsPromises.writeFile(path.join(dirB, 'resume.txt'), 'CANDIDATE B TEXT - Frontend Engineer', 'utf-8');

      // Force identical mtimes on both files, the exact condition the brief
      // calls out (cp -p / rsync -a / git checkout / coarse fs granularity
      // all produce this).
      const sharedMtime = new Date('2024-01-01T00:00:00.000Z');
      await fsPromises.utimes(path.join(dirA, 'resume.txt'), sharedMtime, sharedMtime);
      await fsPromises.utimes(path.join(dirB, 'resume.txt'), sharedMtime, sharedMtime);

      const statA = await fsPromises.stat(path.join(dirA, 'resume.txt'));
      const statB = await fsPromises.stat(path.join(dirB, 'resume.txt'));
      assert.equal(statA.mtimeMs, statB.mtimeMs, 'test setup requires identical mtimes');

      const resumesA = await parseResumes(dirA);
      const resumesB = await parseResumes(dirB);

      assert.equal(resumesA.length, 1);
      assert.equal(resumesB.length, 1);
      assert.match(resumesA[0].text, /CANDIDATE A TEXT/);
      assert.match(resumesB[0].text, /CANDIDATE B TEXT/);
      assert.doesNotMatch(resumesB[0].text, /CANDIDATE A TEXT/, 'dirB must not be served dirA\'s cached text');
    } finally {
      await fsPromises.rm(dirA, { recursive: true, force: true });
      await fsPromises.rm(dirB, { recursive: true, force: true });
    }
  });

  test('a file modified in place (same path, new content, new mtime) returns the new content', async () => {
    const dir = await makeTempDir();
    try {
      const filepath = path.join(dir, 'resume.txt');
      await fsPromises.writeFile(filepath, 'ORIGINAL CONTENT', 'utf-8');
      const older = new Date('2024-01-01T00:00:00.000Z');
      await fsPromises.utimes(filepath, older, older);

      const first = await parseResumes(dir);
      assert.equal(first.length, 1);
      assert.match(first[0].text, /ORIGINAL CONTENT/);

      await fsPromises.writeFile(filepath, 'UPDATED CONTENT', 'utf-8');
      const newer = new Date('2024-01-01T00:00:10.000Z');
      await fsPromises.utimes(filepath, newer, newer);

      const second = await parseResumes(dir);
      assert.equal(second.length, 1);
      assert.match(second[0].text, /UPDATED CONTENT/);
      assert.doesNotMatch(second[0].text, /ORIGINAL CONTENT/);
    } finally {
      await fsPromises.rm(dir, { recursive: true, force: true });
    }
  });

  test('an unchanged file is served from cache without re-reading it from disk', async () => {
    const dir = await makeTempDir();
    const filepath = path.join(dir, 'resume.txt');
    await fsPromises.writeFile(filepath, 'STABLE CONTENT', 'utf-8');

    // Observe the cache behaviorally: count real fs.readFile calls for this
    // exact file, without inspecting resumeParser's internal Map. `fs`
    // (`require('fs').promises`) is a Node module singleton, so patching
    // the method here is visible to resumeParser.js's own `fs` reference —
    // no internals of the module under test are touched.
    const realReadFile = fsPromises.readFile;
    let readCount = 0;
    fsPromises.readFile = async function (...args) {
      if (args[0] === filepath) readCount++;
      return realReadFile.apply(fsPromises, args);
    };

    try {
      const first = await parseResumes(dir);
      assert.equal(first.length, 1);
      assert.equal(readCount, 1, 'first parse should read the file from disk once');

      const second = await parseResumes(dir);
      assert.equal(second.length, 1);
      assert.equal(readCount, 1, 'second parse of an unchanged file must be served from cache, not re-read');
      assert.equal(second[0].text, first[0].text);
    } finally {
      fsPromises.readFile = realReadFile;
      await fsPromises.rm(dir, { recursive: true, force: true });
    }
  });

  test('deleting a file evicts its cache entry (no unbounded growth) without disturbing other directories', async () => {
    const dirA = await makeTempDir();
    const dirB = await makeTempDir();
    try {
      const fileA = path.join(dirA, 'resume.txt');
      const fileB = path.join(dirB, 'resume.txt');
      await fsPromises.writeFile(fileA, 'DIR A TEXT', 'utf-8');
      await fsPromises.writeFile(fileB, 'DIR B TEXT', 'utf-8');

      await parseResumes(dirA);
      await parseResumes(dirB);

      // Delete dirA's file and re-scan dirA. The eviction is directory-
      // scoped, so dirB's cache entry (and re-parse behavior) must be
      // unaffected.
      await fsPromises.unlink(fileA);
      const afterDeleteA = await parseResumes(dirA);
      assert.deepEqual(afterDeleteA, []);

      const realReadFile = fsPromises.readFile;
      let readCountB = 0;
      fsPromises.readFile = async function (...args) {
        if (args[0] === fileB) readCountB++;
        return realReadFile.apply(fsPromises, args);
      };
      try {
        const resumesB = await parseResumes(dirB);
        assert.equal(resumesB.length, 1);
        assert.match(resumesB[0].text, /DIR B TEXT/);
        assert.equal(readCountB, 0, 'dirB entry must still be cache-served after an unrelated dirA eviction');
      } finally {
        fsPromises.readFile = realReadFile;
      }
    } finally {
      await fsPromises.rm(dirA, { recursive: true, force: true });
      await fsPromises.rm(dirB, { recursive: true, force: true });
    }
  });
});
