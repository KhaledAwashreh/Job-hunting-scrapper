const { detectPlatformAndSlug } = require('./src/agents/apiAgent');
const { addCompany, companyExists } = require('./src/db/queries');
const { initializeDatabase } = require('./src/db/schema');
const fs = require('fs');

const companies = [
  // ===== Netherlands (Tier 1) =====
  { name: 'Booking.com', country: 'Netherlands', career_url: 'https://jobs.booking.com' },
  { name: 'Adyen', country: 'Netherlands', career_url: 'https://careers.adyen.com' },
  { name: 'TomTom', country: 'Netherlands', career_url: 'https://tomtom.com/careers' },
  { name: 'Coolblue', country: 'Netherlands', career_url: 'https://careersatcoolblue.com' },
  { name: 'Picnic', country: 'Netherlands', career_url: 'https://picnic.app/careers' },
  { name: 'Nedap', country: 'Netherlands', career_url: 'https://nedap.com/careers' },
  { name: 'ING Bank', country: 'Netherlands', career_url: 'https://ing.jobs' },
  { name: 'Philips', country: 'Netherlands', career_url: 'https://philips.com/careers' },
  { name: 'ASML', country: 'Netherlands', career_url: 'https://asml.com/en/careers' },
  { name: 'Mollie', country: 'Netherlands', career_url: 'https://mollie.com/careers' },
  // ===== Netherlands (Tier 2) =====
  { name: 'Nationale-Nederlanden', country: 'Netherlands', career_url: 'https://nn-careers.com' },
  { name: 'Optiver', country: 'Netherlands', career_url: 'https://optiver.com/careers' },
  { name: 'YORTEAM', country: 'Netherlands', career_url: 'https://yorteam.nl' },
  { name: 'Qualogy', country: 'Netherlands', career_url: 'https://qualogy.com/vacatures' },
  { name: 'ViaBill', country: 'Netherlands', career_url: 'https://viabill.com/careers' },
  { name: 'SVB', country: 'Netherlands', career_url: 'https://svb.nl/nl/over-svb/werken-bij-svb' },
  // ===== Ireland =====
  { name: 'Stripe', country: 'Ireland', career_url: 'https://stripe.com/jobs' },
  { name: 'HubSpot', country: 'Ireland', career_url: 'https://hubspot.com/jobs' },
  { name: 'Workday', country: 'Ireland', career_url: 'https://workday.com/careers' },
  { name: 'Intercom', country: 'Ireland', career_url: 'https://intercom.com/careers' },
  { name: 'Arista Networks', country: 'Ireland', career_url: 'https://arista.com/en/careers' },
  { name: 'Featurespace', country: 'Ireland', career_url: 'https://featurespace.com/careers' },
  { name: 'Salesforce', country: 'Ireland', career_url: 'https://salesforce.com/company/careers' },
  { name: 'LinkedIn / Microsoft', country: 'Ireland', career_url: 'https://careers.microsoft.com' },
  // ===== Portugal =====
  { name: 'Revolut', country: 'Portugal', career_url: 'https://revolut.com/careers' },
  { name: 'Farfetch', country: 'Portugal', career_url: 'https://farfetch.com/careers' },
  { name: 'Talkdesk', country: 'Portugal', career_url: 'https://talkdesk.com/careers' },
  { name: 'Blip.pt', country: 'Portugal', career_url: 'https://blip.pt/careers' },
  { name: 'OutSystems', country: 'Portugal', career_url: 'https://outsystems.com/careers' },
  { name: 'Feedzai', country: 'Portugal', career_url: 'https://feedzai.com/careers' },
  { name: 'Pipedrive', country: 'Portugal', career_url: 'https://pipedrive.com/en/careers' },
  { name: 'Novabase', country: 'Portugal', career_url: 'https://novabase.pt/en/careers' },
  // ===== Spain =====
  { name: 'Glovo', country: 'Spain', career_url: 'https://glovoapp.com/careers' },
  { name: 'Typeform', country: 'Spain', career_url: 'https://typeform.com/careers' },
  { name: 'Wallapop', country: 'Spain', career_url: 'https://boards.greenhouse.io/wallapop' },
  { name: 'Verisure', country: 'Spain', career_url: 'https://verisure.com/careers' },
  { name: 'Cabify', country: 'Spain', career_url: 'https://cabify.com/careers' },
  { name: 'Idealista', country: 'Spain', career_url: 'https://idealista.com/empleo' },
  { name: 'ERNI', country: 'Spain', career_url: 'https://erni.com/es/careers' },
  { name: 'Qaracter', country: 'Spain', career_url: 'https://qaracter.com/es/careers' },
  // ===== Remote EU =====
  { name: 'Wise', country: 'Remote EU', career_url: 'https://wise.jobs' },
  { name: 'Klarna', country: 'Remote EU', career_url: 'https://klarna.com/careers' },
  { name: 'Remote.com', country: 'Remote EU', career_url: 'https://remote.com/careers' },
  { name: 'Miro', country: 'Remote EU', career_url: 'https://miro.com/careers' },
  { name: 'Hotjar', country: 'Remote EU', career_url: 'https://hotjar.com/careers' },
  { name: 'Pleo', country: 'Remote EU', career_url: 'https://pleo.io/en/careers' },
  { name: 'Contentful', country: 'Remote EU', career_url: 'https://contentful.com/careers' },
  // ===== AI-Forward =====
  { name: 'Unbabel', country: 'Portugal', career_url: 'https://unbabel.com/careers' },
  { name: 'Jungle AI', country: 'Portugal', career_url: 'https://jungle.ai/careers' },
];

