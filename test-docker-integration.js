/**
 * Integration Test using Testcontainers
 * Uses pre-built Docker image and tests health endpoints
 */

const { GenericContainer } = require('testcontainers');
const http = require('http');

// Test configuration
const TEST_TIMEOUT = 120000; // 2 minutes
let container = null;
let baseUrl = '';

// Helper: Make HTTP request
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Helper: Wait for app to be ready
async function waitForReady(url, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await httpGet(url);
      if (res.statusCode === 200) {
        return true;
      }
    } catch (e) {
      // Ignore and retry
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('App did not become ready in time');
}

async function runTests() {
  console.log('=== Testcontainers Integration Test ===\n');
  
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return fn().then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    }).catch(err => {
      console.error(`  ✗ ${name}: ${err.message}`);
      failed++;
    });
  }

  try {
    // Step 1: Start pre-built container with testcontainers
    console.log('Step 1: Starting pre-built container with testcontainers...');
    
    container = await new GenericContainer('job-hunter-test')
      .withExposedPorts(3000)
      .withEnvironment([{
        name: 'NODE_ENV',
        value: 'test'
      }])
      .start();

    const port = container.getMappedPort(3000);
    baseUrl = `http://localhost:${port}`;
    
    console.log(`  Container started on ${baseUrl}`);

    // Step 2: Wait for app to be ready
    console.log('\nStep 2: Waiting for app to be ready...');
    await waitForReady(`${baseUrl}/api/health`);
    console.log('  App is ready!');

    // Step 3: Run health check tests
    console.log('\nStep 3: Running health check tests...');

    await test('GET /api/health - returns 200', async () => {
      const res = await httpGet(`${baseUrl}/api/health`);
      if (res.statusCode !== 200) {
        throw new Error(`Expected 200, got ${res.statusCode}`);
      }
      const body = JSON.parse(res.body);
      if (body.status !== 'ok') {
        throw new Error(`Expected status 'ok', got '${body.status}'`);
      }
    });

    await test('GET /api/health - has db_initialized field', async () => {
      const res = await httpGet(`${baseUrl}/api/health`);
      const body = JSON.parse(res.body);
      if (typeof body.db_initialized !== 'boolean') {
        throw new Error('db_initialized field missing or not boolean');
      }
    });

    await test('GET /api/health - has resumes_loaded field', async () => {
      const res = await httpGet(`${baseUrl}/api/health`);
      const body = JSON.parse(res.body);
      if (typeof body.resumes_loaded !== 'number') {
        throw new Error('resumes_loaded field missing or not number');
      }
    });

    // Step 4: Test companies endpoint (no AI required)
    console.log('\nStep 4: Testing companies endpoint...');

    await test('GET /api/companies - returns array', async () => {
      const res = await httpGet(`${baseUrl}/api/companies`);
      if (res.statusCode !== 200) {
        throw new Error(`Expected 200, got ${res.statusCode}`);
      }
      const body = JSON.parse(res.body);
      if (!Array.isArray(body)) {
        throw new Error('Response is not an array');
      }
    });

    // Step 5: Test positions endpoint (no AI required)
    console.log('\nStep 5: Testing positions endpoint...');

    await test('GET /api/positions - returns array', async () => {
      const res = await httpGet(`${baseUrl}/api/positions`);
      if (res.statusCode !== 200) {
        throw new Error(`Expected 200, got ${res.statusCode}`);
      }
      const body = JSON.parse(res.body);
      if (!Array.isArray(body)) {
        throw new Error('Response is not an array');
      }
    });

    // Step 6: Test scrape status endpoint (no AI required)
    console.log('\nStep 6: Testing scrape status endpoint...');

    await test('GET /api/scrape/status - returns status object', async () => {
      const res = await httpGet(`${baseUrl}/api/scrape/status`);
      if (res.statusCode !== 200) {
        throw new Error(`Expected 200, got ${res.statusCode}`);
      }
      const body = JSON.parse(res.body);
      if (typeof body.running !== 'boolean') {
        throw new Error('running field missing or not boolean');
      }
    });

    // Step 7: Test profiles endpoint (no AI required)
    console.log('\nStep 7: Testing profiles endpoint...');

    await test('GET /api/profiles - returns array', async () => {
      const res = await httpGet(`${baseUrl}/api/profiles`);
      if (res.statusCode !== 200) {
        throw new Error(`Expected 200, got ${res.statusCode}`);
      }
      const body = JSON.parse(res.body);
      if (!Array.isArray(body)) {
        throw new Error('Response is not an array');
      }
    });

    // Step 8: Test 404 handling
    console.log('\nStep 8: Testing 404 handling...');

    await test('GET /api/nonexistent - returns 404', async () => {
      const res = await httpGet(`${baseUrl}/api/nonexistent`);
      if (res.statusCode !== 404) {
        throw new Error(`Expected 404, got ${res.statusCode}`);
      }
    });

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    
    if (failed > 0) {
      console.error('INTEGRATION TESTS FAILED');
      process.exit(1);
    } else {
      console.log('✅ ALL INTEGRATION TESTS PASSED');
      process.exit(0);
    }

  } catch (error) {
    console.error(`\n✗ Test setup failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Cleanup: Stop container
    if (container) {
      console.log('\nCleaning up: Stopping container...');
      await container.stop();
      console.log('Container stopped.');
    }
  }
}

// Run tests with timeout
const timeoutHandle = setTimeout(() => {
  console.error('TEST TIMEOUT: Tests took too long');
  process.exit(1);
}, TEST_TIMEOUT);

runTests().finally(() => {
  clearTimeout(timeoutHandle);
});
