/**
 * User Profiles Listing Component
 * Displays a searchable list of all user profiles
 */

import { usersAPI } from '../api.js';

export class UserProfilesListing {
  constructor() {
    this.modal = null;
    this.users = [];
    this.searchTimeout = null;
  }

  /**
   * Initialize the profiles listing modal
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
      <div class="user-profiles-modal-overlay" id="user-profiles-modal-overlay" style="display: none;">
        <div class="user-profiles-modal">
          <div class="user-profiles-modal-header">
            <h2>User Profiles</h2>
            <button class="user-profiles-modal-close" id="user-profiles-modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="user-profiles-modal-body">
            <div class="profiles-search-container">
              <input 
                type="text" 
                id="profiles-search-input" 
                placeholder="Search users by name, email, or artist name..." 
                class="profiles-search-input"
              />
            </div>
            <div class="profiles-list" id="profiles-list">
              <div class="profiles-loading">Loading profiles...</div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modal = document.getElementById('user-profiles-modal-overlay');
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Close button
    const closeBtn = document.getElementById('user-profiles-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    // Overlay click
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) {
          this.hide();
        }
      });
    }

    // Search input
    const searchInput = document.getElementById('profiles-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        // Debounce search
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
          this.loadUsers(query);
        }, 300);
      });
    }
  }

  /**
   * Load users from API
   */
  async loadUsers(search = '') {
    const listContainer = document.getElementById('profiles-list');
    if (!listContainer) return;

    try {
      listContainer.innerHTML = '<div class="profiles-loading">Loading profiles...</div>';
      
      const users = await usersAPI.listUsers(search, 100);
      this.users = users;

      if (users.length === 0) {
        listContainer.innerHTML = '<div class="profiles-empty">No users found.</div>';
        return;
      }

      listContainer.innerHTML = users.map(user => this.renderUserCard(user)).join('');
    } catch (error) {
      console.error('Error loading users:', error);
      listContainer.innerHTML = '<div class="profiles-error">Failed to load profiles. Please try again.</div>';
    }
  }

  /**
   * Render a user card
   */
  renderUserCard(user) {
    const avatarUrl = user.avatarUrl || 'https://via.placeholder.com/80?text=' + encodeURIComponent(user.name.charAt(0).toUpperCase());
    const artistName = user.artistName ? `<div class="user-card-artist">${this.escapeHtml(user.artistName)}</div>` : '';
    const patternCount = user._count?.patterns || 0;
    const socialLinks = user.socialLinks || {};
    const socialLinksHtml = this.renderSocialLinks(socialLinks);

    return `
      <div class="user-card" data-user-id="${user.id}">
        <div class="user-card-avatar">
          <img src="${avatarUrl}" alt="${this.escapeHtml(user.name)}" onerror="this.src='https://via.placeholder.com/80?text=' + encodeURIComponent('${this.escapeHtml(user.name.charAt(0).toUpperCase())}')" />
        </div>
        <div class="user-card-info">
          <div class="user-card-name">${this.escapeHtml(user.name)}</div>
          ${artistName}
          <div class="user-card-email">${this.escapeHtml(user.email)}</div>
          <div class="user-card-stats">
            <span class="user-card-patterns">${patternCount} pattern${patternCount !== 1 ? 's' : ''}</span>
          </div>
          ${socialLinksHtml}
        </div>
      </div>
    `;
  }

  /**
   * Render social links
   */
  renderSocialLinks(socialLinks) {
    const links = [];
    const icons = {
      twitter: '🐦',
      instagram: '📷',
      soundcloud: '🎵',
      bandcamp: '💿',
      youtube: '▶️',
      spotify: '🎧',
      website: '🌐'
    };

    Object.entries(socialLinks).forEach(([key, url]) => {
      if (url) {
        links.push(`<a href="${this.escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="user-card-social-link" title="${key}">${icons[key] || '🔗'}</a>`);
      }
    });

    if (links.length === 0) return '';
    return `<div class="user-card-social">${links.join('')}</div>`;
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
  async show() {
    if (this.modal) {
      this.modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      // Load users when showing
      await this.loadUsers();
      // Focus search input
      const searchInput = document.getElementById('profiles-search-input');
      if (searchInput) {
        setTimeout(() => searchInput.focus(), 100);
      }
    }
  }

  /**
   * Hide modal
   */
  hide() {
    if (this.modal) {
      this.modal.style.display = 'none';
      document.body.style.overflow = '';
      // Clear search
      const searchInput = document.getElementById('profiles-search-input');
      if (searchInput) {
        searchInput.value = '';
      }
    }
  }
}

