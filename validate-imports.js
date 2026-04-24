// Validation test - checks that all imports/exports match
// Run with: node validate-imports.js

const path = require('path');

// Test 1: hasher module
console.log('Test 1: hasher module...');
try {
  const { hashContent, hashJob } = require('./src/utils/hasher');
  const testJob = { title: 'Test', description: 'Desc', qualifications: 'Quals', publishDate: '2026-04-24' };
  const hash = hashJob(testJob);
  console.log('  ✓ hashJob works:', hash.substring(0, 16) + '...');
  const contentHash = hashContent('test');
  console.log('  ✓ hashContent works:', contentHash.substring(0, 16) + '...');
} catch (e) {
  console.log('  ✗ FAILED:', e.message);
}

// Test 2: config module
console.log('Test 2: config module...');
try {
  const { MODELS } = require('./src/config');
  console.log('  ✓ MODELS:', JSON.stringify(MODELS));
} catch (e) {
  console.log('  ✗ FAILED:', e.message);
}

// Test 3: timeWindow module
console.log('Test 3: timeWindow module...');
try {
  const { isWithinTimeWindow, getTimeWindowOptions, TIME_WINDOWS } = require('./src/utils/timeWindow');
  const result = isWithinTimeWindow('2026-04-20', '30');
  console.log('  ✓ isWithinTimeWindow works:', result);
  const options = getTimeWindowOptions();
  console.log('  ✓ getTimeWindowOptions works:', options.length, 'options');
} catch (e) {
  console.log('  ✗ FAILED:', e.message);
}

// Test 4: typeHelpers module
console.log('Test 4: typeHelpers module...');
try {
  const { ensureArray, ensureString } = require('./src/utils/typeHelpers');
  console.log('  ✓ ensureArray("[1,2]"):', JSON.stringify(ensureArray('[1,2]')));
  console.log('  ✓ ensureString([1,2]):', ensureString([1,2]));
} catch (e) {
  console.log('  ✗ FAILED:', e.message);
}

// Test 5: jobFieldExtractor module
console.log('Test 5: jobFieldExtractor module...');
try {
  const { extractJobType, extractLocationType, extractSeniorityLevel, isClosedPosition } = require('./src/utils/jobFieldExtractor');
  const jobType = extractJobType('Senior Backend Engineer', 'We need someone with Python and Django');
  console.log('  ✓ extractJobType:', jobType);
  const locType = extractLocationType('Remote position', 'Work from home');
  console.log('  ✓ extractLocationType:', locType);
  const closed = isClosedPosition('This position is closed', '', '');
  console.log('  ✓ isClosedPosition:', closed);
} catch (e) {
  console.log('  ✗ FAILED:', e.message);
}

console.log('\nAll validation tests completed.');