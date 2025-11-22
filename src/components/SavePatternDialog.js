/**
 * Save Pattern Dialog Component
 * Handles saving patterns with metadata (title, artist, version, privacy)
 */

import { patternsAPI, getCurrentUser } from '../api.js';

export class SavePatternDialog {
  constructor() {
    this.modal = null;
    this.onSave = null;
    this.currentPattern = null;
    this.patternType = null;
    this.elementId = null;
    this.selectedUsers = [];
  }

  /**
   * Initialize the save dialog
   */
  init() {
    this.createModal();
    this.attachEventListeners();
  }

  /**
   * Create modal HTML
   */
  createModal() {
    const modalHTML = `
      <div class="save-pattern-modal-overlay" id="save-pattern-modal-overlay" style="display: none;">
        <div class="save-pattern-modal">
          <div class="save-pattern-modal-header">
            <h2>Save Pattern</h2>
            <button class="save-pattern-modal-close" id="save-pattern-modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="save-pattern-modal-body">
            <form id="save-pattern-form">
              <div class="form-group">
                <label for="save-pattern-title">Title (optional)</label>
                <input type="text" id="save-pattern-title" placeholder="e.g., My Awesome Beat" />
              </div>

              <div class="form-group">
                <label for="save-pattern-artist">Artist Name (optional)</label>
                <input type="text" id="save-pattern-artist" placeholder="Leave empty to use your default artist name" />
                <small>Override your default artist name for this pattern</small>
              </div>

              <div class="form-group">
                <label for="save-pattern-version-name">Version Name (optional)</label>
                <input type="text" id="save-pattern-version-name" placeholder="e.g., Remix, Live, Studio" />
                <small>Add a label to this version (version number is automatic)</small>
              </div>

              <div class="form-group">
                <label class="privacy-toggle-label">
                  <input type="checkbox" id="save-pattern-public" />
                  <span>Make this pattern public</span>
                </label>
                <small>Public patterns can be seen and used by all users</small>
              </div>

              <div class="form-group" id="save-pattern-share-group" style="display: none;">
                <label>Share with specific users (optional)</label>
                <div class="user-search-container">
                  <input type="text" id="save-pattern-user-search" placeholder="Search users by name or email..." />
                  <div class="user-search-results" id="save-pattern-user-results"></div>
                </div>
                <div class="selected-users" id="save-pattern-selected-users"></div>
              </div>

              <div class="save-pattern-modal-footer">
                <button type="button" class="btn-cancel" id="save-pattern-cancel-btn">Cancel</button>
                <button type="submit" class="btn-save" id="save-pattern-save-btn">Save Pattern</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modal = document.getElementById('save-pattern-modal-overlay');
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Close button
    const closeBtn = document.getElementById('save-pattern-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    // Cancel button
    const cancelBtn = document.getElementById('save-pattern-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.hide());
    }

    // Overlay click
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) {
          this.hide();
        }
      });
    }

    // Form submit
    const form = document.getElementById('save-pattern-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.savePattern();
      });
    }

    // Public checkbox toggle
    const publicCheckbox = document.getElementById('save-pattern-public');
    const shareGroup = document.getElementById('save-pattern-share-group');
    if (publicCheckbox && shareGroup) {
      publicCheckbox.addEventListener('change', (e) => {
        if (!e.target.checked) {
          shareGroup.style.display = 'block';
        } else {
          shareGroup.style.display = 'none';
          this.selectedUsers = [];
          this.updateSelectedUsers();
        }
      });
    }

    // User search
    const userSearch = document.getElementById('save-pattern-user-search');
    if (userSearch) {
      let searchTimeout;
      userSearch.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        if (query.length >= 2) {
          searchTimeout = setTimeout(() => this.searchUsers(query), 300);
        } else {
          this.clearUserSearchResults();
        }
      });
    }
  }

  /**
   * Search users
   */
  async searchUsers(query) {
    try {
      const { usersAPI } = await import('../api.js');
      const users = await usersAPI.searchUsers(query);
      this.displayUserSearchResults(users);
    } catch (error) {
      console.error('Error searching users:', error);
    }
  }

  /**
   * Display user search results
   */
  displayUserSearchResults(users) {
    const resultsContainer = document.getElementById('save-pattern-user-results');
    if (!resultsContainer) return;

    if (users.length === 0) {
      resultsContainer.innerHTML = '<div class="user-search-no-results">No users found</div>';
      return;
    }

    resultsContainer.innerHTML = users
      .filter(user => !this.selectedUsers.find(su => su.id === user.id))
      .map(user => `
        <div class="user-search-result-item" data-user-id="${user.id}">
          <img src="${user.avatarUrl || ''}" alt="${user.name}" class="user-search-avatar" onerror="this.style.display='none'">
          <div class="user-search-result-info">
            <div class="user-search-result-name">${user.name}</div>
            <div class="user-search-result-email">${user.email}</div>
          </div>
          <button type="button" class="user-search-add-btn">Add</button>
        </div>
      `).join('');

    // Attach click handlers
    resultsContainer.querySelectorAll('.user-search-result-item').forEach(item => {
      const addBtn = item.querySelector('.user-search-add-btn');
      const userId = item.dataset.userId;
      const user = users.find(u => u.id === userId);
      
      if (addBtn && user) {
        addBtn.addEventListener('click', () => {
          this.addUserToShare(user);
          item.remove();
        });
      }
    });
  }

  /**
   * Clear user search results
   */
  clearUserSearchResults() {
    const resultsContainer = document.getElementById('save-pattern-user-results');
    if (resultsContainer) {
      resultsContainer.innerHTML = '';
    }
  }

  /**
   * Add user to share list
   */
  addUserToShare(user) {
    if (!this.selectedUsers.find(u => u.id === user.id)) {
      this.selectedUsers.push(user);
      this.updateSelectedUsers();
    }
    const userSearch = document.getElementById('save-pattern-user-search');
    if (userSearch) {
      userSearch.value = '';
    }
    this.clearUserSearchResults();
  }

  /**
   * Remove user from share list
   */
  removeUserFromShare(userId) {
    this.selectedUsers = this.selectedUsers.filter(u => u.id !== userId);
    this.updateSelectedUsers();
  }

  /**
   * Update selected users display
   */
  updateSelectedUsers() {
    const container = document.getElementById('save-pattern-selected-users');
    if (!container) return;

    if (this.selectedUsers.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = this.selectedUsers.map(user => `
      <div class="selected-user-item">
        <img src="${user.avatarUrl || ''}" alt="${user.name}" class="selected-user-avatar" onerror="this.style.display='none'">
        <span class="selected-user-name">${user.name}</span>
        <button type="button" class="selected-user-remove" data-user-id="${user.id}">&times;</button>
      </div>
    `).join('');

    // Attach remove handlers
    container.querySelectorAll('.selected-user-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        this.removeUserFromShare(btn.dataset.userId);
      });
    });
  }

  /**
   * Show modal with pattern data
   */
  async show(patternCode, type, elementId = null) {
    if (!this.modal) return;

    this.currentPattern = patternCode;
    this.patternType = type;
    this.elementId = elementId;
    this.selectedUsers = [];

    // Try to extract existing metadata
    try {
      // Note: extractMetadataFromPattern is a server utility, we'll handle this differently
      // For now, just clear the form
    } catch (error) {
      // Ignore
    }

    // Clear form
    document.getElementById('save-pattern-title')?.value && (document.getElementById('save-pattern-title').value = '');
    document.getElementById('save-pattern-artist')?.value && (document.getElementById('save-pattern-artist').value = '');
    document.getElementById('save-pattern-version-name')?.value && (document.getElementById('save-pattern-version-name').value = '');
    document.getElementById('save-pattern-public')?.checked && (document.getElementById('save-pattern-public').checked = false);
    this.updateSelectedUsers();
    this.clearUserSearchResults();

    this.modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  /**
   * Hide modal
   */
  hide() {
    if (this.modal) {
      this.modal.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  /**
   * Save pattern
   */
  async savePattern() {
    if (!this.currentPattern) {
      alert('No pattern to save');
      return;
    }

    try {
      const user = await getCurrentUser();
      if (!user) {
        alert('Please log in to save patterns');
        return;
      }

      const title = document.getElementById('save-pattern-title')?.value.trim() || null;
      const artistName = document.getElementById('save-pattern-artist')?.value.trim() || null;
      const versionName = document.getElementById('save-pattern-version-name')?.value.trim() || null;
      const isPublic = document.getElementById('save-pattern-public')?.checked || false;

      // Extract raw pattern code (remove metadata if present)
      let rawPattern = this.currentPattern;
      // Try to extract code from formatted pattern
      const lines = rawPattern.split('\n');
      let codeStart = 0;
      let codeEnd = lines.length;
      
      // Find where actual code starts (after comments and empty line)
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === '' && i > 0 && lines[i-1].trim().startsWith('//')) {
          codeStart = i + 1;
          break;
        }
      }
      
      // Find where code ends (before footer comment)
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes('Made with Strudesk 4000')) {
          codeEnd = i;
          break;
        }
      }
      
      rawPattern = lines.slice(codeStart, codeEnd).join('\n').trim();

      const patternData = {
        type: this.patternType,
        elementId: this.elementId,
        patternCode: rawPattern,
        title,
        artistName,
        versionName,
        isPublic,
        metadata: {} // Can store additional config here
      };

      const savedPattern = await patternsAPI.createPattern(patternData);

      // Share with selected users if private
      if (!isPublic && this.selectedUsers.length > 0) {
        await patternsAPI.sharePattern(savedPattern.id, this.selectedUsers.map(u => u.id));
      }

      if (this.onSave) {
        this.onSave(savedPattern);
      }

      this.hide();
      alert('Pattern saved successfully!');
    } catch (error) {
      console.error('Error saving pattern:', error);
      alert('Failed to save pattern: ' + (error.message || 'Unknown error'));
    }
  }

  /**
   * Set callback for save
   */
  setOnSave(callback) {
    this.onSave = callback;
  }
}

