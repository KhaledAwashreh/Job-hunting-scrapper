const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { parseSearchParams } = require('../src/utils/csvParser');

// csvParser.parseSearchParams() always reads from the real data/search-params.csv
// path via fs.readFileSync/fs.existsSync. To exercise it against fixture content
// without ever touching that real file, we mock those two fs methods per-test.
describe('csvParser', () => {
  let warnCalls;
  let originalWarn;

  beforeEach(() => {
    warnCalls = [];
    originalWarn = console.warn;
    console.warn = (...args) => { warnCalls.push(args.join(' ')); };
  });

  afterEach((t) => {
    console.warn = originalWarn;
  });

  function stubCsv(t, content) {
    t.mock.method(fs, 'existsSync', () => true);
    t.mock.method(fs, 'readFileSync', () => content);
  }

  describe('#46 seniority validation', () => {
    test('invalid seniority value is dropped (null), not stored as-is', (t) => {
      stubCsv(t, 'title,country,seniority\nBackend Engineer,Netherlands,expert\n');
      const records = parseSearchParams();
      assert.equal(records.length, 1);
      assert.equal(records[0].seniority, null);
      assert.ok(
        warnCalls.some(w => w.includes('Invalid seniority')),
        'expected a warning about the invalid seniority value'
      );
    });

    test('valid seniority value is normalized and stored', (t) => {
      stubCsv(t, 'title,country,seniority\nBackend Engineer,Netherlands,Senior\n');
      const records = parseSearchParams();
      assert.equal(records[0].seniority, 'senior');
      assert.equal(warnCalls.length, 0);
    });

    test('missing seniority column results in null with no warning', (t) => {
      stubCsv(t, 'title,country\nBackend Engineer,Netherlands\n');
      const records = parseSearchParams();
      assert.equal(records[0].seniority, null);
      assert.equal(warnCalls.length, 0);
    });
  });

  describe('#52 remote flag parsing', () => {
    test('accepts "Yes" (mixed case) as truthy', (t) => {
      stubCsv(t, 'title,country,remote\nBackend Engineer,Netherlands,Yes\n');
      assert.equal(parseSearchParams()[0].remote, true);
    });

    test('accepts "TRUE" (uppercase) as truthy', (t) => {
      stubCsv(t, 'title,country,remote\nBackend Engineer,Netherlands,TRUE\n');
      assert.equal(parseSearchParams()[0].remote, true);
    });

    test('accepts "1" as truthy', (t) => {
      stubCsv(t, 'title,country,remote\nBackend Engineer,Netherlands,1\n');
      assert.equal(parseSearchParams()[0].remote, true);
    });

    test('accepts " yes " (surrounding whitespace, quoted so csv-parse does not pre-trim it) as truthy', (t) => {
      stubCsv(t, 'title,country,remote\nBackend Engineer,Netherlands," yes "\n');
      assert.equal(parseSearchParams()[0].remote, true);
    });

    test('treats "no" as falsy', (t) => {
      stubCsv(t, 'title,country,remote\nBackend Engineer,Netherlands,no\n');
      assert.equal(parseSearchParams()[0].remote, false);
      assert.equal(warnCalls.length, 0);
    });

    test('treats "false" as falsy', (t) => {
      stubCsv(t, 'title,country,remote\nBackend Engineer,Netherlands,false\n');
      assert.equal(parseSearchParams()[0].remote, false);
      assert.equal(warnCalls.length, 0);
    });

    test('treats "0" as falsy', (t) => {
      stubCsv(t, 'title,country,remote\nBackend Engineer,Netherlands,0\n');
      assert.equal(parseSearchParams()[0].remote, false);
      assert.equal(warnCalls.length, 0);
    });

    test('treats empty remote value as falsy with no warning', (t) => {
      stubCsv(t, 'title,country,remote\nBackend Engineer,Netherlands,\n');
      assert.equal(parseSearchParams()[0].remote, false);
      assert.equal(warnCalls.length, 0);
    });

    test('unrecognized value ("maybe") falls back to false and logs a warning', (t) => {
      stubCsv(t, 'title,country,remote\nBackend Engineer,Netherlands,maybe\n');
      const records = parseSearchParams();
      assert.equal(records[0].remote, false);
      assert.ok(
        warnCalls.some(w => w.includes('Invalid remote value') && w.includes('maybe')),
        'expected a warning about the unrecognized remote value'
      );
    });
  });
});
