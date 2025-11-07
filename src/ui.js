/**
 * UI Controls Handler
 */

import { soundConfig } from './config.js';
import { soundManager } from './soundManager.js';

class UIController {
  constructor() {
    this.updateCallbacks = new Map();
    this.soundTrigger = null;
    this.controlSoundTimers = new Map(); // Debounce timers for control sounds
    this.activeSliders = new Set(); // Track which sliders are currently being dragged
    // Tap tempo tracking
    this.tapTimes = []; // Array of timestamps for taps
    this.tapTimeout = null; // Timeout to reset tap sequence
    this.tapTimeoutDelay = 2000; // Reset after 2 seconds of no taps
    this.initializeControls();
  }

  /**
   * Set the sound trigger callback
   */
  setSoundTrigger(callback) {
    this.soundTrigger = callback;
  }

  /**
   * Trigger a control sound with debouncing
   */
  triggerControlSound(controlName) {
    if (!this.soundTrigger) return;
    
    // Clear any existing timer for this control
    const existingTimer = this.controlSoundTimers.get(controlName);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Set a new timer to trigger the sound after a short delay
    const timer = setTimeout(() => {
      this.controlSoundTimers.delete(controlName);
      const controlConfig = soundConfig.getControlConfig(controlName);
      if (controlConfig && controlConfig.type) {
        // Create a unique ID for this control sound
        const controlId = `control-${controlName}`;
        this.soundTrigger(controlId, controlConfig);
      }
    }, 100); // 100ms debounce
    
    this.controlSoundTimers.set(controlName, timer);
  }

  /**
   * Initialize UI controls
   */
  initializeControls() {
    // Proximity and hover controls removed - only click activation now
    // Volume slider removed - use master volume instead

    // Tempo slider
    const tempoSlider = document.getElementById('tempo-slider');
    const tempoValue = document.getElementById('tempo-value');
    
    if (tempoSlider && tempoValue) {
      tempoSlider.addEventListener('input', (e) => {
        const bpm = parseInt(e.target.value);
        tempoValue.textContent = bpm;
        this.notify('tempo', bpm);
      });
    }

    // Tap tempo button
    const tapTempoBtn = document.getElementById('tap-tempo-btn');
    if (tapTempoBtn) {
      tapTempoBtn.addEventListener('click', () => {
        this.handleTapTempo(tempoSlider, tempoValue, tapTempoBtn);
      });
    }

    // Key select
    const keySelect = document.getElementById('key-select');
    const keyValue = document.getElementById('key-value');
    
    if (keySelect && keyValue) {
      keySelect.addEventListener('change', (e) => {
        const key = e.target.value;
        // Don't notify if placeholder is selected
        if (key === '') {
          keyValue.textContent = 'Select Key';
          return;
        }
        const selectedOption = e.target.options[e.target.selectedIndex];
        keyValue.textContent = selectedOption.text;
        this.notify('key', key);
      });
    }

    // Time signature select
    const timeSignatureSelect = document.getElementById('time-signature-select');
    const timeSignatureValue = document.getElementById('time-signature-value');
    
    if (timeSignatureSelect && timeSignatureValue) {
      timeSignatureSelect.addEventListener('change', (e) => {
        const timeSignature = e.target.value;
        // Don't notify if placeholder is selected
        if (timeSignature === '') {
          timeSignatureValue.textContent = 'Select Time Signature';
          return;
        }
        const selectedOption = e.target.options[e.target.selectedIndex];
        timeSignatureValue.textContent = timeSignature;
        this.notify('timeSignature', timeSignature);
      });
    }
  }

  /**
   * Handle tap tempo button clicks
   * Calculates tempo from tap intervals after 3 or more taps
   */
  handleTapTempo(tempoSlider, tempoValue, tapTempoBtn) {
    const now = Date.now();
    
    // Clear any existing timeout
    if (this.tapTimeout) {
      clearTimeout(this.tapTimeout);
      this.tapTimeout = null;
    }

    // Add current tap time
    this.tapTimes.push(now);

    // If we have 2 or more intervals (3+ taps), calculate tempo
    if (this.tapTimes.length >= 3) {
      // Calculate intervals between taps (skip first tap as it has no previous)
      const intervals = [];
      for (let i = 1; i < this.tapTimes.length; i++) {
        intervals.push(this.tapTimes[i] - this.tapTimes[i - 1]);
      }

      // Calculate average interval
      const averageInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;

      // Convert interval (milliseconds) to BPM
      // BPM = 60 seconds / (average interval in seconds) = 60000 ms / average interval in ms
      let bpm = Math.round(60000 / averageInterval);

      // Clamp BPM to valid range (60-240)
      bpm = Math.max(60, Math.min(240, bpm));

      // Update slider and display
      if (tempoSlider) {
        tempoSlider.value = bpm;
      }
      if (tempoValue) {
        tempoValue.textContent = bpm;
      }

      // Notify tempo change
      this.notify('tempo', bpm);

      // Keep only the last 4 tap times for better accuracy with continuing taps
      if (this.tapTimes.length > 4) {
        this.tapTimes = this.tapTimes.slice(-4);
      }
    } else {
      // Not enough taps yet - show feedback
      const tapsNeeded = 3 - this.tapTimes.length;
      if (tapTempoBtn) {
        const originalText = tapTempoBtn.textContent;
        tapTempoBtn.textContent = `${tapsNeeded} more`;
        setTimeout(() => {
          tapTempoBtn.textContent = originalText;
        }, 500);
      }
    }

    // Set timeout to reset tap sequence if no taps for 2 seconds
    this.tapTimeout = setTimeout(() => {
      this.tapTimes = [];
      this.tapTimeout = null;
      if (tapTempoBtn) {
        tapTempoBtn.textContent = 'TAP';
      }
    }, this.tapTimeoutDelay);
  }


  /**
   * Register a callback for control updates
   */
  onUpdate(controlName, callback) {
    if (!this.updateCallbacks.has(controlName)) {
      this.updateCallbacks.set(controlName, []);
    }
    this.updateCallbacks.get(controlName).push(callback);
  }

  /**
   * Notify listeners of control updates
   */
  notify(controlName, value) {
    const callbacks = this.updateCallbacks.get(controlName);
    if (callbacks) {
      callbacks.forEach(callback => callback(value));
    }
  }

  /**
   * Update status text
   */
  updateStatus(text) {
    const statusText = document.getElementById('status-text');
    if (statusText) {
      statusText.textContent = text;
    }
  }

  /**
   * Update active elements display
   */
  updateActiveElements(elements) {
    const activeElementsDiv = document.getElementById('active-elements');
    if (activeElementsDiv) {
      if (elements.length === 0) {
        activeElementsDiv.textContent = 'None';
      } else {
        activeElementsDiv.textContent = elements.join(', ');
      }
    }
  }

  /**
   * Update element visual indicator
   */
  setElementState(element, state) {
    const indicator = element.querySelector('.element-indicator');
    if (indicator) {
      indicator.className = 'element-indicator';
      if (state === 'hover') {
        indicator.classList.add('hover');
      } else if (state === 'proximity') {
        indicator.classList.add('proximity');
      }
    }

    // Update element class
    element.className = 'sound-element';
    if (state === 'hover') {
      element.classList.add('is-hovered');
    } else if (state === 'proximity') {
      element.classList.add('is-proximity');
    }
  }
}

export const uiController = new UIController();

