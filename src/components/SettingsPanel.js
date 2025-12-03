import { BUILTIN_BANK_OPTIONS } from '../constants/banks.js';
import { CHAOSPAD_EFFECT_OPTIONS, CHAOSPAD_EFFECTS } from '../constants/chaospad.js';
import {
  getSettings,
  updateSettings,
  subscribeToSettings,
  toggleBankVisibility,
  resetSettings,
  getDefaultSettings
} from '../utils/settingsStore.js';
import { lockScroll, unlockScroll } from '../scrollLock.js';

const BACKGROUND_MODE_OPTIONS = [
  { value: 'animated', label: 'Animated bubbles' },
  { value: 'solid', label: 'Solid color' },
  { value: 'image', label: 'Background image' }
];

export class SettingsPanel {
  constructor() {
    this.overlay = null;
    this.unsubscribe = null;
    this.isOpen = false;
    this.saveStatusTimeout = null;
  }

  init() {
    this.render();
    this.attachEventListeners();
    this.syncUI(getSettings());
    this.unsubscribe = subscribeToSettings((settings) => this.syncUI(settings));
  }

  render() {
    if (!this.overlay) {
      const modalHtml = `
        <div class="settings-panel-overlay" id="settings-panel-overlay" style="display: none;">
          <div class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-panel-title">
            <div class="settings-panel-header">
              <div>
                <h2 id="settings-panel-title">Settings</h2>
                <p>Customize how Strudesk 4000 behaves for you.</p>
              </div>
              <div class="settings-panel-actions">
                <button type="button" class="settings-link" id="settings-reset-btn" aria-label="Reset settings to defaults">Reset</button>
                <button type="button" class="settings-panel-close" id="settings-panel-close" aria-label="Close settings">&times;</button>
              </div>
            </div>
            <div class="settings-panel-body">
              <section class="settings-section" id="settings-sample-banks">
                <div class="settings-section-header">
                  <div>
                    <h3>Sample Bank Visibility</h3>
                    <p>Hide the banks you never use to keep dropdowns tidy.</p>
                  </div>
                </div>
                ${this.renderSampleBankControls()}
              </section>

              <section class="settings-section" id="settings-chaospad">
                <div class="settings-section-header">
                  <div>
                    <h3>Chaospad Controls</h3>
                    <p>Pick an effect for each axis and fine-tune its response.</p>
                  </div>
                </div>
                <div class="settings-chaospad-grid">
                  ${this.renderChaospadAxisControls('x', 'Horizontal Axis (X)')}
                  ${this.renderChaospadAxisControls('y', 'Vertical Axis (Y)')}
                </div>
              </section>

              <section class="settings-section" id="settings-styling">
                <div class="settings-section-header">
                  <div>
                    <h3>Page Styling</h3>
                    <p>Switch off the animated background or bring your own visuals.</p>
                  </div>
                </div>
                <div class="settings-field settings-radio-group" role="radiogroup" aria-label="Page background mode">
                  ${BACKGROUND_MODE_OPTIONS.map(({ value, label }) => `
                    <label class="settings-radio">
                      <input type="radio" name="settings-bg-mode" value="${value}">
                      <span>${label}</span>
                    </label>
                  `).join('')}
                </div>
                <div class="settings-field">
                  <label for="settings-bg-color">Solid color</label>
                  <input type="color" id="settings-bg-color" value="#05060a">
                  <small>Applied for Solid or Image modes.</small>
                </div>
                <div class="settings-field">
                  <label for="settings-bg-image">Background image URL</label>
                  <input type="url" id="settings-bg-image" placeholder="https://example.com/texture.jpg" disabled>
                  <small>Used only when “Background image” mode is active.</small>
                </div>
              </section>
            </div>
            <div class="settings-panel-footer">
              <div class="settings-save-status" id="settings-save-status">
                <span class="settings-save-icon">✓</span>
                <span class="settings-save-text">Settings saved automatically</span>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', modalHtml);
      this.overlay = document.getElementById('settings-panel-overlay');
    }

    const userMenu = document.getElementById('user-menu-dropdown');
    if (userMenu) {
      let settingsLink = userMenu.querySelector('#user-settings-link');
      if (!settingsLink) {
        const divider = document.createElement('div');
        divider.className = 'user-menu-divider';
        settingsLink = document.createElement('button');
        settingsLink.id = 'user-settings-link';
        settingsLink.type = 'button';
        settingsLink.className = 'user-menu-item';
        settingsLink.textContent = 'Settings';
        const logoutButton = userMenu.querySelector('#user-logout-btn');
        if (divider && logoutButton) {
          userMenu.insertBefore(divider, logoutButton);
          userMenu.insertBefore(settingsLink, logoutButton);
        } else {
          userMenu.appendChild(divider);
          userMenu.appendChild(settingsLink);
        }
      }
      if (settingsLink && !settingsLink.dataset.listenerAttached) {
        settingsLink.addEventListener('click', () => {
          this.show();
          userMenu.classList.remove('active');
        });
        settingsLink.dataset.listenerAttached = 'true';
      }
    }
  }

  renderSampleBankControls() {
    return BUILTIN_BANK_OPTIONS.map(({ group, options }) => `
      <div class="settings-fieldset">
        <div class="settings-fieldset-heading">
          <div>
            <h4>${group}</h4>
            <p>${options.length} banks</p>
          </div>
        </div>
        <div class="settings-checkbox-grid">
          ${options.map((option) => `
            <label class="settings-checkbox">
              <input type="checkbox" class="settings-bank-toggle" data-bank-value="${option.value}">
              <span>${option.label}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  renderChaospadAxisControls(axis, title) {
    const effectOptions = CHAOSPAD_EFFECT_OPTIONS.map(
      (effect) => `<option value="${effect.id}">${effect.label}</option>`
    ).join('');

    return `
      <div class="settings-chaospad-card" data-axis="${axis}">
        <header>
          <h4>${title}</h4>
          <p>Drag ${axis === 'x' ? 'left ↔ right' : 'up ↕ down'} on Chaospad to control this.</p>
        </header>
        <label class="settings-input-label">
          Effect
          <select data-chaospad-effect="${axis}" id="settings-chaospad-${axis}-effect">
            ${effectOptions}
          </select>
        </label>
        <div class="settings-range-field">
          <label>
            Min
            <input type="number" data-chaospad-min="${axis}" step="0.01">
          </label>
          <label>
            Max
            <input type="number" data-chaospad-max="${axis}" step="0.01">
          </label>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    if (!this.overlay) return;
    const closeBtn = this.overlay.querySelector('#settings-panel-close');
    closeBtn?.addEventListener('click', () => this.hide());

    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) {
        this.hide();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (this.isOpen && event.key === 'Escape') {
        this.hide();
      }
    });

    this.overlay.querySelectorAll('.settings-bank-toggle').forEach((checkbox) => {
      checkbox.addEventListener('change', (event) => {
        const value = event.target.dataset.bankValue;
        toggleBankVisibility(value, event.target.checked);
        this.showSaveStatus();
      });
    });

    this.overlay.querySelectorAll('[data-chaospad-effect]').forEach((select) => {
      select.addEventListener('change', (event) => {
        const axis = event.target.dataset.chaospadEffect;
        const effectId = event.target.value;
        const effect = CHAOSPAD_EFFECTS[effectId];
        updateSettings({
          chaospad: {
            axes: {
              [axis]: {
                effect: effectId,
                min: effect?.defaultMin ?? 0,
                max: effect?.defaultMax ?? 1
              }
            }
          }
        });
        this.showSaveStatus();
      });
    });

    this.overlay.querySelectorAll('[data-chaospad-min]').forEach((input) => {
      input.addEventListener('change', (event) => {
        this.handleChaospadRangeChange(event, 'min');
        this.showSaveStatus();
      });
    });

    this.overlay.querySelectorAll('[data-chaospad-max]').forEach((input) => {
      input.addEventListener('change', (event) => {
        this.handleChaospadRangeChange(event, 'max');
        this.showSaveStatus();
      });
    });

    this.overlay.querySelectorAll('input[name="settings-bg-mode"]').forEach((input) => {
      input.addEventListener('change', (event) => {
        if (!event.target.checked) return;
        updateSettings({
          styling: {
            backgroundType: event.target.value
          }
        });
        this.showSaveStatus();
      });
    });

    const bgColorInput = this.overlay.querySelector('#settings-bg-color');
    bgColorInput?.addEventListener('input', (event) => {
      updateSettings({
        styling: {
          backgroundColor: event.target.value || getDefaultSettings().styling.backgroundColor
        }
      });
      this.showSaveStatus();
    });

    const bgImageInput = this.overlay.querySelector('#settings-bg-image');
    bgImageInput?.addEventListener('change', (event) => {
      updateSettings({
        styling: {
          backgroundImage: (event.target.value || '').trim()
        }
      });
      this.showSaveStatus();
    });

    const resetButton = this.overlay.querySelector('#settings-reset-btn');
    resetButton?.addEventListener('click', () => {
      resetSettings();
      this.showSaveStatus();
    });
  }

  handleChaospadRangeChange(event, type) {
    const axis = event.target.dataset[`chaospad${type === 'min' ? 'Min' : 'Max'}`];
    const numeric = parseFloat(event.target.value);
    if (!axis || Number.isNaN(numeric)) {
      return;
    }
    const settings = getSettings();
    const currentAxis = settings?.chaospad?.axes?.[axis] || {};
    const nextConfig = {
      ...currentAxis,
      [type]: numeric
    };
    if (type === 'min' && nextConfig.max !== undefined && numeric > nextConfig.max) {
      nextConfig.max = numeric;
    }
    if (type === 'max' && nextConfig.min !== undefined && numeric < nextConfig.min) {
      nextConfig.min = numeric;
    }
    updateSettings({
      chaospad: {
        axes: {
          [axis]: nextConfig
        }
      }
    });
  }

  syncUI(settings) {
    if (!this.overlay) return;
    const hidden = new Set(settings?.sampleBanks?.hidden || []);
    this.overlay.querySelectorAll('.settings-bank-toggle').forEach((checkbox) => {
      const value = checkbox.dataset.bankValue;
      checkbox.checked = !hidden.has(value);
    });

    ['x', 'y'].forEach((axis) => {
      const axisConfig = settings?.chaospad?.axes?.[axis];
      if (!axisConfig) return;
      const effectSelect = this.overlay.querySelector(`[data-chaospad-effect="${axis}"]`);
      const minInput = this.overlay.querySelector(`[data-chaospad-min="${axis}"]`);
      const maxInput = this.overlay.querySelector(`[data-chaospad-max="${axis}"]`);
      if (effectSelect) {
        effectSelect.value = axisConfig.effect;
      }
      if (minInput) {
        minInput.value = axisConfig.min;
      }
      if (maxInput) {
        maxInput.value = axisConfig.max;
      }
      this.updateChaospadAxisInputs(axis, axisConfig);
    });

    const styling = settings?.styling || getDefaultSettings().styling;
    const modeInput = this.overlay.querySelector(`input[name="settings-bg-mode"][value="${styling.backgroundType}"]`);
    if (modeInput && !modeInput.checked) {
      modeInput.checked = true;
    }
    const bgColorInput = this.overlay.querySelector('#settings-bg-color');
    if (bgColorInput) {
      bgColorInput.value = styling.backgroundColor || getDefaultSettings().styling.backgroundColor;
    }
    const bgImageInput = this.overlay.querySelector('#settings-bg-image');
    if (bgImageInput) {
      bgImageInput.value = styling.backgroundImage || '';
      bgImageInput.disabled = styling.backgroundType !== 'image';
    }
    bgColorInput.disabled = styling.backgroundType === 'animated';
  }

  updateChaospadAxisInputs(axis, axisConfig) {
    const effect = CHAOSPAD_EFFECTS[axisConfig.effect];
    const minInput = this.overlay?.querySelector(`[data-chaospad-min="${axis}"]`);
    const maxInput = this.overlay?.querySelector(`[data-chaospad-max="${axis}"]`);
    if (minInput && effect) {
      minInput.step = effect.step ?? minInput.step;
      minInput.placeholder = effect.defaultMin;
    }
    if (maxInput && effect) {
      maxInput.step = effect.step ?? maxInput.step;
      maxInput.placeholder = effect.defaultMax;
    }
  }

  show() {
    if (!this.overlay || this.isOpen) return;
    this.overlay.style.display = 'flex';
    lockScroll('settings-panel');
    this.isOpen = true;
  }

  hide() {
    if (!this.overlay || !this.isOpen) return;
    this.overlay.style.display = 'none';
    unlockScroll('settings-panel');
    this.isOpen = false;
  }

  showSaveStatus() {
    const saveStatus = this.overlay?.querySelector('#settings-save-status');
    if (!saveStatus) return;

    // Clear any existing timeout
    if (this.saveStatusTimeout) {
      clearTimeout(this.saveStatusTimeout);
    }

    // Show "Saved" animation
    saveStatus.classList.add('settings-save-status--saved');
    saveStatus.querySelector('.settings-save-text').textContent = 'Saved!';

    // Reset after 2 seconds
    this.saveStatusTimeout = setTimeout(() => {
      saveStatus.classList.remove('settings-save-status--saved');
      saveStatus.querySelector('.settings-save-text').textContent = 'Settings saved automatically';
    }, 2000);
  }

  destroy() {
    if (this.saveStatusTimeout) {
      clearTimeout(this.saveStatusTimeout);
      this.saveStatusTimeout = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
