/**
 * Companies Countries Component
 * Integrates REST Countries API for multi-select country filtering
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
      const res = await fetch('https://restcountries.com/v3.1/all');
      if (!res.ok) throw new Error('Failed to fetch countries');
      
      const data = await res.json();
      this.countries = data
        .map(c => ({
          code: c.cca2,
          name: c.name.common,
          flag: c.flag
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      
      this.renderCountryCheckboxes();
    } catch (error) {
      console.warn('Could not load REST Countries API, using fallback:', error);
      this.useFallbackCountries();
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
      { code: 'IN', name: 'India', flag: '🇮🇳' },
      { code: 'JP', name: 'Japan', flag: '🇯🇵' },
      { code: 'ES', name: 'Spain', flag: '🇪🇸' },
      { code: 'IT', name: 'Italy', flag: '🇮🇹' },
      { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
      { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
      { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
    ];
    this.renderCountryCheckboxes();
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
          <button id="selectAllCountries" style="padding: 8px 12px; margin-right: 5px;">Select All</button>
          <button id="clearAllCountries" style="padding: 8px 12px;">Clear All</button>
          <span id="countryCount" style="margin-left: 15px; font-weight: bold;">Selected: 0</span>
        </div>
        <div id="countryCheckboxes" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; padding: 10px; border-radius: 4px; background: #f8f9fa;">
    `;

    this.countries.forEach(country => {
      const isSelected = this.selectedCountries.has(country.code);
      html += `
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 8px; border-radius: 4px; background: ${isSelected ? '#e3f2fd' : 'transparent'};">
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
      container.innerHTML = '<div class="empty-state">No companies found</div>';
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
            <button style="padding: 4px 8px; font-size: 12px; margin-right: 5px;" onclick="CompaniesCountries.editCompany(${company.id})">Edit</button>
            <button style="padding: 4px 8px; font-size: 12px;" onclick="CompaniesCountries.deleteCompany(${company.id})">Delete</button>
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
