const { runScraper } = require('./agents/orchestrator');
(async () => {
  try {
    const result = await runScraper();
    console.log('Run result:', result);
  } catch (e) {
    console.error('Error running scraper:', e);
  }
})();