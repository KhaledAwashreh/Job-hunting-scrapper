const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { getProviderForUseCase, defaultModelFor } = require('../src/utils/llmFactory');
const { MODELS } = require('../src/config');

describe('defaultModelFor', () => {
  test('anthropic + main returns CLAUDE_MAIN', () => {
    assert.equal(defaultModelFor('anthropic', 'main'), MODELS.CLAUDE_MAIN);
  });

  test('anthropic + fast returns CLAUDE_FAST', () => {
    assert.equal(defaultModelFor('anthropic', 'fast'), MODELS.CLAUDE_FAST);
  });

  test('openai + main returns OPENAI_MAIN', () => {
    assert.equal(defaultModelFor('openai', 'main'), MODELS.OPENAI_MAIN);
  });

  test('openai + fast returns OPENAI_MAIN', () => {
    assert.equal(defaultModelFor('openai', 'fast'), MODELS.OPENAI_MAIN);
  });

  test('ollama + main returns OLLAMA_DEFAULT', () => {
    assert.equal(defaultModelFor('ollama', 'main'), MODELS.OLLAMA_DEFAULT);
  });

  test('ollama + fast returns OLLAMA_DEFAULT', () => {
    assert.equal(defaultModelFor('ollama', 'fast'), MODELS.OLLAMA_DEFAULT);
  });

  test('unknown provider throws', () => {
    assert.throws(
      () => defaultModelFor('bogus', 'main'),
      /Unknown LLM provider: bogus/
    );
  });

  test('provider matching is case-insensitive', () => {
    assert.equal(defaultModelFor('Anthropic', 'main'), MODELS.CLAUDE_MAIN);
    assert.equal(defaultModelFor('OLLAMA', 'fast'), MODELS.OLLAMA_DEFAULT);
  });
});

describe('getProviderForUseCase', () => {
  const originalScoringProvider = process.env.SCORING_PROVIDER;

  afterEach(() => {
    if (originalScoringProvider === undefined) {
      delete process.env.SCORING_PROVIDER;
    } else {
      process.env.SCORING_PROVIDER = originalScoringProvider;
    }
  });

  test('returns "ollama" when SCORING_PROVIDER=ollama is set', () => {
    process.env.SCORING_PROVIDER = 'ollama';
    assert.equal(getProviderForUseCase('scoring'), 'ollama');
  });

  test('returns "anthropic" when SCORING_PROVIDER is unset', () => {
    delete process.env.SCORING_PROVIDER;
    assert.equal(getProviderForUseCase('scoring'), 'anthropic');
  });
});
