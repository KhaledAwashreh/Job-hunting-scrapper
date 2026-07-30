/**
 * Profiles Tab Component
 * Handles profile management, CV uploads, and time window settings
 */

// Escapes a value for safe interpolation into innerHTML. Profile names are
// normally authored locally, but are still user-supplied strings that reach
// innerHTML unescaped (see issue #9) — treat them as untrusted like the rest.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
      container.innerHTML = '<div class="empty-state" data-testid="empty-state">No profiles yet. Create one to start matching jobs!</div>';
      return;
    }

    let html = '';
    this.profiles.forEach((profile, idx) => {
      const jobTypesStr = Array.isArray(profile.job_types) ? profile.job_types.join(', ') : profile.job_types;
      const yearsExp = this.parseArray(profile.years_of_experience).join(', ') || 'Any';
      const workLocs = this.parseArray(profile.work_location_preference).join(', ') || 'Any';
      
      html += `
        <div class="accordion-item">
          <button type="button" class="accordion-header" id="accordion-header-${idx}" onclick="ProfilesTab.toggleAccordion(${idx})" aria-expanded="false" aria-controls="accordion-${idx}">
            <div class="flex-1">
              <h4 class="mb-5">${escapeHtml(profile.name)}</h4>
              <small class="text-muted">${escapeHtml(jobTypesStr)}</small>
            </div>
            <span class="accordion-icon">▼</span>
          </button>
          <div class="accordion-content" id="accordion-${idx}">
            <div class="grid-2">
              <div>
                <strong>Job Types:</strong>
                <div class="hint-sm">${escapeHtml(jobTypesStr)}</div>
              </div>
              <div>
                <strong>Seniority Level:</strong>
                <div class="hint-sm">${escapeHtml(profile.seniority_level) || 'Not specified'}</div>
              </div>
              <div>
                <strong>Years of Experience:</strong>
                <div class="hint-sm">${escapeHtml(yearsExp)}</div>
              </div>
              <div>
                <strong>Work Location:</strong>
                <div class="hint-sm">${escapeHtml(workLocs)}</div>
              </div>
              <div class="span-full">
                <strong>Resume:</strong>
                <div class="hint-sm">${escapeHtml(profile.resume_file)}</div>
              </div>
              ${profile.secondary_category ? `
              <div class="span-full">
                <strong>Secondary Category:</strong>
                <div class="hint-sm">${escapeHtml(profile.secondary_category)}</div>
              </div>
              ` : ''}
            </div>
            <div class="row-actions">
              <button onclick="ProfilesTab.editProfile(${profile.id})" class="flex-1">Edit</button>
              <button onclick="ProfilesTab.deleteProfile(${profile.id})" class="danger flex-1">Delete</button>
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
      const isOpen = content.classList.toggle('active');
      const header = document.getElementById(`accordion-header-${idx}`);
      if (header) header.setAttribute('aria-expanded', String(isOpen));
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
    // A brand-new profile has no resume on file yet, so a file must be chosen.
    document.getElementById('profileResume').required = true;
    modal.classList.add('open');
  },

  async saveProfile(event) {
    event.preventDefault();

    const name = document.getElementById('profileName').value;
    const resumeFile = document.getElementById('profileResume');
    const profileId = document.getElementById('profileForm').getAttribute('data-profile-id');

    // When editing without re-selecting a file, keep the resume already on
    // record instead of overwriting it with the 'resume.pdf' placeholder
    // (issue #14). Only a genuinely new profile falls back to the placeholder,
    // and the file input is required in that case so this line is unreachable
    // without a real upload happening below.
    const existingProfile = profileId ? this.profiles.find(p => String(p.id) === String(profileId)) : null;
    let resume_file = existingProfile ? existingProfile.resume_file : 'resume.pdf';

    // Upload resume file first if selected
    if (resumeFile.files && resumeFile.files.length > 0) {
      const formData = new FormData();
      formData.append('resume', resumeFile.files[0]);

      try {
        const uploadRes = await fetch('/api/resumes/upload', {
          method: 'POST',
          body: formData
        });

        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          resume_file = uploadData.filename;
        } else {
          showError('Failed to upload resume');
          return;
        }
      } catch (error) {
        showError('Error uploading resume: ' + error.message);
        return;
      }
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
    
    // Clear file input for edit mode. The profile already has a resume on
    // file, so re-selecting one is optional here (issue #14) — `required`
    // would otherwise block the native form submit before saveProfile() ever
    // runs, with no visible error.
    const fileInput = document.getElementById('profileResume');
    fileInput.value = '';
    fileInput.required = false;

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