async function main() {
  console.log('Initializing database...');
  await initializeDatabase();

  const results = { added: 0, skipped: 0, errors: [] };

  for (const company of companies) {
    try {
      console.log(`\n--- ${company.name} (${company.country}) ---`);
      console.log(`  URL: ${company.career_url}`);

      // #29 — companies now has a UNIQUE(name, career_url) constraint and
      // addCompany() no longer throws on a collision (it just returns the
      // existing row's id), so this is the only way left to tell "already
      // exists" apart from "freshly added" for the summary counts below.
      // Checking first also skips the network round-trip to
      // detectPlatformAndSlug() for companies that are already in the db,
      // instead of doing that work and throwing it away.
      if (companyExists(company.name, company.career_url)) {
        console.log(`  - Skipped (already exists)`);
        results.skipped++;
        continue;
      }

      // Try to detect platform
      let platform = 'custom';
      let platformSlug = null;
      let apiUrl = null;

      try {
        const detected = await detectPlatformAndSlug(company.career_url);
        if (detected && detected.platform) {
          platform = detected.platform;
          platformSlug = detected.platform_slug || null;
          apiUrl = detected.api_url || null;
          console.log(`  Detected platform: ${platform} (slug: ${platformSlug || 'N/A'})`);
          if (apiUrl) console.log(`  API URL: ${apiUrl}`);
        } else {
          console.log(`  No platform detected, using: custom`);
        }
      } catch (detectErr) {
        console.log(`  Detection error: ${detectErr.message}, using: custom`);
      }

      // Add to database
      const id = addCompany(
        company.name,
        company.country,
        company.career_url,
        platform,
        platformSlug,
        apiUrl
      );

      console.log(`  ✓ Added with ID: ${id}`);
      results.added++;
    } catch (err) {
      // #29 — companyExists() above now catches the "already exists" case
      // before addCompany() ever runs, and addCompany() itself no longer
      // throws a UNIQUE-constraint error for a (name, career_url) collision
      // (it returns the existing row's id instead) — so anything landing
      // here is a genuine, unexpected error.
      console.log(`  ✗ Error: ${err.message}`);
      results.errors.push({ company: company.name, error: err.message });
    }
  }

  console.log('\n========================================');
  console.log(`Results: ${results.added} added, ${results.skipped} skipped, ${results.errors.length} errors`);
  if (results.errors.length > 0) {
    console.log('Errors:');
    results.errors.forEach(e => console.log(`  - ${e.company}: ${e.error}`));
  }
  console.log('========================================');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
