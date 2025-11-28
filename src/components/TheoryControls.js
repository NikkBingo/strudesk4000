const CONTEXT_CONFIG = {
  modal: {
    mountId: 'modal-theory-block',
    timeGroupSelector: '#modal-time-signature-group',
    keyGroupSelector: '#modal-key-scale-group',
    chordSelectors: ['#modal-scale-chord-suggestions'],
    timeGroupClass: 'form-group',
    timeGroupId: 'modal-time-signature-group',
    timeSelectId: 'modal-time-signature-select',
    keyGridClass: 'form-group',
    keyGridId: 'modal-key-scale-group',
    keySelectId: 'modal-key-select',
    scaleSelectId: 'modal-scale-select',
    scaleNotesId: 'modal-scale-notes-display',
    keyGridStyle: 'display: none;',
    pianoElementId: 'modal-piano'
  },
  collab: {
    mountId: 'collab-theory-block',
    timeGroupSelector: '#collab-time-signature-group',
    keyGroupSelector: '.collab-key-scale-grid',
    chordSelectors: ['.collab-chord-tools'],
    timeGroupClass: 'form-group collab-time-signature',
    timeGroupId: 'collab-time-signature-group',
    timeSelectId: 'collab-channel-time-signature',
    keyGridClass: 'collab-key-scale-grid',
    keyGridId: 'collab-key-scale-group',
    keySelectId: 'collab-key-select',
    scaleSelectId: 'collab-scale-select',
    scaleNotesId: 'collab-scale-notes-display',
    keyGridStyle: '',
    pianoElementId: 'collab-piano'
  }
};

const KEY_OPTIONS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];

const TIME_SIGNATURE_OPTIONS = [
  { value: '4/4', label: '4/4 (Common Time)', selected: true },
  { value: '3/4', label: '3/4 (Waltz)' },
  { value: '6/8', label: '6/8' },
  { value: '2/4', label: '2/4 (March)' },
  { value: '5/4', label: '5/4' },
  { value: '7/8', label: '7/8' },
  { value: '12/8', label: '12/8' },
  { value: '2/2', label: '2/2 (Cut Time)' },
  { value: '3/8', label: '3/8' },
  { value: '9/8', label: '9/8' },
  { value: '5/8', label: '5/8' },
  { value: '7/4', label: '7/4' }
];

const SCALE_GROUPS = [
  {
    label: 'Diatonic (Major Scale) Modes',
    options: [
      { value: 'ionian', label: 'Ionian (Major)' },
      { value: 'dorian', label: 'Dorian' },
      { value: 'phrygian', label: 'Phrygian' },
      { value: 'lydian', label: 'Lydian' },
      { value: 'mixolydian', label: 'Mixolydian' },
      { value: 'aeolian', label: 'Aeolian (Natural Minor)' },
      { value: 'locrian', label: 'Locrian' }
    ]
  },
  {
    label: 'Melodic Minor Modes (Jazz Melodic Minor)',
    options: [
      { value: 'melodic minor', label: 'Melodic Minor (Jazz Minor)' },
      { value: 'dorian b2', label: 'Dorian ♭2' },
      { value: 'lydian augmented', label: 'Lydian Augmented' },
      { value: 'lydian dominant', label: 'Lydian Dominant' },
      { value: 'mixolydian b6', label: 'Mixolydian ♭6' },
      { value: 'locrian #2', label: 'Locrian ♮2' },
      { value: 'altered', label: 'Altered Scale (Super-Locrian)' }
    ]
  },
  {
    label: 'Harmonic Major Modes',
    options: [
      { value: 'harmonic major', label: 'Harmonic Major' },
      { value: 'dorian b5', label: 'Dorian ♭5' },
      { value: 'phrygian b4', label: 'Phrygian ♭4' },
      { value: 'lydian b3', label: 'Lydian ♭3' },
      { value: 'mixolydian b2', label: 'Mixolydian ♭2' },
      { value: 'lydian augmented #2', label: 'Lydian Augmented ♯2' },
      { value: 'locrian bb7', label: 'Locrian ♭♭7' }
    ]
  },
  {
    label: 'Harmonic Minor Modes',
    options: [
      { value: 'harmonic minor', label: 'Harmonic Minor' },
      { value: 'locrian #6', label: 'Locrian ♮6' },
      { value: 'ionian #5', label: 'Ionian ♯5' },
      { value: 'dorian #4', label: 'Dorian ♯4' },
      { value: 'phrygian dominant', label: 'Phrygian Dominant' },
      { value: 'lydian #2', label: 'Lydian ♯2' },
      { value: 'ultralocrian', label: 'Ultralocrian' }
    ]
  },
  {
    label: 'Pentatonic Modes (Major Pentatonic)',
    options: [
      { value: 'major pentatonic', label: 'Major Pentatonic' },
      { value: 'suspended pentatonic', label: 'Suspended Pentatonic' },
      { value: 'man gong', label: 'Man Gong' },
      { value: 'ritusen', label: 'Ritusen' },
      { value: 'minor pentatonic mode 5', label: 'Minor Pentatonic Mode 5' }
    ]
  },
  {
    label: 'Pentatonic Modes (Minor Pentatonic)',
    options: [
      { value: 'minor pentatonic', label: 'Minor Pentatonic' },
      { value: 'blues minor pentatonic', label: 'Blues Minor (no ♭5)' },
      { value: 'major pentatonic mode 3', label: 'Major Pentatonic Mode 3' },
      { value: 'egyptian', label: 'Egyptian' },
      { value: 'minor pentatonic mode 5', label: 'Minor Pentatonic Mode 5' }
    ]
  },
  {
    label: 'Other Scale Systems',
    options: [
      { value: 'whole tone', label: 'Whole Tone' },
      { value: 'half-whole diminished', label: 'Half–Whole' },
      { value: 'whole-half diminished', label: 'Whole–Half' },
      { value: 'minor blues', label: 'Minor Blues' }
    ]
  }
];

