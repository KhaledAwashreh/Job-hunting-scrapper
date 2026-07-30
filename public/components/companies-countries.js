/**
 * Companies Countries Component
 * Multi-select country filtering, backed by a local country list.
 *
 * The list is served from /countries.json rather than an external API: the
 * app's CSP sets `connect-src 'self'`, so any cross-origin fetch is blocked
 * outright. The previous version called restcountries.com, which meant the
 * request always failed and a hardcoded 15-country fallback was always used —
 * and that fallback omitted Ireland and Portugal, so neither could be selected.
 */

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
      const res = await fetch('/countries.json');
      if (!res.ok) throw new Error(`countries.json responded ${res.status}`);

      const data = await res.json();
      this.countries = (data.countries || []).slice()
        .sort((a, b) => a.name.localeCompare(b.name));

      if (this.countries.length === 0) throw new Error('countries.json was empty');

      this.renderCountryCheckboxes();
    } catch (error) {
      // Show the failure instead of silently substituting a partial list —
      // a short fallback that looks plausible is what hid this bug before.
      console.error('Could not load the country list:', error);
      this.renderCountryError(error);
    }
  },

  renderCountryError(error) {
    const container = document.getElementById('countriesContainer');
    if (!container) return;
    container.innerHTML =
      '<div class="countries-error" data-testid="countries-error" role="alert">' +
      'Could not load the country list. ' +
      String(error && error.message ? error.message : error) +
      '</div>';
  },

  renderCountryCheckboxes() {
    const container = document.getElementById('countriesContainer');
    if (!container) {
      console.warn('countriesContainer not found');
      return;
    }

    let html = `
      <div class="countries-grid">
        <div class="select-controls mb-15">
          <button id="selectAllCountries" data-testid="countries-select-all" class="btn-md-gap">Select All</button>
          <button id="clearAllCountries" data-testid="countries-clear-all" class="btn-md">Clear All</button>
          <span id="countryCount" data-testid="countries-count" class="countries-count-label">Selected: 0</span>
        </div>
        <div id="countryCheckboxes" data-testid="countries-checkboxes" class="countries-grid-inner">
    `;

    this.countries.forEach(country => {
      const isSelected = this.selectedCountries.has(country.code);
      html += `
        <label data-testid="country-option" data-country-code="${country.code}" class="country-row ${isSelected ? 'is-selected' : ''}">
          <input type="checkbox" class="country-checkbox" value="${country.code}" data-name="${country.name}" ${isSelected ? 'checked' : ''}>
          <span>${country.flag}</span>
          <span>${country.name}</span>
        </label>
      `;
    });

    html += `
        </div>
      </div>
    `;

    container.innerHTML = html;

    // Attach event listeners
    document.getElementById('selectAllCountries').addEventListener('click', () => this.selectAllCountries());
    document.getElementById('clearAllCountries').addEventListener('click', () => this.clearAllCountries());
    
    document.querySelectorAll('.country-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedCountries.add(checkbox.value);
        } else {
          this.selectedCountries.delete(checkbox.value);
        }
        this.updateCountryCount();
        this.filterCompaniesByCountry();
      });
    });
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

    if (filteredCompanies.length === 0) {
      container.innerHTML = '<div class="empty-state" data-testid="empty-state">No companies found</div>';
      return;
    }

    let html = `
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Country</th>
            <th>Platform</th>
            <th>Site URL</th>
            <th>Positions</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    filteredCompanies.forEach(company => {
      const posCount = this.companies
        .filter(c => c.id === company.id)
        .reduce((acc) => acc + 1, 0);

      html += `
        <tr>
          <td>${company.name}</td>
          <td>${company.country || '—'}</td>
          <td>${company.platform || '—'}</td>
          <td class="link-cell"><a href="${company.career_url}" target="_blank">Visit</a></td>
          <td>${posCount}</td>
          <td>
            <button class="btn-sm-gap" onclick="CompaniesCountries.editCompany(${company.id})">Edit</button>
            <button class="btn-sm" onclick="CompaniesCountries.deleteCompany(${company.id})">Delete</button>
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;

    container.innerHTML = html;
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
        await this.loadCompanies();
      } else {
        showError('Failed to add company');
      }
    } catch (error) {
      showError('Error: ' + error.message);
    }
  },

  async editCompany(companyId) {
    const company = this.companies.find(c => c.id === companyId);
    if (!company) return;

    const name = prompt('Company name:', company.name) || company.name;
    const country = prompt('Country:', company.country) || company.country;
    const platform = prompt('Platform:', company.platform) || company.platform;
    const siteUrl = prompt('Site URL:', company.career_url) || company.career_url;

    try {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, country, platform, career_url: siteUrl })
      });

      if (res.ok) {
        showSuccess('Company updated');
        await this.loadCompanies();
      } else {
        showError('Failed to update company');
      }
    } catch (error) {
      showError('Error: ' + error.message);
    }
  },

  async deleteCompany(companyId) {
    if (!confirm('Delete this company?')) return;

    try {
      const res = await fetch(`/api/companies/${companyId}`, { method: 'DELETE' });
      if (res.ok) {
        showSuccess('Company deleted');
        await this.loadCompanies();
      } else {
        showError('Failed to delete company');
      }
    } catch (error) {
      showError('Error: ' + error.message);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => CompaniesCountries.init());
