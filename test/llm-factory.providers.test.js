// Provider plumbing in llmFactory.
//
// The OpenAI-protocol and Ollama clients are exercised against local stub
// servers rather than mocks, so the request body, headers and response parsing
// are all real. No network access, no API keys, no new dependencies.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createClient, defaultModelFor } = require('../src/utils/llmFactory');
const { MODELS } = require('../src/config');

// A stub that records what it received and replies with whatever is configured.
function startStub() {
  const state = { requests: [], reply: null, status: 200, contentType: 'application/json' };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      state.requests.push({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: body ? JSON.parse(body) : null,
      });
      res.statusCode = state.status;
      res.setHeader('Content-Type', state.contentType);
      res.end(typeof state.reply === 'string' ? state.reply : JSON.stringify(state.reply));
    });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      state.port = server.address().port;
      state.baseUrl = `http://127.0.0.1:${state.port}`;
      state.close = () => new Promise(r => server.close(r));
      resolve(state);
    });
  });
}

describe('createClient — provider selection', () => {
  test('unknown provider throws a named error', () => {
    assert.throws(() => createClient('nope'), /Unknown LLM provider: nope/);
  });

  test('provider names are case-insensitive', () => {
    const c = createClient('DeepSeek', { apiKey: 'k' });
    assert.equal(c.provider, 'deepseek');
  });

  test('each OpenAI-compatible provider gets its own base URL', () => {
    const expected = {
      deepseek: 'https://api.deepseek.com/v1',
      groq: 'https://api.groq.com/openai/v1',
      together: 'https://api.together.xyz/v1',
      openrouter: 'https://openrouter.ai/api/v1',
    };
    for (const [name, baseURL] of Object.entries(expected)) {
      assert.equal(createClient(name, { apiKey: 'k' }).baseURL, baseURL, `${name} base URL`);
    }
  });

  test('openai defaults to the real OpenAI host', () => {
    assert.equal(createClient('openai', { apiKey: 'k' }).baseURL, 'https://api.openai.com/v1');
  });

  test('a missing key names the variable the user must set', () => {
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      assert.throws(() => createClient('deepseek'), /DEEPSEEK_API_KEY not set/);
    } finally {
      if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
    }
  });

  test('a trailing slash on the base URL does not produce a double slash', async () => {
    const stub = await startStub();
    try {
      stub.reply = { choices: [{ message: { content: 'ok' } }] };
      const client = createClient('openai', { apiKey: 'k', baseURL: `${stub.baseUrl}/` });
      await client.complete('hi');
      assert.equal(stub.requests[0].url, '/chat/completions');
    } finally {
      await stub.close();
    }
  });
});

describe('defaultModelFor', () => {
  test('resolves every supported provider', () => {
    assert.equal(defaultModelFor('anthropic', 'main'), MODELS.CLAUDE_MAIN);
    assert.equal(defaultModelFor('anthropic', 'fast'), MODELS.CLAUDE_FAST);
    assert.equal(defaultModelFor('openai', 'main'), MODELS.OPENAI_MAIN);
    assert.equal(defaultModelFor('ollama', 'main'), MODELS.OLLAMA_DEFAULT);
    assert.equal(defaultModelFor('deepseek', 'main'), MODELS.DEEPSEEK_MAIN);
    assert.equal(defaultModelFor('groq', 'main'), MODELS.GROQ_MAIN);
    assert.equal(defaultModelFor('together', 'main'), MODELS.TOGETHER_MAIN);
    assert.equal(defaultModelFor('openrouter', 'main'), MODELS.OPENROUTER_MAIN);
  });

  test('every provider createClient accepts also has a default model', () => {
    // Guards against adding a provider to one and forgetting the other.
    for (const name of ['anthropic', 'openai', 'ollama', 'deepseek', 'groq', 'together', 'openrouter']) {
      assert.doesNotThrow(() => defaultModelFor(name, 'main'), `${name} has no default model`);
      assert.ok(defaultModelFor(name, 'main'), `${name} default model is empty`);
    }
  });

  test('unknown provider throws', () => {
    assert.throws(() => defaultModelFor('nope', 'main'), /Unknown LLM provider/);
  });
});

