/**
 * User Profile Component
 * Handles user profile editing with social media links and artist name
 */

import { usersAPI, getCurrentUser, authAPI } from '../api.js';

export class UserProfile {
  constructor() {
    this.modal = null;
    this.user = null;
    this.onUpdate = null;
  }

  /**
   * Initialize the profile modal
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
      <div class="user-profile-modal-overlay" id="user-profile-modal-overlay" style="display: none;">
        <div class="user-profile-modal">
          <div class="user-profile-modal-header">
            <h2>Edit Profile</h2>
            <button class="user-profile-modal-close" id="user-profile-modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="user-profile-modal-body">
            <form id="user-profile-form">
              <div class="form-group">
                <label for="profile-avatar-url">Profile Image</label>
                <div class="avatar-preview-container">
                  <img id="profile-avatar-preview" src="" alt="Avatar preview" style="display: none; width: 100px; height: 100px; border-radius: 50%; object-fit: cover; margin-bottom: 10px; border: 2px solid #ddd;" />
                  <input type="url" id="profile-avatar-url" placeholder="https://example.com/your-image.jpg" />
                  <small>Enter a URL to your profile image</small>
                </div>
              </div>

              <div class="form-group">
                <label for="profile-artist-name">Artist Name (Pseudonym)</label>
                <input type="text" id="profile-artist-name" placeholder="Your artist name or pseudonym" />
                <small>This will be used as the default copyright holder for your patterns</small>
              </div>

              <div class="form-group">
                <label>Social Media Links</label>
                <div class="social-links-grid">
                  <div class="social-link-item">
                    <label for="social-twitter">Twitter/X</label>
                    <input type="url" id="social-twitter" placeholder="https://twitter.com/username" />
                  </div>
                  <div class="social-link-item">
                    <label for="social-instagram">Instagram</label>
                    <input type="url" id="social-instagram" placeholder="https://instagram.com/username" />
                  </div>
                  <div class="social-link-item">
                    <label for="social-soundcloud">SoundCloud</label>
                    <input type="url" id="social-soundcloud" placeholder="https://soundcloud.com/username" />
                  </div>
                  <div class="social-link-item">
                    <label for="social-bandcamp">Bandcamp</label>
                    <input type="url" id="social-bandcamp" placeholder="https://username.bandcamp.com" />
                  </div>
                  <div class="social-link-item">
                    <label for="social-youtube">YouTube</label>
                    <input type="url" id="social-youtube" placeholder="https://youtube.com/@username" />
                  </div>
                  <div class="social-link-item">
                    <label for="social-spotify">Spotify</label>
                    <input type="url" id="social-spotify" placeholder="https://open.spotify.com/artist/..." />
                  </div>
                  <div class="social-link-item">
                    <label for="social-website">Website</label>
                    <input type="url" id="social-website" placeholder="https://yourwebsite.com" />
                  </div>
                </div>
              </div>

              <div class="form-group">
                <div class="user-profile-info">
                  <p><strong>Name:</strong> <span id="profile-display-name"></span></p>
                  <p><strong>Email:</strong> <span id="profile-display-email"></span></p>
                </div>
              </div>

              <div class="user-profile-modal-footer">
                <div>
                  <button type="button" class="btn-danger" id="profile-delete-account-btn">Delete Account</button>
                </div>
                <div>
                  <button type="button" class="btn-cancel" id="profile-cancel-btn">Cancel</button>
                  <button type="submit" class="btn-save" id="profile-save-btn">Save Changes</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modal = document.getElementById('user-profile-modal-overlay');
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Close button
    const closeBtn = document.getElementById('user-profile-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }

    const deleteBtn = document.getElementById('profile-delete-account-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (!confirm('Delete your account and all patterns? This action cannot be undone.')) return;
        try {
          await authAPI.deleteAccount();
          window.location.reload();
        } catch (error) {
          console.error('Delete account error:', error);
          alert(error.message || 'Failed to delete account');
        }
      });
    }

    // Cancel button
    const cancelBtn = document.getElementById('profile-cancel-btn');
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
    const form = document.getElementById('user-profile-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.saveProfile();
      });
    }
  }

  /**
   * Load user data into form
   */
  async loadUserData() {
    try {
      const user = await getCurrentUser();
      if (!user) {
        throw new Error('Not authenticated');
      }

      this.user = user;

      // Load user data
      const fullUser = await usersAPI.getUser(user.id);
      this.user = fullUser;

      // Populate form
      const avatarUrlInput = document.getElementById('profile-avatar-url');
      const avatarPreview = document.getElementById('profile-avatar-preview');
      if (avatarUrlInput) {
        avatarUrlInput.value = fullUser.avatarUrl || '';
        // Update preview when URL changes
        avatarUrlInput.addEventListener('input', (e) => {
          const url = e.target.value.trim();
          if (avatarPreview) {
            if (url) {
              avatarPreview.src = url;
              avatarPreview.style.display = 'block';
              avatarPreview.onerror = () => {
                avatarPreview.style.display = 'none';
              };
            } else {
              avatarPreview.style.display = 'none';
            }
          }
        });
        // Initial preview
        if (fullUser.avatarUrl && avatarPreview) {
          avatarPreview.src = fullUser.avatarUrl;
          avatarPreview.style.display = 'block';
          avatarPreview.onerror = () => {
            avatarPreview.style.display = 'none';
          };
        }
      }

      const artistNameInput = document.getElementById('profile-artist-name');
      if (artistNameInput) {
        artistNameInput.value = fullUser.artistName || '';
      }

      const displayName = document.getElementById('profile-display-name');
      if (displayName) {
        displayName.textContent = fullUser.name;
      }

      const displayEmail = document.getElementById('profile-display-email');
      if (displayEmail) {
        displayEmail.textContent = fullUser.email;
      }

      // Load social links
      const socialLinks = fullUser.socialLinks || {};
      const socialFields = ['twitter', 'instagram', 'soundcloud', 'bandcamp', 'youtube', 'spotify', 'website'];
      socialFields.forEach(field => {
        const input = document.getElementById(`social-${field}`);
        if (input) {
          input.value = socialLinks[field] || '';
        }
      });

      return fullUser;
    } catch (error) {
      console.error('Error loading user data:', error);
      alert('Failed to load profile data');
      return null;
    }
  }

  /**
   * Save profile
   */
  async saveProfile() {
    if (!this.user) {
      alert('User not loaded');
      return;
    }

    try {
      const avatarUrl = document.getElementById('profile-avatar-url')?.value.trim() || null;
      const artistName = document.getElementById('profile-artist-name')?.value.trim() || null;
      
      // Collect social links
      const socialLinks = {};
      const socialFields = ['twitter', 'instagram', 'soundcloud', 'bandcamp', 'youtube', 'spotify', 'website'];
      socialFields.forEach(field => {
        const input = document.getElementById(`social-${field}`);
        if (input && input.value.trim()) {
          socialLinks[field] = input.value.trim();
        }
      });

      // Update user
      const updated = await usersAPI.updateUser(this.user.id, {
        avatarUrl,
        artistName,
        socialLinks
      });

      this.user = updated;
      
      if (this.onUpdate) {
        this.onUpdate(updated);
      }

      this.hide();
      alert('Profile updated successfully!');
    } catch (error) {
      console.error('Error saving profile:', error);
      alert('Failed to save profile: ' + (error.message || 'Unknown error'));
    }
  }

  /**
   * Show modal
   */
  async show() {
    if (this.modal) {
      await this.loadUserData();
      this.modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
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
   * Set callback for profile update
   */
  setOnUpdate(callback) {
    this.onUpdate = callback;
  }
}