const CHORD_PRESET_OPTIONS = [
  { value: 'i-iv-v', label: 'I · IV · V' },
  { value: 'ii-v-i', label: 'ii · V · I' },
  { value: 'lofi-walk', label: 'Lo-fi walk' }
];

const keyOptionsHtml = `<option value="">Select Key</option>${KEY_OPTIONS.map((value) => `<option value="${value}">${value}</option>`).join('')}`;

const timeSignatureOptionsHtml = TIME_SIGNATURE_OPTIONS.map((option) =>
  `<option value="${option.value}"${option.selected ? ' selected' : ''}>${option.label}</option>`
).join('');

const scaleOptionsHtml = [
  '<option value="chromatic" selected>Chromatic</option>',
  SCALE_GROUPS.map((group) => {
    const options = group.options.map((option) => `<option value="${option.value}">${option.label}</option>`).join('');
    return `<optgroup label="${group.label}">${options}</optgroup>`;
  }).join('')
].join('');

function renderTimeSignatureBlock(context) {
  const config = CONTEXT_CONFIG[context];
  if (!config) return '';
  return `
    <div class="${config.timeGroupClass}" id="${config.timeGroupId}">
      <label for="${config.timeSelectId}">Time Signature:</label>
      <select id="${config.timeSelectId}" class="control-select" aria-label="Time Signature">
        ${timeSignatureOptionsHtml}
      </select>
    </div>
  `;
}

function renderKeyScaleBlock(context) {
  const config = CONTEXT_CONFIG[context];
  if (!config) return '';
  const style = config.keyGridStyle ? ` style="${config.keyGridStyle}"` : '';
  return `
    <div class="${config.keyGridClass}" id="${config.keyGridId || ''}"${style}>
      <div class="form-group">
        <label for="${config.keySelectId}">Key:</label>
        <select id="${config.keySelectId}" class="control-select" aria-label="Key">
          ${keyOptionsHtml}
        </select>
      </div>
      <div class="form-group">
        <label for="${config.scaleSelectId}">Scale:</label>
        <select id="${config.scaleSelectId}" class="control-select" aria-label="Scale">
          ${scaleOptionsHtml}
        </select>
        <div id="${config.scaleNotesId}" class="theory-scale-notes-hint"></div>
      </div>
    </div>
  `;
}

function renderModalChordSuggestions() {
  return `
    <div class="scale-chord-suggestions" id="modal-scale-chord-suggestions" aria-live="polite">
      <div class="scale-chord-suggestions__header">
        <p id="modal-scale-chord-title">Select a key and scale to view chord progressions.</p>
        <p id="modal-scale-characteristic" class="scale-chord-suggestions__characteristic"></p>
      </div>
      <div class="scale-chord-suggestions__dropdown-wrapper">
        <label for="modal-chord-progression-select" class="scale-chord-suggestions__label">Chord Progressions:</label>
        <select id="modal-chord-progression-select" class="scale-chord-suggestions__select">
          <option value="">Select a progression...</option>
        </select>
      </div>
    </div>
  `;
}

