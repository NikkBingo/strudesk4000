import { collabAPI, usersAPI } from '../api.js';
import { getStrudelEditorValue, setStrudelEditorValue } from '../strudelReplEditor.js';
import { collaborationClient } from '../collaboration/socketClient.js';
import { lockScroll, unlockScroll } from '../scrollLock.js';
import { DRUM_BANK_VALUES, SYNTH_BANK_ALIASES, parseBankSelectionValue } from '../constants/banks.js';
import { getTheoryControlsTemplate, updateTheoryControlsVisibility } from './TheoryControls.js';
import { soundManager } from '../soundManager.js';
import { initPianoSections } from '../pianoKeyboard.js';

const STATUS_VARIANTS = {
  info: 'info',
  success: 'success',
  error: 'error'
};

const STEP_EDITOR_ROWS = [
  { key: 'bd', label: 'Kick', sample: 'bd' },
  { key: 'sd', label: 'Snare', sample: 'sd' },
  { key: 'hh', label: 'Hi-hat', sample: 'hh' },
  { key: 'oh', label: 'Open hat', sample: 'oh' },
  { key: 'cp', label: 'Clap', sample: 'cp' },
  { key: 'perc', label: 'Perc', sample: 'perc' }
];

const TIME_SIGNATURE_STEPS = {
  '2/4': 8,
  '3/4': 12,
  '4/4': 16,
  '5/4': 20,
  '6/8': 12,
  '7/4': 28,
  '7/8': 14,
  '9/8': 18,
  '12/8': 24,
  '2/2': 16,
  '3/8': 6,
  '5/8': 10
};

const DEFAULT_TIME_SIGNATURE = '4/4';

const CHORD_PRESETS = [
  {
    id: 'i-iv-v',
    label: 'I · IV · V',
    noteSnippet: 'note("c4 e4 g4").slow(2) ++ note("f4 a4 c5").slow(2) ++ note("g4 b4 d5").slow(2)',
    semitoneSnippet: 'n("0 4 7").slow(2) ++ n("5 9 12").slow(2) ++ n("7 11 14").slow(2)'
  },
  {
    id: 'ii-v-i',
    label: 'ii · V · I',
    noteSnippet: 'note("d4 f4 a4").slow(2) ++ note("g3 b3 d4").slow(2) ++ note("c4 e4 g4").slow(2)',
    semitoneSnippet: 'n("2 5 9").slow(2) ++ n("7 11 14").slow(2) ++ n("0 4 7").slow(2)'
  },
  {
    id: 'lofi-walk',
    label: 'Lo-fi walk',
    noteSnippet: 'note("c4 e4 g4").stack(note("b3 d4 g4")).slow(2)',
    semitoneSnippet: 'n("0 4 7").stack(n("11 2 7")).slow(2)'
  }
];

const NOTE_MODE = {
  NOTE: 'note',
  SEMITONE: 'semitone'
};

const MASTER_CHANNEL_STATUSES = new Set(['live', 'published']);

const AUTHOR_COLOR_PALETTE = [
  { bg: '#fff1f2', border: '#fda4af' },
  { bg: '#fefce8', border: '#fcd34d' },
  { bg: '#ecfccb', border: '#bef264' },
  { bg: '#cffafe', border: '#67e8f9' },
  { bg: '#e0e7ff', border: '#a5b4fc' },
  { bg: '#fdf2f8', border: '#f9a8d4' },
  { bg: '#fffbeb', border: '#fcd34d' }
];

const CODE_META_PREFIX = '// @meta';

export class CollabPanel {
  constructor(socketClient = collaborationClient) {
    this.root = null;
    this.overlay = null;
    this.closeBtn = null;
    this.socketClient = socketClient;
    this.currentSnapshot = null;
    this.currentUser = null;
    this.statusTimer = null;
    this.boundHandlers = [];
    this.isOpen = false;
    this.pendingInvites = [];
    this.recentSessions = [];
    this.inviteSearchResults = [];
    this.selectedInvitees = [];
    this.inviteSearchTimeout = null;
    this.channelEditorState = this.createDefaultEditorState();
    this.channelTitleAuto = true;
    this.channelLastChordLabel = null;
    this.lineNumberElement = null;
    this.modeToggleSwitch = null;
    this.userColorAssignments = new Map();
    this.userColorIndex = 0;
    this.masterPlaybackActive = false;
  }

  createDefaultEditorState() {
    const steps = TIME_SIGNATURE_STEPS[DEFAULT_TIME_SIGNATURE] || 16;
    return {
      mode: 'code',
      timeSignature: DEFAULT_TIME_SIGNATURE,
      stepsPerBar: steps,
      gridSelections: this.createEmptyGridSelections(steps),
      noteMode: NOTE_MODE.NOTE,
      bankValue: '',
      key: '',
      scale: 'chromatic'
    };
  }

  createEmptyGridSelections(stepsPerBar) {
    const selections = {};
    STEP_EDITOR_ROWS.forEach((row) => {
      selections[row.key] = new Array(stepsPerBar).fill(false);
    });
    return selections;
  }

  init() {
    this.ensureModal();
    if (!this.root) return;
    this.render();
    this.attachEvents();
    this.bindSocketEvents();
    this.updateAuthState();
  }

