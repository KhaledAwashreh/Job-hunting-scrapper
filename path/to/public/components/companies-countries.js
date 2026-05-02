const CompaniesCountries = {
  countries: [],
  companies: [],
  selectedCountries: new Set(),

  async init() {
    await this.loadCountries();
    await this.loadCompanies();
    this.setupEventListeners();
  },

  async loadCountries() {
    try {
      const res = await fetch('https://restcountries.com/v3.1/all');
      if (!res.ok) throw new Error('Failed to fetch countries');

      const data = await res.json();
      this.countries = data
        .map(c => ({
          code: c.cca2,
          name: c.name.common,
        }));
    } catch (error) {
      console.error('Failed to load countries:', error);
    }
  },

  useFallbackCountries() {
    this.countries = [
      { code: 'US', name: 'United States', flag: '🇺🇸' },
      { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
      { code: 'CA', name: 'Canada', flag: '🇨🇦' },
      { code: 'AU', name: 'Australia', flag: '🇦🇺' },
      { code: 'DE', name: 'Germany', flag: '🇩🇪' },
      { code: 'FR', name: 'France', flag: '🇫🇷' },
      { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
      { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
    ];
  },

  renderCountryCheckboxes() {
    const container = document.getElementById('countriesContainer');
    if (!container) {
      console.warn('countriesContainer not found');
      return;
    }

    let html = `
      <div class="countries-grid">
        <div class="select-controls" style="margin-bottom: 15px;">
          ${this.countries.map(c => `
            <label>
              <input type="checkbox" value="${c.code}" checked>
              <span>${c.name}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;
    container.innerHTML = html;
  },

  selectAllCountries() {
    this.countries.forEach(c => this.selectedCountries.add(c.code));
    document.querySelectorAll('.country-checkbox').forEach(cb => cb.checked = true);
    this.updateCountryCount();
    this.filterCompaniesByCountry();
  },

  clearAllCountries() {
    this.selectedCountries.clear();
    document.querySelectorAll('.country-checkbox').forEach(cb => cb.checked = false);
    this.updateCountryCount();
    this.filterCompaniesByCountry();
  },

  updateCountryCount() {
    const count = document.getElementById('countryCount');
    if (count) count.textContent = `Selected: ${this.selectedCountries.size}`;
  },

  async loadCompanies() {
    try {
      const res = await fetch('/api/companies');
      this.companies = await res.json();
      this.renderCompanies();
    } catch (error) {
      showError('Failed to load companies: ' + error.message);
    }
  },

  renderCompanies() {
    const container = document.getElementById('companiesTableContainer');
    if (!container) return;

    let filteredCompanies = this.companies;
    if (this.selectedCountries.size > 0) {
      filteredCompanies = this.companies.filter(c => 
        this.selectedCountries.has(c.country)
      );
    }

    // Existing content...
  },

  setupEventListeners() {
    const addBtn = document.getElementById('addCompanyBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.showCompanyModal());
    }
  },

  filterCompaniesByCountry() {
    this.renderCompanies();
  },

  showCompanyModal() {
    const name = prompt('Company name:');
    if (!name) return;

    const country = prompt('Country:');
    const platform = prompt('Platform (linkedin/indeed/glassdoor/custom):');
    const siteUrl = prompt('Site URL:');

    if (name && country && siteUrl) {
      this.saveCompany(name, country, platform, siteUrl);
    }
  },

  async saveCompany(name, country, platform, siteUrl) {
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, country, platform, career_url: siteUrl })
      });

      if (res.ok) {
        showSuccess('Company added');
      } else {
        showError('Failed to add company');
      }
    } catch (error) {
      console.error('Error saving company:', error);
    }
  },
};