function renderCollabChordTools() {
  const chordOptions = [
    '<option value="">Add a chord progression…</option>',
    CHORD_PRESET_OPTIONS.map((option) => `<option value="${option.value}">${option.label}</option>`).join('')
  ].join('');
  return `
    <div class="collab-chord-tools">
      <label for="collab-chord-select">Chords</label>
      <div class="collab-chord-row">
        <select id="collab-chord-select" class="control-select">
          ${chordOptions}
        </select>
        <label class="collab-note-mode-toggle">
          <input type="checkbox" id="collab-note-mode-toggle" />
          <span id="collab-note-mode-label">Note names</span>
        </label>
      </div>
    </div>
  `;
}

function renderPianoSection(context) {
  const config = CONTEXT_CONFIG[context];
  if (!config) return '';
  const elementId = config.pianoElementId || `${context}-piano`;
  return `
    <div class="piano-section" data-piano-section data-piano-context="${context}" data-piano-element-id="${elementId}" hidden>
      <div class="piano-header">
        <h3>Interactive Piano</h3>
        <div class="piano-octave-controls">
          <label>Octave:</label>
          <button class="piano-octave-btn" data-piano-octave="1">1</button>
          <button class="piano-octave-btn" data-piano-octave="2">2</button>
          <button class="piano-octave-btn active" data-piano-octave="3">3</button>
          <button class="piano-octave-btn" data-piano-octave="4">4</button>
          <button class="piano-octave-btn" data-piano-octave="5">5</button>
        </div>
      </div>
      <div class="piano-keyboard" data-piano-keys>
        <button class="piano-key white" data-note="C">C</button>
        <button class="piano-key black" data-note="C#">C#</button>
        <button class="piano-key white" data-note="D">D</button>
        <button class="piano-key black" data-note="D#">D#</button>
        <button class="piano-key white" data-note="E">E</button>
        <button class="piano-key white" data-note="F">F</button>
        <button class="piano-key black" data-note="F#">F#</button>
        <button class="piano-key white" data-note="G">G</button>
        <button class="piano-key black" data-note="G#">G#</button>
        <button class="piano-key white" data-note="A">A</button>
        <button class="piano-key black" data-note="A#">A#</button>
        <button class="piano-key white" data-note="B">B</button>
      </div>
    </div>
  `;
}

export function getTheoryControlsTemplate(context) {
  if (context === 'modal') {
    return [
      renderTimeSignatureBlock(context),
      renderKeyScaleBlock(context),
      renderModalChordSuggestions(),
      renderPianoSection(context)
    ].join('\n');
  }

  if (context === 'collab') {
    return `
      <div class="collab-theory-block">
        <div class="collab-channel-editor-tools">
          <div class="form-group collab-mode-toggle-group">
            <label>Editor mode</label>
            <div class="collab-mode-switch">
              <span class="collab-mode-label collab-mode-label--code">Code</span>
              <label class="toggle-switch collab-mode-toggle">
                <input type="checkbox" id="collab-editor-mode-toggle" aria-label="Toggle step editor" />
                <span class="toggle-slider"></span>
              </label>
              <span class="collab-mode-label collab-mode-label--step">Step</span>
            </div>
          </div>
        </div>
        ${renderTimeSignatureBlock(context)}
        ${renderKeyScaleBlock(context)}
        ${renderCollabChordTools()}
        ${renderPianoSection(context)}
      </div>
    `;
  }

  throw new Error(`Unknown theory block context: ${context}`);
}

export function updateTheoryControlsVisibility(context, { showTimeSignature, showKeyScale, showPiano }) {
  const config = CONTEXT_CONFIG[context];
  if (!config) return;

  const timeGroup = document.querySelector(config.timeGroupSelector);
  if (timeGroup) {
    timeGroup.style.display = showTimeSignature ? '' : 'none';
  }

  const keyGroup = document.querySelector(config.keyGroupSelector);
  if (keyGroup) {
    keyGroup.style.display = showKeyScale ? '' : 'none';
  }

  if (Array.isArray(config.chordSelectors)) {
    config.chordSelectors.forEach((selector) => {
      const el = document.querySelector(selector);
      if (el) {
        el.style.display = showKeyScale ? '' : 'none';
      }
    });
  }

  const mount = config.mountId ? document.getElementById(config.mountId) : null;
  const pianoSection = mount?.querySelector('[data-piano-section]');
  if (pianoSection) {
    const shouldShow = !!showPiano;
    if (shouldShow) {
      pianoSection.hidden = false;
      pianoSection.classList.remove('piano-section--hidden');
      pianoSection.style.removeProperty('display');
    } else {
      pianoSection.hidden = true;
      pianoSection.classList.add('piano-section--hidden');
      pianoSection.style.setProperty('display', 'none', 'important');
    }
  }
}

