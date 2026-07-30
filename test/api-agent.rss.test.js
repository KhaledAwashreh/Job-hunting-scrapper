const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { parseRSSJobs } = require('../src/agents/apiAgent');

// --- issue #33: one malformed pubDate must not discard the whole feed ------
//
// parseRSSJobs used to call `new Date(pubDate).toISOString()` unguarded per
// item. A single item with an unparseable pubDate throws RangeError: Invalid
// time value, which (in the caller, scrapeRSSFeed) was only caught by the
// try/catch around the *entire* fetch+parse, so the whole batch — including
// every valid item in the same feed — was silently discarded as [].

describe('parseRSSJobs — issue #33: malformed pubDate does not discard the feed', () => {
  const feedWithBadDate = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Example Jobs</title>
  <item>
    <title>Backend Engineer - (Amsterdam, Netherlands)</title>
    <description>Build things.</description>
    <link>https://example.com/jobs/1</link>
    <pubDate>Mon, 01 Jul 2024 10:00:00 GMT</pubDate>
    <category>Engineering</category>
  </item>
  <item>
    <title>Frontend Engineer - (Dublin, Ireland)</title>
    <description>Build other things.</description>
    <link>https://example.com/jobs/2</link>
    <pubDate>Not A Real Date</pubDate>
    <category>Engineering</category>
  </item>
  <item>
    <title>Platform Engineer - (Lisbon, Portugal)</title>
    <description>Build platforms.</description>
    <link>https://example.com/jobs/3</link>
    <pubDate>Tue, 02 Jul 2024 10:00:00 GMT</pubDate>
    <category>Engineering</category>
  </item>
  <item>
    <title>Data Engineer - (Madrid, Spain)</title>
    <description>Build pipelines.</description>
    <link>https://example.com/jobs/4</link>
    <pubDate>Wed, 03 Jul 2024 10:00:00 GMT</pubDate>
    <category>Engineering</category>
  </item>
</channel>
</rss>`;

  test('all 3 valid items are still parsed when one item has a malformed pubDate', () => {
    const jobs = parseRSSJobs(feedWithBadDate, 'https://example.com/feed.xml');
    assert.equal(jobs.length, 4, 'the bad-date item is kept (with an empty publishDate), not dropped');
    const titles = jobs.map((j) => j.title);
    assert.ok(titles.some((t) => t.startsWith('Backend Engineer')));
    assert.ok(titles.some((t) => t.startsWith('Frontend Engineer')));
    assert.ok(titles.some((t) => t.startsWith('Platform Engineer')));
    assert.ok(titles.some((t) => t.startsWith('Data Engineer')));
  });

  test('the malformed pubDate item falls back to an empty publishDate instead of throwing', () => {
    const jobs = parseRSSJobs(feedWithBadDate, 'https://example.com/feed.xml');
    const badDateJob = jobs.find((j) => j.title.startsWith('Frontend Engineer'));
    assert.ok(badDateJob, 'item with the malformed pubDate was still parsed');
    assert.equal(badDateJob.publishDate, '');
  });

  test('valid pubDates are still parsed to a YYYY-MM-DD date string', () => {
    const jobs = parseRSSJobs(feedWithBadDate, 'https://example.com/feed.xml');
    const goodDateJob = jobs.find((j) => j.title.startsWith('Backend Engineer'));
    assert.equal(goodDateJob.publishDate, '2024-07-01');
  });
});

// --- issue #41: RDF-style <item rdf:about="..."> items were missed ---------
//
// The item regex required the literal attribute-free `<item>` tag, so RSS
// 1.0/RDF feeds (and some enterprise ATS RSS variants) that emit
// `<item rdf:about="url">` returned 0 jobs — indistinguishable from a
// genuinely empty feed.

describe('parseRSSJobs — issue #41: RDF-style <item rdf:about="..."> feeds are parsed', () => {
  const rdfFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
<channel rdf:about="https://example.com/feed.rdf">
  <title>Example Jobs (RDF)</title>
</channel>
<item rdf:about="https://example.com/jobs/10">
  <title>Site Reliability Engineer - (Berlin, Germany)</title>
  <description>Keep things up.</description>
  <link>https://example.com/jobs/10</link>
  <pubDate>Thu, 04 Jul 2024 10:00:00 GMT</pubDate>
</item>
<item rdf:about="https://example.com/jobs/11">
  <title>QA Engineer - (Paris, France)</title>
  <description>Break things on purpose.</description>
  <link>https://example.com/jobs/11</link>
  <pubDate>Fri, 05 Jul 2024 10:00:00 GMT</pubDate>
</item>
</rdf:RDF>`;

  test('items with an rdf:about attribute on <item> are matched, not skipped', () => {
    const jobs = parseRSSJobs(rdfFeed, 'https://example.com/feed.rdf');
    assert.equal(jobs.length, 2);
    assert.ok(jobs.some((j) => j.title.startsWith('Site Reliability Engineer')));
    assert.ok(jobs.some((j) => j.title.startsWith('QA Engineer')));
  });

  test('fields (link, pubDate) are still extracted correctly from RDF-style items', () => {
    const jobs = parseRSSJobs(rdfFeed, 'https://example.com/feed.rdf');
    const sre = jobs.find((j) => j.title.startsWith('Site Reliability Engineer'));
    assert.equal(sre.link, 'https://example.com/jobs/10');
    assert.equal(sre.publishDate, '2024-07-04');
  });
});
