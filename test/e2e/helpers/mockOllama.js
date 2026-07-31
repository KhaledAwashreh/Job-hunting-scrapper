// Minimal mock of Ollama's POST /api/chat endpoint (see
// src/utils/llmFactory.js's createOllamaClient). Pointing the server under
// test at this instead of the real Anthropic API lets #23's rate-limit test
// hammer the resume-tailor endpoint, and #25's graceful-shutdown test hold a
// request genuinely in-flight, without making real, billed LLM calls.
const http = require('node:http');

// `delayMs` lets a test simulate a slow LLM response so a request stays
// in-flight for a controlled window (used by the SIGTERM/#25 test).
function startMockOllama({ delayMs = 0, text = 'MOCKED TAILORED RESUME' } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || !req.url.startsWith('/api/chat')) {
        res.writeHead(404);
        res.end();
        return;
      }
      // Drain the request body; content is irrelevant to this mock.
      req.on('data', () => {});
      req.on('end', () => {
        const respond = () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: { content: text } }));
        };
        if (delayMs > 0) setTimeout(respond, delayMs);
        else respond();
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        stop: () => new Promise(r => server.close(r)),
      });
    });
  });
}

module.exports = { startMockOllama };
