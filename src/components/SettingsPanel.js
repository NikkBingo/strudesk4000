import { DRUM_BANKS, WAVEFORM_BANKS, SAMPLE_BANKS, BUILTIN_BANK_OPTIONS } from '../constants/banks.js';
import { CHAOSPAD_EFFECT_OPTIONS, CHAOSPAD_EFFECTS } from '../constants/chaospad.js';
import { getSettings, updateSettings, subscribeToSettings, toggleBankVisibility } from '../utils/settingsStore.js';
import { lockScroll, unlockScroll } from '../scrollLock.js';

export class SettingsPanel {
  constructor() {
    this.overlay = null;
    this.unsubscribe = null;
    this.isOpen = false;
  }

  init() {
    this.render();
    this.attachEventListeners();
    this.unsubscribe = subscribeToSettings((settings) => this.syncUI(settings));
    this.syncUI(getSettings());
  }

  render() {
    if (this.overlay) return;
    const modalHtml = `
      <div class="settings-panel-overlay" id="settings-panel-overlay" style="display: none;">
        <div class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-panel-title">
          <div class="settings-panel-header">
            <h2 id="settings-panel-title">Settings</h2>
            <button type="button" class="settings-panel-close" id="settings-panel-close" aria-label="Close settings">&times;</button>
          </div>
          <div class="settings-panel-body">
            <section class="settings-section" id="settings-sample-banks">
              <div class="settings-section-header">
                <h3>Sample Bank Visibility</h3>
                <p>Select which built-in banks should appear in dropdowns.</p>
              </div>
              ${this.renderSampleBankControls()}
            </section>

            <section class="settings-section" id="settings-chaospad">
              <div class="settings-section-header">
                <h3>Chaospad Controls</h3>
                <p>Pick the effect type and range for each axis.</p>
              </div>
              <div class="settings-chaospad-grid">
                ${this.renderChaospadAxisControls('x', 'X Axis')}
                ${this.renderChaospadAxisControls('y', 'Y Axis')}
              </div>
            </section>

            <section class="settings-section" id="settings-styling">
              <div class="settings-section-header">
                <h3>Page Styling</h3>
                <p>Your preferences for the background treatment.</p>
              </div>
              <div class="settings-field">
                <label class="settings-checkbox">
                  <input type="checkbox" id="settings-disable-bubbles">
                  <span>Disable animated background</span>
                </label>
              </div>
              <div class="settings-field">
                <label for="settings-bg-color">Background color</label>
                <input type="color" id="settings-bg-color" value="#05060a">
              </div>
              <div class="settings-field">
                <label for="settings-bg-image">Background image URL</label>
                <input type="url" id="settings-bg-image" placeholder="https://example.com/background.jpg">
                <small>Leave empty to use only the color above.</small>
              </div>
            </section>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    this.overlay = document.getElementById('settings-panel-overlay');
  }

  renderSampleBankControls() {
    return BUILTIN_BANK_OPTIONS.map(({ group, options }) => `
      <div class="settings-fieldset">
        <div class="settings-fieldset-title">${group}</div>
        <div class="settings-checkbox-grid">
          ${options.map(option => `
            <label class="settings-checkbox">
              <input type="checkbox" data-bank-value="${option.value}" class="settings-bank-toggle">
              <span>${option.label}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  renderChaospadAxisControls(axis, title) {
    const effectOptions = CHAOSPAD_EFFECT_OPTIONS.map(effect => `
      <option value="${effect.id}">${effect.label}</option>
    `).join('');
    return `
      <div class="settings-chaospad-card" data-axis="${axis}">
        <div class="settings-field">
          <label for="settings-chaospad-${axis}-effect">${title} Effect</label>
          <select id="settings-chaospad-${axis}-effect" data-chaospad-effect="${axis}">
            ${effectOptions}
          </select>
        </div>
        <div class="settings-field settings-range-field">
          <div>
            <label for="settings-chaospad-${axis}-min">Min</label>
            <input type="number" step="0.01" id="settings-chaospad-${axis}-min" data-chaospad-min="${axis}">
          </div>
          <div>
            <label for="settings-chaospad-${axis}-max">Max</label>
            <input type="number" step="0.01" id="settings-chaospad-${axis}-max" data-chaospad-max="${axis}">
          </div>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    if (!this.overlay) return;
    const closeBtn = document.getElementById('settings-panel-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) {
        this.hide();
      }
    });

    this.overlay.querySelectorAll('.settings-bank-toggle').forEach((checkbox) => {
      checkbox.addEventListener('change', (event) => {
        const value = event.target.dataset.bankValue;
        toggleBankVisibility(value, event.target.checked);
      });
    });

    this.overlay.querySelectorAll('[data-chaospad-effect]').forEach((select) => {
      select.addEventListener('change', (event) => {
        const axis = event.target.dataset.chaospadEffect;
        const effectId = event.target.value;
        const effect = CHAOSPAD_EFFECTS[effectId];
        const payload = {
          chaospad: {
            axes: {
              [axis]: {
                effect: effectId,
                min: effect ? effect.defaultMin : 0,
                max: effect ? effect.defaultMax : 1
              }
            }
          }
        };
        updateSettings(payload);
      });
    });

    this.overlay.querySelectorAll('[data-chaospad-min]').forEach((input) => {
      input.addEventListener('change', (event) => this.handleChaospadRangeChange(event, 'min'));
    });
    this.overlay.querySelectorAll('[data-chaospad-max]').forEach((input) => {
      input.addEventListener('change', (event) => this.handleChaospadRangeChange(event, 'max'));
    });

    const disableBubblesCheckbox = document.getElementById('settings-disable-bubbles');
    if (disableBubblesCheckbox) {
      disableBubblesCheckbox.addEventListener('change', (event) => {
        updateSettings({
          styling: {
            disableBubbles: !!event.target.checked
          }
        });
      });
    }

    const bgColorInput = document.getElementById('settings-bg-color');
    if (bgColorInput) {
      bgColorInput.addEventListener('input', (event) => {
        updateSettings({
          styling: {
            backgroundColor: event.target.value || DEFAULT_SETTINGS.styling.backgroundColor
          }
        });
      });
    }

    const bgImageInput = document.getElementById('settings-bg-image');
    if (bgImageInput) {
      bgImageInput.addEventListener('change', (event) => {
        updateSettings({
          styling: {
            backgroundImage: (event.target.value || '').trim()
          }
        });
      });
    }
  }