describe('OpenAI-protocol client — request shape', () => {
  let stub;
  before(async () => { stub = await startStub(); });
  after(async () => { await stub.close(); });

  test('posts to /chat/completions with a bearer token and returns the message text', async () => {
    stub.status = 200;
    stub.reply = { choices: [{ message: { content: 'scored: 82' } }] };

    const client = createClient('deepseek', { apiKey: 'secret-key', baseURL: stub.baseUrl });
    const res = await client.complete('rate this job', { model: 'deepseek-chat', maxTokens: 128 });

    const req = stub.requests.at(-1);
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer secret-key');
    assert.equal(req.body.model, 'deepseek-chat');
    assert.equal(req.body.max_tokens, 128);
    assert.equal(req.body.stream, false, 'must not request a stream — the parser cannot read one');
    assert.deepEqual(req.body.messages, [{ role: 'user', content: 'rate this job' }]);
    assert.equal(res.text, 'scored: 82');
  });

  test('a system prompt is sent as the first message', async () => {
    stub.reply = { choices: [{ message: { content: 'x' } }] };
    const client = createClient('openai', { apiKey: 'k', baseURL: stub.baseUrl });
    await client.complete('user text', { systemPrompt: 'you are a scorer' });

    assert.deepEqual(stub.requests.at(-1).body.messages, [
      { role: 'system', content: 'you are a scorer' },
      { role: 'user', content: 'user text' },
    ]);
  });

  test('defaults to the configured model for the provider, not a hardcoded one', async () => {
    stub.reply = { choices: [{ message: { content: 'x' } }] };
    const client = createClient('deepseek', { apiKey: 'k', baseURL: stub.baseUrl });
    await client.complete('hi');

    assert.equal(stub.requests.at(-1).body.model, MODELS.DEEPSEEK_MAIN);
    assert.notEqual(stub.requests.at(-1).body.model, 'gpt-4-turbo-preview');
  });

  test('the default token ceiling is not the old truncating 200', async () => {
    stub.reply = { choices: [{ message: { content: 'x' } }] };
    const client = createClient('openai', { apiKey: 'k', baseURL: stub.baseUrl });
    await client.complete('hi');
    assert.ok(stub.requests.at(-1).body.max_tokens >= 2048);
  });

  test('an HTTP error surfaces the status and body instead of a parse failure', async () => {
    stub.status = 401;
    stub.reply = { error: { message: 'invalid api key' } };
    const client = createClient('deepseek', { apiKey: 'bad', baseURL: stub.baseUrl });

    await assert.rejects(
      () => client.complete('hi'),
      err => /deepseek request failed \(401\)/.test(err.message) && /invalid api key/.test(err.message)
    );
    stub.status = 200;
  });

  test('a response with no choices yields empty text rather than throwing', async () => {
    stub.reply = {};
    const client = createClient('openai', { apiKey: 'k', baseURL: stub.baseUrl });
    assert.equal((await client.complete('hi')).text, '');
  });
});

describe('Ollama client — the streaming bug', () => {
  let stub;
  before(async () => { stub = await startStub(); });
  after(async () => { await stub.close(); });

  test('sends stream:false — without it Ollama returns NDJSON that cannot be parsed', async () => {
    stub.reply = { message: { content: 'hello' }, done: true };
    const client = createClient('ollama', { baseUrl: stub.baseUrl });
    const res = await client.complete('hi', { model: 'mistral' });

    assert.equal(stub.requests.at(-1).body.stream, false);
    assert.equal(res.text, 'hello');
  });

  test('maps maxTokens onto num_predict', async () => {
    stub.reply = { message: { content: 'x' } };
    const client = createClient('ollama', { baseUrl: stub.baseUrl });
    await client.complete('hi', { maxTokens: 512 });
    assert.equal(stub.requests.at(-1).body.options.num_predict, 512);
  });

  test('an HTTP error surfaces the status', async () => {
    stub.status = 500;
    stub.reply = 'model not found';
    const client = createClient('ollama', { baseUrl: stub.baseUrl });
    await assert.rejects(() => client.complete('hi'), /Ollama request failed \(500\)/);
    stub.status = 200;
  });

  test('an empty message yields empty text rather than throwing', async () => {
    stub.reply = { done: true };
    const client = createClient('ollama', { baseUrl: stub.baseUrl });
    assert.equal((await client.complete('hi')).text, '');
  });

  // Issue #50: a slow/dead local Ollama instance must not hang the caller
  // forever. Point at a server that accepts the connection but never responds,
  // and confirm complete() aborts on the configured timeout instead of hanging.
  test('a hanging request aborts via the timeout instead of hanging forever', async () => {
    const hangingServer = http.createServer(() => {
      // Deliberately never call res.end() — simulates a stuck local Ollama.
    });
    await new Promise(resolve => hangingServer.listen(0, '127.0.0.1', resolve));
    const hangingBaseUrl = `http://127.0.0.1:${hangingServer.address().port}`;

    try {
      const client = createClient('ollama', { baseUrl: hangingBaseUrl });
      const start = Date.now();
      await assert.rejects(() => client.complete('hi', { timeout: 200 }));
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 5000, `expected an early abort, took ${elapsed}ms`);
    } finally {
      hangingServer.closeAllConnections();
      await new Promise(resolve => hangingServer.close(resolve));
    }
  });
});

describe('Ollama client — base URL normalisation', () => {
  test('a /v1 suffix is stripped so the native endpoint is reached', async () => {
    // .env.example used to suggest http://localhost:11434/v1, which would make
    // the client request /v1/api/chat and 404.
    const stub = await startStub();
    try {
      stub.reply = { message: { content: 'ok' } };
      const client = createClient('ollama', { baseUrl: `${stub.baseUrl}/v1` });
      await client.complete('hi');
      assert.equal(stub.requests.at(-1).url, '/api/chat');
    } finally {
      await stub.close();
    }
  });

  test('a trailing slash is stripped too', async () => {
    const stub = await startStub();
    try {
      stub.reply = { message: { content: 'ok' } };
      const client = createClient('ollama', { baseUrl: `${stub.baseUrl}/` });
      await client.complete('hi');
      assert.equal(stub.requests.at(-1).url, '/api/chat');
    } finally {
      await stub.close();
    }
  });
});
