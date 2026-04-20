/**
 * Positions Tab Enhanced Component
 * Handles dynamic grouping, profile matching display, and job field filtering
 */

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
      container.innerHTML = '<div class="empty-state">No positions found with selected filters</div>';
      return;
    }

    this.renderFlat(filtered);
    this.updateFilterDropdowns();
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
        <tr>
          <td><span class="badge ${scoreClass}">${pos.match_score}</span></td>
          <td>${pos.country || '—'}</td>
          <td>${pos.company_name || '—'}</td>
          <td>${pos.title}</td>
          <td>${pos.job_type || '—'}</td>
          <td>${locationTypes.join(', ') || '—'}</td>
          <td>${levels.join(', ') || '—'}</td>
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
      if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0].title) {
        // Leaf node - show positions in a simple list
        data.forEach(pos => {
          const scoreClass = pos.match_score >= 70 ? 'badge-green' : pos.match_score >= 40 ? 'badge-amber' : 'badge-red';
          const statusBadgeClass = pos.status === 'new' ? 'badge-info' : pos.status === 'applied' ? 'badge-green' : 'badge-red';
          
          html += `
            <div style="margin-left: ${level * 20}px; padding: 8px; border-left: 2px solid #ddd; margin-bottom: 5px;">
              <div style="display: flex; gap: 10px; align-items: center; font-size: 14px; flex-wrap: wrap;">
                <span class="badge ${scoreClass}">${pos.match_score}</span>
                <strong>${pos.title}</strong>
                <span style="color: #999;">${pos.company_name}</span>
                <span style="font-size: 12px; color: #666;">${pos.country}</span>
                <a href="${pos.link}" target="_blank" style="font-size: 12px;">View</a>
                <span class="badge ${statusBadgeClass}" style="margin-left: auto;">${pos.status}</span>
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
            <div style="margin-left: ${level * 20}px; padding: 8px; border-left: 2px solid #ddd; margin-bottom: 5px;">
              <div style="display: flex; gap: 10px; align-items: center; font-size: 14px; flex-wrap: wrap;">
                <span class="badge ${scoreClass}">${pos.match_score}</span>
                <strong>${pos.title}</strong>
                <span style="color: #999;">${pos.company_name}</span>
                <span style="font-size: 12px; color: #666;">${pos.country}</span>
                <a href="${pos.link}" target="_blank" style="font-size: 12px;">View</a>
                <span class="badge ${statusBadgeClass}" style="margin-left: auto;">${pos.status}</span>
              </div>
            </div>
          `;
        });
      } else if (typeof data === 'object') {
        // Group node - show category and recurse
        const keys = Object.keys(data);
        keys.forEach(key => {
          const count = this.countPositionsInGroup(data[key]);
          html += `<div style="margin-left: ${level * 20}px; padding: 12px 8px; background: #f8f9fa; margin-top: 10px; margin-bottom: 5px; font-weight: 600; border-radius: 4px; color: #2c3e50;">
            ${key} <span style="font-size: 12px; color: #999;">(${count} ${count === 1 ? 'job' : 'jobs'})</span>
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
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">All Countries</option>';
    countries.forEach(c => {
      select.innerHTML += `<option value="${c}">${c}</option>`;
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
      select.innerHTML += `<option value="${jt}">${jt}</option>`;
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
