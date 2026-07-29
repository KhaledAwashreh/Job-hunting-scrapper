/**
 * Application Configuration
 */

const MODELS = {
  CLAUDE_MAIN: process.env.CLAUDE_MODEL || 'claude-opus-5',
  CLAUDE_FAST: process.env.CLAUDE_MODEL_FAST || 'claude-haiku-4-5',
  OPENAI_MAIN: process.env.OPENAI_MODEL || 'gpt-4o',
  OLLAMA_DEFAULT: process.env.OLLAMA_MODEL || 'mistral',
};

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';

module.exports = { MODELS, FIRECRAWL_API_KEY };
