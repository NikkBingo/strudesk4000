/**
 * User Submissions Component
 * Displays and allows editing of all patterns and tracks submitted by the user
 */

import { patternsAPI, getCurrentUser } from '../api.js';
import { lockScroll, unlockScroll } from '../scrollLock.js';

export class UserSubmissions {
  constructor() {
    this.modal = null;
    this.user = null;
    this.patterns = [];
    this.currentEditingId = null;
  }

  /**
   * Initialize the submissions modal
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
      <div class="user-submissions-modal-overlay" id="user-submissions-modal-overlay" style="display: none;">
        <div class="user-submissions-modal">
          <div class="user-submissions-modal-header">
            <h2>My Submissions</h2>
            <button class="user-submissions-modal-close" id="user-submissions-modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="user-submissions-modal-body">
            <div class="user-submissions-tabs">
              <button class="user-submissions-tab active" data-tab="all">All</button>
              <button class="user-submissions-tab" data-tab="master">Tracks</button>
              <button class="user-submissions-tab" data-tab="channel">Patterns</button>
            </div>
            <div class="user-submissions-content">
              <div class="user-submissions-loading" id="user-submissions-loading" style="display: none;">
                <p>Loading your submissions...</p>
              </div>
              <div class="user-submissions-empty" id="user-submissions-empty" style="display: none;">
                <p>You haven't submitted any patterns or tracks yet.</p>
              </div>
              <div class="user-submissions-list" id="user-submissions-list"></div>
            </div>
          </div>
          <div class="user-submissions-modal-footer">
            <button
              type="button"
              class="user-submissions-footer-btn user-submissions-footer-btn--neutral"
              id="user-submissions-close-btn"
            >Close</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modal = document.getElementById('user-submissions-modal-overlay');
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Close button
    const closeBtn = document.getElementById('user-submissions-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    // Close footer button
    const closeFooterBtn = document.getElementById('user-submissions-close-btn');
    if (closeFooterBtn) {
      closeFooterBtn.addEventListener('click', () => this.hide());
    }

    // Overlay click
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) {
          this.hide();
        }
      });
    }

    // Tab switching
    const tabs = this.modal?.querySelectorAll('.user-submissions-tab');
    tabs?.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        this.switchTab(tabName);
      });
    });
  }

  /**
   * Switch between tabs
   */
  switchTab(tabName) {
    const tabs = this.modal?.querySelectorAll('.user-submissions-tab');
    tabs?.forEach(tab => {
      if (tab.dataset.tab === tabName) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    this.loadPatterns(tabName === 'all' ? null : tabName);
  }

  /**
   * Show modal and load patterns
   */
  async show(user) {
    if (!user) {
      user = await getCurrentUser();
    }

    if (!user) {
      alert('Please log in to view your submissions.');
      return;
    }

    this.user = user;
    this.currentEditingId = null;
    this.showModal();
    await this.loadPatterns();
  }

  /**
   * Load patterns from API
   */
  async loadPatterns(type = null) {
    const loadingEl = document.getElementById('user-submissions-loading');
    const emptyEl = document.getElementById('user-submissions-empty');
    const listEl = document.getElementById('user-submissions-list');

    if (loadingEl) loadingEl.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';
    if (listEl) listEl.innerHTML = '';

    try {
      // Get all patterns for the user
      const filters = {};
      if (type) {
        filters.type = type;
      }
      
      // Get patterns - when authenticated, API returns user's own patterns
      let allPatterns = await patternsAPI.getPatterns(filters);
      
      // Filter to only current user's patterns (API might return public ones too)
      allPatterns = allPatterns.filter(p => p.userId === this.user.id);

      this.patterns = allPatterns;

      if (loadingEl) loadingEl.style.display = 'none';

      if (allPatterns.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        if (listEl) listEl.innerHTML = '';
      } else {
        if (emptyEl) emptyEl.style.display = 'none';
        this.renderPatterns(allPatterns, listEl);
      }
    } catch (error) {
      console.error('Error loading patterns:', error);
      if (loadingEl) loadingEl.style.display = 'none';
      if (listEl) {
        listEl.innerHTML = `<p class="user-submissions-error">Error loading submissions: ${error.message || 'Unknown error'}</p>`;
      }
    }
  }

  /**
   * Render patterns list
   */
  renderPatterns(patterns, container) {
    if (!container) return;

    container.innerHTML = '';

    patterns.forEach(pattern => {
      const patternEl = this.createPatternElement(pattern);
      container.appendChild(patternEl);
    });
  }

  /**
   * Create pattern element
   */
  createPatternElement(pattern) {
    const div = document.createElement('div');
    div.className = 'user-submission-item';
    div.dataset.patternId = pattern.id;

    const isEditing = this.currentEditingId === pattern.id;
    const createdAt = new Date(pattern.createdAt).toLocaleDateString();
    const updatedAt = new Date(pattern.updatedAt).toLocaleDateString();
    const typeLabel = pattern.type === 'master' ? 'Track' : 'Pattern';
    const isPublic = pattern.isPublic ? 'Public' : 'Private';

    div.innerHTML = `
      <div class="user-submission-header">
        <div class="user-submission-info">
          <h3 class="user-submission-title">${pattern.title || 'Untitled'} <span class="user-submission-type">${typeLabel}</span></h3>
          <div class="user-submission-meta">
            <span class="user-submission-date">Created: ${createdAt}</span>
            <span class="user-submission-date">Updated: ${updatedAt}</span>
            <span class="user-submission-visibility">${isPublic}</span>
            ${pattern.version > 1 ? `<span class="user-submission-version">v${pattern.version}</span>` : ''}
            ${pattern.versionName ? `<span class="user-submission-version-name">${pattern.versionName}</span>` : ''}
          </div>
        </div>
        <div class="user-submission-actions">
          ${!isEditing ? `
            <button class="user-submission-btn user-submission-btn--edit" data-action="edit" data-pattern-id="${pattern.id}">Edit</button>
            <button class="user-submission-btn user-submission-btn--delete" data-action="delete" data-pattern-id="${pattern.id}">Delete</button>
          ` : `
            <button class="user-submission-btn user-submission-btn--save" data-action="save" data-pattern-id="${pattern.id}">Save</button>
            <button class="user-submission-btn user-submission-btn--cancel" data-action="cancel" data-pattern-id="${pattern.id}">Cancel</button>
          `}
        </div>
      </div>
      ${isEditing ? this.createEditForm(pattern) : this.createViewContent(pattern)}
    `;

    // Attach event listeners
    const editBtn = div.querySelector('[data-action="edit"]');
    const deleteBtn = div.querySelector('[data-action="delete"]');
    const saveBtn = div.querySelector('[data-action="save"]');
    const cancelBtn = div.querySelector('[data-action="cancel"]');

    if (editBtn) {
      editBtn.addEventListener('click', () => this.startEdit(pattern.id));
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => this.deletePattern(pattern.id));
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.savePattern(pattern.id));
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.cancelEdit(pattern.id));
    }

