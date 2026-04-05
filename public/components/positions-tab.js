/**
 * Positions Tab Enhanced Component
 * Handles dynamic grouping, profile matching display, and job field filtering
 */

const PositionsTab = {
  positions: [],
  groupBy1: null,
  groupBy2: null,
  groupBy3: null,

  groupOptions: [
    { value: '', label: '—' },
    { value: 'jobType', label: 'Job Type' },
    { value: 'locationType', label: 'Location' },
    { value: 'level', label: 'Level' }
  ],

  async init() {
    this.setupEventListeners();
    await this.loadPositions();
  },

  setupEventListeners() {
    document.getElementById('countryFilter').addEventListener('change', () => this.loadPositions());
    document.getElementById('statusFilter').addEventListener('change', () => this.loadPositions());
    document.getElementById('jobTypeFilter').addEventListener('change', () => this.loadPositions());
    document.getElementById('groupBy1').addEventListener('change', (e) => {
      this.groupBy1 = e.target.value;
      this.renderPositions();
    });
    document.getElementById('groupBy2').addEventListener('change', (e) => {
      this.groupBy2 = e.target.value;
      this.renderPositions();
    });
    document.getElementById('groupBy3').addEventListener('change', (e) => {
      this.groupBy3 = e.target.value;
      this.renderPositions();
    });
    document.getElementById('refreshPositionsBtn').addEventListener('click', () => this.loadPositions());
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
    } catch (error) {
      showError('Failed to load positions: ' + error.message);
    }
  },

  renderPositions() {
    const container = document.getElementById('positionsContainer');
    
    if (this.positions.length === 0) {
      container.innerHTML = '<div class="empty-state">No positions found</div>';
      return;
    }

    // Apply grouping
    if (this.groupBy1 || this.groupBy2 || this.groupBy3) {
      this.renderGrouped();
    } else {
      this.renderFlat();
    }
  },

  renderFlat() {
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
            <th>Profiles</th>
            <th>Link</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
    `;

    this.positions.forEach(pos => {
      const scoreClass = pos.match_score >= 70 ? 'badge-green' : pos.match_score >= 40 ? 'badge-amber' : 'badge-red';
      const statusBadgeClass = pos.status === 'new' ? 'badge-info' : pos.status === 'applied' ? 'badge-green' : 'badge-red';
      
      const locationTypes = this.parseArray(pos.location_type);
      const jobTypes = this.parseArray(pos.years_experience);

      html += `
        <tr>
          <td><span class="badge ${scoreClass}">${pos.match_score}</span></td>
          <td>${pos.country || '—'}</td>
          <td>${pos.company_name || '—'}</td>
          <td>${pos.title}</td>
          <td>${pos.job_type || '—'}</td>
          <td>${locationTypes.join(', ') || '—'}</td>
          <td>${pos.seniority_level || '—'}</td>
          <td><button class="profile-btn" onclick="alert('Profile matching - coming soon')">Show</button></td>
          <td class="link-cell"><a href="${pos.link}" target="_blank">View</a></td>
          <td>
            <span class="badge ${statusBadgeClass}">${pos.status}</span>
            <button style="margin-left: 5px; padding: 4px 8px; font-size: 12px;" onclick="PositionsTab.updateStatus(${pos.id}, '${pos.status}')">
              Change
            </button>
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
      if (data.positions) {
        // Leaf node - show positions table
        data.positions.forEach(pos => {
          const scoreClass = pos.match_score >= 70 ? 'badge-green' : pos.match_score >= 40 ? 'badge-amber' : 'badge-red';
          const statusBadgeClass = pos.status === 'new' ? 'badge-info' : pos.status === 'applied' ? 'badge-green' : 'badge-red';
          
          html += `
            <div style="margin-left: ${level * 20}px; padding: 8px; border-left: 2px solid #ddd;">
              <div style="display: flex; gap: 10px; align-items: center; font-size: 14px;">
                <span class="badge ${scoreClass}">${pos.match_score}</span>
                <strong>${pos.title}</strong>
                <span style="color: #999;">${pos.company_name}</span>
                <a href="${pos.link}" target="_blank" style="font-size: 12px;">View</a>
                <span class="badge ${statusBadgeClass}">${pos.status}</span>
              </div>
            </div>
          `;
        });
      } else {
        // Group node - show category and recurse
        const keys = Object.keys(data);
        keys.forEach(key => {
          html += `<div style="margin-left: ${level * 20}px; padding: 12px; background: #f8f9fa; margin-top: 10px; font-weight: bold; border-radius: 4px;">
            ${key} (${this.countPositions(data[key])})
          </div>`;
          renderGroup(data[key], level + 1);
        });
      }
    };

    renderGroup(grouped);
    html += '</div>';
    container.innerHTML = html;
  },

  groupPositions() {
    let grouped = { positions: this.positions };

    if (this.groupBy1) {
      grouped = this.groupByField(grouped, this.groupBy1);
    }
    if (this.groupBy2) {
      grouped = this.applyGrouping(grouped, this.groupBy2);
    }
    if (this.groupBy3) {
      grouped = this.applyGrouping(grouped, this.groupBy3);
    }

    return grouped;
  },

  groupByField(data, field) {
    const result = {};
    data.positions.forEach(pos => {
      const value = this.getFieldValue(pos, field) || 'Unspecified';
      if (!result[value]) result[value] = { positions: [] };
      result[value].positions.push(pos);
    });
    return result;
  },

  applyGrouping(grouped, field) {
    const result = {};
    Object.keys(grouped).forEach(key => {
      result[key] = this.groupByField(grouped[key], field);
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

  countPositions(group) {
    if (group.positions) return group.positions.length;
    let count = 0;
    Object.values(group).forEach(g => count += this.countPositions(g));
    return count;
  },

  parseArray(jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  updateCountryFilter() {
    const countries = [...new Set(this.positions.map(p => p.country).filter(Boolean))].sort();
    const select = document.getElementById('countryFilter');
    const current = select.value;
    select.innerHTML = '<option value="">All Countries</option>';
    countries.forEach(c => {
      select.innerHTML += `<option value="${c}">${c}</option>`;
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
  }
};

document.addEventListener('DOMContentLoaded', () => PositionsTab.init());
