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
            <button style="margin-left: 5px; padding: 4px 8px; font-size: 12px;" onclick="PositionsTab.tailorResume(${pos.id})">
              Tailor Resume
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
                <button style="padding: 4px 8px; font-size: 12px;" onclick="PositionsTab.tailorResume(${pos.id})">
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
            <div style="margin-left: ${level * 20}px; padding: 8px; border-left: 2px solid #ddd; margin-bottom: 5px;">
              <div style="display: flex; gap: 10px; align-items: center; font-size: 14px; flex-wrap: wrap;">
                <span class="badge ${scoreClass}">${pos.match_score}</span>
                <strong>${pos.title}</strong>
                <span style="color: #999;">${pos.company_name}</span>
                <span style="font-size: 12px; color: #666;">${pos.country}</span>
                <a href="${pos.link}" target="_blank" style="font-size: 12px;">View</a>
                <span class="badge ${statusBadgeClass}" style="margin-left: auto;">${pos.status}</span>
                <button style="padding: 4px 8px; font-size: 12px;" onclick="PositionsTab.tailorResume(${pos.id})">
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
  },

  async tailorResume(positionId) {
    try {
      showSuccess('Generating tailored resume...');
      const res = await fetch(`/api/positions/${positionId}/tailor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
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

  showTailoredModal(tailoredId, tailoredText, version) {
    // Create modal if not exists
    let modal = document.getElementById('tailoredResumeModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tailoredResumeModal';
      modal.style = 'display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;';
      modal.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 8px; width: 90%; max-width: 800px; max-height: 90vh; overflow-y: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3 style="margin: 0;">Tailored Resume (v${version})</h3>
            <div>
              <button onclick="PositionsTab.downloadTailored(${tailoredId}, 'txt')" style="padding: 8px 12px; margin-right: 5px;">Download TXT</button>
              <button onclick="PositionsTab.downloadTailored(${tailoredId}, 'docx')" style="padding: 8px 12px; margin-right: 5px;">Download DOCX</button>
              <button onclick="PositionsTab.downloadTailored(${tailoredId}, 'pdf')" style="padding: 8px 12px; margin-right: 5px;">Download PDF</button>
              <button onclick="document.getElementById('tailoredResumeModal').style.display = 'none'" style="padding: 8px 12px;">Close</button>
            </div>
          </div>
          <textarea id="tailoredText" style="width: 100%; height: 60vh; padding: 15px; font-family: 'Times New Roman', serif; font-size: 12px; line-height: 1.5; border: 1px solid #ddd; border-radius: 4px; resize: vertical;">${tailoredText}</textarea>
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
