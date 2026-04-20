const { initializeDatabase } = require('./src/db/schema');
const { runScraper } = require('./src/agents/orchestrator');

(async () => {
  try {
    await initializeDatabase();
    console.log('ENV OLLAMA_API_KEY:', process.env.OLLAMA_API_KEY);

    const result = await runScraper();
    console.log('Scrape result:', result);
  } catch (err) {
    console.error('Error:', err);
  }
})();