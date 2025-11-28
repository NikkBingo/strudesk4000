import { soundManager } from './soundManager.js';
import { Note } from '@tonaljs/tonal';

const DEFAULT_OCTAVE = 3;

const PIANO_CONTEXTS = {
  modal: {
    textareaSelector: '#modal-pattern',
    keySelector: '#modal-key-select',
    scaleSelector: '#modal-scale-select',
    resolveNoteMode() {
      return 'note';
    }
  },
  collab: {
    textareaSelector: '#collab-channel-code',
    keySelector: '#collab-key-select',
    scaleSelector: '#collab-scale-select',
    resolveNoteMode() {
      const toggle = document.getElementById('collab-note-mode-toggle');
      return toggle?.checked ? 'semitone' : 'note';
    }
  }
};

function getTextareaForContext(contextConfig) {
  if (!contextConfig || !contextConfig.textareaSelector) return null;
  return document.querySelector(contextConfig.textareaSelector);
}

function getSelectedValue(selector, fallback = '') {
  if (!selector) return fallback;
  const el = document.querySelector(selector);
  if (!el) return fallback;
  return el.value || fallback;
}

function normalizeKeyValue(keyValue) {
  if (!keyValue || typeof keyValue !== 'string') {
    return 'C';
  }
  const trimmed = keyValue.trim();
  return trimmed || 'C';
}

function normalizeScaleValue(scaleValue) {
  if (!scaleValue || typeof scaleValue !== 'string') {
    return 'chromatic';
  }
  const trimmed = scaleValue.trim();
  return trimmed || 'chromatic';
}

function getRootMidi(keyValue) {
  const normalized = normalizeKeyValue(keyValue);
  const info = Note.get(`${normalized}4`);
  return Number.isFinite(info.midi) ? info.midi : 60;
}

function ensureScaleSteps(keyValue, scaleValue) {
  if (!soundManager?.getScaleSemitoneSteps) {
    return null;
  }
  const steps = soundManager.getScaleSemitoneSteps(normalizeKeyValue(keyValue), normalizeScaleValue(scaleValue));
  if (Array.isArray(steps) && steps.length > 0) {
    return steps;
  }
  return null;
}

function convertNoteToScaleDegree(noteName, octave, keyValue, scaleValue) {
  const info = Note.get(`${noteName}${octave}`);
  if (!info || !Number.isFinite(info.midi)) {
    return null;
  }
  const rootMidi = getRootMidi(keyValue);
  const steps = ensureScaleSteps(keyValue, scaleValue);
  const semitoneOffset = info.midi - rootMidi;

  if (!steps || !steps.length) {
    return semitoneOffset;
  }

  const relative = ((semitoneOffset % 12) + 12) % 12;
  const degreeIndex = steps.indexOf(relative);
  if (degreeIndex === -1) {
    return null;
  }
  const octaveOffset = Math.floor((semitoneOffset - steps[degreeIndex]) / 12);
  return octaveOffset * steps.length + degreeIndex;
}

