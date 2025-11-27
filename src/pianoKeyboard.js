import { soundManager } from './soundManager.js';

const DEFAULT_OCTAVE = 3;

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

    const handlePlay = (event) => {
      if (event) {
        event.preventDefault();
      }
      playPianoNote(note, currentOctave, elementId, key);
    };

    key.addEventListener('mousedown', handlePlay);
    key.addEventListener('touchstart', handlePlay, { passive: false });
  });
}

export function initPianoSections(root = document) {
  if (!root) return;
  const sections = root.querySelectorAll('[data-piano-section]');
  sections.forEach(initSection);
}

