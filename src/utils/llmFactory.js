/**
 * LLM Client Factory - Model-agnostic interface
 *
 * Supports: Anthropic (Claude), OpenAI, DeepSeek, Ollama (local), and any other
 * service that speaks the OpenAI chat-completions protocol — point
 * OPENAI_BASE_URL at it and use provider 'openai'.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { MODELS } = require('../config');

// Services that speak the OpenAI chat-completions protocol but live at their
// own host. Adding one here is all that is needed to make it selectable via
// SCORING_PROVIDER and friends.
const OPENAI_COMPATIBLE = {
  deepseek: { baseURL: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY' },
  groq:     { baseURL: 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY' },
  together: { baseURL: 'https://api.together.xyz/v1', apiKeyEnv: 'TOGETHER_API_KEY' },
  openrouter: { baseURL: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY' },
};

/**
 * Create an LLM client based on provider
 * @param {string} provider - 'anthropic', 'openai', 'ollama', or an
 *                            OpenAI-compatible service ('deepseek', 'groq', …)
 * @param {object} options - Provider-specific options
 * @returns {object} Client with standardized .complete() method
 */
function createClient(provider = 'anthropic', options = {}) {
  const name = provider.toLowerCase();

  switch (name) {
    case 'anthropic':
      return createAnthropicClient(options);
    case 'openai':
      return createOpenAIClient(options);
    case 'ollama':
      return createOllamaClient(options);
    default:
      if (OPENAI_COMPATIBLE[name]) {
        const { baseURL, apiKeyEnv } = OPENAI_COMPATIBLE[name];
        // Caller options spread first so the resolved provider identity below
        // always wins — otherwise a stray `provider` key in options would send
        // the request to the wrong service's model namespace.
        return createOpenAIClient({
          ...options,
          baseURL: options.baseURL || process.env[`${name.toUpperCase()}_BASE_URL`] || baseURL,
          apiKey: options.apiKey || process.env[apiKeyEnv],
          apiKeyEnv,
          provider: name,
        });
      }
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
        // 200 was the old default and truncates almost any real response. On
        // thinking-capable models max_tokens caps reasoning and output together,
        // so a low ceiling can return nothing at all.
        maxTokens = 2048,
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
 * OpenAI chat-completions client.
 *
 * Implemented over plain fetch rather than the `openai` SDK. That package is not
 * a dependency of this project — it was only ever loaded through an optional
 * try/require, so every OpenAI-backed provider threw "OpenAI package not
 * installed" at runtime. The endpoint is a single JSON POST, and the Ollama
 * client below already uses fetch, so dropping the SDK makes OpenAI, DeepSeek,
 * Groq, Together and OpenRouter all work with no new dependency.
 */
function createOpenAIClient(options = {}) {
  // OPENAI_BASE_URL lets this client talk to any OpenAI-protocol service —
  // DeepSeek, Groq, a local vLLM, an enterprise gateway — without new code.
  const baseURL = (options.baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
    .replace(/\/+$/, '');
  const apiKeyEnv = options.apiKeyEnv || 'OPENAI_API_KEY';
  const provider = options.provider || 'openai';

  const apiKey = options.apiKey || process.env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(`${apiKeyEnv} not set`);
  }

  return {
    provider,
    baseURL,
    async complete(prompt, options = {}) {
      const {
        // Default to the configured model rather than a hardcoded one. The old
        // literal 'gpt-4-turbo-preview' went stale and silently overrode config.
        model = defaultModelFor(provider, 'main'),
        maxTokens = 2048,
        systemPrompt = null,
        timeout = 60000,
      } = options;

      const messages = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      const response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages, stream: false }),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`${provider} request failed (${response.status}): ${body.slice(0, 200)}`);
      }

      const data = await response.json();
      return {
        text: data.choices?.[0]?.message?.content || '',
        raw: data
      };
    }
  };
}

/**
 * Ollama client (local LLM)
 */
function createOllamaClient(options = {}) {
  // Strip a trailing /v1 as well as trailing slashes. This client calls Ollama's
  // native /api/chat, not its OpenAI-compatible /v1 surface, so a base URL
  // ending in /v1 would request /v1/api/chat and 404. The project's own
  // .env.example used to suggest exactly that value, so tolerate it.
  const raw = options.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const baseUrl = raw.replace(/\/+$/, '').replace(/\/v1$/, '');
  const model = options.model || MODELS.OLLAMA_DEFAULT;

  return {
    provider: 'ollama',
    async complete(prompt, options = {}) {
      const {
        model: reqModel = model,
        maxTokens = 2048,
        systemPrompt = null,
        // A local Ollama instance that is slow, overloaded or crashed mid-request
        // otherwise hangs the fetch indefinitely (no OS-level timeout kicks in
        // for minutes), stalling the whole scrape run. Same pattern/default as
        // createOpenAIClient above.
        timeout = 60000,
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
          // Required. Ollama's /api/chat streams NDJSON by default, which
          // response.json() cannot parse — without this the call always threw
          // "Unexpected non-whitespace character after JSON", making every
          // ollama-backed provider unusable.
          stream: false,
          options: { num_predict: maxTokens }
        }),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Ollama request failed (${response.status}): ${body.slice(0, 200)}`);
      }

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
    case 'deepseek':
      return tier === 'fast' ? MODELS.DEEPSEEK_FAST : MODELS.DEEPSEEK_MAIN;
    case 'groq':
      return MODELS.GROQ_MAIN;
    case 'together':
      return MODELS.TOGETHER_MAIN;
    case 'openrouter':
      return MODELS.OPENROUTER_MAIN;
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

module.exports = {
  createClient,
  getProviderForUseCase,
  defaultModelFor
};
