/**
 * Save Track Dialog Component
 * Handles saving tracks with metadata (title, artist, version, privacy)
 */

import { patternsAPI, getCurrentUser } from '../api.js';
import { lockScroll, unlockScroll } from '../scrollLock.js';

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
            <h2 id="save-pattern-modal-title">Save Track</h2>
            <button class="save-pattern-modal-close" id="save-pattern-modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="save-pattern-modal-body">
            <form id="save-pattern-form">
              <div class="form-group">
                <label for="save-pattern-title">Track Title</label>
                <input type="text" id="save-pattern-title" placeholder="e.g., My Awesome Beat" required />
              </div>

              <div class="form-group">
                <label for="save-pattern-artist">Artist Name</label>
                <input type="text" id="save-pattern-artist" placeholder="Leave empty to use your default artist name" required />
                <small>Override your default artist name for this track</small>
              </div>

              <div class="form-group" id="save-pattern-image-group">
                <label for="save-pattern-image">Cover Image URL (optional)</label>
                <input type="url" id="save-pattern-image" placeholder="https://example.com/cover.jpg" />
                <small>Shown in the Top Tracks section when shared</small>
              </div>

              <div class="form-group">
                <label for="save-pattern-image">Cover Image URL (optional)</label>
                <input type="url" id="save-pattern-image" placeholder="https://example.com/cover.jpg" />
                <small>Shown in the Top Tracks section when shared</small>
              </div>

              <div class="form-group">
                <label for="save-pattern-version-name">Version Name (optional)</label>
                <input type="text" id="save-pattern-version-name" placeholder="e.g., Remix, Live, Studio" />
                <small>Add a label to this version (version number is automatic)</small>
              </div>

              <div class="form-group" id="save-pattern-genre-group" style="display: none;">
                <label for="save-pattern-genre">Genre/Style (optional)</label>
                <select id="save-pattern-genre">
                  <option value="">Select a genre...</option>
                  <optgroup label="Electronic">
                    <option value="Techno">Techno</option>
                    <option value="House">House</option>
                    <option value="Trance">Trance</option>
                    <option value="Dubstep">Dubstep</option>
                    <option value="Drum & Bass">Drum & Bass</option>
                    <option value="Ambient">Ambient</option>
                    <option value="IDM">IDM</option>
                    <option value="Electro">Electro</option>
                    <option value="Synthwave">Synthwave</option>
                    <option value="Industrial">Industrial</option>
                  </optgroup>
                  <optgroup label="Hip Hop & Urban">
                    <option value="Hip Hop">Hip Hop</option>
                    <option value="Trap">Trap</option>
                    <option value="R&B">R&B</option>
                    <option value="Grime">Grime</option>
                    <option value="Drill">Drill</option>
                  </optgroup>
                  <optgroup label="Rock & Alternative">
                    <option value="Rock">Rock</option>
                    <option value="Alternative">Alternative</option>
                    <option value="Indie">Indie</option>
                    <option value="Punk">Punk</option>
                    <option value="Metal">Metal</option>
                    <option value="Post-Rock">Post-Rock</option>
                  </optgroup>
                  <optgroup label="Jazz & Blues">
                    <option value="Jazz">Jazz</option>
                    <option value="Blues">Blues</option>
                    <option value="Smooth Jazz">Smooth Jazz</option>
                    <option value="Bebop">Bebop</option>
                    <option value="Fusion">Fusion</option>
                  </optgroup>
                  <optgroup label="World & Folk">
                    <option value="World">World</option>
                    <option value="Folk">Folk</option>
                    <option value="Traditional">Traditional</option>
                    <option value="Ethnic">Ethnic</option>
                  </optgroup>
                  <optgroup label="Pop & Dance">
                    <option value="Pop">Pop</option>
                    <option value="Dance">Dance</option>
                    <option value="EDM">EDM</option>
                    <option value="Disco">Disco</option>
                    <option value="Funk">Funk</option>
                  </optgroup>
                  <optgroup label="Experimental">
                    <option value="Experimental">Experimental</option>
                    <option value="Noise">Noise</option>
                    <option value="Avant-garde">Avant-garde</option>
                    <option value="Minimal">Minimal</option>
                  </optgroup>
                  <optgroup label="Other">
                    <option value="Cinematic">Cinematic</option>
                    <option value="Game Music">Game Music</option>
                    <option value="Other">Other</option>
                  </optgroup>
                </select>
                <small>Select a genre to help with pattern matching and discovery</small>
              </div>

              <div class="form-group">
                <label class="privacy-toggle-label">
                  <input type="checkbox" id="save-pattern-public" />
                  <span>Make this track public</span>
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
                <button type="submit" class="btn-save" id="save-pattern-save-btn">Save Track</button>
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

    const isMasterTrack = type === 'master';
    const modalTitle = document.getElementById('save-pattern-modal-title');
    const saveButton = document.getElementById('save-pattern-save-btn');
    if (modalTitle) {
      modalTitle.textContent = isMasterTrack ? 'Save Track' : 'Save Pattern';
    }
    if (saveButton) {
      saveButton.textContent = isMasterTrack ? 'Save Track' : 'Save Pattern';
    }

    const titleInput = document.getElementById('save-pattern-title');
    const artistInput = document.getElementById('save-pattern-artist');
    const imageGroup = document.getElementById('save-pattern-image-group');
    const imageInput = document.getElementById('save-pattern-image');
    if (titleInput) {
      titleInput.required = isMasterTrack;
      titleInput.placeholder = isMasterTrack ? 'Enter track title' : 'e.g., My Awesome Beat';
    }
    if (artistInput) {
      artistInput.required = isMasterTrack;
      artistInput.placeholder = isMasterTrack
        ? 'Enter artist name'
        : 'Leave empty to use your default artist name';
    }
    if (imageGroup) {
      imageGroup.style.display = isMasterTrack ? 'block' : 'none';
    }

    // Show/hide genre dropdown based on pattern type (only for master)
    const genreGroup = document.getElementById('save-pattern-genre-group');
    if (genreGroup) {
      genreGroup.style.display = isMasterTrack ? 'block' : 'none';
    }

    // Clear form
    document.getElementById('save-pattern-title')?.value && (document.getElementById('save-pattern-title').value = '');
    document.getElementById('save-pattern-artist')?.value && (document.getElementById('save-pattern-artist').value = '');
    document.getElementById('save-pattern-version-name')?.value && (document.getElementById('save-pattern-version-name').value = '');
    if (imageInput) {
      imageInput.value = '';
    }
    const genreSelect = document.getElementById('save-pattern-genre');
    if (genreSelect) genreSelect.value = '';
    document.getElementById('save-pattern-public')?.checked && (document.getElementById('save-pattern-public').checked = false);
    this.updateSelectedUsers();
    this.clearUserSearchResults();

    this.modal.style.display = 'flex';
    lockScroll('save-pattern-dialog');
  }

  /**
   * Hide modal
   */
  hide() {
    if (this.modal) {
      this.modal.style.display = 'none';
      unlockScroll('save-pattern-dialog');
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
      const genre = document.getElementById('save-pattern-genre')?.value.trim() || null;
      const isPublic = document.getElementById('save-pattern-public')?.checked || false;
      const imageUrl = document.getElementById('save-pattern-image')?.value.trim() || null;

      if (this.patternType === 'master') {
        if (!title) {
          alert('Track title is required.');
          return;
        }
        if (!artistName) {
          alert('Artist name is required.');
          return;
        }
      }

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

      // Remove master-injected modifiers (postgain, pan, fast, slow, cpm) before saving
      // These are added dynamically during playback but shouldn't be persisted
      // Use case-insensitive and global flags to catch ALL instances - critical to prevent duplicates
      let cleanedPattern = rawPattern;
      // Remove ALL instances of postgain() - loop until no more are found to handle nested/duplicated cases
      let previousPattern = '';
      while (previousPattern !== cleanedPattern) {
        previousPattern = cleanedPattern;
        cleanedPattern = cleanedPattern.replace(/\.postgain\s*\([^)]*\)/gi, '');
      }
      cleanedPattern = cleanedPattern.replace(/\.pan\s*\([^)]*\)/gi, '');
      cleanedPattern = cleanedPattern.replace(/\.fast\s*\([^)]*\)/gi, '');
      cleanedPattern = cleanedPattern.replace(/\.slow\s*\([^)]*\)/gi, '');
      cleanedPattern = cleanedPattern.replace(/\.cpm\s*\([^)]*\)/gi, '');
      // Clean up any double dots, trailing dots, or extra whitespace that might result
      cleanedPattern = cleanedPattern.replace(/\.\.+/g, '.').trim();
      cleanedPattern = cleanedPattern.replace(/\.+$/, '').trim();
      cleanedPattern = cleanedPattern.replace(/\s+\./g, '.');

      const metadata = {};
      if (imageUrl) {
        metadata.imageUrl = imageUrl;
      }

      const patternData = {
        type: this.patternType,
        elementId: this.elementId,
        patternCode: cleanedPattern,
        title,
        artistName,
        versionName,
        genre: this.patternType === 'master' ? genre : null, // Only set genre for master patterns
        isPublic,
        metadata: Object.keys(metadata).length ? metadata : undefined
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
      alert(this.patternType === 'master' ? 'Track saved successfully!' : 'Pattern saved successfully!');
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

