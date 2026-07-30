/**
 * Positions Tab Enhanced Component
 * Handles dynamic grouping, profile matching display, and job field filtering
 */

// Escapes a value for safe interpolation into innerHTML. Scraped job titles,
// company names etc. are untrusted third-party strings (see issue #9) — every
// field pulled from the API must go through this before it touches innerHTML.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only allow http(s) links through to an href attribute. Rejects javascript:
// and other schemes that would execute on click (issue #9).
function safeHref(value) {
  const str = String(value == null ? '' : value).trim();
  if (/^https?:\/\//i.test(str)) return escapeHtml(str);
  return '#';
}

const PositionsTab = {
  positions: [],
  filterJobType: null,
  filterLocation: null,
  filterLevel: null,

  async init() {
    this.setupEventListeners();
    await this.loadPositions();
  },

  setupEventListeners() {
    document.getElementById('countryFilter')?.addEventListener('change', () => this.loadPositions());
    document.getElementById('statusFilter')?.addEventListener('change', () => this.loadPositions());
    document.getElementById('jobTypeFilter')?.addEventListener('change', () => this.loadPositions());
    document.getElementById('filterJobType')?.addEventListener('change', (e) => {
      this.filterJobType = e.target.value || null;
      this.renderPositions();
    });
    document.getElementById('filterLocation')?.addEventListener('change', (e) => {
      this.filterLocation = e.target.value || null;
      this.renderPositions();
    });
    document.getElementById('filterLevel')?.addEventListener('change', (e) => {
      this.filterLevel = e.target.value || null;
      this.renderPositions();
    });
    document.getElementById('refreshPositionsBtn')?.addEventListener('click', () => this.loadPositions());
  },

  async loadPositions() {
    try {
      const country = document.getElementById('countryFilter').value;
      const status = document.getElementById('statusFilter').value;
      const url = new URL('/api/positions', window.location);
      if (country) url.searchParams.set('country', country);
      if (status) url.searchParams.set('status', status);

      const res = await fetch(url);
      this.positions = await res.json();
      this.renderPositions();
      this.updateCountryFilter();
      this.updateJobTypeFilter();
    } catch (error) {
      showError('Failed to load positions: ' + error.message);
    }
  },

  renderPositions() {
    const container = document.getElementById('positionsContainer');
    
    // Apply filters
    let filtered = this.positions.filter(pos => {
      if (this.filterJobType && pos.job_type !== this.filterJobType) return false;
      if (this.filterLocation) {
        const locs = this.parseArray(pos.location_type);
        if (!locs.includes(this.filterLocation)) return false;
      }
      if (this.filterLevel) {
        const levels = this.parseArray(pos.seniority_level);
        if (!levels.includes(this.filterLevel)) return false;
      }
      return true;
    });
    
    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state" data-testid="empty-state">No positions found with selected filters</div>';
      return;
    }

    this.renderFlat(filtered);
    this.updateCountryFilter();
    this.updateJobTypeFilter();
  },

  renderFlat(positions) {
    const container = document.getElementById('positionsContainer');
    let html = `
      <table>
        <thead>
          <tr>
            <th>Score</th>
            <th>Country</th>
            <th>Company</th>
            <th>Title</th>
            <th>Job Type</th>
            <th>Location</th>
            <th>Level</th>
            <th>Link</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
    `;

    positions.forEach(pos => {
      const scoreClass = pos.match_score >= 70 ? 'badge-green' : pos.match_score >= 40 ? 'badge-amber' : 'badge-red';
      const statusBadgeClass = pos.status === 'new' ? 'badge-info' : pos.status === 'applied' ? 'badge-green' : 'badge-red';
      
      const locationTypes = this.parseArray(pos.location_type);
      const levels = this.parseArray(pos.seniority_level);

       html += `
        <tr data-testid="position-row" data-position-id="${pos.id}">
          <td><span class="badge ${scoreClass}" data-testid="position-score">${pos.match_score}</span></td>
          <td data-testid="position-country">${escapeHtml(pos.country) || '—'}</td>
          <td data-testid="position-company">${escapeHtml(pos.company_name) || '—'}</td>
          <td data-testid="position-title">${escapeHtml(pos.title)}</td>
          <td>${escapeHtml(pos.job_type) || '—'}</td>
          <td>${escapeHtml(locationTypes.join(', ')) || '—'}</td>
          <td>${escapeHtml(levels.join(', ')) || '—'}</td>
          <td class="link-cell"><a href="${safeHref(pos.link)}" target="_blank" data-testid="position-link">View</a></td>
          <td><span class="badge ${statusBadgeClass}">${escapeHtml(pos.status)}</span></td>
          <td class="actions-cell">
            <button class="btn-change" onclick="PositionsTab.updateStatus(${pos.id}, '${pos.status}')">Change</button>
            <button class="btn-tailor" onclick="PositionsTab.tailorResume(${pos.id})">Tailor Resume</button>
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

  renderGrouped() {
    const container = document.getElementById('positionsContainer');
    const grouped = this.groupPositions();
    
    let html = '<div class="grouped-positions">';
    
     const renderGroup = (data, level = 1) => {
      if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0].title) {
        // Leaf node - show positions in a simple list
        data.forEach(pos => {
          const scoreClass = pos.match_score >= 70 ? 'badge-green' : pos.match_score >= 40 ? 'badge-amber' : 'badge-red';
          const statusBadgeClass = pos.status === 'new' ? 'badge-info' : pos.status === 'applied' ? 'badge-green' : 'badge-red';
           
          html += `
            <div data-testid="position-row" data-position-id="${pos.id}" class="position-group-row" style="margin-left: ${level * 20}px;">
              <div class="position-line">
                <span class="badge ${scoreClass}" data-testid="position-score">${pos.match_score}</span>
                <strong data-testid="position-title">${escapeHtml(pos.title)}</strong>
                <span data-testid="position-company" class="text-faint">${escapeHtml(pos.company_name)}</span>
                <span data-testid="position-country" class="text-sm-muted">${escapeHtml(pos.country)}</span>
                <a href="${safeHref(pos.link)}" target="_blank" data-testid="position-link" class="text-sm">View</a>
                <span class="badge ${statusBadgeClass} push-right">${escapeHtml(pos.status)}</span>
                <button class="btn-sm" onclick="PositionsTab.tailorResume(${pos.id})">
                  Tailor Resume
                </button>
              </div>
            </div>
          `;
        });
       } else if (data && typeof data === 'object' && data.positions && Array.isArray(data.positions)) {
        // Mixed node with positions array
        data.positions.forEach(pos => {
          const scoreClass = pos.match_score >= 70 ? 'badge-green' : pos.match_score >= 40 ? 'badge-amber' : 'badge-red';
          const statusBadgeClass = pos.status === 'new' ? 'badge-info' : pos.status === 'applied' ? 'badge-green' : 'badge-red';
           
          html += `
            <div data-testid="position-row" data-position-id="${pos.id}" class="position-group-row" style="margin-left: ${level * 20}px;">
              <div class="position-line">
                <span class="badge ${scoreClass}" data-testid="position-score">${pos.match_score}</span>
                <strong data-testid="position-title">${escapeHtml(pos.title)}</strong>
                <span data-testid="position-company" class="text-faint">${escapeHtml(pos.company_name)}</span>
                <span data-testid="position-country" class="text-sm-muted">${escapeHtml(pos.country)}</span>
                <a href="${safeHref(pos.link)}" target="_blank" data-testid="position-link" class="text-sm">View</a>
                <span class="badge ${statusBadgeClass} push-right">${escapeHtml(pos.status)}</span>
                <button class="btn-sm" onclick="PositionsTab.tailorResume(${pos.id})">
                  Tailor Resume
                </button>
              </div>
            </div>
          `;
        });
      } else if (typeof data === 'object') {
        // Group node - show category and recurse
        const keys = Object.keys(data);
        keys.forEach(key => {
          const count = this.countPositionsInGroup(data[key]);
          html += `<div class="position-group-heading" style="margin-left: ${level * 20}px;">
            ${escapeHtml(key)} <span class="text-sm-faint">(${count} ${count === 1 ? 'job' : 'jobs'})</span>
          </div>`;
          renderGroup(data[key], level + 1);
        });
      }
    };

    renderGroup(grouped);
    html += '</div>';
    container.innerHTML = html;
  },

  countPositionsInGroup(group) {
    if (Array.isArray(group)) return group.length;
    if (group && group.positions && Array.isArray(group.positions)) return group.positions.length;
    if (typeof group === 'object') {
      let count = 0;
      Object.values(group).forEach(g => count += this.countPositionsInGroup(g));
      return count;
    }
    return 0;
  },

  groupPositions() {
    let grouped = { positions: this.positions };

    if (this.groupBy1) {
      grouped = this.groupByField(this.positions, this.groupBy1);
    }
    if (this.groupBy2 && this.groupBy1) {
      grouped = this.applySecondaryGrouping(grouped, this.groupBy2);
    }
    if (this.groupBy3 && this.groupBy1 && this.groupBy2) {
      grouped = this.applyTertiaryGrouping(grouped, this.groupBy3);
    }

    return grouped;
  },

  groupByField(positions, field) {
    const result = {};
    positions.forEach(pos => {
      const value = this.getFieldValue(pos, field) || 'Unspecified';
      if (!result[value]) result[value] = { positions: [] };
      result[value].positions.push(pos);
    });
    return result;
  },

  applySecondaryGrouping(grouped, field) {
    const result = {};
    Object.keys(grouped).forEach(key => {
      result[key] = this.groupByField(grouped[key].positions, field);
    });
    return result;
  },

  applyTertiaryGrouping(grouped, field) {
    const result = {};
    Object.keys(grouped).forEach(key1 => {
      result[key1] = {};
      Object.keys(grouped[key1]).forEach(key2 => {
        result[key1][key2] = this.groupByField(grouped[key1][key2].positions, field);
      });
    });
    return result;
  },

  getFieldValue(pos, field) {
    switch(field) {
      case 'jobType':
        return pos.job_type;
      case 'locationType':
        const locs = this.parseArray(pos.location_type);
        return locs.length > 0 ? locs[0] : 'Unspecified';
      case 'level':
        const seniorities = this.parseArray(pos.seniority_level);
        return seniorities.length > 0 ? seniorities[0] : 'Unspecified';
      default:
        return null;
    }
  },

  parseArray(value) {
    // The API already returns real arrays (src/db/queries.js runs ensureArray()
    // on these fields), so the common case must be handled without JSON.parse:
    // JSON.parse(anArray) stringifies it first (e.g. "Remote", unquoted), which
    // is invalid JSON and throws. Only fall back to parsing for the legacy
    // string-encoded form.
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  updateCountryFilter() {
    const countries = [...new Set(this.positions.map(p => p.country).filter(Boolean))].sort();
    const select = document.getElementById('countryFilter');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">All Countries</option>';
    countries.forEach(c => {
      select.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
    });
    select.value = current;
  },

  updateJobTypeFilter() {
    const jobTypes = [...new Set(this.positions.map(p => p.job_type).filter(Boolean))].sort();
    const select = document.getElementById('jobTypeFilter');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">All Job Types</option>';
    jobTypes.forEach(jt => {
      select.innerHTML += `<option value="${escapeHtml(jt)}">${escapeHtml(jt)}</option>`;
    });
    select.value = current;
  },

  async updateStatus(positionId, currentStatus) {
    const newStatus = prompt('Enter new status (new/applied/rejected/accepted):', currentStatus);
    if (!newStatus) return;

    try {
      const res = await fetch(`/api/positions/${positionId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });

      if (res.ok) {
        showSuccess('Status updated');
        this.loadPositions();
      } else {
        showError('Failed to update status');
      }
    } catch (error) {
      showError('Error: ' + error.message);
    }
  },

  async tailorResume(positionId) {
    try {
      // 1. Fetch available profiles
      const profilesRes = await fetch('/api/profiles');
      const profiles = await profilesRes.json();

      if (!profiles || profiles.length === 0) {
        showError('No profiles configured. Create one in the Profiles tab first.');
        return;
      }

      let selectedProfileId;

      if (profiles.length === 1) {
        // Single profile — use it automatically
        selectedProfileId = profiles[0].id;
      } else {
        // Multiple profiles — ask user to pick one
        selectedProfileId = await this.promptProfileSelection(profiles);
        if (!selectedProfileId) return; // user cancelled
      }

      showSuccess('Generating tailored resume...');
      const res = await fetch(`/api/positions/${positionId}/tailor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: selectedProfileId })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate tailored resume');
      }

      const data = await res.json();
      this.showTailoredModal(data.id, data.tailored_text, data.version);
      showSuccess('Tailored resume generated!');
    } catch (error) {
      showError('Tailoring failed: ' + error.message);
    }
  },

  promptProfileSelection(profiles) {
    return new Promise((resolve) => {
      // Create a lightweight modal with profile options
      const overlay = document.createElement('div');
      overlay.className = 'profile-picker-overlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:2000;display:flex;align-items:center;justify-content:center;';

      const modal = document.createElement('div');
      modal.style.cssText = 'background:white;padding:24px;border-radius:8px;min-width:400px;max-width:500px;box-shadow:0 4px 20px rgba(0,0,0,0.2);';

      modal.innerHTML = `
        <h3 class="modal-title">Select Profile for Tailoring</h3>
        <p class="modal-subtitle">Choose which profile/resume to use for tailoring this position:</p>
        <div class="field-stack">
          ${profiles.map(p => `
            <button class="profile-option" data-id="${p.id}" class="choice-card">
              <strong>${escapeHtml(p.name)}</strong>
              <span class="hint-block">
                ${escapeHtml(Array.isArray(p.job_types) ? p.job_types.join(', ') : '')}${p.seniority_level ? ' — ' + escapeHtml(p.seniority_level) : ''}
              </span>
            </button>
          `).join('')}
        </div>
        <button class="profile-picker-cancel btn-outline">Cancel</button>
      `;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      // Handle selection
      modal.querySelectorAll('.profile-option').forEach(btn => {
        btn.addEventListener('click', () => {
          document.body.removeChild(overlay);
          resolve(parseInt(btn.dataset.id));
        });
        btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#3498db'; btn.style.background = '#e8f4fd'; });
        btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#ddd'; btn.style.background = '#f9f9f9'; });
      });

      modal.querySelector('.profile-picker-cancel').addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(null);
      });
    });
  },

  showTailoredModal(tailoredId, tailoredText, version) {
    // Create modal if not exists
    let modal = document.getElementById('tailoredResumeModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tailoredResumeModal';
      modal.style = 'display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;';
      modal.innerHTML = `
        <div class="modal-panel-wide">
          <div class="split-header">
            <h3 class="m-0">Tailored Resume (v${version})</h3>
            <div>
              <button onclick="PositionsTab.downloadTailored(${tailoredId}, 'txt')" class="btn-md-gap">Download TXT</button>
              <button onclick="PositionsTab.downloadTailored(${tailoredId}, 'docx')" class="btn-md-gap">Download DOCX</button>
              <button onclick="PositionsTab.downloadTailored(${tailoredId}, 'pdf')" class="btn-md-gap">Download PDF</button>
              <button onclick="document.getElementById('tailoredResumeModal').style.display = 'none'" class="btn-md">Close</button>
            </div>
          </div>
          <textarea id="tailoredText" class="resume-editor">${escapeHtml(tailoredText)}</textarea>
        </div>
      `;
      document.body.appendChild(modal);
    } else {
      // Update existing modal
      modal.querySelector('h3').textContent = `Tailored Resume (v${version})`;
      modal.querySelector('#tailoredText').value = tailoredText;
      // Update download buttons
      modal.querySelector('button[onclick*="txt"]').setAttribute('onclick', `PositionsTab.downloadTailored(${tailoredId}, 'txt')`);
      modal.querySelector('button[onclick*="docx"]').setAttribute('onclick', `PositionsTab.downloadTailored(${tailoredId}, 'docx')`);
      modal.querySelector('button[onclick*="pdf"]').setAttribute('onclick', `PositionsTab.downloadTailored(${tailoredId}, 'pdf')`);
    }

    modal.style.display = 'flex';
  },

  downloadTailored(tailoredId, format) {
    window.open(`/api/tailored-resumes/${tailoredId}/download?format=${format}`, '_blank');
  }
};

document.addEventListener('DOMContentLoaded', () => PositionsTab.init());
