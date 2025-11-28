import { DEFAULT_CHAOSPAD_AXES, CHAOSPAD_EFFECTS } from '../constants/chaospad.js';
import { BUILTIN_BANK_VALUES } from '../constants/banks.js';

const SETTINGS_KEY = 'strudesk_settings_v1';
const VALID_BACKGROUND_TYPES = new Set(['animated', 'solid', 'image']);

const DEFAULT_SETTINGS = {
  sampleBanks: {
    hidden: []
  },
  chaospad: {
    axes: structuredClone(DEFAULT_CHAOSPAD_AXES)
  },
  styling: {
    backgroundType: 'animated',
    backgroundColor: '#05060a',
    backgroundImage: ''
  }
};

let settingsCache = loadSettingsFromStorage();
const listeners = new Set();

function loadSettingsFromStorage() {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null;
    if (!stored) {
      return structuredClone(DEFAULT_SETTINGS);
    }
    const parsed = JSON.parse(stored);
    return normalizeSettings(parsed);
  } catch (error) {
    console.warn('⚠️ Unable to read settings from storage, using defaults:', error);
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function persistSettings() {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsCache));
  } catch (error) {
    console.warn('⚠️ Unable to persist settings:', error);
  }
}

function deepMerge(target, source) {
  if (typeof source !== 'object' || source === null) {
    return target;
  }
  Object.keys(source).forEach((key) => {
    const value = source[key];
    if (Array.isArray(value)) {
      target[key] = Array.from(value);
      return;
    }
    if (value && typeof value === 'object') {
      target[key] = deepMerge(target[key] ? { ...target[key] } : {}, value);
      return;
    }
    target[key] = value;
  });
  return target;
}

function normalizeAxisConfig(config, fallback) {
  const base = fallback || DEFAULT_CHAOSPAD_AXES.x;
  const requestedEffect = config?.effect && CHAOSPAD_EFFECTS[config.effect] ? config.effect : base.effect;
  const effectMeta = CHAOSPAD_EFFECTS[requestedEffect] || CHAOSPAD_EFFECTS[base.effect];
  const min = Number.isFinite(config?.min) ? config.min : (Number.isFinite(base?.min) ? base.min : effectMeta.defaultMin);
  const max = Number.isFinite(config?.max) ? config.max : (Number.isFinite(base?.max) ? base.max : effectMeta.defaultMax);
  let normalizedMin = typeof min === 'number' ? min : effectMeta.defaultMin;
  let normalizedMax = typeof max === 'number' ? max : effectMeta.defaultMax;
  if (normalizedMax <= normalizedMin) {
    normalizedMax = normalizedMin + Math.abs(effectMeta.defaultMax - effectMeta.defaultMin) || normalizedMin + 1;
  }
  return {
    effect: requestedEffect,
    min: normalizedMin,
    max: normalizedMax
  };
}

function normalizeSettings(partialSettings) {
  const merged = deepMerge(structuredClone(DEFAULT_SETTINGS), partialSettings || {});

  // Sample bank visibility
  const hiddenList = Array.isArray(merged.sampleBanks?.hidden) ? merged.sampleBanks.hidden : [];
  merged.sampleBanks.hidden = Array.from(
    new Set(hiddenList.filter((value) => typeof value === 'string' && BUILTIN_BANK_VALUES.has(value)))
  );

  // Chaospad axes
  merged.chaospad.axes = {
    x: normalizeAxisConfig(merged.chaospad?.axes?.x, DEFAULT_CHAOSPAD_AXES.x),
    y: normalizeAxisConfig(merged.chaospad?.axes?.y, DEFAULT_CHAOSPAD_AXES.y)
  };

  // Styling
  const backgroundType = merged.styling?.backgroundType;
  if (!VALID_BACKGROUND_TYPES.has(backgroundType)) {
    merged.styling.backgroundType = merged.styling?.disableBubbles ? 'solid' : 'animated';
  }
  merged.styling.backgroundColor = merged.styling.backgroundColor || DEFAULT_SETTINGS.styling.backgroundColor;
  merged.styling.backgroundImage = (merged.styling.backgroundImage || '').trim();

  // Cleanup legacy fields
  if ('disableBubbles' in merged.styling) {
    delete merged.styling.disableBubbles;
  }

  return merged;
}

export function getDefaultSettings() {
  return structuredClone(DEFAULT_SETTINGS);
}

export function getSettings() {
  return settingsCache;
}

export function updateSettings(partialSettings = {}) {
  const merged = deepMerge(structuredClone(settingsCache), partialSettings);
  settingsCache = normalizeSettings(merged);
  persistSettings();
  listeners.forEach((listener) => listener(settingsCache));
}

export function subscribeToSettings(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetSettings() {
  settingsCache = structuredClone(DEFAULT_SETTINGS);
  persistSettings();
  listeners.forEach((listener) => listener(settingsCache));
}

export function isBankVisible(bankValue, settings = settingsCache) {
  if (!bankValue) return true;
  const hiddenList = settings?.sampleBanks?.hidden || [];
  return !hiddenList.includes(bankValue);
}

export function getChaospadAxes(settings = settingsCache) {
  return structuredClone(settings?.chaospad?.axes || DEFAULT_CHAOSPAD_AXES);
}

export function getStylingSettings(settings = settingsCache) {
  return structuredClone(settings?.styling || DEFAULT_SETTINGS.styling);
}

export function toggleBankVisibility(bankValue, isVisible) {
  if (!bankValue) return;
  const hiddenList = new Set(settingsCache.sampleBanks?.hidden || []);
  if (!isVisible) {
    hiddenList.add(bankValue);
  } else {
    hiddenList.delete(bankValue);
  }
  updateSettings({
    sampleBanks: {
      hidden: Array.from(hiddenList)
    }
  });
}

