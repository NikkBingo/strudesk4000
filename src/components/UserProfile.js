/**
 * User Profile Component
 * Handles user profile editing with social media links and artist name
 */

import { usersAPI, getCurrentUser, authAPI } from '../api.js';
import { lockScroll, unlockScroll } from '../scrollLock.js';

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
              <div class="form-group" id="profile-avatar-group">
                <label for="profile-avatar-url">Profile Image</label>
                <div class="avatar-preview-container">
                  <img id="profile-avatar-preview" src="" alt="Avatar preview" style="display: none; width: 100px; height: 100px; border-radius: 50%; object-fit: cover; margin-bottom: 10px; border: 2px solid #ddd;" />
                  <input type="url" id="profile-avatar-url" placeholder="https://example.com/your-image.jpg" />
                  <small id="profile-avatar-note">Enter a URL to your profile image</small>
                  <small id="profile-avatar-provider-note" style="display: none;">Your profile image is managed by Google and can be changed from your Google Account.</small>
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
                    <label for="social-facebook">Meta/Facebook</label>
                    <input type="url" id="social-facebook" placeholder="https://facebook.com/username" />
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
                  <p><strong>Display Name:</strong> <span id="profile-display-name"></span></p>
                  <p><strong>Joined:</strong> <span id="profile-display-joined"></span></p>
                </div>
              </div>

              <div class="user-profile-optional">
                <div class="user-profile-optional-header">
                  <h3>Personal details (optional)</h3>
                  <p>These details stay private and help us personalize your experience.</p>
                </div>
                <div class="user-profile-optional-grid">
                  <div class="form-group user-profile-email-field">
                    <label>Email</label>
                    <div class="user-profile-email" id="profile-email-display">—</div>
                  </div>
                  <div class="form-group">
                    <label for="profile-first-name">First name</label>
                    <input type="text" id="profile-first-name" placeholder="First name" />
                  </div>
                  <div class="form-group">
                    <label for="profile-last-name">Last name</label>
                    <input type="text" id="profile-last-name" placeholder="Last name" />
                  </div>
                  <div class="form-group">
                    <label for="profile-birth-date">Birth date</label>
                    <input type="date" id="profile-birth-date" />
                  </div>
                  <div class="form-group">
                    <label for="profile-city">City</label>
                    <input type="text" id="profile-city" placeholder="City" />
                  </div>
                  <div class="form-group">
                    <label for="profile-country">Country</label>
                    <input type="text" id="profile-country" placeholder="Country" />
                  </div>
                </div>
              </div>

              <div class="user-profile-modal-footer">
                <button
                  type="button"
                  class="user-profile-footer-btn user-profile-footer-btn--danger"
                  id="profile-delete-account-btn"
                >Delete Account</button>
                <button
                  type="button"
                  class="user-profile-footer-btn user-profile-footer-btn--neutral"
                  id="profile-cancel-btn"
                >Cancel</button>
                <button
                  type="submit"
                  class="user-profile-footer-btn user-profile-footer-btn--primary"
                  id="profile-save-btn"
                >Save Changes</button>
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
      let user = this.user;
      if (!user) {
        user = await getCurrentUser();
        console.log('loadUserData: fetched user via API:', user);
      } else {
        console.log('loadUserData: using existing user:', user);
      }
      if (!user) {
        throw new Error('Not authenticated');
      }

      if (!user.id) {
        throw new Error('User object missing ID');
      }

      // Set user immediately so saveProfile can work even if fetch fails
      this.user = user;
      console.log('loadUserData: this.user set to:', this.user);

      // Load user data - use current user data if getUser fails
      let fullUser = user;
      try {
        fullUser = await usersAPI.getUser(user.id);
        if (fullUser && user.oauthProvider && !fullUser.oauthProvider) {
          fullUser.oauthProvider = user.oauthProvider;
        }
        // Update this.user with full user data
        this.user = fullUser;
      } catch (fetchError) {
        console.warn('Failed to fetch full user data, using current user data:', fetchError);
        // Continue with the user data we already have from getCurrentUser
        // this.user is already set above
      }

      // Ensure we have a user object before populating form
      if (!this.user) {
        throw new Error('No user data available');
      }

      // Populate form
      const avatarUrlInput = document.getElementById('profile-avatar-url');
      const avatarPreview = document.getElementById('profile-avatar-preview');
      if (avatarUrlInput) {
        avatarUrlInput.value = this.user.avatarUrl || '';
        
        // Update preview when URL changes (only add listener once)
        if (!avatarUrlInput.dataset.listenerAttached) {
          avatarUrlInput.dataset.listenerAttached = 'true';
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
        }
        
        // Initial preview
        if (this.user.avatarUrl && avatarPreview) {
          avatarPreview.src = this.user.avatarUrl;
          avatarPreview.style.display = 'block';
          avatarPreview.onerror = () => {
            avatarPreview.style.display = 'none';
          };
        } else if (avatarPreview) {
          avatarPreview.style.display = 'none';
        }
      }

      this.updateAvatarFieldState();

      const artistNameInput = document.getElementById('profile-artist-name');
      if (artistNameInput) {
        artistNameInput.value = this.user.artistName || '';
      }

      const displayName = document.getElementById('profile-display-name');
      if (displayName) {
        // Show Artist name if available, otherwise show name
        const displayNameValue = this.user.artistName || this.user.name || 'Not set';
        displayName.textContent = displayNameValue;
      }

      const displayJoined = document.getElementById('profile-display-joined');
      if (displayJoined && this.user.createdAt) {
        const joinedDate = new Date(this.user.createdAt);
        displayJoined.textContent = joinedDate.toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      } else if (displayJoined) {
        displayJoined.textContent = 'Unknown';
      }

      const emailDisplay = document.getElementById('profile-email-display');
      if (emailDisplay) {
        emailDisplay.textContent = this.user.email || 'Not set';
      }

      const firstNameInput = document.getElementById('profile-first-name');
      if (firstNameInput) {
        firstNameInput.value = this.user.firstName || '';
      }

      const lastNameInput = document.getElementById('profile-last-name');
      if (lastNameInput) {
        lastNameInput.value = this.user.lastName || '';
      }

      const cityInput = document.getElementById('profile-city');
      if (cityInput) {
        cityInput.value = this.user.city || '';
      }

      const countryInput = document.getElementById('profile-country');
      if (countryInput) {
        countryInput.value = this.user.country || '';
      }

      const birthDateInput = document.getElementById('profile-birth-date');
      if (birthDateInput) {
        if (this.user.birthDate) {
          const birthDate = new Date(this.user.birthDate);
          if (!Number.isNaN(birthDate.getTime())) {
            birthDateInput.value = birthDate.toISOString().split('T')[0];
          } else {
            birthDateInput.value = '';
          }
        } else {
          birthDateInput.value = '';
        }
      }

      // Load social links
      const socialLinks = this.user.socialLinks || {};
      const socialFields = ['twitter', 'facebook', 'instagram', 'soundcloud', 'bandcamp', 'youtube', 'spotify', 'website'];
      socialFields.forEach(field => {
        const input = document.getElementById(`social-${field}`);
        if (input) {
          input.value = socialLinks[field] || '';
        }
      });

      return this.user;
    } catch (error) {
      console.error('Error loading user data:', error);
      // Only show alert if we don't have any user data at all
      if (!this.user) {
        alert('Failed to load profile data: ' + (error.message || 'Unknown error'));
      }
      return this.user || null;
    }
  }

  isAvatarManagedExternally() {
    return this.user?.oauthProvider === 'google';
  }

  updateAvatarFieldState() {
    const avatarGroup = document.getElementById('profile-avatar-group');
    const avatarInput = document.getElementById('profile-avatar-url');
    const defaultNote = document.getElementById('profile-avatar-note');
    const providerNote = document.getElementById('profile-avatar-provider-note');
    const avatarPreview = document.getElementById('profile-avatar-preview');
    const isLocked = this.isAvatarManagedExternally();

    if (!avatarGroup) return;

    avatarGroup.classList.toggle('is-locked', isLocked);

    if (isLocked) {
      if (avatarInput) {
        avatarInput.disabled = true;
        avatarInput.style.display = 'none';
      }
      if (defaultNote) defaultNote.style.display = 'none';
      if (providerNote) providerNote.style.display = 'block';
      if (avatarPreview) {
        if (this.user?.avatarUrl) {
          avatarPreview.src = this.user.avatarUrl;
          avatarPreview.style.display = 'block';
        } else {
          avatarPreview.style.display = 'none';
        }
      }
    } else {
      if (avatarInput) {
        avatarInput.disabled = false;
        avatarInput.style.display = '';
      }
      if (defaultNote) defaultNote.style.display = 'block';
      if (providerNote) providerNote.style.display = 'none';
    }
  }

  /**
   * Save profile
   */
  async saveProfile() {
    console.log('saveProfile called, this.user =', this.user);
    
    // First verify authentication and get fresh user data
    let currentUser;
    try {
      currentUser = await getCurrentUser();
      if (!currentUser || !currentUser.id) {
        alert('Your session has expired. Please log in again.');
        window.location.reload();
        return;
      }
    } catch (error) {
      console.error('saveProfile: Failed to verify authentication:', error);
      alert('Your session has expired. Please log in again.');
      window.location.reload();
      return;
    }

    // Use the authenticated user's ID instead of potentially stale this.user
    const userIdToUpdate = currentUser.id;
    
    // Reload user data to ensure we have the latest
    if (!this.user || this.user.id !== userIdToUpdate) {
      try {
        await this.loadUserData();
        // If loadUserData still doesn't have the right user, use currentUser
        if (!this.user || this.user.id !== userIdToUpdate) {
          this.user = currentUser;
        }
      } catch (error) {
        console.warn('saveProfile: Failed to reload user data, using current user:', error);
        this.user = currentUser;
      }
    }

    if (!this.user || !this.user.id) {
      console.error('saveProfile: User ID missing', this.user);
      alert('User ID missing. Please try logging in again.');
      return;
    }

    // Verify the user ID matches the authenticated user
    if (this.user.id !== userIdToUpdate) {
      alert('You can only edit your own profile. Please refresh the page.');
      return;
    }

    try {
      const avatarInputEl = document.getElementById('profile-avatar-url');
      const avatarUrlValue = avatarInputEl ? avatarInputEl.value.trim() : '';
      const artistName = document.getElementById('profile-artist-name')?.value.trim() || null;
      const firstNameValue = document.getElementById('profile-first-name')?.value.trim() || '';
      const lastNameValue = document.getElementById('profile-last-name')?.value.trim() || '';
      const birthDateValue = document.getElementById('profile-birth-date')?.value || '';
      const cityValue = document.getElementById('profile-city')?.value.trim() || '';
      const countryValue = document.getElementById('profile-country')?.value.trim() || '';
      
      // Collect social links
      const socialLinks = {};
      const socialFields = ['twitter', 'facebook', 'instagram', 'soundcloud', 'bandcamp', 'youtube', 'spotify', 'website'];
      socialFields.forEach(field => {
        const input = document.getElementById(`social-${field}`);
        if (input && input.value.trim()) {
          socialLinks[field] = input.value.trim();
        }
      });

      const normalizeText = (value) => {
        const trimmed = value?.trim();
        return trimmed ? trimmed : null;
      };

      let birthDateIso = null;
      if (birthDateValue) {
        const parsed = new Date(birthDateValue);
        if (!Number.isNaN(parsed.getTime())) {
          birthDateIso = parsed.toISOString();
        }
      }

      const payload = {
        artistName,
        socialLinks,
        firstName: normalizeText(firstNameValue),
        lastName: normalizeText(lastNameValue),
        city: normalizeText(cityValue),
        country: normalizeText(countryValue),
        birthDate: birthDateValue ? birthDateIso : null
      };

      if (!this.isAvatarManagedExternally()) {
        payload.avatarUrl = avatarUrlValue ? avatarUrlValue : null;
      }

      // Update user - use verified user ID
      const updated = await usersAPI.updateUser(userIdToUpdate, payload);

      this.user = updated;
      
      if (this.onUpdate) {
        this.onUpdate(updated);
      }

      this.hide();
      alert('Profile updated successfully!');
    } catch (error) {
      console.error('Error saving profile:', error);
      if (error.status === 401) {
        alert('Your session has expired. Please log in again.');
        window.location.reload();
      } else {
        alert('Failed to save profile: ' + (error.message || 'Unknown error'));
      }
    }
  }

  /**
   * Show modal
   */
  async show(userOverride = null) {
    if (!this.modal) {
      console.error('Profile modal not initialized');
      return;
    }

    try {
      if (!userOverride && !this.user) {
        const current = await getCurrentUser();
        if (!current) {
          throw new Error('Please log in to view your profile.');
        }
        this.user = current;
      }
      if (userOverride) {
        this.user = userOverride;
      }
      const userData = await this.loadUserData();
      if (!userData && !this.user) {
        alert('Unable to load user profile. Please try logging in again.');
        return;
      }
      this.modal.style.display = 'flex';
      lockScroll('user-profile-modal');
    } catch (error) {
      console.error('Error showing profile modal:', error);
      if (!this.user) {
        alert('Failed to load profile: ' + (error.message || 'Unknown error'));
      }
    }
  }

  /**
   * Hide modal
   */
  hide() {
    if (this.modal) {
      this.modal.style.display = 'none';
      unlockScroll('user-profile-modal');
    }
  }

  /**
   * Set callback for profile update
   */
  setOnUpdate(callback) {
    this.onUpdate = callback;
  }
}

