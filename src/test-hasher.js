const hasherModule = require('./utils/hasher');
const { hashContent } = hasherModule;
console.log('hasherModule:', hasherModule);

function runTest() {
  try {
    console.log('Running hasher test...');

    const testString1 = 'Hello, world!';
    const hash1 = hashContent(testString1);
    console.log(`Hash for '${testString1}': ${hash1}`);

    const testString2 = 'Hello, world!';
    const hash2 = hashContent(testString2);
    console.log(`Hash for '${testString2}': ${hash2}`);

    if (hash1 !== hash2) {
      throw new Error('Hashes for identical content do not match.');
    }

    const testString3 = 'Another string.';
    const hash3 = hashContent(testString3);
    console.log(`Hash for '${testString3}': ${hash3}`);

    if (hash1 === hash3) {
      throw new Error('Hashes for different content should not match.');
    }

    // Test with empty string
    const emptyString = '';
    const emptyHash = hashContent(emptyString);
    console.log(`Hash for empty string: ${emptyHash}`);
    if (!emptyHash) {
      throw new Error('Hash for empty string is invalid.');
    }

    // Test error handling for non-string input
    let errorCaught = false;
    try {
      hashContent(123);
    } catch (error) {
      if (error.message === 'Content to hash must be a string.') {
        errorCaught = true;
      }
    }
    if (!errorCaught) {
      throw new Error('Expected error for non-string input was not caught.');
    }

    console.log('Hasher test: PASS');
  } catch (error) {
    console.error('Hasher test: FAIL', error);
  }
}

runTest();
