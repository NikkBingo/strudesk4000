const CONTEXT_CONFIG = {
  modal: {
    mountId: 'modal-theory-block',
    timeGroupSelector: '#modal-time-signature-group',
    keyGroupSelector: '#modal-key-scale-group',
    chordSelectors: ['#modal-scale-chord-suggestions']
  },
  collab: {
    mountId: 'collab-theory-block',
    timeGroupSelector: '#collab-time-signature-group',
    keyGroupSelector: '.collab-key-scale-grid',
    chordSelectors: ['.collab-chord-tools']
  }
};

export function getTheoryControlsTemplate(context) {
  if (context === 'modal') {
    return `
      <div class="form-group" id="modal-time-signature-group">
        <label for="modal-time-signature-select">Time Signature:</label>
        <select id="modal-time-signature-select" class="control-select" aria-label="Time Signature">
          <option value="4/4" selected>4/4 (Common Time)</option>
          <option value="3/4">3/4 (Waltz)</option>
          <option value="6/8">6/8</option>
          <option value="2/4">2/4 (March)</option>
          <option value="5/4">5/4</option>
          <option value="7/8">7/8</option>
          <option value="12/8">12/8</option>
          <option value="2/2">2/2 (Cut Time)</option>
          <option value="3/8">3/8</option>
          <option value="9/8">9/8</option>
          <option value="5/8">5/8</option>
          <option value="7/4">7/4</option>
        </select>
      </div>
      <div class="form-group" id="modal-key-scale-group" style="display: none;">
        <div style="display: flex; gap: 16px;">
          <div style="flex: 1;">
            <label for="modal-key-select">Key:</label>
            <select id="modal-key-select" class="control-select" aria-label="Key">
              <option value="">Select Key</option>
              <option value="C">C</option>
              <option value="C#">C#</option>
              <option value="Db">Db</option>
              <option value="D">D</option>
              <option value="D#">D#</option>
              <option value="Eb">Eb</option>
              <option value="E">E</option>
              <option value="F">F</option>
              <option value="F#">F#</option>
              <option value="Gb">Gb</option>
              <option value="G">G</option>
              <option value="G#">G#</option>
              <option value="Ab">Ab</option>
              <option value="A">A</option>
              <option value="A#">A#</option>
              <option value="Bb">Bb</option>
              <option value="B">B</option>
            </select>
          </div>
          <div style="flex: 1;">
            <label for="modal-scale-select">Scale:</label>
            <select id="modal-scale-select" class="control-select" aria-label="Scale">
              <option value="chromatic" selected>Chromatic</option>
              <optgroup label="Diatonic (Major Scale) Modes">
                <option value="ionian">Ionian (Major)</option>
                <option value="dorian">Dorian</option>
                <option value="phrygian">Phrygian</option>
                <option value="lydian">Lydian</option>
                <option value="mixolydian">Mixolydian</option>
                <option value="aeolian">Aeolian (Natural Minor)</option>
                <option value="locrian">Locrian</option>
              </optgroup>
              <optgroup label="Melodic Minor Modes (Jazz Melodic Minor)">
                <option value="melodic minor">Melodic Minor (Jazz Minor)</option>
                <option value="dorian b2">Dorian ♭2</option>
                <option value="lydian augmented">Lydian Augmented</option>
                <option value="lydian dominant">Lydian Dominant</option>
                <option value="mixolydian b6">Mixolydian ♭6</option>
                <option value="locrian #2">Locrian ♮2</option>
                <option value="altered">Altered Scale (Super-Locrian)</option>
              </optgroup>
              <optgroup label="Harmonic Major Modes">
                <option value="harmonic major">Harmonic Major</option>
                <option value="dorian b5">Dorian ♭5</option>
                <option value="phrygian b4">Phrygian ♭4</option>
                <option value="lydian b3">Lydian ♭3</option>
                <option value="mixolydian b2">Mixolydian ♭2</option>
                <option value="lydian augmented #2">Lydian Augmented ♯2</option>
                <option value="locrian bb7">Locrian ♭♭7</option>
              </optgroup>
              <optgroup label="Harmonic Minor Modes">
                <option value="harmonic minor">Harmonic Minor</option>
                <option value="locrian #6">Locrian ♮6</option>
                <option value="ionian #5">Ionian ♯5</option>
                <option value="dorian #4">Dorian ♯4</option>
                <option value="phrygian dominant">Phrygian Dominant</option>
                <option value="lydian #2">Lydian ♯2</option>
                <option value="ultralocrian">Ultralocrian</option>
              </optgroup>
              <optgroup label="Pentatonic Modes (Major Pentatonic)">
                <option value="major pentatonic">Major Pentatonic</option>
                <option value="suspended pentatonic">Suspended Pentatonic</option>
                <option value="man gong">Man Gong</option>
                <option value="ritusen">Ritusen</option>
                <option value="minor pentatonic mode 5">Minor Pentatonic Mode 5</option>
              </optgroup>
              <optgroup label="Pentatonic Modes (Minor Pentatonic)">
                <option value="minor pentatonic">Minor Pentatonic</option>
                <option value="blues minor pentatonic">Blues Minor (no ♭5)</option>
                <option value="major pentatonic mode 3">Major Pentatonic Mode 3</option>
                <option value="egyptian">Egyptian</option>
                <option value="minor pentatonic mode 5">Minor Pentatonic Mode 5</option>
              </optgroup>
              <optgroup label="Other Scale Systems">
                <option value="whole tone">Whole Tone</option>
                <option value="half-whole diminished">Half–Whole</option>
                <option value="whole-half diminished">Whole–Half</option>
                <option value="minor blues">Minor Blues</option>
              </optgroup>
            </select>
            <div id="modal-scale-notes-display" style="font-size: 0.85em; color: #666; margin-top: 4px; font-style: italic;"></div>
          </div>
        </div>
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
      </div>
    `;
  }

  if (context === 'collab') {
    return `
      <div class="collab-theory-block">
        <div class="form-group collab-time-signature" id="collab-time-signature-group">
          <label for="collab-channel-time-signature">Time Signature:</label>
          <select id="collab-channel-time-signature" class="control-select" aria-label="Time Signature">
            <option value="4/4" selected>4/4 (Common Time)</option>
            <option value="3/4">3/4 (Waltz)</option>
            <option value="6/8">6/8</option>
            <option value="2/4">2/4 (March)</option>
            <option value="5/4">5/4</option>
            <option value="7/8">7/8</option>
            <option value="12/8">12/8</option>
            <option value="2/2">2/2 (Cut Time)</option>
            <option value="3/8">3/8</option>
            <option value="9/8">9/8</option>
            <option value="5/8">5/8</option>
            <option value="7/4">7/4</option>
          </select>
        </div>
        <div class="collab-key-scale-grid">
          <div class="form-group">
            <label for="collab-key-select">Key:</label>
            <select id="collab-key-select" class="control-select" aria-label="Key">
              <option value="">Select Key</option>
              <option value="C">C</option>
              <option value="C#">C#</option>
              <option value="Db">Db</option>
              <option value="D">D</option>
              <option value="D#">D#</option>
              <option value="Eb">Eb</option>
              <option value="E">E</option>
              <option value="F">F</option>
              <option value="F#">F#</option>
              <option value="Gb">Gb</option>
              <option value="G">G</option>
              <option value="G#">G#</option>
              <option value="Ab">Ab</option>
              <option value="A">A</option>
              <option value="A#">A#</option>
              <option value="Bb">Bb</option>
              <option value="B">B</option>
            </select>
          </div>
          <div class="form-group">
            <label for="collab-scale-select">Scale:</label>
            <select id="collab-scale-select" class="control-select" aria-label="Scale">
              <option value="chromatic" selected>Chromatic</option>
              <option value="ionian">Ionian (Major)</option>
              <option value="dorian">Dorian</option>
              <option value="phrygian">Phrygian</option>
              <option value="lydian">Lydian</option>
              <option value="mixolydian">Mixolydian</option>
              <option value="aeolian">Aeolian (Natural Minor)</option>
              <option value="locrian">Locrian</option>
              <option value="melodic minor">Melodic Minor</option>
            </select>
          </div>
        </div>
        <div class="collab-chord-tools">
          <label for="collab-chord-select">Chords</label>
          <div class="collab-chord-row">
            <select id="collab-chord-select" class="control-select">
              <option value="">Add a chord progression…</option>
              <option value="i-iv-v">I · IV · V</option>
              <option value="ii-v-i">ii · V · I</option>
              <option value="lofi-walk">Lo-fi walk</option>
            </select>
            <label class="collab-note-mode-toggle">
              <input type="checkbox" id="collab-note-mode-toggle" />
              <span id="collab-note-mode-label">Note names</span>
            </label>
          </div>
        </div>
      </div>
    `;
  }

  throw new Error(`Unknown theory block context: ${context}`);
}

export function updateTheoryControlsVisibility(context, { showTimeSignature, showKeyScale }) {
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
}

