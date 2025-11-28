const SETTINGS_KEY = 'strudesk_settings_v1';

const DEFAULT_SETTINGS = {
  sampleBanks: {
    hidden: []
  },
  chaospad: {
    axes: {
      x: { effect: 'cutoff', min: 80, max: 8000 },
      y: { effect: 'resonance', min: 0.1, max: 5 }
    }
  },
  styling: {
    disableBubbles: false,
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
    return deepMerge(structuredClone(DEFAULT_SETTINGS), parsed);
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

export function getDefaultSettings() {
  return structuredClone(DEFAULT_SETTINGS);
}

export function getSettings() {
  return settingsCache;
}

export function updateSettings(partialSettings = {}) {
  settingsCache = deepMerge(structuredClone(settingsCache), partialSettings);
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

