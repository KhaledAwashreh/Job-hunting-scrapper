/**
 * LLM Client Factory - Model-agnostic interface
 * Supports: Anthropic (Claude), OpenAI, Ollama (local)
 */

const Anthropic = require('@anthropic-ai/sdk');
const { MODELS } = require('../config');

// OpenAI support (optional)
let OpenAI;
try {
  OpenAI = require('openai');
} catch (e) {
  // OpenAI not installed
}

/**
 * Create an LLM client based on provider
 * @param {string} provider - 'anthropic', 'openai', 'ollama'
 * @param {object} options - Provider-specific options
 * @returns {object} Client with standardized .complete() method
 */
function createClient(provider = 'anthropic', options = {}) {
  switch (provider.toLowerCase()) {
    case 'anthropic':
      return createAnthropicClient(options);
    case 'openai':
      return createOpenAIClient(options);
    case 'ollama':
      return createOllamaClient(options);
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

/**
 * Anthropic (Claude) client
 */
function createAnthropicClient(options = {}) {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const client = new Anthropic({ apiKey });

  return {
    provider: 'anthropic',
    /**
     * Complete a prompt using Claude
     * @param {string} prompt - The prompt text
     * @param {object} options - { model, maxTokens, systemPrompt }
     */
    async complete(prompt, options = {}) {
      const {
        model = MODELS.CLAUDE_MAIN,
        maxTokens = 200,
        systemPrompt = null,
        timeout = 60000
      } = options;

      const messages = [{ role: 'user', content: prompt }];
      
      const params = {
        model,
        max_tokens: maxTokens,
        messages,
        timeout
      };

      if (systemPrompt) {
        params.system = systemPrompt;
      }

      const response = await client.messages.create(params);
      return {
        text: response.content[0].type === 'text' ? response.content[0].text : '',
        raw: response
      };
    }
  };
}

/**
 * OpenAI client (optional support)
 */
function createOpenAIClient(options = {}) {
  if (!OpenAI) {
    throw new Error('OpenAI package not installed. Run: npm install openai');
  }

  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set');
  }

  const client = new OpenAI({ apiKey });

  return {
    provider: 'openai',
    async complete(prompt, options = {}) {
      const {
        model = 'gpt-4-turbo-preview',
        maxTokens = 200,
        systemPrompt = null,
      } = options;

      const messages = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      const response = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages
      });

      return {
        text: response.choices[0].message.content,
        raw: response
      };
    }
  };
}

/**
 * Ollama client (local LLM)
 */
function createOllamaClient(options = {}) {
  const baseUrl = options.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = options.model || MODELS.OLLAMA_DEFAULT;

  return {
    provider: 'ollama',
    async complete(prompt, options = {}) {
      const {
        model: reqModel = model,
        maxTokens = 200,
        systemPrompt = null,
      } = options;

      const messages = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: reqModel,
          messages,
          options: { num_predict: maxTokens }
        })
      });

      const data = await response.json();
      return {
        text: data.message?.content || '',
        raw: data
      };
    }
  };
}

/**
 * Get provider from environment or config
 * @param {string} useCase - 'scoring', 'translation', 'extraction', 'mcp'
 * @returns {string} Provider name
 */
function getProviderForUseCase(useCase = 'scoring') {
  const envKey = `${useCase.toUpperCase()}_PROVIDER`;
  return process.env[envKey] || 'anthropic'; // Default to Anthropic
}

/**
 * Get the default model ID for a given provider and speed tier
 * @param {string} provider - 'anthropic', 'openai', 'ollama'
 * @param {string} tier - 'main' or 'fast'
 * @returns {string} Model ID
 */
function defaultModelFor(provider, tier) {
  switch (provider.toLowerCase()) {
    case 'anthropic':
      return tier === 'fast' ? MODELS.CLAUDE_FAST : MODELS.CLAUDE_MAIN;
    case 'openai':
      return MODELS.OPENAI_MAIN;
    case 'ollama':
      return MODELS.OLLAMA_DEFAULT;
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

module.exports = {
  createClient,
  getProviderForUseCase,
  defaultModelFor
};
