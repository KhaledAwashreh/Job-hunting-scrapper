const ProfilesTab = {
  profiles: [],
  timeWindow: '30',

  async init() {
    this.loadTimeWindow();
    this.loadProfiles();
    this.setupEventListeners();
  },

  setupEventListeners() {
    document.getElementById('addProfileBtn').addEventListener('click', () => this.showAddProfileForm());
    document.getElementById('timeWindowSelect').addEventListener('change', (e) => this.setTimeWindow(e.target.value));
  },

  async loadTimeWindow() {
    try {
      const res = await fetch('/api/scrape/time-window');
      const data = await res.json();
      this.timeWindow = data.time_window;
      document.getElementById('timeWindowSelect').value = this.timeWindow;
    } catch (error) {
      console.error('Failed to load time window:', error);
    }
  },

  async setTimeWindow(window) {
    try {
      const res = await fetch('/api/scrape/time-window', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time_window: window })
      });

      if (res.ok) {
        this.timeWindow = window;
        document.getElementById('timeWindowSelect').value = window;
      } else {
        console.error('Failed to set time window:', error);
      }
    } catch (error) {
      console.error('Error setting time window:', error);
    }
  },

  getTimeWindowLabel(window) {
    const labels = {
      '7': 'Last 7 days',
      '30': 'Last 30 days',
      '90': 'Last 60 days',
      '180': 'Last 6 months',
      'all': 'All time'
    };
    return labels[window] || window;
  },

  async loadProfiles() {
    try {
      const res = await fetch('/api/profiles');
      this.profiles = await res.json();
      this.renderProfiles();
    } catch (error) {
      showError('Failed to load profiles: ' + error.message);
    }
  },

  renderProfiles() {
    const container = document.getElementById('profilesAccordion');

    if (this.profiles.length === 0) {
      container.innerHTML = '<div class="empty-state">No profiles yet. Create one to start matching.</div>';
      return;
    }

    let html = '';
    this.profiles.forEach((profile, idx) => {
      const profileId = profile.id;
      const name = profile.name || 'Unnamed';
      const score = profile.match_score || 0;

      html += `
        <div class="profile-card" data-profile-id="${profileId}">
          <h3>${name}</h3>
          <p>Match Score: ${score}</p>
          <button onclick="showProfileDetails(${profileId})">View Details</button>
        </div>
      `;
    });

    container.innerHTML = html;
  },

  parseArray(jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  },

  showAddProfileForm() {
    const modal = document.getElementById('profileModal');
    document.getElementById('profileFormTitle').textContent = 'Add New Profile';
    document.getElementById('profileForm').reset();
    document.getElementById('profileForm').setAttribute('data-profile-id', '');
    document.getElementById('profileSeniority').value = '';
    modal.classList.add('open');
  },

  closeModal() {
    document.getElementById('profileModal').classList.remove('open');
  }
};
