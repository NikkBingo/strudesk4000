import { usersAPI } from '../api.js';
import { lockScroll, unlockScroll } from '../scrollLock.js';

export class ProfileOnboardingModal {
  constructor() {
    this.modal = null;
    this.user = null;
    this.onComplete = null;
  }

  init() {
    this.createModal();
    this.attachEventListeners();
  }

  createModal() {
    const modalHTML = `
      <div class="profile-onboarding-overlay" id="profile-onboarding-overlay" style="display: none;">
        <div class="profile-onboarding-modal">
          <div class="profile-onboarding-header">
            <h2>Welcome! Let's complete your profile</h2>
            <p>Tell the community who you are. These details appear on your shared patterns.</p>
          </div>
          <form id="profile-onboarding-form" class="profile-onboarding-form">
            <div class="form-group">
              <label for="onboarding-name">Display Name</label>
              <input type="text" id="onboarding-name" placeholder="Your full name" required />
            </div>
            <div class="form-group">
              <label for="onboarding-artist">Artist / Producer Name</label>
              <input type="text" id="onboarding-artist" placeholder="e.g., Neon Skyline" required />
              <small>This name is shown on saved patterns. You can change it later.</small>
            </div>
            <div class="form-group">
              <label for="onboarding-avatar">Profile Image URL (optional)</label>
              <input type="url" id="onboarding-avatar" placeholder="https://example.com/avatar.jpg" />
            </div>
            <div class="profile-onboarding-actions">
              <button type="submit" class="btn-save">Save & Continue</button>
            </div>
            <div class="profile-onboarding-status" id="profile-onboarding-status"></div>
          </form>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modal = document.getElementById('profile-onboarding-overlay');
  }

  attachEventListeners() {
    const form = document.getElementById('profile-onboarding-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.saveProfile();
      });
    }
  }

  async saveProfile() {
    if (!this.user) return;
    const statusEl = document.getElementById('profile-onboarding-status');
    const name = document.getElementById('onboarding-name')?.value.trim();
    const artistName = document.getElementById('onboarding-artist')?.value.trim();
    const avatarUrl = document.getElementById('onboarding-avatar')?.value.trim() || null;

    if (!name || !artistName) {
      if (statusEl) statusEl.textContent = 'Please fill in both required fields.';
      return;
    }

    try {
      if (statusEl) {
        statusEl.textContent = 'Saving...';
      }
      const updated = await usersAPI.updateUser(this.user.id, {
        name,
        artistName,
        avatarUrl,
        profileCompleted: true
      });
      if (statusEl) {
        statusEl.textContent = 'Profile updated!';
      }
      this.hide();
      if (this.onComplete) {
        this.onComplete(updated);
      }
    } catch (error) {
      console.error('Onboarding save error:', error);
      if (statusEl) {
        statusEl.textContent = error.message || 'Failed to save profile.';
      }
    }
  }

  async show(user) {
    this.user = user;
    if (this.modal) {
      const nameInput = document.getElementById('onboarding-name');
      const artistInput = document.getElementById('onboarding-artist');
      const avatarInput = document.getElementById('onboarding-avatar');
      const statusEl = document.getElementById('profile-onboarding-status');

      if (nameInput) nameInput.value = user?.name || '';
      if (artistInput) artistInput.value = user?.artistName || '';
      if (avatarInput) avatarInput.value = user?.avatarUrl || '';
      if (statusEl) statusEl.textContent = '';

      this.modal.style.display = 'flex';
      lockScroll('profile-onboarding-modal');
    }
  }

  hide() {
    if (this.modal) {
      this.modal.style.display = 'none';
      unlockScroll('profile-onboarding-modal');
    }
  }

  setOnComplete(callback) {
    this.onComplete = callback;
  }
}

