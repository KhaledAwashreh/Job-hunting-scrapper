/**
 * Profiles Tab Component
 * Handles profile management, CV uploads, and time window settings
 */

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
        showSuccess('Time window updated to: ' + this.getTimeWindowLabel(window));
      } else {
        showError('Failed to set time window');
      }
    } catch (error) {
      showError('Error: ' + error.message);
    }
  },

  getTimeWindowLabel(window) {
    const labels = {
      '7': 'Last 7 days',
      '30': 'Last 30 days',
      '90': 'Last 90 days',
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
      container.innerHTML = '<div class="empty-state">No profiles yet. Create one to start matching jobs!</div>';
      return;
    }

    let html = '';
    this.profiles.forEach((profile, idx) => {
      const jobTypesStr = Array.isArray(profile.job_types) ? profile.job_types.join(', ') : '';
      html += `
        <div class="accordion-item">
          <div class="accordion-header" onclick="ProfilesTab.toggleAccordion(${idx})">
            <div class="accordion-title">
              <h4>${profile.name}</h4>
              <span class="profile-meta">${jobTypesStr}</span>
            </div>
            <span class="accordion-icon">▼</span>
          </div>
          <div class="accordion-content" id="accordion-${idx}">
            <div class="profile-details">
              <div class="detail-row">
                <label>Profile Name:</label>
                <span>${profile.name}</span>
              </div>
              <div class="detail-row">
                <label>Resume File:</label>
                <span>${profile.resume_file}</span>
              </div>
              <div class="detail-row">
                <label>Job Types:</label>
                <span>
                  ${jobTypesStr}
                </span>
              </div>
              ${profile.secondary_category ? `
              <div class="detail-row">
                <label>Secondary Category:</label>
                <span>${profile.secondary_category}</span>
              </div>
              ` : ''}
              <div class="button-group">
                <button onclick="ProfilesTab.editProfile(${profile.id})">Edit</button>
                <button onclick="ProfilesTab.updateCV(${profile.id})">Update CV</button>
                <button class="danger" onclick="ProfilesTab.deleteProfile(${profile.id})">Delete</button>
              </div>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  },

  toggleAccordion(idx) {
    const content = document.getElementById(`accordion-${idx}`);
    content.classList.toggle('open');
  },

  showAddProfileForm() {
    const modal = document.getElementById('profileModal');
    document.getElementById('profileFormTitle').textContent = 'Add New Profile';
    document.getElementById('profileForm').reset();
    document.getElementById('profileForm').setAttribute('data-profile-id', '');
    modal.classList.add('open');
  },

  async saveProfile(event) {
    event.preventDefault();
    
    const name = document.getElementById('profileName').value;
    const resume_file = document.getElementById('profileResume').value || 'resume.pdf';
    const jobTypesMulti = document.getElementById('profileJobTypes');
    const job_types = Array.from(jobTypesMulti.selectedOptions).map(o => o.value);
    const secondary_category = document.getElementById('profileSecondary').value;
    const profileId = document.getElementById('profileForm').getAttribute('data-profile-id');

    if (!name || job_types.length === 0) {
      showError('Name and job types are required');
      return;
    }

    try {
      const url = profileId ? `/api/profiles/${profileId}` : '/api/profiles';
      const method = profileId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, resume_file, job_types, secondary_category })
      });

      if (res.ok) {
        showSuccess(profileId ? 'Profile updated!' : 'Profile created!');
        this.closeModal();
        this.loadProfiles();
      } else {
        showError('Failed to save profile');
      }
    } catch (error) {
      showError('Error: ' + error.message);
    }
  },

  async editProfile(profileId) {
    const profile = this.profiles.find(p => p.id === profileId);
    if (!profile) return;

    document.getElementById('profileFormTitle').textContent = 'Edit Profile';
    document.getElementById('profileName').value = profile.name;
    document.getElementById('profileResume').value = profile.resume_file;
    document.getElementById('profileSecondary').value = profile.secondary_category || '';
    
    // Set multi-select
    const jobTypesSelect = document.getElementById('profileJobTypes');
    Array.from(jobTypesSelect.options).forEach(opt => {
      opt.selected = profile.job_types.includes(opt.value);
    });

    document.getElementById('profileForm').setAttribute('data-profile-id', profileId);
    document.getElementById('profileModal').classList.add('open');
  },

  updateCV(profileId) {
    alert('CV upload feature coming soon!');
  },

  async deleteProfile(profileId) {
    if (!confirm('Are you sure you want to delete this profile?')) return;

    try {
      const res = await fetch(`/api/profiles/${profileId}`, { method: 'DELETE' });
      if (res.ok) {
        showSuccess('Profile deleted');
        this.loadProfiles();
      } else {
        showError('Failed to delete profile');
      }
    } catch (error) {
      showError('Error: ' + error.message);
    }
  },

  closeModal() {
    document.getElementById('profileModal').classList.remove('open');
  }
};

// Initialize when DOM ready
document.addEventListener('DOMContentLoaded', () => ProfilesTab.init());
