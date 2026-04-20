const { createSchema, db } = require('./db/schema');
const queries = require('./db/queries');

async function runTest() {
  try {
    console.log('Running DB schema test...');
    createSchema();

    // Test insert company
    const companyName = 'Test Company';
    const insertCompanyResult = queries.insertCompany.run(companyName, 'http://test.com/careers', null, null, null);
    console.log('Insert Company Result:', insertCompanyResult);

    const company = queries.getCompanyByName.get(companyName);
    console.log('Retrieved Company:', company);

    if (!company) {
      throw new Error('Company not found after insertion.');
    }

    // Test insert position
    const positionLink = 'http://test.com/job/123';
    const insertPositionResult = queries.insertPosition.run(
      company.id, 'Software Engineer', 'Develops software', 'BS in CS', '2023-01-01',
      positionLink, 'USA', 'New York', 'NY', '100k-150k', 'REF123', null, null, null
    );
    console.log('Insert Position Result:', insertPositionResult);

    const position = queries.getPositionByLink.get(positionLink);
    console.log('Retrieved Position:', position);

    if (!position) {
      throw new Error('Position not found after insertion.');
    }

    // Test update position score
    const updateScoreResult = queries.updatePositionScore.run(90, 1, 'Good match', position.id);
    console.log('Update Score Result:', updateScoreResult);

    const updatedPosition = queries.getPositionByLink.get(positionLink);
    console.log('Updated Position:', updatedPosition);

    if (updatedPosition.score !== 90) {
      throw new Error('Position score not updated correctly.');
    }

    // Test insert search param
    const insertSearchParamResult = queries.insertSearchParam.run('Node.js', 'Remote', 50);
    console.log('Insert Search Param Result:', insertSearchParamResult);

    const searchParams = queries.getAllSearchParams.all();
    console.log('All Search Params:', searchParams);

    if (searchParams.length === 0) {
      throw new Error('Search params not inserted.');
    }

    console.log('DB schema test: PASS');
  } catch (error) {
    console.error('DB schema test: FAIL', error);
  } finally {
    // Clean up: delete the test database file if it exists
    const fs = require('fs');
    const path = require('path');
    const dbPath = path.resolve(__dirname, '../../jobs.db');
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      console.log('Cleaned up jobs.db');
    }
    if (db) {
      db.close();
    }
  }
}

runTest();
