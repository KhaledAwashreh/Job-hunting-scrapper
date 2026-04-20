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
      const jobTypesStr = Array.isArray(profile.job_types) ? profile.job_types.join(', ') : profile.job_types;
      const yearsExp = this.parseArray(profile.years_of_experience).join(', ') || 'Any';
      const workLocs = this.parseArray(profile.work_location_preference).join(', ') || 'Any';
      
      html += `
        <div class="accordion-item">
          <div class="accordion-header" onclick="ProfilesTab.toggleAccordion(${idx})">
            <div style="flex: 1;">
              <h4 style="margin: 0 0 5px 0;">${profile.name}</h4>
              <small style="color: #666;">${jobTypesStr}</small>
            </div>
            <span class="accordion-icon">▼</span>
          </div>
          <div class="accordion-content" id="accordion-${idx}">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
              <div>
                <strong>Job Types:</strong>
                <div style="margin-top: 5px; color: #666;">${jobTypesStr}</div>
              </div>
              <div>
                <strong>Seniority Level:</strong>
                <div style="margin-top: 5px; color: #666;">${profile.seniority_level || 'Not specified'}</div>
              </div>
              <div>
                <strong>Years of Experience:</strong>
                <div style="margin-top: 5px; color: #666;">${yearsExp}</div>
              </div>
              <div>
                <strong>Work Location:</strong>
                <div style="margin-top: 5px; color: #666;">${workLocs}</div>
              </div>
              <div style="grid-column: 1/-1;">
                <strong>Resume:</strong>
                <div style="margin-top: 5px; color: #666;">${profile.resume_file}</div>
              </div>
              ${profile.secondary_category ? `
              <div style="grid-column: 1/-1;">
                <strong>Secondary Category:</strong>
                <div style="margin-top: 5px; color: #666;">${profile.secondary_category}</div>
              </div>
              ` : ''}
            </div>
            <div style="margin-top: 15px; display: flex; gap: 10px;">
              <button onclick="ProfilesTab.editProfile(${profile.id})" style="flex: 1;">Edit</button>
              <button onclick="ProfilesTab.deleteProfile(${profile.id})" class="danger" style="flex: 1;">Delete</button>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  },

  toggleAccordion(idx) {
    const content = document.getElementById(`accordion-${idx}`);
    if (content) {
      content.classList.toggle('active');
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

  showAddProfileForm() {
    const modal = document.getElementById('profileModal');
    document.getElementById('profileFormTitle').textContent = 'Add New Profile';
    document.getElementById('profileForm').reset();
    document.getElementById('profileForm').setAttribute('data-profile-id', '');
    document.getElementById('profileSeniority').value = '';
    modal.classList.add('open');
  },

  async saveProfile(event) {
    event.preventDefault();
    
    const name = document.getElementById('profileName').value;
    const resumeFile = document.getElementById('profileResume');
    let resume_file = 'resume.pdf';
    if (resumeFile.files && resumeFile.files.length > 0) {
      resume_file = resumeFile.files[0].name;
    }
    
    const jobTypesMulti = document.getElementById('profileJobTypes');
    const job_types = Array.from(jobTypesMulti.selectedOptions).map(o => o.value);
    
    const yearsExpMulti = document.getElementById('profileYearsExp');
    const years_of_experience = Array.from(yearsExpMulti.selectedOptions).map(o => o.value);
    
    const workLocPrefs = [];
    if (document.getElementById('workRemote').checked) workLocPrefs.push('Remote');
    if (document.getElementById('workOnsite').checked) workLocPrefs.push('On-site');
    if (document.getElementById('workHybrid').checked) workLocPrefs.push('Hybrid');
    
    const seniority_level = document.getElementById('profileSeniority').value || null;
    const secondary_category = document.getElementById('profileSecondary').value;
    const profileId = document.getElementById('profileForm').getAttribute('data-profile-id');

    if (!name || job_types.length === 0) {
      showError('Name and job types are required');
      return;
    }

    try {
      const url = profileId ? `/api/profiles/${profileId}` : '/api/profiles';
      const method = profileId ? 'PATCH' : 'POST';

      const payload = { 
        name, 
        resume_file, 
        job_types, 
        years_of_experience,
        work_location_preference: workLocPrefs,
        secondary_category 
      };
      if (seniority_level) payload.seniority_level = seniority_level;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
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
    document.getElementById('profileSecondary').value = profile.secondary_category || '';
    document.getElementById('profileSeniority').value = profile.seniority_level || '';
    
    // Clear file input for edit mode
    const fileInput = document.getElementById('profileResume');
    fileInput.value = '';
    
    // Set multi-select for job types
    const jobTypesSelect = document.getElementById('profileJobTypes');
    Array.from(jobTypesSelect.options).forEach(opt => {
      opt.selected = profile.job_types.includes(opt.value);
    });

    // Set years of experience
    const yearsExpSelect = document.getElementById('profileYearsExp');
    const yearsExp = this.parseArray(profile.years_of_experience);
    Array.from(yearsExpSelect.options).forEach(opt => {
      opt.selected = yearsExp.includes(opt.value);
    });

    // Set work location preferences
    const workLocs = this.parseArray(profile.work_location_preference);
    document.getElementById('workRemote').checked = workLocs.includes('Remote');
    document.getElementById('workOnsite').checked = workLocs.includes('On-site');
    document.getElementById('workHybrid').checked = workLocs.includes('Hybrid');

    document.getElementById('profileForm').setAttribute('data-profile-id', profileId);
    document.getElementById('profileModal').classList.add('open');
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
