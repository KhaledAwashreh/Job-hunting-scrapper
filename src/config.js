/**
 * Application Configuration
 */

const MODELS = {
  CLAUDE_MAIN: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
  CLAUDE_FAST: process.env.CLAUDE_MODEL_FAST || 'claude-3-haiku-20250305',
  OLLAMA_DEFAULT: process.env.OLLAMA_MODEL || 'mistral',
};

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';

module.exports = { MODELS, FIRECRAWL_API_KEY };
