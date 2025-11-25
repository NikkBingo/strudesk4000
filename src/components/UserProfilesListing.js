/**
 * User Profiles Listing Component
 * Displays a searchable list of all user profiles
 */

import { usersAPI } from '../api.js';
import { lockScroll, unlockScroll } from '../scrollLock.js';

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
    const displayName = (user.artistName && user.artistName.trim()) || user.name || user.email || 'Unnamed Artist';
    const avatarFallback = displayName.charAt(0).toUpperCase();
    const avatarUrl = user.avatarUrl || 'https://via.placeholder.com/80?text=' + encodeURIComponent(avatarFallback);
    const patternCount = user._count?.patterns || 0;
    const socialLinks = user.socialLinks || {};
    const socialLinksHtml = this.renderSocialLinks(socialLinks);
    
    // Format date joined
    let dateJoinedHtml = '';
    if (user.createdAt) {
      const joinedDate = new Date(user.createdAt);
      const formattedDate = joinedDate.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      dateJoinedHtml = `<div class="user-card-date">Joined ${formattedDate}</div>`;
    }

    return `
      <div class="user-card" data-user-id="${user.id}">
        <div class="user-card-avatar">
          <img src="${avatarUrl}" alt="${this.escapeHtml(displayName)}" onerror="this.src='https://via.placeholder.com/80?text=' + encodeURIComponent('${this.escapeHtml(avatarFallback)}')" />
        </div>
        <div class="user-card-info">
          <div class="user-card-name">${this.escapeHtml(displayName)}</div>
          ${dateJoinedHtml}
          <div class="user-card-stats">
            <span class="user-card-patterns">${patternCount} pattern${patternCount !== 1 ? 's' : ''}</span>
          </div>
          ${socialLinksHtml}
        </div>
      </div>
    `;
  }

  /**
   * Get SVG icon for social platform
   */
  getSocialIcon(platform) {
    const icons = {
      twitter: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
      facebook: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
      instagram: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`,
      soundcloud: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M17.707 8.274A4.36 4.36 0 0 0 13.638 6a4.35 4.35 0 0 0-.947.112 4.989 4.989 0 0 0-9.79.654A3.52 3.52 0 0 0 3.507 16H19.23a3.307 3.307 0 1 0 .558-6.632h-.013a4.33 4.33 0 0 0-2.068-1.094z"/></svg>`,
      bandcamp: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M2.4 6h7.4l5.8 6-5.8 6H2.4l5.8-6z"/></svg>`,
      youtube: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
      spotify: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.84-.179-.84-.66 0-.419.36-.66.78-.54 4.56 1.021 8.52 1.561 11.64 1.92.42.06.66.36.6.78zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.3.421-1.02.599-1.56.3z"/></svg>`,
      website: `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM18.92 8h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg>`
    };
    return icons[platform] || `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>`;
  }

  /**
   * Render social links
   */
  renderSocialLinks(socialLinks) {
    const links = [];

    Object.entries(socialLinks).forEach(([key, url]) => {
      if (url) {
        const icon = this.getSocialIcon(key);
        links.push(`<a href="${this.escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="user-card-social-link" title="${key}">${icon}</a>`);
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
      lockScroll('user-profiles-modal');
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
      unlockScroll('user-profiles-modal');
      // Clear search
      const searchInput = document.getElementById('profiles-search-input');
      if (searchInput) {
        searchInput.value = '';
      }
    }
  }
}