  ensureModal() {
    if (this.overlay && this.root) {
      return;
    }
    if (!document.getElementById('collab-modal-overlay')) {
      const template = `
        <div class="collab-modal-overlay" id="collab-modal-overlay" style="display: none;">
          <div class="collab-modal">
            <button type="button" class="collab-modal-close" id="collab-modal-close" aria-label="Close collaboration panel">&times;</button>
            <div class="collab-panel-wrapper">
              <div id="collab-panel-root"></div>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', template);
    }
    this.overlay = document.getElementById('collab-modal-overlay');
    this.root = this.overlay?.querySelector('#collab-panel-root') || null;
    this.closeBtn = this.overlay?.querySelector('#collab-modal-close') || null;
  }

  show() {
    if (!this.currentUser) {
      this.setStatus('Login to access live collaboration.', STATUS_VARIANTS.error, 2000);
      return;
    }
    this.ensureModal();
    if (!this.overlay) return;
    this.overlay.style.display = 'flex';
    lockScroll('collab-modal');
    this.isOpen = true;
    this.refreshUserInvites();
    this.refreshRecentSessions();
  }

  hide() {
    if (!this.overlay) return;
    this.overlay.style.display = 'none';
    unlockScroll('collab-modal');
    this.isOpen = false;
  }

  destroy() {
    this.boundHandlers.forEach((unbind) => unbind());
    this.boundHandlers = [];
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
      this.root = null;
      this.closeBtn = null;
    }
  }

  setCurrentUser(user) {
    this.currentUser = user;
    this.updateAuthState();
    if (user) {
      this.refreshUserInvites();
      this.refreshRecentSessions();
      this.renderInviteSearchResults();
      this.renderSelectedInvitees();
    } else {
      this.pendingInvites = [];
      this.recentSessions = [];
      this.inviteSearchResults = [];
      this.selectedInvitees = [];
      this.renderPendingInvites();
      this.renderRecentSessions();
      this.renderInviteSearchResults();
      this.renderSelectedInvitees();
    }
  }

  updateAuthState() {
    const disabled = !this.currentUser;
    const authGate = this.root?.querySelector('[data-collab-auth-message]');
    const inputs = this.root?.querySelectorAll('[data-collab-requires-auth]');
    if (inputs) {
      inputs.forEach((input) => {
        input.disabled = disabled;
      });
    }
    if (authGate) {
      authGate.style.display = disabled ? 'block' : 'none';
    }
    if (disabled && this.isOpen) {
      this.hide();
    }
  }

  render() {
    this.root.innerHTML = `
      <div class="collab-panel-header">
        <div>
          <h3>Live Collaboration</h3>
          <p id="collab-session-label">Not connected</p>
        </div>
        <div class="collab-connection-indicator" id="collab-connection-indicator" title="Socket status"></div>
      </div>
      <div class="collab-panel-body">
        <div class="collab-auth-gate" data-collab-auth-message>
          <p>Login to create or join a collaboration session.</p>
        </div>
        <div class="collab-form-row">
          <label for="collab-title-input">Session title</label>
          <div class="collab-form-controls">
            <input type="text" id="collab-title-input" placeholder="Friday night jam" data-collab-requires-auth />
            <button id="collab-create-btn" class="btn-primary" data-collab-requires-auth>Create session</button>
          </div>
        </div>
        <div class="collab-status-message" id="collab-status-message" role="status" aria-live="polite"></div>
        <section class="collab-recents-section">
          <div class="collab-list-header">
            <strong>Recent sessions</strong>
            <button id="collab-refresh-recents-btn" class="btn-link" type="button">Refresh</button>
          </div>
          <div id="collab-recents-list" class="collab-chip-list collab-empty-state">Log in to see your recent collaborations.</div>
        </section>
        <section class="collab-invites-section">
          <div class="collab-list-header">
            <strong>Invitations for you</strong>
            <button id="collab-refresh-invites-btn" class="btn-link" type="button">Refresh</button>
          </div>
          <div id="collab-my-invites" class="collab-invites-list collab-empty-state">No pending invites.</div>
        </section>
        <div class="collab-session-details" id="collab-session-details" hidden>
          <div class="collab-session-meta">
            <div><strong>Session reference:</strong> <span id="collab-share-code">—</span></div>
            <div><strong>Delay to apply:</strong>
              <input type="range" min="0" max="5000" step="50" id="collab-delay-slider" data-collab-requires-auth />
              <span id="collab-delay-value">0 ms</span>
            </div>
            <div class="collab-cpu-row">
              <span><strong>CPU avg:</strong> <span id="collab-cpu-load">n/a</span></span>
              <span><strong>Last server update:</strong> <span id="collab-cpu-updated">—</span></span>
              <span class="collab-cpu-warning" id="collab-cpu-warning"></span>
              <button id="collab-refresh-cpu-btn" class="btn-link" type="button">Refresh stats</button>
            </div>
          </div>
          <div class="collab-owner-tools" id="collab-owner-tools" hidden>
            <div class="collab-list-header">
              <strong>Invite collaborators (max 5 at a time)</strong>
            </div>
            <div class="collab-invite-search">
              <input type="text" id="collab-invite-search" placeholder="Search users by display name or email..." data-collab-requires-auth />
              <div id="collab-invite-results" class="collab-invite-results collab-empty-state">Start typing to search users.</div>
              <div id="collab-selected-invitees" class="collab-selected-invitees collab-empty-state">No users selected yet.</div>
              <small class="collab-helper-text" id="collab-selected-count">Selected 0 of 5 slots.</small>
              <div class="collab-channel-actions">
                <button id="collab-send-invite-btn" class="btn-primary" data-collab-requires-auth>Send invites</button>
              </div>
            </div>
            <small class="collab-helper-text">Selected users will receive an invite in their Live Collaboration panel.</small>
          </div>
          <div class="collab-participants">
            <div class="collab-list-header">
              <strong>Participants</strong>
              <button id="collab-leave-btn" class="btn-ghost danger" data-collab-requires-auth>Leave</button>
            </div>
            <ul id="collab-participants-list"></ul>
          </div>
          <div class="collab-channel-form">
            <div class="collab-list-header">
              <strong>Channel snippet</strong>
              <button id="collab-load-editor-btn" class="btn-link" type="button">Use master editor content</button>
            </div>
            <div class="collab-channel-config">
              <div class="collab-config-grid">
                <div class="form-group">
                  <label for="collab-pattern-bank">Sound Bank:</label>
                  <select id="collab-pattern-bank" class="control-select">
                  <optgroup label="Drums">
                    <option value="">Default</option>
                    <option value="RolandTR808">Roland TR-808</option>
                    <option value="RolandTR909">Roland TR-909</option>
                    <option value="RolandTR707">Roland TR-707</option>
                    <option value="RhythmAce">Rhythm Ace</option>
                    <option value="AkaiLinn">Akai Linn</option>
                    <option value="ViscoSpaceDrum">Visco Space Drum</option>
                    <option value="CasioRZ1">Casio RZ-1</option>
                  </optgroup>
                  <optgroup label="Basic Waveforms">
                    <option value="sine">Sine</option>
                    <option value="square">Square</option>
                    <option value="triangle">Triangle</option>
                    <option value="sawtooth">Sawtooth</option>
                  </optgroup>
                  <optgroup label="Sample-based Synths">
                    <option value="piano">Piano</option>
                    <option value="supersaw">Saw Synth</option>
                    <option value="casio">Casio</option>
                    <option value="jazz">Jazz</option>
                    <option value="metal">Metal</option>
                    <option value="folkharp">Folk Harp</option>
                  </optgroup>
                  </select>
                  <div class="pattern-help">
                    <small>Select a sound bank to load. Banks are loaded when selected.</small>
                  </div>
                </div>
                <div class="form-group">
                  <label for="collab-channel-title">Title:</label>
                  <input type="text" id="collab-channel-title" placeholder="e.g., My drum pattern" />
                </div>
              </div>
              <div id="collab-theory-block"></div>
            </div>
            <div class="collab-step-editor" id="collab-step-editor" hidden>
              <div class="collab-step-grid" id="collab-step-grid"></div>
              <p class="collab-step-hint">Click steps to toggle hits. Multi-hits create stacked samples.</p>
            </div>
            <div class="collab-channel-editor">
              <div class="pattern-label-row">
                <label for="collab-channel-code">Pattern</label>
              </div>
              <div class="collab-pattern-wrapper">
                <div class="collab-line-numbers" id="collab-line-numbers" aria-hidden="true"></div>
                <textarea id="collab-channel-code" class="collab-pattern-input" rows="6" placeholder="// Write the pattern you want to push"></textarea>
              </div>
              <div class="pattern-help">
                <small>
                  Drum sounds: https://strudel.cc/workshop/first-sounds/#drum-sounds ·
                  Synth sounds: https://strudel.cc/workshop/first-notes/#changing-the-sound
                </small>
              </div>
            </div>
            <div class="collab-channel-actions">
              <button id="collab-push-draft-btn" class="btn-secondary collab-action-button" data-collab-requires-auth>Save draft</button>
              <button id="collab-publish-btn" class="btn-primary collab-action-button" data-collab-requires-auth>Publish to master</button>
              <button
                id="collab-play-master-btn"
                class="play-master-button collab-play-master-button"
                type="button"
                title="Play master pattern"
                aria-label="Play master pattern"
                data-collab-requires-auth
              >▶</button>
            </div>
            <div class="collab-master-display">
              <div class="collab-list-header">
                <strong>Published Master Pattern</strong>
              </div>
              <div id="collab-master-pattern" class="collab-master-pattern-field" role="region" aria-live="polite"></div>
            </div>
          </div>
          <div class="collab-channels-list">
            <div class="collab-list-header">
              <strong>Recent submissions</strong>
              <button id="collab-refresh-session-btn" class="btn-link" type="button">Refresh snapshot</button>
            </div>
            <div id="collab-channels-container"></div>
          </div>
        </div>
      </div>
    `;
    const collabTheoryMount = this.root.querySelector('#collab-theory-block');
    if (collabTheoryMount) {
      collabTheoryMount.innerHTML = getTheoryControlsTemplate('collab');
      initPianoSections(collabTheoryMount);
    }
    this.renderPendingInvites();
    this.renderRecentSessions();
    this.renderInviteSearchResults();
    this.renderSelectedInvitees();
    this.initializeChannelFormControls();
    this.renderMasterPattern(this.currentSnapshot);
  }

  initializeChannelFormControls() {
    if (!this.root) return;
    if (!this.channelEditorState) {
      this.channelEditorState = this.createDefaultEditorState();
    }
    this.channelTextarea = this.root.querySelector('#collab-channel-code');
    this.lineNumberElement = this.root.querySelector('#collab-line-numbers');
    this.channelTitleInput = this.root.querySelector('#collab-channel-title');
    this.bankSelect = this.root.querySelector('#collab-pattern-bank');
    this.timeSignatureSelect = this.root.querySelector('#collab-channel-time-signature');
    this.keySelect = this.root.querySelector('#collab-key-select');
    this.scaleSelect = this.root.querySelector('#collab-scale-select');
    this.chordSelect = this.root.querySelector('#collab-chord-select');
    this.noteToggle = this.root.querySelector('#collab-note-mode-toggle');
    this.noteModeLabel = this.root.querySelector('#collab-note-mode-label');
    this.channelTitleAuto = !this.channelTitleInput || this.channelTitleInput.value.trim().length === 0;

    if (!this.channelTextarea) {
      return;
    }

    this.channelTextarea.addEventListener('input', () => {
      if (this.channelEditorState.mode === 'code') {
        this.channelEditorState.customCode = this.channelTextarea.value;
      }
      this.updatePatternLineNumbers();
    });

    this.channelTextarea.addEventListener('scroll', () => {
      if (this.lineNumberElement) {
        this.lineNumberElement.scrollTop = this.channelTextarea.scrollTop;
      }
    });

    this.channelTitleInput?.addEventListener('input', () => {
      this.handleTitleInputChange();
    });

    this.bankSelect?.addEventListener('change', (event) => {
      this.handleBankChange(event.target.value);
    });
    if (this.bankSelect) {
      this.channelEditorState.bankValue = this.bankSelect.value?.trim() || '';
    }

    this.timeSignatureSelect?.addEventListener('change', (event) => {
      this.handleTimeSignatureChange(event.target.value);
    });
    if (this.timeSignatureSelect) {
      const initialSignature = this.timeSignatureSelect.value || DEFAULT_TIME_SIGNATURE;
      this.channelEditorState.timeSignature = initialSignature;
      this.channelEditorState.stepsPerBar = TIME_SIGNATURE_STEPS[initialSignature] || 16;
    }

    this.keySelect?.addEventListener('change', (event) => {
      this.handleKeyChange(event.target.value);
    });

    this.scaleSelect?.addEventListener('change', (event) => {
      this.handleScaleChange(event.target.value);
    });
    if (this.keySelect) {
      this.channelEditorState.key = this.keySelect.value || '';
    }
    if (this.scaleSelect) {
      this.channelEditorState.scale = this.scaleSelect.value || 'chromatic';
    }

    this.chordSelect?.addEventListener('change', (event) => {
      this.handleChordSelection(event.target.value);
    });

    this.noteToggle?.addEventListener('change', (event) => {
      this.handleNoteModeToggle(event.target.checked);
    });

    this.modeToggleSwitch = this.root.querySelector('#collab-editor-mode-toggle');
    if (this.modeToggleSwitch && !this.modeToggleSwitch.dataset.listenerAttached) {
      this.modeToggleSwitch.addEventListener('change', (event) => {
        const nextMode = event.target.checked ? 'step' : 'code';
        this.setChannelEditorMode(nextMode);
      });
      this.modeToggleSwitch.dataset.listenerAttached = 'true';
    }

    this.buildStepEditorGrid();
    this.autoFillTitleFromBank();
    this.updateEditorModeButtons();
    this.updateEditorModeVisibility();
    if (this.channelEditorState.mode === 'step') {
      this.populateGridFromCode(this.channelTextarea.value);
      this.syncCodeFromGrid();
    } else {
      this.syncCodeAnnotationsFromState();
    }
    this.handleNoteModeToggle(this.channelEditorState.noteMode === NOTE_MODE.SEMITONE, { silent: true });
    this.updateTheoryBlockVisibility();
    this.updatePatternLineNumbers();
  }

  updateTheoryBlockVisibility() {
    const bankValue = this.channelEditorState?.bankValue || '';
    const isDrum = !!bankValue && DRUM_BANK_VALUES.has(bankValue);
    const isStepEditor = this.channelEditorState?.mode === 'step';
    const modeToggleWrapper = this.root?.querySelector('.collab-mode-toggle-group');
    if (modeToggleWrapper) {
      modeToggleWrapper.style.display = isDrum ? '' : 'none';
    }
    const stepEditor = this.root?.querySelector('#collab-step-editor');
    if (stepEditor) {
      stepEditor.hidden = !isDrum || this.channelEditorState.mode !== 'step';
    }
    updateTheoryControlsVisibility('collab', {
      showTimeSignature: isDrum && isStepEditor,
      showKeyScale: !!bankValue && !isDrum,
      showPiano: !!bankValue && !isDrum
    });
  }

  updatePatternLineNumbers() {
    if (!this.lineNumberElement || !this.channelTextarea) {
      return;
    }
    const value = this.channelTextarea.value || '';
    const lineCount = Math.max(value.split('\n').length, 1);
    const digits = Math.max(String(lineCount).length, 2);
    const markup = Array.from({ length: lineCount }, (_, index) => `<span>${index + 1}</span>`).join('');
    this.lineNumberElement.innerHTML = markup;
    this.lineNumberElement.style.minWidth = `${digits * 8 + 16}px`;
    this.lineNumberElement.scrollTop = this.channelTextarea.scrollTop;
  }

  updateMasterPlayButton(isPlaying = soundManager?.masterActive) {
    const playBtn = this.root?.querySelector('#collab-play-master-btn');
    if (!playBtn) return;
    if (isPlaying) {
      playBtn.textContent = '■';
      playBtn.setAttribute('aria-label', 'Stop master playback');
      playBtn.setAttribute('title', 'Stop Master');
      playBtn.classList.add('active');
      this.masterPlaybackActive = true;
    } else {
      playBtn.textContent = '▶';
      playBtn.setAttribute('aria-label', 'Play master pattern');
      playBtn.setAttribute('title', 'Play Master');
      playBtn.classList.remove('active');
      this.masterPlaybackActive = false;
    }
  }

  async toggleMasterPlayback() {
    if (!this.currentSnapshot) {
      this.setStatus('Join a session before playing master.', STATUS_VARIANTS.error, 2500);
      return;
    }
    try {
      if (soundManager.masterActive) {
        await soundManager.stopMasterPattern();
        this.updateMasterPlayButton(false);
        this.setStatus('Master playback stopped.', STATUS_VARIANTS.info, 2000);
        return;
      }
      const playbackCode = this.currentSnapshot?.mergedStack?.trim() || this.currentSnapshot?.masterCode?.trim();
      if (!playbackCode) {
        this.setStatus('Nothing has been published yet.', STATUS_VARIANTS.error, 2500);
        return;
      }
      await soundManager.setMasterPatternCode(playbackCode);
      const result = await soundManager.playMasterPattern();
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to start master playback');
      }
      this.updateMasterPlayButton(true);
      this.setStatus('Master playback started.', STATUS_VARIANTS.success, 2000);
    } catch (error) {
      console.error('toggleMasterPlayback failed:', error);
      this.updateMasterPlayButton(false);
      this.setStatus(error.message || 'Unable to toggle master playback', STATUS_VARIANTS.error, 3000);
    }
  }

  getSelectedBankInfo() {
    const selectedValue = this.channelEditorState?.bankValue || '';
    if (!selectedValue) {
      return null;
    }
    const parsed = parseBankSelectionValue(selectedValue);
    const bankValue = parsed.bankValue || '';
    if (!bankValue) {
      return null;
    }
    const normalized = bankValue.toLowerCase();
    const synthName = SYNTH_BANK_ALIASES[normalized] || bankValue;
    return {
      bankValue,
      synthName,
      isDrum: DRUM_BANK_VALUES.has(bankValue)
    };
  }

  applySelectedInstrumentToPattern() {
    const textarea = this.getChannelTextarea();
    if (!textarea) return;
    let pattern = textarea.value || '';
    if (!pattern.trim()) return;
    const info = this.getSelectedBankInfo();
    if (!info) return;

    if (info.isDrum) {
      if (pattern.includes('.bank(')) {
        pattern = pattern.replace(/\.bank\s*\([^)]*\)/gi, `.bank("${info.bankValue}")`);
      } else {
        pattern = `${pattern}.bank("${info.bankValue}")`;
      }
    } else {
      const soundRegex = /\.\s*(s|sound)\s*\(\s*["'][^"']*["']\s*\)/gi;
      if (soundRegex.test(pattern)) {
        pattern = pattern.replace(soundRegex, `.s("${info.synthName}")`);
      } else {
        pattern = `${pattern}.s("${info.synthName}")`;
      }
    }

    textarea.value = pattern;
    this.updatePatternLineNumbers();
  }

  handleTitleInputChange() {
    if (!this.channelTitleInput) return;
    const value = this.channelTitleInput.value || '';
    this.channelTitleAuto = value.trim().length === 0;
  }

  handleBankChange(value) {
    const parsed = parseBankSelectionValue(value);
    const normalizedValue = parsed?.bankValue || '';
    const isDrum = !!normalizedValue && DRUM_BANK_VALUES.has(normalizedValue);

    this.channelEditorState.bankValue = normalizedValue;
    this.channelEditorState.bankSelectionRaw = parsed?.rawValue || '';
    this.channelEditorState.vcslInstrument = parsed?.isVcslInstrument ? parsed.vcslInstrument : '';
    this.autoFillTitleFromBank();

    const forcedCodeMode = !isDrum && this.channelEditorState.mode !== 'code';
    if (forcedCodeMode) {
      this.setChannelEditorMode('code');
      this.syncCodeAnnotationsFromState();
    } else {
      if (this.channelEditorState.mode === 'step') {
        this.syncCodeFromGrid();
      } else {
        this.syncCodeAnnotationsFromState();
      }
      this.updateTheoryBlockVisibility();
    }
  }

  autoFillTitleFromBank() {
    if (!this.channelTitleAuto || !this.channelTitleInput || !this.bankSelect) return;
    const option = this.bankSelect.selectedOptions?.[0];
    if (option && option.textContent) {
      this.channelTitleInput.value = option.textContent.trim();
    }
  }

  handleTimeSignatureChange(signature) {
    const normalized = TIME_SIGNATURE_STEPS[signature] ? signature : DEFAULT_TIME_SIGNATURE;
    this.channelEditorState.timeSignature = normalized;
    this.channelEditorState.stepsPerBar = TIME_SIGNATURE_STEPS[normalized] || 16;
    this.channelEditorState.gridSelections = this.createEmptyGridSelections(this.channelEditorState.stepsPerBar);
    this.buildStepEditorGrid();
    if (this.channelEditorState.mode === 'step') {
      this.syncCodeFromGrid();
    }
  }

  handleKeyChange(value) {
    this.channelEditorState.key = value || '';
    this.syncCodeAnnotationsFromState();
    this.applySelectedInstrumentToPattern();
  }

  handleScaleChange(value) {
    this.channelEditorState.scale = value || '';
    this.syncCodeAnnotationsFromState();
    this.applySelectedInstrumentToPattern();
  }

  handleChordSelection(presetId) {
    if (!presetId) return;
    const preset = CHORD_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const snippet = this.channelEditorState.noteMode === NOTE_MODE.SEMITONE
      ? preset.semitoneSnippet
      : preset.noteSnippet;
    if (!snippet) return;
    if (this.channelEditorState.mode === 'step') {
      this.setChannelEditorMode('code');
    }
    this.insertSnippetIntoCode(snippet.trim());
    this.channelLastChordLabel = preset.label;
    this.chordSelect.value = '';
    this.syncCodeAnnotationsFromState();
    this.applySelectedInstrumentToPattern();
  }

  handleNoteModeToggle(isSemitone, options = {}) {
    this.channelEditorState.noteMode = isSemitone ? NOTE_MODE.SEMITONE : NOTE_MODE.NOTE;
    if (!options.silent && this.channelEditorState.mode === 'code') {
      this.syncCodeAnnotationsFromState();
    }
    if (this.noteModeLabel) {
      this.noteModeLabel.textContent = isSemitone ? 'Semitone steps' : 'Note names';
    }
    if (this.noteToggle) {
      this.noteToggle.checked = isSemitone;
    }
  }

  insertSnippetIntoCode(snippet) {
    const textarea = this.getChannelTextarea();
    if (!textarea || !snippet) return;
    const current = textarea.value.trimEnd();
    textarea.value = current ? `${current}\n${snippet}\n` : `${snippet}\n`;
    this.updatePatternLineNumbers();
    textarea.focus();
  }

  getChannelTextarea() {
    if (this.channelTextarea && this.channelTextarea.isConnected) {
      return this.channelTextarea;
    }
    this.channelTextarea = this.root?.querySelector('#collab-channel-code') || null;
    return this.channelTextarea;
  }

  setChannelEditorMode(mode = 'code') {
    const normalized = mode === 'step' ? 'step' : 'code';
    if (this.channelEditorState.mode === normalized) {
      this.updateEditorModeButtons();
      this.updateEditorModeVisibility();
      return;
    }
    this.channelEditorState.mode = normalized;
    if (normalized === 'step') {
      this.populateGridFromCode(this.getChannelTextarea()?.value || '');
      this.syncCodeFromGrid();
    } else {
      this.syncCodeAnnotationsFromState();
    }
    this.updateEditorModeButtons();
    this.updateEditorModeVisibility();
    this.updateTheoryBlockVisibility();
  }

  updateEditorModeButtons() {
    if (this.modeToggleSwitch) {
      this.modeToggleSwitch.checked = this.channelEditorState.mode === 'step';
    }
    const codeLabel = this.root?.querySelector('.collab-mode-label--code');
    const stepLabel = this.root?.querySelector('.collab-mode-label--step');
    if (codeLabel) {
      codeLabel.classList.toggle('active', this.channelEditorState.mode === 'code');
    }
    if (stepLabel) {
      stepLabel.classList.toggle('active', this.channelEditorState.mode === 'step');
    }
  }

  updateEditorModeVisibility() {
    const stepWrapper = this.root?.querySelector('#collab-step-editor');
    const timeGroup = this.root?.querySelector('#collab-time-signature-group');
    const codeWrapper = this.root?.querySelector('.collab-channel-editor');
    const textarea = this.getChannelTextarea();
    const isStep = this.channelEditorState.mode === 'step';
    if (stepWrapper) {
      stepWrapper.hidden = !isStep;
    }
    if (timeGroup) {
      timeGroup.hidden = !isStep;
    }
    if (textarea) {
      textarea.readOnly = isStep;
      textarea.classList.toggle('pattern-editor-readonly', isStep);
    }
    if (codeWrapper) {
      codeWrapper.classList.toggle('collab-code-readonly', isStep);
    }
  }

  buildStepEditorGrid() {
    const container = this.root?.querySelector('#collab-step-grid');
    if (!container) return;
    const stepsPerBar = this.channelEditorState.stepsPerBar || 16;
    const selections = this.channelEditorState.gridSelections
      && Object.values(this.channelEditorState.gridSelections)[0]
      && Object.values(this.channelEditorState.gridSelections)[0].length === stepsPerBar
      ? this.channelEditorState.gridSelections
      : this.createEmptyGridSelections(stepsPerBar);
    this.channelEditorState.gridSelections = selections;
    container.innerHTML = '';
    STEP_EDITOR_ROWS.forEach((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'collab-step-row';
      const label = document.createElement('span');
      label.className = 'collab-step-label';
      label.textContent = row.label;
      rowEl.appendChild(label);
      const stepsWrapper = document.createElement('div');
      stepsWrapper.className = 'collab-step-cells';
      stepsWrapper.style.gridTemplateColumns = `repeat(${stepsPerBar}, minmax(18px, 1fr))`;
      for (let step = 0; step < stepsPerBar; step += 1) {
        const cell = document.createElement('label');
        cell.className = 'collab-step-cell';
        if (step % 4 === 0) {
          cell.classList.add('beat');
        }
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !!selections[row.key]?.[step];
        checkbox.addEventListener('change', () => {
          this.handleStepCheckboxChange(row.key, step, checkbox.checked);
        });
        cell.appendChild(checkbox);
        stepsWrapper.appendChild(cell);
      }
      rowEl.appendChild(stepsWrapper);
      container.appendChild(rowEl);
    });
  }

  handleStepCheckboxChange(rowKey, stepIndex, isChecked) {
    if (!this.channelEditorState.gridSelections[rowKey]) {
      this.channelEditorState.gridSelections[rowKey] = new Array(this.channelEditorState.stepsPerBar).fill(false);
    }
    this.channelEditorState.gridSelections[rowKey][stepIndex] = isChecked;
    this.syncCodeFromGrid();
  }

  syncCodeFromGrid() {
    if (this.channelEditorState.mode !== 'step') {
      return;
    }
    const textarea = this.getChannelTextarea();
    if (!textarea) return;
    const pattern = this.generatePatternFromGrid();
    const annotated = this.applyCodeAnnotations(pattern);
    textarea.value = annotated;
    this.updatePatternLineNumbers();
  }

  syncCodeAnnotationsFromState() {
    const textarea = this.getChannelTextarea();
    if (!textarea) return;
    if (this.channelEditorState.mode === 'step') {
      this.syncCodeFromGrid();
      return;
    }
    const annotations = this.collectChannelAnnotations();
    const metaLines = annotations.map(({ label, value }) => `${CODE_META_PREFIX} ${label}: ${value}`);
    const bodyLines = textarea.value
      .split('\n')
      .filter((line) => !line.startsWith(CODE_META_PREFIX));
    const body = bodyLines.join('\n').trim();
    const assembled = [
      metaLines.length ? metaLines.join('\n') : '',
      body
    ].filter(Boolean).join('\n');
    textarea.value = assembled.trim();
    this.updatePatternLineNumbers();
  }

  collectChannelAnnotations() {
    const annotations = [];
    const bankLabel = this.getSelectedBankLabel();
    if (bankLabel) {
      annotations.push({ label: 'Bank', value: bankLabel });
    }
    if (this.channelEditorState.timeSignature) {
      annotations.push({ label: 'Signature', value: this.channelEditorState.timeSignature });
    }
    if (this.channelEditorState.key) {
      annotations.push({ label: 'Key', value: this.channelEditorState.key });
    }
    if (this.channelEditorState.scale) {
      annotations.push({ label: 'Scale', value: this.channelEditorState.scale });
    }
    if (this.channelLastChordLabel) {
      annotations.push({ label: 'Chords', value: this.channelLastChordLabel });
    }
    if (this.channelEditorState.noteMode === NOTE_MODE.SEMITONE) {
      annotations.push({ label: 'Note mode', value: 'Semitone' });
    }
    return annotations;
  }

  getSelectedBankLabel() {
    if (!this.bankSelect) return '';
    const option = this.bankSelect.selectedOptions?.[0];
    return option?.textContent?.trim() || '';
  }

  generatePatternFromGrid() {
    const stepsPerBar = this.channelEditorState.stepsPerBar || 16;
    const tokens = [];
    for (let step = 0; step < stepsPerBar; step += 1) {
      const hits = [];
      STEP_EDITOR_ROWS.forEach((row) => {
        if (this.channelEditorState.gridSelections[row.key]?.[step]) {
          hits.push(row.sample);
        }
      });
      if (hits.length === 0) {
        tokens.push('~');
      } else if (hits.length === 1) {
        tokens.push(hits[0]);
      } else {
        tokens.push(`[${hits.join(' ')}]`);
      }
    }
    let pattern = `s("${tokens.join(' ')}")`;
    if (this.channelEditorState.bankValue) {
      pattern += `.bank("${this.channelEditorState.bankValue}")`;
    }
    return pattern;
  }

  applyCodeAnnotations(pattern) {
    const annotations = this.collectChannelAnnotations();
    if (!annotations.length) {
      return pattern;
    }
    const metaLines = annotations.map(({ label, value }) => `${CODE_META_PREFIX} ${label}: ${value}`);
    return `${metaLines.join('\n')}\n${pattern}`.trim();
  }

  populateGridFromCode(code) {
    if (!code) {
      this.channelEditorState.gridSelections = this.createEmptyGridSelections(this.channelEditorState.stepsPerBar);
      this.buildStepEditorGrid();
      return;
    }
    const match = code.match(/s\("([^"]*)"\)/i);
    if (!match || !match[1]) {
      this.channelEditorState.gridSelections = this.createEmptyGridSelections(this.channelEditorState.stepsPerBar);
      this.buildStepEditorGrid();
      return;
    }
    const sequence = match[1];
    const tokens = sequence.split(/\s+/).filter(Boolean);
    const matchedSignature = Object.entries(TIME_SIGNATURE_STEPS)
      .find(([, steps]) => steps === tokens.length);
    if (matchedSignature) {
      this.channelEditorState.timeSignature = matchedSignature[0];
      this.channelEditorState.stepsPerBar = matchedSignature[1];
      if (this.timeSignatureSelect) {
        this.timeSignatureSelect.value = matchedSignature[0];
      }
    }
    const stepsPerBar = this.channelEditorState.stepsPerBar;
    const selections = this.createEmptyGridSelections(stepsPerBar);
    for (let step = 0; step < stepsPerBar; step += 1) {
      const token = tokens[step];
      if (!token) continue;
      const samples = this.parseTokenSamples(token);
      STEP_EDITOR_ROWS.forEach((row) => {
        selections[row.key][step] = samples.includes(row.sample);
      });
    }
    this.channelEditorState.gridSelections = selections;
    this.buildStepEditorGrid();
  }

  parseTokenSamples(token) {
    if (!token) return [];
    let working = token.trim();
    if (!working || working === '~') return [];
    if ((working.startsWith('[') && working.endsWith(']')) || (working.startsWith('{') && working.endsWith('}'))) {
      working = working.slice(1, -1);
    }
    working = working.replace(/[,]+/g, ' ');
    return working.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  }

  attachEvents() {
    this.closeBtn?.addEventListener('click', () => {
      this.hide();
    });
    this.overlay?.addEventListener('click', (event) => {
      if (event.target === this.overlay) {
        this.hide();
      }
    });
    this.root?.querySelector('#collab-create-btn')?.addEventListener('click', () => {
      this.handleCreateSession();
    });
    this.root?.querySelector('#collab-leave-btn')?.addEventListener('click', () => {
      this.handleLeaveSession();
    });
    this.root?.querySelector('#collab-load-editor-btn')?.addEventListener('click', () => {
      this.populateFromEditor();
    });
    this.root?.querySelector('#collab-push-draft-btn')?.addEventListener('click', () => {
      this.handleChannelSubmit('draft');
    });
    this.root?.querySelector('#collab-publish-btn')?.addEventListener('click', () => {
      this.handleChannelSubmit('live');
    });
    this.root?.querySelector('#collab-play-master-btn')?.addEventListener('click', () => {
      this.toggleMasterPlayback();
    });
    this.root?.querySelector('#collab-refresh-session-btn')?.addEventListener('click', () => {
      if (this.currentSnapshot?.slug) {
        this.fetchSnapshot(this.currentSnapshot.slug);
      }
    });
    this.root?.querySelector('#collab-refresh-cpu-btn')?.addEventListener('click', () => {
      if (this.currentSnapshot?.slug) {
        this.fetchCpuStats(this.currentSnapshot.id || this.currentSnapshot.slug);
      }
    });
    this.root?.querySelector('#collab-refresh-invites-btn')?.addEventListener('click', () => {
      this.refreshUserInvites();
    });
    this.root?.querySelector('#collab-refresh-recents-btn')?.addEventListener('click', () => {
      this.refreshRecentSessions();
    });
    this.root?.querySelector('#collab-invite-search')?.addEventListener('input', (event) => {
      const value = event.target.value.trim();
      this.scheduleInviteSearch(value);
    });
    this.root?.querySelector('#collab-invite-results')?.addEventListener('click', (event) => {
      const target = event.target.closest('[data-add-invitee]');
      if (!target) return;
      const userId = target.getAttribute('data-add-invitee');
      const user = this.inviteSearchResults.find((u) => u.id === userId);
      if (user) {
        this.addInvitee(user);
      }
    });
    this.root?.querySelector('#collab-selected-invitees')?.addEventListener('click', (event) => {
      const target = event.target.closest('[data-remove-invitee]');
      if (!target) return;
      const userId = target.getAttribute('data-remove-invitee');
      this.removeInvitee(userId);
    });
    this.root?.querySelector('#collab-send-invite-btn')?.addEventListener('click', () => {
      this.handleSendInvite();
    });
    this.root?.querySelector('#collab-master-pattern')?.addEventListener('click', (event) => {
      const target = event.target.closest('[data-remove-master-id]');
      if (!target) return;
      const channelId = target.getAttribute('data-remove-master-id');
      this.handleRemoveChannelFromMaster(channelId);
    });
    this.root?.querySelector('#collab-my-invites')?.addEventListener('click', (event) => {
      const acceptTarget = event.target.closest('[data-accept-invite]');
      if (acceptTarget) {
        const inviteId = acceptTarget.getAttribute('data-accept-invite');
        if (inviteId) {
          this.handleRespondInvite(inviteId, true);
        }
        return;
      }
      const declineTarget = event.target.closest('[data-decline-invite]');
      if (declineTarget) {
        const inviteId = declineTarget.getAttribute('data-decline-invite');
        if (inviteId) {
          this.handleRespondInvite(inviteId, false);
        }
      }
    });
    const recentsList = this.root?.querySelector('#collab-recents-list');
    if (recentsList) {
      recentsList.addEventListener('click', (event) => {
        const removeTarget = event.target.closest('[data-remove-session-id]');
        if (removeTarget) {
          event.preventDefault();
          event.stopPropagation();
          const removeId = removeTarget.getAttribute('data-remove-session-id');
          if (removeId) {
            this.handleRecentSessionRemoval(removeId);
          }
          return;
        }
        const chip = event.target.closest('[data-collab-session-id]');
        if (!chip) return;
        const sessionId = chip.getAttribute('data-collab-session-id');
        if (sessionId) {
          this.connectToSession(sessionId);
        }
      });

      recentsList.addEventListener('keydown', (event) => {
        const chip = event.target.closest('[data-collab-session-id]');
        if (!chip) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          const sessionId = chip.getAttribute('data-collab-session-id');
          if (sessionId) {
            this.connectToSession(sessionId);
          }
        }
      });
    }
    this.root?.querySelector('#collab-delay-slider')?.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      const valueEl = this.root.querySelector('#collab-delay-value');
      if (valueEl) {
        valueEl.textContent = `${value} ms`;
      }
    });
    this.root?.querySelector('#collab-delay-slider')?.addEventListener('change', (event) => {
      const value = Number(event.target.value);
      if (!this.currentSnapshot?.id) return;
      collabAPI.updateDelay(this.currentSnapshot.id, value).catch((error) => {
        console.error('Delay update failed', error);
        this.setStatus(error.message || 'Failed to update delay', STATUS_VARIANTS.error);
      });
    });
  }

  bindSocketEvents() {
    this.boundHandlers.push(this.socketClient.on('connect', () => {
      this.updateConnectionIndicator(true);
    }));
    this.boundHandlers.push(this.socketClient.on('disconnect', () => {
      this.updateConnectionIndicator(false);
    }));
    this.boundHandlers.push(this.socketClient.on('error', (payload) => {
      this.setStatus(payload?.message || 'Socket error', STATUS_VARIANTS.error);
    }));
    this.boundHandlers.push(this.socketClient.on('auth:error', (payload) => {
      this.setStatus(payload?.error || 'Authentication required', STATUS_VARIANTS.error);
    }));
    this.boundHandlers.push(this.socketClient.on('session:snapshot', (snapshot) => {
      this.updateSnapshot(snapshot);
    }));
    this.boundHandlers.push(this.socketClient.on('master:updated', (payload) => {
      if (payload?.masterCode) {
        this.setStatus('Master updated across collaborators', STATUS_VARIANTS.info, 2000);
        if (this.currentSnapshot) {
          this.currentSnapshot.masterCode = payload.masterCode;
          this.renderMasterPattern(this.currentSnapshot, payload.masterCode);
        } else {
          this.renderMasterPattern(null, payload.masterCode);
        }
      }
    }));
  }

  updateConnectionIndicator(isConnected) {
    const indicator = this.root?.querySelector('#collab-connection-indicator');
    if (indicator) {
      indicator.classList.toggle('connected', !!isConnected);
    }
  }

  async handleCreateSession() {
    const titleInput = this.root?.querySelector('#collab-title-input');
    const title = titleInput?.value?.trim();
    if (!title) {
      this.setStatus('Enter a session title first.', STATUS_VARIANTS.error);
      return;
    }
    try {
      this.setStatus('Creating session…', STATUS_VARIANTS.info);
      const snapshot = await collabAPI.createSession(title);
      this.updateSnapshot(snapshot);
      await this.socketClient.joinSession(snapshot.id);
      await this.refreshRecentSessions();
      this.setStatus('Session created. Share the code with your friends!', STATUS_VARIANTS.success, 4000);
    } catch (error) {
      console.error('Create session failed', error);
      this.setStatus(error.message || 'Failed to create session', STATUS_VARIANTS.error);
    }
  }

  async handleLeaveSession() {
    if (!this.currentSnapshot?.id) {
      return;
    }
    try {
      await collabAPI.leaveSession(this.currentSnapshot.id);
      await this.socketClient.leaveSession(this.currentSnapshot.id);
      await this.clearCurrentSessionState({ notify: false, skipSocketLeave: true });
      this.setStatus('You left the session.', STATUS_VARIANTS.info, 2000);
      await this.refreshRecentSessions();
    } catch (error) {
      console.error('Leave session failed', error);
      this.setStatus(error.message || 'Failed to leave session', STATUS_VARIANTS.error);
    }
  }

  async clearCurrentSessionState({ notify = true, skipSocketLeave = false } = {}) {
    const activeSessionId = this.currentSnapshot?.id;
    if (activeSessionId && !skipSocketLeave) {
      try {
        await this.socketClient.leaveSession(activeSessionId);
      } catch (error) {
        console.warn('⚠️ Unable to leave collaboration socket:', error);
      }
    }

    this.currentSnapshot = null;
    this.channelEditorState = this.createDefaultEditorState();
    this.channelTitleAuto = true;

    if (this.channelTitleInput) {
      this.channelTitleInput.value = '';
    }
    if (this.channelTextarea) {
      this.channelTextarea.value = '';
      this.updatePatternLineNumbers();
    }
    if (this.bankSelect) {
      this.bankSelect.value = '';
    }
    if (this.keySelect) {
      this.keySelect.value = '';
    }
    if (this.scaleSelect) {
      this.scaleSelect.value = 'chromatic';
    }
    if (this.noteToggle) {
      this.noteToggle.checked = false;
    }
    if (this.noteModeLabel) {
      this.noteModeLabel.textContent = 'Note names';
    }

    this.channelEditorState.gridSelections = this.createEmptyGridSelections(this.channelEditorState.stepsPerBar);
    this.buildStepEditorGrid();
    this.setChannelEditorMode('code');
    this.updateTheoryBlockVisibility();

    this.renderParticipants([]);
    this.renderChannels([]);
    this.renderMasterPattern(null);
    this.renderEmptyState();
    this.updateMasterPlayButton(false);

    try {
      if (soundManager?.stopAllSounds) {
        await soundManager.stopAllSounds();
      }
      setStrudelEditorValue?.('master-pattern', '');
    } catch (error) {
      console.warn('⚠️ Unable to fully reset master playback:', error);
    }

    if (notify) {
      this.setStatus('Session cleared. Start a new session to collaborate.', STATUS_VARIANTS.info, 2500);
    }
  }

  async handleChannelSubmit(targetStatus = 'draft') {
    if (!this.currentSnapshot?.id) {
      this.setStatus('Join a session first.', STATUS_VARIANTS.error);
      return;
    }
    const formValues = this.collectChannelFormValues();
    if (!formValues.code) {
      this.setStatus('Write a pattern before pushing.', STATUS_VARIANTS.error);
      return;
    }
    try {
      this.setStatus(targetStatus === 'live' ? 'Publishing…' : 'Saving draft…', STATUS_VARIANTS.info);
      await this.socketClient.pushChannelDraft({
        sessionId: this.currentSnapshot.id,
        code: formValues.code,
        name: formValues.name,
        metadata: formValues.metadata,
        status: targetStatus
      });
      if (targetStatus === 'live') {
        this.setStatus('Published to master.', STATUS_VARIANTS.success, 2500);
      } else {
        this.setStatus('Draft saved.', STATUS_VARIANTS.success, 2500);
      }
    } catch (error) {
      console.error('Channel submit failed', error);
      this.setStatus(error.message || 'Failed to push channel', STATUS_VARIANTS.error);
    }
  }

  collectChannelFormValues() {
    const textarea = this.root?.querySelector('#collab-channel-code');
    const titleInput = this.root?.querySelector('#collab-channel-title');
    if (this.channelEditorState?.mode === 'step') {
      this.syncCodeFromGrid();
    }
    const title = titleInput?.value?.trim() || '';
    const metadata = {};
    const soundBank = this.channelEditorState?.bankValue?.trim();
    const soundBankLabel = this.getSelectedBankLabel();
    if (soundBank) metadata.soundBank = soundBank;
    if (soundBankLabel) metadata.soundBankLabel = soundBankLabel;
    if (this.channelEditorState?.timeSignature) {
      metadata.timeSignature = this.channelEditorState.timeSignature;
    }
    if (this.channelEditorState?.key) {
      metadata.key = this.channelEditorState.key;
    }
    if (this.channelEditorState?.scale && this.channelEditorState.scale !== 'chromatic') {
      metadata.scale = this.channelEditorState.scale;
    }
    if (this.channelEditorState?.mode) {
      metadata.editorMode = this.channelEditorState.mode;
    }
    if (this.channelEditorState?.noteMode) {
      metadata.noteMode = this.channelEditorState.noteMode;
    }
    if (this.channelLastChordLabel) {
      metadata.chords = this.channelLastChordLabel;
    }
    if (title) {
      metadata.title = title;
    }

    return {
      code: textarea?.value?.trim() || '',
      name: title || null,
      metadata: Object.keys(metadata).length ? metadata : undefined
    };
  }

  populateFromEditor() {
    try {
      const value = getStrudelEditorValue('master-pattern');
      if (!value) {
        this.setStatus('Master editor is empty.', STATUS_VARIANTS.error, 2000);
        return;
      }
      const textarea = this.root?.querySelector('#collab-channel-code');
      if (textarea) {
        textarea.value = value.trim();
        this.updatePatternLineNumbers();
        textarea.focus();
        if (this.channelEditorState?.mode === 'step') {
          this.populateGridFromCode(textarea.value);
          this.syncCodeFromGrid();
        } else {
          this.syncCodeAnnotationsFromState();
        }
      }
      this.setStatus('Copied master editor content into snippet box.', STATUS_VARIANTS.info, 2000);
    } catch (error) {
      console.warn('Unable to read master editor value', error);
      this.setStatus('Master editor is not ready yet.', STATUS_VARIANTS.error);
    }
  }

  async fetchSnapshot(identifier, { silent = false } = {}) {
    try {
      const snapshot = await collabAPI.getSession(identifier, { refresh: true });
      this.updateSnapshot(snapshot);
      if (!silent) {
        this.setStatus('Snapshot refreshed.', STATUS_VARIANTS.info, 2000);
      }
    } catch (error) {
      console.error('Fetch snapshot failed', error);
      this.setStatus(error.message || 'Failed to refresh snapshot', STATUS_VARIANTS.error);
    }
  }

  async fetchCpuStats(identifier) {
    try {
      const stats = await collabAPI.getCpuStats(identifier);
      const sample = stats?.cpuStats?.recentServerSamples?.slice(-1)?.[0];
      if (sample) {
        this.updateCpuStats(sample);
        this.setStatus('CPU stats refreshed.', STATUS_VARIANTS.info, 2000);
      }
    } catch (error) {
      console.error('Fetch CPU failed', error);
      this.setStatus(error.message || 'Failed to refresh CPU stats', STATUS_VARIANTS.error);
    }
  }

  updateSnapshot(snapshot) {
    if (!snapshot) return;
    this.currentSnapshot = snapshot;
    const details = this.root?.querySelector('#collab-session-details');
    if (details) {
      details.hidden = false;
    }
    const label = this.root?.querySelector('#collab-session-label');
    if (label) {
      label.textContent = `Session: ${snapshot.title} (${snapshot.slug})`;
    }
    const shareCode = this.root?.querySelector('#collab-share-code');
    if (shareCode) {
      shareCode.textContent = snapshot.slug;
    }
    const delaySlider = this.root?.querySelector('#collab-delay-slider');
    const delayValue = this.root?.querySelector('#collab-delay-value');
    if (delaySlider) {
      delaySlider.value = snapshot.applyDelayMs ?? 0;
    }
    if (delayValue) {
      delayValue.textContent = `${snapshot.applyDelayMs ?? 0} ms`;
    }
    if ((snapshot.applyDelayMs ?? 0) > 0) {
      this.setStatus(`Master updates apply after ${snapshot.applyDelayMs} ms to protect playback.`, STATUS_VARIANTS.info, 3000);
    }
    const ownerTools = this.root?.querySelector('#collab-owner-tools');
    if (ownerTools) {
      ownerTools.hidden = !(this.currentUser && snapshot.owner && this.currentUser.id === snapshot.owner.id);
    }
    this.renderParticipants(snapshot.participants || []);
    this.renderChannels(snapshot.channels || []);
    const samples = snapshot.cpuStats?.recentServerSamples || [];
    if (samples.length) {
      this.updateCpuStats(samples[samples.length - 1]);
    }
    this.renderMasterPattern(snapshot);
  }

  renderParticipants(participants) {
    const list = this.root?.querySelector('#collab-participants-list');
    if (!list) return;
    if (!participants.length) {
      list.innerHTML = '<li class="empty">No collaborators yet.</li>';
      return;
    }
    list.innerHTML = participants.map((participant) => {
      const userName = participant.user?.artistName || participant.user?.name || 'Unknown';
      return `<li>
        <span>${userName}</span>
        <span class="role">${participant.role}</span>
      </li>`;
    }).join('');
  }

  renderChannels(channels) {
    const container = this.root?.querySelector('#collab-channels-container');
    if (!container) return;
    const visibleChannels = (channels || []).filter((channel) => MASTER_CHANNEL_STATUSES.has(channel.status));
    if (!visibleChannels.length) {
      container.innerHTML = '<div class="empty">Publish a channel to see it here.</div>';
      return;
    }
    container.innerHTML = visibleChannels.slice(0, 5).map((channel) => {
      const updatedAt = channel.updatedAt ? new Date(channel.updatedAt).toLocaleString() : '';
      const author = channel.user?.artistName || channel.user?.name || 'anonymous';
      return `
        <div class="collab-channel-card">
          <div class="collab-channel-card__header">
            <span>${channel.name || 'Untitled channel'}</span>
            <span class="badge ${channel.status}">${channel.status}</span>
          </div>
          <div class="collab-channel-card__meta">
            <span>By ${author}</span>
            <span>${updatedAt}</span>
          </div>
          <pre>${channel.code.slice(0, 220)}${channel.code.length > 220 ? '…' : ''}</pre>
        </div>
      `;
    }).join('');
  }

  renderMasterPattern(snapshot, fallbackCode = '') {
    const container = this.root?.querySelector('#collab-master-pattern');
    if (!container) return;

    const channels = Array.isArray(snapshot?.channels)
      ? snapshot.channels.filter((channel) => {
          if (!channel || !MASTER_CHANNEL_STATUSES.has(channel.status)) return false;
          return !!(channel.code && channel.code.trim().length);
        })
      : [];

    if (!channels.length) {
      const masterValue = (fallbackCode || snapshot?.masterCode || '').trim();
      if (masterValue) {
        container.innerHTML = `<pre>${this.escapeHtml(masterValue)}</pre>`;
      } else {
        container.innerHTML = '<div class="collab-master-empty">No published channels yet. Publish a channel to build the master.</div>';
      }
      this.updateMasterPlayButton(false);
      return;
    }

    container.innerHTML = channels
      .map((channel) => this.renderMasterChannelBlock(channel))
      .join('');
    this.updateMasterPlayButton(soundManager?.masterActive);
  }

  renderMasterChannelBlock(channel) {
    const label = channel.name || channel.elementId || 'Untitled channel';
    const author = channel.user?.artistName || channel.user?.name || 'anonymous';
    const code = (channel.code || '').trim();
    const comment = `// ${label} — ${author}`;
    const fullPayload = `${comment}\n${code}`.trim();
    const colors = this.getUserColor(channel);
    const safeLabel = this.escapeHtml(label);
    const canRemove = !!this.currentUser &&
      (this.currentUser.id === channel.user?.id || this.currentUser.id === this.currentSnapshot?.owner?.id);
    const removeButton = canRemove
      ? `<button type="button" class="collab-master-block__remove" data-remove-master-id="${channel.id}" aria-label="Remove ${safeLabel}">&times;</button>`
      : '';
    return `
      <div class="collab-master-block" data-master-channel-id="${channel.id}" style="--author-bg:${colors.bg}; --author-border:${colors.border};">
        ${removeButton}
        <div class="collab-master-block__meta">
          <span>${safeLabel}</span>
          <span>${this.escapeHtml(author)}</span>
        </div>
        <pre>${this.escapeHtml(fullPayload)}</pre>
      </div>
    `;
  }

  getUserColor(channel) {
    const key =
      channel?.user?.id ||
      channel?.user?.artistName ||
      channel?.user?.name ||
      channel?.id ||
      channel?.elementId ||
      `anonymous-${channel?.status || 'unknown'}`;
    if (!this.userColorAssignments.has(key)) {
      const palette = AUTHOR_COLOR_PALETTE[this.userColorIndex % AUTHOR_COLOR_PALETTE.length];
      this.userColorAssignments.set(key, palette);
      this.userColorIndex += 1;
    }
    return this.userColorAssignments.get(key);
  }

  escapeHtml(value = '') {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  updateCpuStats(sample) {
    const loadEl = this.root?.querySelector('#collab-cpu-load');
    const updatedEl = this.root?.querySelector('#collab-cpu-updated');
    const warningEl = this.root?.querySelector('#collab-cpu-warning');
    if (loadEl) {
      const avg = Array.isArray(sample.loadAvg) ? sample.loadAvg[0] : sample.loadAvg;
      loadEl.textContent = typeof avg === 'number' ? `${avg.toFixed(2)}` : 'n/a';
    }
    if (updatedEl) {
      updatedEl.textContent = sample.timestamp
        ? new Date(sample.timestamp).toLocaleTimeString()
        : '—';
    }
    if (warningEl) {
      warningEl.textContent = sample.warning || '';
      warningEl.style.display = sample.warning ? 'inline-flex' : 'none';
    }
    if (sample.warning) {
      this.setStatus(sample.warning, STATUS_VARIANTS.error, 4000);
    }
  }

  async refreshUserInvites() {
    if (!this.currentUser) {
      this.pendingInvites = [];
      this.renderPendingInvites();
      return;
    }
    try {
      this.pendingInvites = await collabAPI.getPendingInvites();
      this.renderPendingInvites();
    } catch (error) {
      console.error('Failed to load invites:', error);
      this.setStatus(error.message || 'Failed to load invites', STATUS_VARIANTS.error, 3000);
    }
  }

  renderPendingInvites() {
    const container = this.root?.querySelector('#collab-my-invites');
    if (!container) return;
    if (!this.currentUser) {
      container.classList.add('collab-empty-state');
      container.innerHTML = 'Login to see your invitations.';
      return;
    }
    if (!this.pendingInvites.length) {
      container.classList.add('collab-empty-state');
      container.innerHTML = 'No pending invites.';
      return;
    }
    container.classList.remove('collab-empty-state');
    container.innerHTML = this.pendingInvites
      .map((invite) => {
        const inviter = invite.inviter?.name || 'Someone';
        const title = invite.session?.title || 'Untitled session';
        const createdAt = invite.createdAt ? new Date(invite.createdAt).toLocaleString() : '';
        return `
          <div class="collab-invite-card">
            <div class="collab-invite-card__details">
              <strong>${title}</strong>
              <span>Invited by ${inviter}</span>
              <span class="collab-invite-card__meta">${createdAt}</span>
            </div>
            <div class="collab-invite-card__actions">
              <button class="btn-primary btn-small" data-accept-invite="${invite.id}">Accept</button>
              <button class="btn-ghost btn-small" data-decline-invite="${invite.id}">Decline</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  async handleRespondInvite(inviteId, accept) {
    if (!inviteId) return;
    try {
      this.setStatus(accept ? 'Accepting invite…' : 'Declining invite…', STATUS_VARIANTS.info);
      const result = accept
        ? await collabAPI.acceptInvite(inviteId)
        : await collabAPI.declineInvite(inviteId);
      await this.refreshUserInvites();
      if (accept && result?.session) {
        this.updateSnapshot(result.session);
        await this.socketClient.joinSession(result.session.id);
        await this.refreshRecentSessions();
        this.setStatus('Invite accepted. Connected to session.', STATUS_VARIANTS.success, 3000);
      } else if (accept) {
        this.setStatus('Invite accepted.', STATUS_VARIANTS.success, 2000);
      } else {
        this.setStatus('Invite declined.', STATUS_VARIANTS.info, 2000);
      }
    } catch (error) {
      console.error('Failed to respond to invite:', error);
      this.setStatus(error.message || 'Failed to respond to invite', STATUS_VARIANTS.error, 3000);
    }
  }

  async handleSendInvite() {
    if (!this.currentSnapshot?.id) {
      this.setStatus('Start a session before inviting collaborators.', STATUS_VARIANTS.error, 3000);
      return;
    }
    if (!this.selectedInvitees.length) {
      this.setStatus('Select up to five users to invite.', STATUS_VARIANTS.error, 2500);
      return;
    }
    try {
      this.setStatus('Sending invites…', STATUS_VARIANTS.info);
      const ids = this.selectedInvitees.map((user) => user.id);
      await collabAPI.sendInvites(this.currentSnapshot.id, ids);
      this.selectedInvitees = [];
      this.renderSelectedInvitees();
      this.setStatus(`Invitations sent to ${ids.length} user${ids.length > 1 ? 's' : ''}.`, STATUS_VARIANTS.success, 2500);
      this.refreshUserInvites();
    } catch (error) {
      console.error('Failed to send invite:', error);
      this.setStatus(error.message || 'Failed to send invite', STATUS_VARIANTS.error, 3000);
    }
  }

  async refreshRecentSessions() {
    if (!this.currentUser) {
      this.recentSessions = [];
      this.renderRecentSessions();
      return;
    }
    try {
      this.recentSessions = await collabAPI.listRecentSessions();
      this.renderRecentSessions();
    } catch (error) {
      console.error('Failed to fetch recent sessions:', error);
      this.setStatus(error.message || 'Failed to load recent sessions', STATUS_VARIANTS.error, 3000);
    }
  }

  renderRecentSessions() {
    const list = this.root?.querySelector('#collab-recents-list');
    if (!list) return;
    if (!this.currentUser) {
      list.classList.add('collab-empty-state');
      list.innerHTML = 'Login to see your recent collaborations.';
      return;
    }
    if (!this.recentSessions.length) {
      list.classList.add('collab-empty-state');
      list.innerHTML = 'No recent sessions yet.';
      return;
    }
    list.classList.remove('collab-empty-state');
    list.innerHTML = this.recentSessions
      .map((session) => {
        const updated = session.updatedAt ? new Date(session.updatedAt).toLocaleString() : '—';
        const ownerId = session.owner?.id || '';
        const removeLabel = ownerId && ownerId === this.currentUser?.id
          ? 'Delete session'
          : 'Leave session';
        return `
          <div class="collab-chip" data-collab-session-id="${session.id}" role="button" tabindex="0">
            <div class="collab-chip__content">
              <span>${session.title}</span>
              <span class="collab-chip__meta">${updated}</span>
            </div>
            <button type="button" class="collab-chip-remove" data-remove-session-id="${session.id}" aria-label="${removeLabel}">&times;</button>
          </div>
        `;
      })
      .join('');
  }

  async handleRecentSessionRemoval(sessionId) {
    if (!sessionId || !this.currentUser) {
      return;
    }
    const session = this.recentSessions.find((item) => item.id === sessionId);
    const isOwner = session?.owner?.id === this.currentUser.id;
    const isCurrentSession = this.currentSnapshot?.id === sessionId;
    try {
      this.setStatus(isOwner ? 'Deleting session…' : 'Leaving session…', STATUS_VARIANTS.info);
      if (isOwner) {
        await collabAPI.deleteSession(sessionId);
      } else {
        await collabAPI.leaveSession(sessionId);
      }
      if (isCurrentSession) {
        await this.clearCurrentSessionState({ notify: false });
      }
      await this.refreshRecentSessions();
      const message = isCurrentSession
        ? 'Session cleared. Start a new session to collaborate.'
        : (isOwner ? 'Session deleted.' : 'Removed from session.');
      this.setStatus(message, STATUS_VARIANTS.success, 2200);
    } catch (error) {
      console.error('Failed to update session membership:', error);
      this.setStatus(error.message || 'Failed to update recent session', STATUS_VARIANTS.error, 3000);
    }
  }

  async handleRemoveChannelFromMaster(channelId) {
    if (!channelId || !this.currentSnapshot?.id) {
      return;
    }
    try {
      this.setStatus('Removing channel from master…', STATUS_VARIANTS.info);
      await collabAPI.publishChannel(this.currentSnapshot.id, channelId, 'draft');
      const identifier = this.currentSnapshot.slug || this.currentSnapshot.id;
      if (identifier) {
        await this.fetchSnapshot(identifier, { silent: true });
      }
      this.setStatus('Channel removed from master.', STATUS_VARIANTS.success, 2200);
    } catch (error) {
      console.error('Failed to remove master channel:', error);
      this.setStatus(error.message || 'Failed to remove channel from master', STATUS_VARIANTS.error, 3000);
    }
  }

  scheduleInviteSearch(query) {
    if (this.inviteSearchTimeout) {
      clearTimeout(this.inviteSearchTimeout);
    }
    if (!query) {
      this.inviteSearchResults = [];
      this.renderInviteSearchResults();
      return;
    }
    this.inviteSearchTimeout = setTimeout(() => {
      this.performInviteSearch(query);
    }, 250);
  }

  async performInviteSearch(query) {
    try {
      const users = await usersAPI.listUsers(query, 10);
      this.inviteSearchResults = users.filter((user) => user.id !== this.currentUser?.id);
      this.renderInviteSearchResults();
    } catch (error) {
      console.error('Invite search failed:', error);
      this.inviteSearchResults = [];
      this.renderInviteSearchResults('Failed to search users. Try again.');
    }
  }

  renderInviteSearchResults(message) {
    const container = this.root?.querySelector('#collab-invite-results');
    if (!container) return;
    if (message) {
      container.classList.add('collab-empty-state');
      container.innerHTML = message;
      return;
    }
    if (!this.inviteSearchResults.length) {
      container.classList.add('collab-empty-state');
      container.innerHTML = 'Start typing to search users.';
      return;
    }
    container.classList.remove('collab-empty-state');
    container.innerHTML = this.inviteSearchResults
      .map((user) => {
        const disabled = this.selectedInvitees.some((selected) => selected.id === user.id) || this.selectedInvitees.length >= 5;
        const displayName = user.artistName?.trim() || user.name || user.email || 'Unnamed';
        return `
          <button class="collab-invite-result${disabled ? ' disabled' : ''}" data-add-invitee="${user.id}" ${disabled ? 'disabled' : ''}>
            <span>${displayName}</span>
            <span class="collab-invite-result__meta">${user.email || ''}</span>
          </button>
        `;
      })
      .join('');
  }

  addInvitee(user) {
    if (this.selectedInvitees.length >= 5) {
      this.setStatus('You can invite up to five users at a time.', STATUS_VARIANTS.error, 2500);
      return;
    }
    if (this.selectedInvitees.some((invitee) => invitee.id === user.id)) {
      return;
    }
    this.selectedInvitees.push(user);
    this.renderSelectedInvitees();
    this.renderInviteSearchResults();
  }

  removeInvitee(userId) {
    this.selectedInvitees = this.selectedInvitees.filter((invitee) => invitee.id !== userId);
    this.renderSelectedInvitees();
    this.renderInviteSearchResults();
  }

  renderSelectedInvitees() {
    const container = this.root?.querySelector('#collab-selected-invitees');
    const countLabel = this.root?.querySelector('#collab-selected-count');
    if (countLabel) {
      countLabel.textContent = `Selected ${this.selectedInvitees.length} of 5 slots.`;
    }
    if (!container) return;
    if (!this.selectedInvitees.length) {
      container.classList.add('collab-empty-state');
      container.innerHTML = 'No users selected yet.';
      return;
    }
    container.classList.remove('collab-empty-state');
    container.innerHTML = this.selectedInvitees
      .map((invitee) => {
        const displayName = invitee.artistName?.trim() || invitee.name || invitee.email || 'Unnamed';
        return `
          <span class="collab-selected-invitee">
            <span>${displayName}</span>
            <button type="button" data-remove-invitee="${invitee.id}" aria-label="Remove ${displayName}">&times;</button>
          </span>
        `;
      })
      .join('');
  }

  async connectToSession(sessionId) {
    if (!sessionId) return;
    try {
      this.setStatus('Connecting…', STATUS_VARIANTS.info);
      const snapshot = await collabAPI.joinSession(sessionId);
      if (snapshot) {
        this.updateSnapshot(snapshot);
        await this.socketClient.joinSession(sessionId);
        await this.refreshRecentSessions();
        this.setStatus('Connected to session.', STATUS_VARIANTS.success, 2500);
      }
    } catch (error) {
      console.error('Failed to connect to session:', error);
      this.setStatus(error.message || 'Failed to connect to session', STATUS_VARIANTS.error, 3000);
    }
  }

  renderEmptyState() {
    const details = this.root?.querySelector('#collab-session-details');
    if (details) {
      details.hidden = true;
    }
    const ownerTools = this.root?.querySelector('#collab-owner-tools');
    if (ownerTools) {
      ownerTools.hidden = true;
    }
    const label = this.root?.querySelector('#collab-session-label');
    if (label) {
      label.textContent = 'Not connected';
    }
  }

  setStatus(message, variant = STATUS_VARIANTS.info, timeout = 0) {
    const statusEl = this.root?.querySelector('#collab-status-message');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `collab-status-message ${variant}`;
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
    }
    if (timeout > 0) {
      this.statusTimer = setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'collab-status-message';
      }, timeout);
    }
  }
}

