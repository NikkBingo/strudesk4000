import { authAPI } from '../api.js';

/**
 * Login Modal Component
 * Handles email/password auth plus Google OAuth
 */

export class LoginModal {
  constructor() {
    this.modal = null;
    this.onLoginSuccess = null;
    this.activeForm = 'login';
    this.statusEl = null;
  }

  init() {
    this.createModal();
    this.attachEventListeners();
    this.checkAuthStatus();
  }

  createModal() {
    const modalHTML = `
      <div class="login-modal-overlay" id="login-modal-overlay" style="display: none;">
        <div class="login-modal">
          <div class="login-modal-header">
            <h2>Sign in to Strudesk 4000</h2>
            <button class="login-modal-close" id="login-modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="login-modal-body">
            <div class="login-tabs">
              <button type="button" class="login-tab active" data-auth-tab="login">Login</button>
              <button type="button" class="login-tab" data-auth-tab="signup">Create account</button>
            </div>

            <form id="login-email-form" data-auth-form="login" class="auth-form auth-form-active">
              <div class="form-group">
                <label for="login-email">Email</label>
                <input type="email" id="login-email" required placeholder="you@example.com" />
              </div>
              <div class="form-group">
                <label for="login-password">Password</label>
                <input type="password" id="login-password" required placeholder="••••••••" />
              </div>
              <button type="submit" class="btn-primary">Login</button>
              <div class="auth-links">
                <button type="button" data-show-form="reset-request">Forgot password?</button>
                <button type="button" data-show-form="verify-email">Verify email</button>
              </div>
            </form>

            <form id="signup-email-form" data-auth-form="signup" class="auth-form">
              <div class="form-group">
                <label for="signup-name">Name</label>
                <input type="text" id="signup-name" placeholder="Display name" />
              </div>
              <div class="form-group">
                <label for="signup-email">Email</label>
                <input type="email" id="signup-email" required placeholder="you@example.com" />
              </div>
              <div class="form-group">
                <label for="signup-password">Password</label>
                <input type="password" id="signup-password" required placeholder="Create a password" />
              </div>
              <button type="submit" class="btn-primary">Create account</button>
            </form>

            <form id="verify-email-form" data-auth-form="verify-email" class="auth-form">
              <div class="form-group">
                <label for="verify-token">Verification token</label>
                <input type="text" id="verify-token" placeholder="Paste token here" required />
              </div>
              <button type="submit" class="btn-primary">Verify email</button>
              <div class="auth-links">
                <button type="button" data-show-form="login">Back to login</button>
                <button type="button" data-resend-verification>Resend verification email</button>
              </div>
            </form>

            <form id="reset-request-form" data-auth-form="reset-request" class="auth-form">
              <div class="form-group">
                <label for="reset-email">Email</label>
                <input type="email" id="reset-email" required placeholder="you@example.com" />
              </div>
              <button type="submit" class="btn-primary">Send reset link</button>
              <div class="auth-links">
                <button type="button" data-show-form="reset-password">Have a reset token?</button>
                <button type="button" data-show-form="login">Back to login</button>
              </div>
            </form>

            <form id="reset-password-form" data-auth-form="reset-password" class="auth-form">
              <div class="form-group">
                <label for="reset-token">Reset token</label>
                <input type="text" id="reset-token" required placeholder="Token from email" />
              </div>
              <div class="form-group">
                <label for="reset-new-password">New password</label>
                <input type="password" id="reset-new-password" required placeholder="New password" />
              </div>
              <button type="submit" class="btn-primary">Update password</button>
              <div class="auth-links">
                <button type="button" data-show-form="login">Back to login</button>
              </div>
            </form>

            <div class="auth-status" id="login-status-message"></div>

            <div class="login-separator"><span>or</span></div>

            <div class="login-buttons">
              <button class="login-button login-button-google" id="login-google">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.965-2.18l-2.908-2.258c-.806.54-1.837.86-3.057.86-2.35 0-4.34-1.587-5.053-3.72H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
                  <path d="M3.947 10.712c-.18-.54-.282-1.117-.282-1.712s.102-1.172.282-1.712V4.956H.957C.348 6.174 0 7.55 0 9s.348 2.826.957 4.044l2.99-2.332z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.956L3.947 7.288C4.66 5.153 6.65 3.58 9 3.58z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modal = document.getElementById('login-modal-overlay');
    this.statusEl = document.getElementById('login-status-message');
  }

  attachEventListeners() {
    const closeBtn = document.getElementById('login-modal-close');
    closeBtn?.addEventListener('click', () => this.hide());

    this.modal?.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.hide();
      }
    });

    document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setActiveForm(btn.dataset.authTab);
      });
    });

    document.querySelectorAll('[data-show-form]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setActiveForm(btn.dataset.showForm);
      });
    });

    const resendBtn = document.querySelector('[data-resend-verification]');
    resendBtn?.addEventListener('click', async () => {
      const email = document.getElementById('signup-email')?.value || document.getElementById('login-email')?.value;
      if (!email) {
        this.setStatus('Enter your email in the login or signup form first.', 'error');
        return;
      }
      try {
        this.setStatus('Sending verification email...', 'info');
        const response = await authAPI.resendVerification(email);
        
        // If token is provided in response (dev mode), pre-fill it
        if (response?.verificationToken) {
          const tokenInput = document.getElementById('verify-token');
          if (tokenInput) {
            tokenInput.value = response.verificationToken;
          }
          this.setStatus(response.note || 'Verification token sent. Use the token below.', 'info');
        } else {
          this.setStatus('Verification email sent.', 'success');
        }
      } catch (error) {
        this.setStatus(error.message || 'Failed to resend verification email.', 'error');
      }
    });

    const loginForm = document.getElementById('login-email-form');
    loginForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email')?.value.trim();
      const password = document.getElementById('login-password')?.value;
      if (!email || !password) return;
      try {
        this.setStatus('Signing in...', 'info');
        let responseUser = null;
        const response = await authAPI.login(email, password);
        if (response?.user) {
          responseUser = response.user;
        } else {
          const { getCurrentUser } = await import('../api.js');
          responseUser = await getCurrentUser();
        }
        this.setStatus('Login successful!', 'success');
        if (responseUser && this.onLoginSuccess) {
          this.onLoginSuccess(responseUser, true);
        } else {
          await this.checkAuthStatus(true);
        }
        this.hide();
      } catch (error) {
        this.setStatus(error.message || 'Login failed.', 'error');
      }
    });

    const signupForm = document.getElementById('signup-email-form');
    signupForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('signup-name')?.value.trim();
      const email = document.getElementById('signup-email')?.value.trim();
      const password = document.getElementById('signup-password')?.value;
      if (!email || !password) return;
      try {
        this.setStatus('Creating account...', 'info');
        const response = await authAPI.register({ email, password, name });
        this.setActiveForm('verify-email');
        document.getElementById('login-email').value = email;
        
        // If token is provided in response (dev mode), pre-fill it
        if (response?.verificationToken) {
          const tokenInput = document.getElementById('verify-token');
          if (tokenInput) {
            tokenInput.value = response.verificationToken;
          }
          this.setStatus(response.note || 'Account created! Use the verification token below.', 'info');
        } else {
          this.setStatus('Account created! Check your email for verification token.', 'success');
          document.getElementById('verify-token')?.focus();
        }
      } catch (error) {
        this.setStatus(error.message || 'Registration failed.', 'error');
      }
    });

    const verifyForm = document.getElementById('verify-email-form');
    verifyForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = document.getElementById('verify-token')?.value.trim();
      if (!token) return;
      try {
        this.setStatus('Verifying...', 'info');
        const response = await authAPI.verifyEmail(token);
        this.setStatus('Email verified! You can now log in.', 'success');
        if (response?.user) {
          await this.checkAuthStatus(true);
          this.hide();
        } else {
          this.setActiveForm('login');
        }
      } catch (error) {
        this.setStatus(error.message || 'Verification failed.', 'error');
      }
    });

    const resetRequestForm = document.getElementById('reset-request-form');
    resetRequestForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('reset-email')?.value.trim();
      if (!email) return;
      try {
        this.setStatus('Sending reset link...', 'info');
        await authAPI.requestPasswordReset(email);
        this.setStatus('Reset instructions sent (check server log in dev).', 'success');
      } catch (error) {
        this.setStatus(error.message || 'Failed to send reset email.', 'error');
      }
    });

    const resetPasswordForm = document.getElementById('reset-password-form');
    resetPasswordForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = document.getElementById('reset-token')?.value.trim();
      const newPassword = document.getElementById('reset-new-password')?.value;
      if (!token || !newPassword) return;
      try {
        this.setStatus('Updating password...', 'info');
        await authAPI.resetPassword(token, newPassword);
        this.setStatus('Password updated. You can now log in.', 'success');
        this.setActiveForm('login');
      } catch (error) {
        this.setStatus(error.message || 'Failed to update password.', 'error');
      }
    });

    const googleBtn = document.getElementById('login-google');
    googleBtn?.addEventListener('click', async () => {
      window.location.href = authAPI.getGoogleLoginUrl();
    });

    const urlParams = new URLSearchParams(window.location.search);
    const authStatus = urlParams.get('auth');
    const unlockBodyScroll = () => {
      if (document.body.style.overflow === 'hidden') {
        document.body.style.overflow = '';
      }
    };
    const hideIfVisible = () => {
      if (this.modal && this.modal.style.display !== 'none') {
        this.hide();
      } else {
        unlockBodyScroll();
      }
    };
    if (authStatus === 'success') {
      // Wait longer for session cookie to be set and processed by browser
      // After Google OAuth redirect, cookies need time to be stored
      setTimeout(async () => {
        console.log('🔍 Checking auth status after Google login redirect...');
        const success = await this.checkAuthStatus(true);
        if (!success) {
          console.log('⚠️ First auth check failed, retrying...');
          setTimeout(async () => {
            const retrySuccess = await this.checkAuthStatus(true);
            if (!retrySuccess) {
              console.error('❌ Auth check failed after retry - session may not be set');
              this.show();
              this.setStatus('Login successful but session not established. Please refresh the page.', 'error');
            } else {
              console.log('✅ Auth check successful after Google login (retry)');
              hideIfVisible();
            }
          }, 1000);
        } else {
          console.log('✅ Auth check successful after Google login');
          hideIfVisible();
        }
      }, 500);
      const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
      window.history.replaceState({}, document.title, cleanUrl);
    } else if (authStatus === 'error') {
      const errorMessage = urlParams.get('message') || 'Authentication failed';
      this.show();
      this.setStatus(errorMessage, 'error');
      const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }

  setActiveForm(form) {
    this.activeForm = form;
    document.querySelectorAll('.auth-form').forEach((formEl) => {
      formEl.classList.toggle('auth-form-active', formEl.dataset.authForm === form);
    });
    document.querySelectorAll('[data-auth-tab]').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.authTab === form);
    });
    this.clearStatus();
  }

  setStatus(message, type = 'info') {
    if (!this.statusEl) return;
    this.statusEl.textContent = message;
    this.statusEl.dataset.statusType = type;
  }

  clearStatus() {
    if (this.statusEl) {
      this.statusEl.textContent = '';
      this.statusEl.dataset.statusType = '';
    }
  }

  async checkAuthStatus(force = false) {
    try {
      const { getCurrentUser } = await import('../api.js');
      const user = await getCurrentUser();
      if (user && this.onLoginSuccess) {
        this.onLoginSuccess(user, force);
        return true;
      }
      return !!user;
    } catch (error) {
      if (force) {
        this.setStatus(error.message || 'Authentication failed.', 'error');
      }
      return false;
    }
  }

  show() {
    if (!this.modal) return;
    this.setActiveForm('login');
    this.modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  hide() {
    if (!this.modal) return;
    this.modal.style.display = 'none';
    document.body.style.overflow = '';
    this.clearStatus();
  }

  setOnLoginSuccess(callback) {
    this.onLoginSuccess = callback;
  }
}

