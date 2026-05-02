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
    } catch (error) {
      console.error('Failed to load positions:', error);
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
      return true;
    });

    // Existing content...
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
            <!-- ... -->
        </thead>
        <tbody>
          ${positions.map(pos => `
            <tr>
              <td>${pos.match_score}</td>
              <td>${pos.country}</td>
              <td>${pos.company}</td>
              <td>${pos.title}</td>
              <!-- ... -->
            </tr>
          `).join('')}
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
          const scoreClass = pos.match_score >= 70 ? 'badge-green' : pos.match_score >= 40 ? 'badge-yellow' : 'badge-red';
          const statusBadgeClass = pos.status === 'new' ? 'badge-info' : pos.status === 'applied' ? 'badge-warning' : '';

          html += `
            <div style="margin-left: ${level * 20}px; padding: 8px; border-left: 2px solid #ddd; margin-bottom: 10px;">
              <span class="${scoreClass}">${pos.match_score}</span>
              <span class="${statusBadgeClass}">${pos.status}</span>
              <a href="/positions/${pos.id}" target="_blank">${pos.title}</a>
            </div>
          `;
        });
      } else {
        // Non-leaf node - show as a group
        Object.keys(data).forEach(key => {
          const subGroup = data[key];
          html += `
            <h3 style="margin-top: 20px; margin-bottom: 10px;">${key}</h3>
            ${renderGroup(subGroup, level + 1)}
          `;
        });
      }
    };

    renderGroup(grouped);
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
      // Apply tertiary grouping
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
    }
  },

  parseArray(jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
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
  }
};
