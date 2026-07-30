/**
 * Application Configuration
 */

const MODELS = {
  CLAUDE_MAIN: process.env.CLAUDE_MODEL || 'claude-opus-5',
  CLAUDE_FAST: process.env.CLAUDE_MODEL_FAST || 'claude-haiku-4-5',
  OPENAI_MAIN: process.env.OPENAI_MODEL || 'gpt-4o',
  OLLAMA_DEFAULT: process.env.OLLAMA_MODEL || 'mistral',
  // OpenAI-protocol services reached through the same client, each with its own
  // model namespace.
  DEEPSEEK_MAIN: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  DEEPSEEK_FAST: process.env.DEEPSEEK_MODEL_FAST || 'deepseek-chat',
  GROQ_MAIN: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  TOGETHER_MAIN: process.env.TOGETHER_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  OPENROUTER_MAIN: process.env.OPENROUTER_MODEL || 'openai/gpt-4o',
};

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || '';

module.exports = { MODELS, FIRECRAWL_API_KEY };
