// Regression tests for #28 — saveDatabase() rewrote the ENTIRE database file
// on every single write (queries.js's runWrite() called it after each INSERT/
// UPDATE), and saveDatabase() itself does a full `database.export()` +
// `fs.writeFileSync()` of the whole in-memory DB. addPosition() runs once per
// scraped job inside orchestrator.js's scrape loop with no batching, so save
// cost — and therefore scrape time — grew with the square of the database
// size, not linearly with the number of new positions.
//
// The fix (src/db/schema.js: beginBatch/endBatch/flushDatabase) lets bulk
// callers defer the expensive export()+writeFileSync() until they explicitly
// flush, instead of paying it on every single write. These tests prove the
// mechanism directly: they count real `fs.writeFileSync(dbPath, ...)` calls,
// which is exactly the operation the issue measured as growing ~7x for a ~7x
// larger database — keeping the write COUNT flat regardless of how many rows
// are inserted per batch is what turns the near-quadratic cost back into
// roughly-linear (one export() per batch, not per row).
//
// JOBS_DB_PATH is set to a fresh temp file, BEFORE src/db/schema.js is
// required anywhere (including transitively), so the real jobs.db is never
// opened.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const REAL_DB = path.join(REPO_ROOT, 'jobs.db');

function realDbFingerprint() {
  if (!fs.existsSync(REAL_DB)) return { exists: false };
  const st = fs.statSync(REAL_DB);
  return { exists: true, size: st.size, mtimeMs: st.mtimeMs };
}

const realDbBefore = realDbFingerprint();

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunter-batch-test-'));
process.env.JOBS_DB_PATH = path.join(tmpDir, 'test-jobs.db');

const schema = require('../src/db/schema');
const queries = require('../src/db/queries');

before(async () => {
  assert.equal(schema.dbPath, process.env.JOBS_DB_PATH, 'schema.js must be pointed at the temp db, not the real one');
  await schema.initializeDatabase();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const realDbAfter = realDbFingerprint();
  assert.deepEqual(
    realDbAfter,
    realDbBefore,
    'the real jobs.db must not be created, opened, or modified by this test run'
  );
});

// Runs `fn` while counting real writes to the test database file, restoring
// fs.writeFileSync afterward no matter what.
function countDbWrites(fn) {
  let writeCount = 0;
  const origWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function (file, ...rest) {
    if (file === schema.dbPath) writeCount++;
    return origWriteFileSync.call(fs, file, ...rest);
  };
  try {
    fn(() => writeCount);
  } finally {
    fs.writeFileSync = origWriteFileSync;
  }
  return writeCount;
}

describe('#28 — batched writes replace one saveDatabase() per insert', () => {
  test('baseline: without batching, each addPosition triggers its own full-DB write', () => {
    const companyId = queries.addCompany('WriteCountCo', 'US', 'https://writecount.example');

    const writeCount = countDbWrites(() => {
      for (let i = 0; i < 20; i++) {
        queries.addPosition(
          `nobatch-${i}`, companyId, 'US', `Title ${i}`, 'desc', 'quals',
          '2026-01-01', 'link', 'full', [], [], [], 0, null
        );
      }
    });

    assert.equal(writeCount, 20, 'unbatched behaviour is unchanged: one full-DB write per insert');
  });

  test('inside a batch, N inserts cost exactly one full-DB write, not N', () => {
    const companyId = queries.addCompany('BatchCo', 'US', 'https://batch.example');
    let midBatchWriteCount;

    const writeCount = countDbWrites((getCount) => {
      queries.beginBatch();
      for (let i = 0; i < 200; i++) {
        queries.addPosition(
          `batch-${i}`, companyId, 'US', `Title ${i}`, 'desc', 'quals',
          '2026-01-01', 'link', 'full', [], [], [], 0, null
        );
      }
      midBatchWriteCount = getCount();
      queries.endBatch();
    });

    assert.equal(midBatchWriteCount, 0, 'writes must stay fully deferred while the batch is open');
    assert.equal(writeCount, 1, 'endBatch() must flush the whole batch in exactly one write, not one per insert');

    // Prove the data is actually durable on disk, not merely "written fewer
    // times" — reload through the normal query path.
    const rows = queries.getAllPositions().filter(p => p.company_id === companyId);
    assert.equal(rows.length, 200, 'all 200 batched inserts must be present after the flush');
  });

  test('flushDatabase() commits mid-batch without ending the batch', () => {
    const companyId = queries.addCompany('MidFlushCo', 'US', 'https://midflush.example');

    const writeCount = countDbWrites((getCount) => {
      queries.beginBatch();
      queries.addPosition('midflush-1', companyId, 'US', 'A', 'd', 'q', '2026-01-01', 'link', 'full', [], [], [], 0, null);
      queries.flushDatabase();
      assert.equal(getCount(), 1, 'flushDatabase() forces a write even while batching is still active');

      queries.addPosition('midflush-2', companyId, 'US', 'B', 'd', 'q', '2026-01-01', 'link', 'full', [], [], [], 0, null);
      assert.equal(getCount(), 1, 'the next insert must stay deferred — still inside the batch');

      queries.endBatch();
      assert.equal(getCount(), 2, 'endBatch() flushes the remaining pending write');
    });

    assert.equal(writeCount, 2);
  });

  test('write count scales with number of batches, not number of rows inserted (root cause of the superlinear cost)', () => {
    const companyId = queries.addCompany('ScaleCo', 'US', 'https://scale.example');
    const BATCHES = 4;
    const ROWS_PER_BATCH = 150;

    const writeCount = countDbWrites(() => {
      for (let b = 0; b < BATCHES; b++) {
        queries.beginBatch();
        for (let i = 0; i < ROWS_PER_BATCH; i++) {
          queries.addPosition(
            `scale-${b}-${i}`, companyId, 'US', `T${b}-${i}`, 'd', 'q',
            '2026-01-01', 'link', 'full', [], [], [], 0, null
          );
        }
        queries.endBatch();
      }
    });

    // Old behaviour: BATCHES * ROWS_PER_BATCH = 600 full-DB writes (one per
    // addPosition), each one export()-ing a bigger DB than the last — this is
    // exactly the ~7x-slower-per-7x-larger-DB pattern the issue measured.
    // New behaviour: exactly one write per batch, independent of how many
    // rows are in it or how large the DB has grown.
    assert.equal(writeCount, BATCHES, `expected ${BATCHES} full-DB writes (one per batch), got ${writeCount}`);

    const rows = queries.getAllPositions().filter(p => p.company_id === companyId);
    assert.equal(rows.length, BATCHES * ROWS_PER_BATCH);
  });
});