    return div;
  }

  /**
   * Create view content (non-editing)
   */
  createViewContent(pattern) {
    // Extract pattern code (remove metadata if present)
    let patternCode = pattern.patternCode || '';
    
    // Try to extract just the pattern code if it has metadata comments
    // Format: // Title: ... // Artist: ... // Version: ... // Pattern code: [code]
    const lines = patternCode.split('\n');
    let codeStart = 0;
    
    // Find where actual code starts (after "// Pattern code:" line)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('// Pattern code:')) {
        codeStart = i + 1;
        // Skip blank line if present
        if (codeStart < lines.length && lines[codeStart].trim() === '') {
          codeStart++;
        }
        break;
      }
    }
    
    if (codeStart > 0) {
      patternCode = lines.slice(codeStart).join('\n').trim();
    }

    return `
      <div class="user-submission-content">
        <div class="user-submission-field">
          <label>Title:</label>
          <div class="user-submission-value">${pattern.title || 'Untitled'}</div>
        </div>
        ${pattern.artistName ? `
          <div class="user-submission-field">
            <label>Artist:</label>
            <div class="user-submission-value">${pattern.artistName}</div>
          </div>
        ` : ''}
        ${pattern.genre ? `
          <div class="user-submission-field">
            <label>Genre:</label>
            <div class="user-submission-value">${pattern.genre}</div>
          </div>
        ` : ''}
        <div class="user-submission-field">
          <label>Pattern Code:</label>
          <pre class="user-submission-code">${this.escapeHtml(patternCode.substring(0, 200))}${patternCode.length > 200 ? '...' : ''}</pre>
        </div>
      </div>
    `;
  }

  /**
   * Create edit form
   */
  createEditForm(pattern) {
    // Extract pattern code (remove metadata if present)
    let patternCode = pattern.patternCode || '';
    
    // Try to extract just the pattern code if it has metadata comments
    const lines = patternCode.split('\n');
    let codeStart = 0;
    
    // Find where actual code starts (after "// Pattern code:" line)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('// Pattern code:')) {
        codeStart = i + 1;
        // Skip blank line if present
        if (codeStart < lines.length && lines[codeStart].trim() === '') {
          codeStart++;
        }
        break;
      }
    }
    
    if (codeStart > 0) {
      patternCode = lines.slice(codeStart).join('\n').trim();
    }

    return `
      <div class="user-submission-edit-form">
        <div class="user-submission-edit-field">
          <label for="edit-title-${pattern.id}">Title:</label>
          <input type="text" id="edit-title-${pattern.id}" value="${this.escapeHtml(pattern.title || '')}" />
        </div>
        ${pattern.type === 'master' ? `
          <div class="user-submission-edit-field">
            <label for="edit-genre-${pattern.id}">Genre:</label>
            <input type="text" id="edit-genre-${pattern.id}" value="${this.escapeHtml(pattern.genre || '')}" />
          </div>
        ` : ''}
        <div class="user-submission-edit-field">
          <label for="edit-isPublic-${pattern.id}">Visibility:</label>
          <select id="edit-isPublic-${pattern.id}">
            <option value="true" ${pattern.isPublic ? 'selected' : ''}>Public</option>
            <option value="false" ${!pattern.isPublic ? 'selected' : ''}>Private</option>
          </select>
        </div>
        <div class="user-submission-edit-field">
          <label for="edit-code-${pattern.id}">Pattern Code:</label>
          <textarea id="edit-code-${pattern.id}" rows="8" class="user-submission-code-input">${this.escapeHtml(patternCode)}</textarea>
        </div>
      </div>
    `;
  }

  /**
   * Start editing a pattern
   */
  startEdit(patternId) {
    this.currentEditingId = patternId;
    this.loadPatterns();
  }

  /**
   * Cancel editing
   */
  cancelEdit(patternId) {
    this.currentEditingId = null;
    this.loadPatterns();
  }

  /**
   * Save pattern changes
   */
  async savePattern(patternId) {
    const pattern = this.patterns.find(p => p.id === patternId);
    if (!pattern) return;

    const titleEl = document.getElementById(`edit-title-${patternId}`);
    const codeEl = document.getElementById(`edit-code-${patternId}`);
    const isPublicEl = document.getElementById(`edit-isPublic-${patternId}`);
    const genreEl = document.getElementById(`edit-genre-${patternId}`);

    if (!titleEl || !codeEl || !isPublicEl) {
      alert('Error: Form elements not found');
      return;
    }

    const title = titleEl.value.trim();
    let patternCode = codeEl.value.trim();
    const isPublic = isPublicEl.value === 'true';
    const genre = genreEl ? genreEl.value.trim() : null;

    if (!patternCode) {
      alert('Pattern code cannot be empty');
      return;
    }

    // Strip existing metadata comments before adding new ones
    // Remove ALL metadata formats:
    // - Old format: // "Title" @by Artist, // @version, // @copyright
    // - New format: // Title:, // Artist:, // Version:
    // - Pattern code marker: // Pattern code:
    // - Footer: // Made with Strudesk 4000
    const allLines = patternCode.split('\n');
    let codeStart = 0;
    let codeEnd = allLines.length;
    
    // Find where actual code starts (skip ALL comment/empty lines at start)
    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i].trim();
      // Skip comment lines and empty lines at the start
      if (line.startsWith('//') || line === '') {
        continue;
      }
      // Found code start
      codeStart = i;
      break;
    }
    
    // Find where code ends (remove ALL footer comments at end)
    // Work backwards and stop at last non-comment line
    for (let i = allLines.length - 1; i >= codeStart; i--) {
      const line = allLines[i].trim();
      // Skip empty lines and comment lines at the end
      if (line === '' || line.startsWith('//')) {
        continue;
      }
      // Found last line of actual code
      codeEnd = i + 1;
      break;
    }
    
    // Extract just the pattern code without ANY comments
    patternCode = allLines.slice(codeStart, codeEnd).join('\n').trim();

    try {
      // Format pattern code with metadata (similar to SavePatternDialog)
      const formattedCode = this.formatPatternWithMetadata({
        patternCode,
        title,
        artistName: pattern.artistName,
        version: pattern.version,
        versionName: pattern.versionName
      });

      const updateData = {
        title: title || null,
        patternCode: formattedCode,
        isPublic,
        ...(pattern.type === 'master' && genre !== null ? { genre } : {})
      };

      await patternsAPI.updatePattern(patternId, updateData);
      
      // Reload patterns
      this.currentEditingId = null;
      await this.loadPatterns();
    } catch (error) {
      console.error('Error saving pattern:', error);
      alert(`Error saving pattern: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Delete pattern
   */
  async deletePattern(patternId) {
    const pattern = this.patterns.find(p => p.id === patternId);
    if (!pattern) return;

    const title = pattern.title || 'Untitled';
    if (!confirm(`Are you sure you want to delete "${title}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await patternsAPI.deletePattern(patternId);
      await this.loadPatterns();
    } catch (error) {
      console.error('Error deleting pattern:', error);
      alert(`Error deleting pattern: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Format pattern with metadata (similar to SavePatternDialog)
   */
  formatPatternWithMetadata({ patternCode, title, artistName, version, versionName }) {
    const lines = [];
    
    // Add metadata header
    if (title && artistName) {
      lines.push(`// "${title}" @by ${artistName}`);
    } else if (title) {
      lines.push(`// "${title}"`);
    }
    
    if (version) {
      lines.push(`// @version ${version}`);
    }
    
    if (artistName) {
      lines.push(`// @copyright ${artistName}`);
    }
    
    // Add blank line between metadata and code
    lines.push('');
    
    // Add the pattern code (already cleaned)
    lines.push(patternCode);
    
    // Add footer
    lines.push('');
    lines.push('// Made with Strudesk 4000 by eKommissar.');
    
    return lines.join('\n');
  }

  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Show modal
   */
  showModal() {
    if (this.modal) {
      this.modal.style.display = 'flex';
      lockScroll();
    }
  }

  /**
   * Hide modal
   */
  hide() {
    if (this.modal) {
      this.modal.style.display = 'none';
      unlockScroll();
    }
    this.currentEditingId = null;
  }
}