function insertTokenIntoPattern(pattern, token, targetFn) {
  const workingPattern = pattern || '';
  const fnRegex = targetFn === 'n'
    ? /\bn\s*\(\s*(["'])([\s\S]*?)\1\s*\)/
    : /\bnote\s*\(\s*(["'])([\s\S]*?)\1\s*\)/;
  const match = workingPattern.match(fnRegex);

  if (match) {
    const [fullMatch, quote, existingContent] = match;
    const trimmedContent = existingContent.trim();
    const newContent = trimmedContent ? `${trimmedContent} ${token}` : token;
    const replacement = `${targetFn}(${quote}${newContent}${quote})`;
    const startIndex = match.index ?? 0;
    return `${workingPattern.slice(0, startIndex)}${replacement}${workingPattern.slice(startIndex + fullMatch.length)}`;
  }

  const snippet = targetFn === 'n'
    ? `n("${token}")`
    : `note("${token}")`;
  const prefix = workingPattern.trimEnd();
  const separator = prefix ? '\n' : '';
  return `${prefix}${separator}${snippet}\n`;
}

function resolveTargetFunction(pattern, preferredMode) {
  if (/\bn\s*\(/i.test(pattern)) {
    return 'n';
  }
  if (/\bnote\s*\(/i.test(pattern)) {
    return 'note';
  }
  return preferredMode === 'semitone' ? 'n' : 'note';
}

function addNoteFromPiano(context, noteName, octave) {
  const contextConfig = PIANO_CONTEXTS[context];
  if (!contextConfig) return false;
  const textarea = getTextareaForContext(contextConfig);
  if (!textarea) return false;

  const keyValue = getSelectedValue(contextConfig.keySelector, 'C');
  const scaleValue = getSelectedValue(contextConfig.scaleSelector, 'chromatic');
  const preferredMode = contextConfig.resolveNoteMode?.() === 'semitone' ? 'semitone' : 'note';
  const currentValue = textarea.value || '';
  const targetFn = resolveTargetFunction(currentValue, preferredMode);

  let token = `${noteName}${octave}`;
  if (targetFn === 'n') {
    const degree = convertNoteToScaleDegree(noteName, octave, keyValue, scaleValue);
    if (!Number.isFinite(degree)) {
      console.warn(`⚠️ Unable to map ${noteName}${octave} to scale degrees (key=${keyValue}, scale=${scaleValue})`);
      return false;
    }
    token = String(degree);
  }

  const updated = insertTokenIntoPattern(currentValue, token, targetFn);
  if (!updated) {
    return false;
  }
  textarea.value = updated;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

async function playPianoNote(note, octave, elementId, keyEl) {
  if (!note) return;

  if (!soundManager.isAudioReady()) {
    const success = await soundManager.initialize();
    if (!success) {
      console.warn('⚠️ Unable to initialize audio for piano keyboard');
      return;
    }
  }

  if (soundManager.audioContext && soundManager.audioContext.state === 'suspended') {
    try {
      await soundManager.audioContext.resume();
      await new Promise(resolve => setTimeout(resolve, 30));
    } catch (error) {
      console.warn('⚠️ Failed to resume audio context for piano keyboard:', error);
    }
  }

  if (!soundManager.isAudioReady()) {
    console.warn('⚠️ Audio context not ready for piano playback');
    return;
  }

  const fullNote = `${note}${octave}`;
  const pattern = `note("${fullNote}").s("piano")`;
  try {
    await soundManager.playStrudelPattern(elementId, pattern);
    if (keyEl) {
      keyEl.classList.add('active');
      setTimeout(() => keyEl.classList.remove('active'), 150);
    }
  } catch (error) {
    console.warn('⚠️ Unable to play piano note:', error);
  }
}

function initSection(section) {
  if (!section || section.dataset.pianoInitialized === 'true') {
    return;
  }

  const keyboard = section.querySelector('[data-piano-keys]');
  if (!keyboard) return;

  section.dataset.pianoInitialized = 'true';

  const elementId = section.getAttribute('data-piano-element-id') || 'piano-keys';
  const context = section.getAttribute('data-piano-context') || 'modal';
  const octaveButtons = section.querySelectorAll('.piano-octave-btn');
  const activeBtn = section.querySelector('.piano-octave-btn.active');
  let currentOctave = activeBtn
    ? parseInt(activeBtn.dataset.pianoOctave || `${DEFAULT_OCTAVE}`, 10)
    : DEFAULT_OCTAVE;

  if (Number.isNaN(currentOctave)) {
    currentOctave = DEFAULT_OCTAVE;
  }

  if (!activeBtn && octaveButtons.length > 0) {
    const fallbackBtn = octaveButtons[0];
    fallbackBtn.classList.add('active');
    const fallbackValue = parseInt(fallbackBtn.dataset.pianoOctave || `${DEFAULT_OCTAVE}`, 10);
    if (!Number.isNaN(fallbackValue)) {
      currentOctave = fallbackValue;
    }
  }

  const setActiveOctave = (value, btn) => {
    currentOctave = value;
    octaveButtons.forEach(button => button.classList.remove('active'));
    if (btn) {
      btn.classList.add('active');
    }
  };

  octaveButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const next = parseInt(btn.dataset.pianoOctave, 10);
      if (!Number.isNaN(next)) {
        setActiveOctave(next, btn);
      }
    });
  });

  const keys = keyboard.querySelectorAll('.piano-key');
  keys.forEach(key => {
    const note = key.dataset.note;
    if (!note) return;

    const handlePressStart = (event) => {
      if (event) {
        event.preventDefault();
      }
      addNoteFromPiano(context, note, currentOctave);
      playPianoNote(note, currentOctave, elementId, key);
    };

    key.addEventListener('mousedown', handlePressStart);
    key.addEventListener('touchstart', handlePressStart, { passive: false });
  });
}

export function initPianoSections(root = document) {
  if (!root) return;
  const sections = root.querySelectorAll('[data-piano-section]');
  sections.forEach(initSection);
}