  handleChaospadRangeChange(event, type) {
    const axis = event.target.dataset[`chaospad${type === 'min' ? 'Min' : 'Max'}`];
    const numeric = parseFloat(event.target.value);
    if (!axis || Number.isNaN(numeric)) {
      return;
    }
    const settings = getSettings();
    const axisConfig = settings?.chaospad?.axes?.[axis] || {};
    const nextConfig = {
      ...axisConfig,
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
      const effectSelect = this.overlay.querySelector(`[data-chaospad-effect="${axis}"]`);
      if (effectSelect && axisConfig?.effect) {
        effectSelect.value = axisConfig.effect;
      }
      const minInput = this.overlay.querySelector(`[data-chaospad-min="${axis}"]`);
      const maxInput = this.overlay.querySelector(`[data-chaospad-max="${axis}"]`);
      if (minInput && axisConfig?.min !== undefined) {
        minInput.value = axisConfig.min;
      }
      if (maxInput && axisConfig?.max !== undefined) {
        maxInput.value = axisConfig.max;
      }
    });

    const disableBubblesCheckbox = document.getElementById('settings-disable-bubbles');
    if (disableBubblesCheckbox) {
      disableBubblesCheckbox.checked = !!settings?.styling?.disableBubbles;
    }
    const bgColorInput = document.getElementById('settings-bg-color');
    if (bgColorInput && settings?.styling?.backgroundColor) {
      bgColorInput.value = settings.styling.backgroundColor;
    }
    const bgImageInput = document.getElementById('settings-bg-image');
    if (bgImageInput) {
      bgImageInput.value = settings?.styling?.backgroundImage || '';
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

  destroy() {
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

