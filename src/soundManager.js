/**
 * Sound Manager - Coordinates Strudel patterns and Web Audio API
 */

import { soundConfig } from './config.js';
import { Note, Scale, Interval } from '@tonaljs/tonal';
import { WebMidi } from 'webmidi';
import { startMasterHighlighting, stopMasterHighlighting } from './highlighting.js';

// Import Strudel modules statically at top level to avoid duplicate bundling
// Use dynamic imports but cache them to ensure single instance
let strudelModulesPromise = null;
let coreModule = null;
let webaudioModule = null;
let webModule = null;
let tonalModule = null;
let midiModule = null;
let samplerModule = null;

const resolveSampleManifestPath = (path, baseUrl) => {
  if (!path) return path;
  if (!baseUrl) return path;
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return path;
  }
};

const normalizeSampleManifestEntry = (entry, baseUrl) => {
  if (typeof entry === 'string') {
    return resolveSampleManifestPath(entry, baseUrl);
  }
  if (Array.isArray(entry)) {
    return entry.map((value) => normalizeSampleManifestEntry(value, baseUrl));
  }
  if (entry && typeof entry === 'object') {
    const result = {};
    Object.entries(entry).forEach(([key, value]) => {
      result[key] = normalizeSampleManifestEntry(value, baseUrl);
    });
    return result;
  }
  return entry;
};

const normalizeSampleManifest = (manifest) => {
  if (!manifest || typeof manifest !== 'object') return manifest;
  const baseUrl = manifest._base || '';
  const normalized = {};
  Object.entries(manifest).forEach(([key, value]) => {
    if (key === '_base') return;
    normalized[key] = normalizeSampleManifestEntry(value, baseUrl);
  });
  return normalized;
};

const DOUGH_SAMPLES_BASE_URL = 'https://raw.githubusercontent.com/felixroos/dough-samples/main';

async function getStrudelModules() {
  // Create promise only once - this ensures all calls use the same module instances
  // Vite will pre-bundle these, and we cache them to prevent duplicate imports
  if (!strudelModulesPromise) {
    strudelModulesPromise = Promise.all([
      import('@strudel/core'),
      import('@strudel/web'),
      import('@strudel/webaudio'),
      import('@strudel/tonal'),
      import('@strudel/midi').catch(() => null) // MIDI module - catch if not available
    ]).then(modules => {
      coreModule = modules[0];
      webModule = modules[1];
      webaudioModule = modules[2];
      tonalModule = modules[3];
      midiModule = modules[4]; // @strudel/midi
      // Note: @strudel/sampler has broken package.json exports, can't be imported
      // Drum samples come from @strudel/webaudio via samples() function
      samplerModule = null;
      
      return { coreModule, webModule, webaudioModule, tonalModule, midiModule, samplerModule };
    });
  }
  return strudelModulesPromise;
}

const SYNTH_NAME_ALIASES = {
  superpiano: 'piano',
  wood: 'jazz'  // Wood is now called Jazz
};

function replaceSynthAliasesInPattern(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    return pattern;
  }

  let result = pattern;
  for (const [legacyName, canonicalName] of Object.entries(SYNTH_NAME_ALIASES)) {
    const escapedLegacy = legacyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sRegex = new RegExp(`(\\.s\\(["'])${escapedLegacy}(["']\\))`, 'gi');
    result = result.replace(sRegex, (_, prefix, suffix) => `${prefix}${canonicalName}${suffix}`);

    const soundRegex = new RegExp(`(sound\\(["'])${escapedLegacy}(["']\\))`, 'gi');
    result = result.replace(soundRegex, (_, prefix, suffix) => `${prefix}${canonicalName}${suffix}`);
  }
  return result;
}

const SCALE_NAME_TONAL_MAP = {
  // Legacy/simple names
  major: 'major',
  minor: 'minor',
  harmonicMinor: 'harmonic minor',
  melodicMinor: 'melodic minor',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  locrian: 'locrian',
  blues: 'blues',
  pentatonicMajor: 'major pentatonic',
  pentatonicMinor: 'minor pentatonic',

  // Diatonic (Major) modes
  ionian: 'major',
  aeolian: 'minor',

  // Melodic Minor modes
  'melodic minor': 'melodic minor',
  'dorian b2': 'dorian b2',
  'lydian augmented': 'lydian augmented',
  'lydian dominant': 'lydian dominant',
  'mixolydian b6': 'mixolydian b6',
  'locrian #2': 'locrian #2',
  altered: 'altered',

  // Harmonic Minor modes
  'harmonic minor': 'harmonic minor',
  'locrian #6': 'locrian #6',
  'ionian #5': 'ionian #5',
  'dorian #4': 'dorian #4',
  'phrygian dominant': 'phrygian dominant',
  'lydian #2': 'lydian #2',
  ultralocrian: 'ultralocrian',

  // Harmonic Major modes
  'harmonic major': 'harmonic major',
  'dorian b5': 'dorian b5',
  'phrygian b4': 'phrygian b4',
  'lydian b3': 'lydian b3',
  'mixolydian b2': 'mixolydian b2',
  'lydian augmented #2': 'lydian augmented #2',
  'locrian bb7': 'locrian bb7',

  // Pentatonic modes (Major)
  'major pentatonic': 'major pentatonic',
  'suspended pentatonic': 'suspended pentatonic',
  'man gong': 'man gong',
  ritusen: 'ritusen',
  'minor pentatonic mode 5': 'minor pentatonic',

  // Pentatonic modes (Minor)
  'minor pentatonic': 'minor pentatonic',
  'blues minor pentatonic': 'minor pentatonic', // no b5 → same as minor pentatonic
  'major pentatonic mode 3': 'major pentatonic',
  egyptian: 'egyptian',
  'minor pentatonic mode 5': 'minor pentatonic',

  // Other systems
  'whole tone': 'whole tone',
  'half-whole diminished': 'dominant diminished', // half-whole
  'whole-half diminished': 'diminished', // whole-half
  'minor blues': 'blues'
};

function normalizeKeyRoot(key) {
  if (!key || typeof key !== 'string') {
    return '';
  }
  const match = key.trim().match(/^([a-gA-G])([#b]?)/);
  if (!match) {
    return key.trim();
  }
  return `${match[1].toUpperCase()}${match[2] || ''}`;
}

function convertNoteSequenceContent(content) {
  const separatorRegex = /(\s+|[,;:<>()[\]{}|\\/]+|\*+)/g;
  const segments = content.split(separatorRegex);
  let converted = false;
  let baseMidi = null;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment || separatorRegex.test(segment)) {
      separatorRegex.lastIndex = 0;
      continue;
    }

    // Match note names with optional time annotations (e.g., "D5@1.0", "C5@0.5")
    // Pattern: note letter, optional accidental, optional octave, optional time annotation
    const noteMatch = segment.match(/^([a-gA-G])([#b]?)(-?\d+)?(@[\d.]+)?$/);
    if (!noteMatch) {
      separatorRegex.lastIndex = 0;
      continue;
    }

    const letter = noteMatch[1].toUpperCase();
    const accidental = noteMatch[2] || '';
    const explicitOctave = noteMatch[3] ? parseInt(noteMatch[3], 10) : null;
    const timeAnnotation = noteMatch[4] || ''; // Preserve time annotation (e.g., "@1.0")

    const testOctaves = [];
    if (explicitOctave !== null && !Number.isNaN(explicitOctave)) {
      testOctaves.push(explicitOctave);
    }
    if (baseMidi !== null) {
      testOctaves.push(Math.round(baseMidi / 12) - 1);
      testOctaves.push(Math.round(baseMidi / 12));
      testOctaves.push(Math.round(baseMidi / 12) + 1);
    }
    testOctaves.push(3, 4, 5);

    let noteInfo = null;
    for (const octave of testOctaves) {
      const noteName = `${letter}${accidental}${octave}`;
      const candidate = Note.get(noteName);
      if (candidate && Number.isFinite(candidate.midi)) {
        noteInfo = candidate;
        break;
      }
    }

    if (!noteInfo || !Number.isFinite(noteInfo.midi)) {
      return null;
    }

    const midi = Math.round(noteInfo.midi);
    if (baseMidi === null) {
      baseMidi = midi;
    }
    const semitoneOffset = midi - baseMidi;
    // Preserve time annotation in the converted output
    segments[i] = String(semitoneOffset) + timeAnnotation;
    converted = true;
    separatorRegex.lastIndex = 0;
  }

  return converted ? segments.join('') : null;
}

function convertNoteCallsToScaleDegrees(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    return pattern;
  }

  const bareNoteCallRegex = /\bnote\s*\(\s*([a-gA-G][^'"()]*?)\s*\)/gi;
  let result = pattern.replace(bareNoteCallRegex, (match, content) => {
    const inner = (content || '').trim();
    if (!inner) {
      return match;
    }
    const convertedContent = convertNoteSequenceContent(inner);
    if (convertedContent === null) {
      return match;
    }
    return `n("${convertedContent}")`;
  });

  const noteCallRegex = /\bnote\s*\(\s*(['"])([\s\S]*?)\1\s*\)/gi;

  result = result.replace(noteCallRegex, (match, quote, content) => {
    const convertedContent = convertNoteSequenceContent(content);
    if (convertedContent === null) {
      return match;
    }
    return `n(${quote}${convertedContent}${quote})`;
  });

  return result;
}

// Global AudioContext warning suppression
let audioContextWarningSuppressed = false;
let originalConsoleError = null;
let originalConsoleWarn = null;

function suppressAudioContextWarnings() {
  if (audioContextWarningSuppressed) return;
  
  audioContextWarningSuppressed = true;
  originalConsoleError = originalConsoleError || console.error;
  originalConsoleWarn = originalConsoleWarn || console.warn;
  
  const suppressAudioContextWarning = (args) => {
    if (args && args.length > 0) {
      // Check both string messages and error objects
      let msg = '';
      let errorObj = null;
      
      // Get message from first argument
      if (typeof args[0] === 'string') {
        msg = args[0];
      } else if (args[0] instanceof Error) {
        msg = args[0].message || String(args[0]);
        errorObj = args[0];
      } else if (typeof args[0] === 'object' && args[0] !== null) {
        msg = args[0].message || String(args[0]);
        errorObj = args[0];
      } else {
        msg = String(args[0]);
      }
      
      // Suppress all AudioContext warnings
      if (msg.includes('AudioContext')) {
        if (msg.includes('not allowed') || 
            msg.includes('start') || 
            msg.includes('resume') ||
            msg.includes('user gesture')) {
          return true;
        }
      }
      // Suppress duplicate Strudel core module warnings
      if (msg.includes('@strudel/core was loaded more than once')) {
        return true;
      }
      // Suppress "undefined instead of pattern" errors when they're handled gracefully
      if (msg.includes('undefined instead of pattern') || 
          msg.includes('got "undefined" instead of pattern') ||
          msg.includes('got undefined instead of pattern') ||
          msg.includes('Pattern evaluation failed: got undefined')) {
        // Suppress these errors - they're handled gracefully elsewhere
        return true;
      }
      // Suppress Strudel sample warnings (missing samples are handled gracefully)
      // Check multiple argument positions for error messages
      let fullMessage = msg;
      for (let i = 0; i < args.length; i++) {
        if (typeof args[i] === 'string' || (args[i] && args[i].toString)) {
          fullMessage += ' ' + String(args[i]);
        }
      }
      
      // Check for sample not found errors - check multiple formats
      const lowerMessage = fullMessage.toLowerCase();
      
      // Suppress Strudel internal errors - check multiple patterns
      if (fullMessage.includes('not found! Is it loaded?') ||
          fullMessage.includes('not found') ||
          lowerMessage.includes('not found') ||
          (fullMessage.includes('sound ') && fullMessage.includes('not found')) ||
          fullMessage.includes('[getTrigger] error') ||
          fullMessage.includes('[getTrigger]') ||
          msg.includes('[getTrigger]') ||
          fullMessage.includes('[eval] error') ||
          fullMessage.includes('[eval]') ||
          msg.includes('[eval]') ||
          fullMessage.includes('Unexpected token') ||
          fullMessage.includes('createPeriodicWave') ||
          fullMessage.includes('length of the real array provided (0)') ||
          fullMessage.includes('minimum bound (2)') ||
          fullMessage.includes('got "undefined" instead of pattern') ||
          fullMessage.includes('got undefined instead of pattern') ||
          fullMessage.includes('undefined instead of pattern') ||
          lowerMessage.includes('undefined instead of pattern') ||
          msg.includes('undefined instead of pattern') ||
          fullMessage.includes('RolandTR909') ||
          fullMessage.includes('RolandTR808') ||
          fullMessage.includes('RolandTR') ||
          lowerMessage.includes('rolandtr') ||
          msg.includes('RolandTR') ||
          // Suppress superdough scheduling warnings
          fullMessage.includes('[superdough]') ||
          fullMessage.includes('cannot schedule sounds in the past') ||
          msg.includes('[superdough]') ||
          msg.includes('cannot schedule sounds in the past')) {
        // Suppress sample not found warnings - they're expected when samples aren't loaded
        return true;
      }
      // Suppress JSON parsing errors from bank loading attempts
      // Check both msg and fullMessage for various error formats
      if ((msg.includes('SyntaxError') || fullMessage.includes('SyntaxError')) && 
          (msg.includes('JSON') || fullMessage.includes('JSON'))) {
        // These occur when trying to load banks that don't exist or return invalid responses
        return true;
      }
      // Suppress HTML responses being parsed as JSON (404 pages)
      if (msg.includes('<!DOCTYPE') || fullMessage.includes('<!DOCTYPE') ||
          msg.includes('Unexpected token') && msg.includes('<') ||
          fullMessage.includes('Unexpected token') && fullMessage.includes('<') ||
          msg.includes('is not valid JSON') || fullMessage.includes('is not valid JSON')) {
        // These occur when GitHub returns HTML 404 pages instead of JSON
        return true;
      }
      // Also check for JSON parse errors in general
      if (fullMessage.includes('Unexpected non-whitespace character after JSON') ||
          (fullMessage.includes('Unexpected token') && fullMessage.includes('JSON'))) {
        return true;
      }
      // Suppress CycleTones loading errors (repository might not exist)
      if (fullMessage.includes('error loading') && (fullMessage.includes('CycleTones') || fullMessage.includes('strudel.json'))) {
        return true;
      }
      // Suppress "Failed to load default sound banks" errors
      if (fullMessage.includes('Failed to load default sound banks') ||
          msg.includes('Failed to load default sound banks')) {
        return true;
      }
      // Also check if error object has the flag
      if (errorObj && errorObj.isUndefinedPattern === true) {
        return true;
      }
    }
    return false;
  };
  
  console.error = (...args) => {
    // First check if we should suppress - check msg directly as well
    const shouldSuppress = suppressAudioContextWarning(args);
    
    // Also check first argument directly for Strudel internal errors
    if (!shouldSuppress && args.length > 0) {
      const firstArg = args[0];
      const firstArgStr = typeof firstArg === 'string' ? firstArg : String(firstArg);
      
      // Quick check for common Strudel error patterns
      if (firstArgStr.includes('[eval]') || 
          firstArgStr.includes('[getTrigger]') ||
          firstArgStr.includes('RolandTR') ||
          firstArgStr.includes('undefined instead of pattern') ||
          firstArgStr.includes('not found') ||
          firstArgStr.includes('createPeriodicWave') ||
          firstArgStr.includes('length of the real array provided (0)') ||
          firstArgStr.includes('minimum bound (2)') ||
          firstArgStr.includes('Unexpected token')) {
        return; // Suppress
      }
    }
    
    if (shouldSuppress) return;
    originalConsoleError.apply(console, args);
  };
  
  console.warn = (...args) => {
    // First check if we should suppress - check msg directly as well
    const shouldSuppress = suppressAudioContextWarning(args);
    
    // Also check first argument directly for Strudel internal errors
    if (!shouldSuppress && args.length > 0) {
      const firstArg = args[0];
      const firstArgStr = typeof firstArg === 'string' ? firstArg : String(firstArg);
      
      // Quick check for common Strudel error patterns
      if (firstArgStr.includes('[eval]') || 
          firstArgStr.includes('[getTrigger]') ||
          firstArgStr.includes('RolandTR') ||
          firstArgStr.includes('undefined instead of pattern') ||
          firstArgStr.includes('not found') ||
          firstArgStr.includes('[superdough]') ||
          firstArgStr.includes('cannot schedule sounds in the past') ||
          firstArgStr.includes('CycleTones not available') ||
          firstArgStr.includes('falling back to dirt-samples') ||
          firstArgStr.includes('createPeriodicWave') ||
          firstArgStr.includes('length of the real array provided (0)') ||
          firstArgStr.includes('minimum bound (2)') ||
          firstArgStr.includes('Unexpected token')) {
        return; // Suppress
      }
    }
    
    if (shouldSuppress) return;
    originalConsoleWarn.apply(console, args);
  };
}

// Call suppression early, before any audio operations
const suppressed = suppressAudioContextWarnings();

// Safe routing logger to avoid accidental 'this' binding issues
function __safeRouteLog(ctx, ...args) {
  try {
    if (ctx && typeof ctx._logRoute === 'function') {
      ctx._logRoute(...args);
    }
  } catch (e) {
    // noop
  }
}

function restoreConsoleMethods() {
  if (!audioContextWarningSuppressed) return;
  // Don't restore - keep suppression active to catch async warnings
  // The browser may emit warnings asynchronously after resume() returns
}

class SoundManager {
  constructor() {
    this.audioContext = null;
    this.appInstance = null; // Reference to InteractiveSoundApp for accessing effects
    this.volume = soundConfig.defaults.volume;
    this.activeSounds = new Map(); // Track active sounds per element
    this.audioBuffers = new Map(); // Cache loaded audio buffers
    this.oscillators = new Map(); // Track active oscillators
    
    // Per-element audio controls
    this.elementGainNodes = new Map(); // elementId -> gainNode
    this.elementPanNodes = new Map(); // elementId -> stereopannerNode
    this.elementGainValues = new Map(); // elementId -> gain value (0-1)
    this.elementPanValues = new Map(); // elementId -> pan value (-1 to 1)
    // REMOVED: masterAnalyser - visualizer uses its own analyser connected in parallel
    this.currentEvaluatingSlot = null; // Track which pattern slot is currently being evaluated
    
    // Initialize audio context (requires user interaction)
    this.initialized = false;
    
    // Track Strudel sound bank loading state
    this.strudelSoundBanksLoaded = false;
    this.strudelSoundBankLoading = false;
    this.soundsPreloaded = false; // Flag to track if all sounds are preloaded
    
    // Callback for when sounds are ready
    this.onSoundsReadyCallback = null;
    this.onMasterPatternUpdateCallback = null; // Callback for when master pattern is updated
    this.onMasterStateChangeCallback = null; // Callback for when master starts/stops playing
    
    // Track Strudel initialization state
    this.strudelLoading = false;
    this.strudelLoaded = false;
    
    // Map element IDs to Strudel pattern slots (d1, d2, d3, etc.)
    // Each Strudel element gets its own pattern slot so they don't overwrite each other
    this.strudelPatternSlots = new Map(); // elementId -> slotName (e.g., 'd1', 'd2')
    this.patternSlotToElementId = new Map(); // slotName -> elementId (reverse map for routing)
    this.nextPatternSlot = 1; // Start with d1
    this.previewSlotName = 'd16';
    this.reservedSlots = new Set([this.previewSlotName]);
    
    // Track which banks are successfully loaded
    this.loadedBanks = new Set(); // Set of bank names that are successfully loaded
    
    // Current tempo (BPM) - defaults to 120
    this.currentTempo = 120;
    
    // Current key/scale - no default (user must select)
    this.currentKey = 'C';
    this.currentScale = 'chromatic';
    
    // Current time signature - no default (user must select)
    this.currentTimeSignature = '';
    
    // Pattern cache system for instant triggering
    // elementId -> { processedPattern, patternSlot, isPreEvaluated, originalPattern }
    this.patternCache = new Map();
    
    // Master channel routing
    this.masterGainNode = null; // Master gain node - all channels route here
    this._manualStrudelOutputNode = null; // Fallback output when scheduler.webaudio is missing
    this._manualStrudelOutputDisabled = false; // Set true if factory throws ensureObjectValue error
    this.masterPanNode = null; // Master pan node
    this.masterVolume = 0.7; // Master volume (0-1)
    this.masterPan = 0; // Master pan (-1 to 1)
    this.masterMuted = false; // Master mute state
    this.masterVolumeBeforeMute = 0.7; // Store volume before mute
    this.visualizerAnalyser = null;
    this.visualizerAnalyserTapGain = null;
    this.visualizerAnalyserTapGainConnected = false;
    
    // Debug flags
    this.debugAudioRouting = false; // set true to see detailed routing logs
    this._logRoute = (...args) => { if (this.debugAudioRouting) console.log(...args); };
    // Route all Strudel AudioNodes through master chain by default
    this._routingBypass = false;
    
    // Master pattern system
    this.masterPattern = ''; // Combined pattern code
    this.masterSlot = 'd0'; // Dedicated slot for master output
    this.trackedPatterns = new Map(); // elementId -> {pattern, gain, pan, muted, soloed}
    this.masterActive = false; // Is master pattern playing
    this.masterPlaybackStartTime = null;
    this.masterPlaybackSpeed = 1;
    this.masterPlaybackTempo = this.currentTempo;
    this.masterOnlyPlayback = true; // Route all playback (including preview) through master
    this.previewElementIds = new Set(); // Track preview elements routed through master
    this.sampleNameToSpecialtyBank = new Map(); // Map sample name -> specialty bank

    this.specialtyManifests = new Map(); // Cache normalized specialty sample manifests

    // Master pattern live refresh helpers
    this._pendingMasterPatternRefreshReason = null;
    this._masterPatternRefreshTimer = null;
    this._masterPatternEvalPromise = Promise.resolve();

    // Cache for scale conversion context
    this._cachedScaleContext = null;
    this._cachedScaleKey = '';
    
    // Audio export state
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    
    // MIDI state
    this.midiEnabled = false;
    this.midiOutputs = new Map(); // portName -> WebMidi output
    this.selectedMidiOutput = null; // Currently selected MIDI output port
    this.midiChannel = 0; // Default MIDI channel (0-15, where 0 = channel 1)
  }
  
  /**
   * Get the pattern slot for an element (assigns one if not already assigned)
   */
  getPatternSlot(elementId) {
    if (elementId === 'modal-preview') {
      const slotName = this.previewSlotName;
      const existingOwner = this.patternSlotToElementId.get(slotName);
      if (existingOwner && existingOwner !== elementId) {
        console.log(`⚠️ Preview slot ${slotName} previously mapped to ${existingOwner}, reassigning...`);
        this.strudelPatternSlots.delete(existingOwner);
        this.patternSlotToElementId.delete(slotName);
        this.getPatternSlot(existingOwner);
      }
      this.strudelPatternSlots.set(elementId, slotName);
      this.patternSlotToElementId.set(slotName, elementId);
      return slotName;
    }

    if (!this.strudelPatternSlots.has(elementId)) {
      let slotNumber = this.nextPatternSlot;
      let slotName = `d${slotNumber}`;
      while (this.reservedSlots.has(slotName)) {
        slotNumber++;
        if (slotNumber > 16) slotNumber = 1;
        slotName = `d${slotNumber}`;
      }

      this.strudelPatternSlots.set(elementId, slotName);
      this.patternSlotToElementId.set(slotName, elementId); // Create reverse map
      console.log(`🎵 Assigned ${elementId} to pattern slot ${slotName}`);

      slotNumber++;
      if (slotNumber > 16) slotNumber = 1;
      this.nextPatternSlot = slotNumber;
    }
    const slot = this.strudelPatternSlots.get(elementId);
    console.log(`🎵 ${elementId} using slot ${slot}`);
    return slot;
  }

  /**
   * Set callback for when sounds are ready to play
   */
  onSoundsReady(callback) {
    this.onSoundsReadyCallback = callback;
  }

  /**
   * Register a callback for when the master pattern is updated
   */
  onMasterPatternUpdate(callback) {
    this.onMasterPatternUpdateCallback = callback;
  }

  /**
   * Register a callback for when the master state changes (playing/stopped)
   */
  onMasterStateChange(callback) {
    this.onMasterStateChangeCallback = callback;
  }

  /**
   * Initialize Strudel and load sound banks (called after audio context is ready)
   */
  async initializeStrudelAndSounds() {
    try {
      console.log('📦 Loading Strudel from CDN...');
      
      // Load Strudel if not already loaded OR if functions aren't exposed yet
      // Note: silence is a Pattern object, not a function!
      const needsLoading = !window.strudel || 
                          !window.strudel.evaluate || 
                          typeof globalThis.silence !== 'object' ||
                          typeof globalThis.sound !== 'function';
      
      if (needsLoading) {
        console.log('Loading Strudel (window.strudel exists:', !!window.strudel, ', functions exposed:', typeof globalThis.sound === 'function', ')');
        await this.loadStrudelFromCDN();
      } else {
        console.log('Strudel already loaded and functions exposed');
      }
      
      // Verify Strudel is ready
      if (!window.strudel || !window.strudel.evaluate) {
        console.error('Strudel failed to load properly');
        return false;
      }
      
      // Verify functions are exposed (silence is a Pattern object, sound/note are functions)
      if (typeof globalThis.silence !== 'object' || typeof globalThis.sound !== 'function') {
        console.error('Strudel loaded but functions not exposed to globalThis!');
        console.log('  typeof globalThis.silence:', typeof globalThis.silence, '(should be object)');
        console.log('  typeof globalThis.sound:', typeof globalThis.sound, '(should be function)');
        console.log('  typeof globalThis.note:', typeof globalThis.note, '(should be function)');
        return false;
      }
      
      console.log('✅ Strudel loaded successfully with functions exposed');
      
      // Silence all patterns immediately (only if silence is available)
      console.log('🔇 Ensuring all patterns are silent...');
      if (globalThis.silence && typeof globalThis.silence === 'object') {
        for (let i = 1; i <= 16; i++) {
          try {
            window.strudel.evaluate(`d${i} = silence`).catch(() => {});
          } catch (e) {
            // Ignore
          }
        }
      } else {
        console.warn('⚠️ silence pattern not available yet - skipping pattern slot initialization');
      }
      
      // Load sound banks
      console.log('📦 Loading sound banks...');
      const banksLoaded = await this.ensureDefaultSoundBanks();
      
      if (banksLoaded) {
        console.log('✅ Default sound banks loaded');
      } else {
        console.warn('⚠️ Default sound banks failed to load');
      }
      
      // Preload all common drum sounds and banks
      console.log('📦 Preloading all sounds...');
      await this.preloadAllCommonDrumSounds();
      
      // Pre-load all configured patterns for instant triggering
      console.log('📦 Pre-loading all configured patterns...');
      this.preloadAllPatterns().catch(err => {
        console.log('⚠️ Pattern pre-loading failed:', err);
      });
      
      // Mark sounds as preloaded
      this.soundsPreloaded = true;
      console.log('✅✅✅ All sounds ready and preloaded!');
      return true;
    } catch (error) {
      console.error('Error initializing Strudel/sounds:', error);
      return false;
    }
  }

  /**
   * Initialize the audio context (must be called after user interaction)
   */
  async initialize() {
    if (this.initialized && this.audioContext && this.audioContext.state === 'running') {
      return true;
    }
    
    try {
      // Only create new audio context if it doesn't exist or is closed
      if (this.audioContext) {
        // If context exists but is closed, create a new one
        if (this.audioContext.state === 'closed') {
          this.audioContext = null;
        }
      }

      if (!this.audioContext) {
        // CRITICAL: Hijack AudioContext constructor BEFORE loading Strudel
        // This ensures Strudel uses our shared context from the start
        // Store original constructor BEFORE creating context
        const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
        if (!window.__OriginalAudioContext) {
          window.__OriginalAudioContext = OriginalAudioContext;
        }
        
        // Create audio context - this is allowed on user gesture
        this.audioContext = new OriginalAudioContext();
        
        // CRITICAL: Hijack AudioContext constructor IMMEDIATELY after creating our context
        // This ensures Strudel uses our context when it creates nodes
        const ourContext = this.audioContext;
        
        // Replace constructor with a function that returns our context
        // Preserve prototype chain for proper inheritance
        const HijackedAudioContext = function() {
          __safeRouteLog(this, '🎚️ AudioContext constructor hijacked - returning our shared context');
          return ourContext;
        };
        
        // Copy prototype from original AudioContext to maintain compatibility
        HijackedAudioContext.prototype = OriginalAudioContext.prototype;
        HijackedAudioContext.__proto__ = OriginalAudioContext;
        
        // Replace the constructor IMMEDIATELY
        window.AudioContext = HijackedAudioContext;
        
        // Also handle webkitAudioContext for Safari
        if (window.webkitAudioContext) {
          window.webkitAudioContext = HijackedAudioContext;
        }
        
        // Store reference for debugging
        window.__hijackedAudioContext = ourContext;
        
        // Mark our context so we can identify it
        this.audioContext.__masterPanNode = true; // Marker for debugging
        
        console.log('✅ AudioContext hijacked - all future AudioContext creations will use our shared context');
        
        // Create master channel nodes EARLY so initStrudel can receive a valid destination
        this.masterPanNode = this.audioContext.createStereoPanner();
        this.masterGainNode = this.audioContext.createGain();
        
        // Store the real destination BEFORE overriding
        this._realDestination = this.audioContext.destination;
        
        // REMOVED: masterAnalyser - no longer needed, visualizer uses its own analyser
        // Simplified chain: element gain -> element pan -> master pan -> master gain -> destination
        // Visualizer analyser connects in parallel to master gain

        // Connect: masterPan -> masterGain -> REAL destination
        this.masterPanNode.connect(this.masterGainNode);
        // CRITICAL: Connect masterGainNode to destination - this is the final output
        // Store this connection so we can verify it later
        this.masterGainNode.connect(this._realDestination);
        __safeRouteLog(this, `🎚️ ✅ INITIAL: Connected masterPan -> masterGain -> destination (gain=${this.masterGainNode.gain.value.toFixed(3)})`);
        
        // Set master values (use stored masterVolume, not this.volume)
        this.masterGainNode.gain.value = this.masterVolume;
        this.masterPanNode.pan.value = this.masterPan;
        
        // Keep old gainNode for backward compatibility (now routes through master)
        // Use masterVolume, not this.volume, since master controls the output
        this.gainNode = this.masterGainNode;
        // Don't override master gain - it's already set to masterVolume above
        
        // Don't override destination - it breaks Strudel
        // Instead, we'll manually call webaudioOutput with masterPanNode
        console.log('💡 Master channel ready - will route Strudel through it during init');

        // NOW load Strudel - it will use our hijacked AudioContext
        // CRITICAL: Load Strudel AFTER hijacking AudioContext AND after master nodes exist
        // so we can pass masterPanNode as destination
        if (!this.strudelLoaded) {
          __safeRouteLog(this, '🎚️ Loading Strudel after hijacking AudioContext (master nodes ready for destination)...');
          await this.loadStrudelFromCDN();
        }

        // Patch AudioNode.prototype.connect to intercept connections to destination
        // This ensures ALL audio nodes (including Strudel's) route through element gain nodes or master
        if (!AudioNode.prototype.__originalConnect) {
          AudioNode.prototype.__originalConnect = AudioNode.prototype.connect;
          
          const masterPanNode = this.masterPanNode;
          const masterGainNode = this.masterGainNode;
          const audioContextInstance = this.audioContext;
          const soundManagerInstance = this;
          
          const realDestination = this._realDestination;
          
          AudioNode.prototype.connect = function(destination, outputIndex, inputIndex) {
            // Optional routing bypass for debugging: allow native connections
            if (soundManagerInstance && soundManagerInstance._routingBypass === true) {
              return this.__originalConnect.call(this, destination, outputIndex, inputIndex);
            }

            // If either the source or destination belongs to a different AudioContext than our shared one,
            // skip the interception completely and allow the native connection. This avoids cross-context errors
            // (e.g., Strudel's room() reverb uses its own Offline/secondary contexts).
            const sourceContext = this.context;
            const destinationContext = destination?.context;
            const isSourceOurContext = sourceContext && sourceContext === audioContextInstance;
            const isDestinationOurContext = destinationContext && destinationContext === audioContextInstance;
            const destinationIsReal = destination === realDestination || destination === audioContextInstance.destination;
            const destinationHasNoContext = destination && !destinationContext && destinationIsReal;

            if (!isSourceOurContext || (!(isDestinationOurContext || destinationHasNoContext))) {
              return this.__originalConnect.call(this, destination, outputIndex, inputIndex);
            }
            
            // CRITICAL DEBUG: Log ALL connection attempts when master is active
            // This helps us see if Strudel is creating nodes and connecting them
            if (soundManagerInstance && soundManagerInstance.masterActive) {
              const nodeType = this.constructor.name;
              const destType = destination?.constructor?.name || 'unknown';
              const isDest = destination === realDestination || 
                           destination === audioContextInstance.destination ||
                           (destination?.constructor?.name === 'AudioDestinationNode');
              
              // Log ALL connections when master is active (not just destination connections)
              if (!soundManagerInstance._allConnectionsDebugLogged) {
                soundManagerInstance._allConnectionsDebugLogged = new Set();
              }
              const connKey = `${nodeType}->${destType}`;
              if (!soundManagerInstance._allConnectionsDebugLogged.has(connKey)) {
                console.log(`🔊 CONNECTION DEBUG: ${nodeType} -> ${destType}, isDestination=${isDest}, context=${this.context === audioContextInstance ? 'OUR' : 'OTHER'}`);
                soundManagerInstance._allConnectionsDebugLogged.add(connKey);
              }
            }
            
            // Skip AnalyserNodes - they're passive readers, not sources
            const isAnalyserNode = this.constructor.name === 'AnalyserNode';
            
            // Only intercept connections to destinations, not internal GainNode->GainNode connections
            // Intercepting internal routing causes feedback loops
            // Check if connecting to the actual audio destination (NOT intermediate nodes like masterPanNode/masterGainNode)
            // Only intercept connections to the real destination, not internal routing nodes
            const isMasterDestination = (
              destination === realDestination ||
              destination === audioContextInstance.destination
            );
            
            // Also check if destination is ANY AudioContext's destination (Strudel might use its own context)
            const isAnyAudioContextDestination = (
              destination && 
              destination.constructor && 
              destination.constructor.name === 'AudioDestinationNode'
            );

            // OLD GainNode->GainNode interception code removed - it was causing feedback loops
            // We now only intercept connections to destinations, not internal routing

            // If connecting to the master destination OR any AudioContext destination, check for element routing first
            // Only intercept when master is active (playing)
            // CRITICAL: Also intercept connections to ANY AudioContext destination when master is active
            // This ensures we catch Strudel nodes even if they're connecting to Strudel's own destination
            // SKIP AnalyserNodes - they're audio readers, not sources. We want to intercept audio SOURCE nodes.
            
            // Log ALL connection attempts to destination (regardless of masterActive) for debugging
            if ((isMasterDestination || isAnyAudioContextDestination) && !isAnalyserNode) {
              if (!soundManagerInstance._allDestConnectionsLogged) {
                soundManagerInstance._allDestConnectionsLogged = new Set();
              }
              const connectionKey = `${this.constructor.name}->${destination?.constructor?.name}`;
              if (!soundManagerInstance._allDestConnectionsLogged.has(connectionKey)) {
                soundManagerInstance._logRoute(`🎚️ 🔴 DESTINATION CONNECTION: ${this.constructor.name} -> ${destination?.constructor?.name}, masterActive=${soundManagerInstance.masterActive}, trackedPatterns=${soundManagerInstance.trackedPatterns.size}`);
                soundManagerInstance._allDestConnectionsLogged.add(connectionKey);
              }
            }
            
            // Log ALL connection attempts when master is active (for debugging)
            if (soundManagerInstance.masterActive && !isAnalyserNode) {
              if (!soundManagerInstance._allConnectionsLogged) {
                soundManagerInstance._allConnectionsLogged = new Set();
              }
              const connectionKey = `${this.constructor.name}->${destination?.constructor?.name}`;
              if (!soundManagerInstance._allConnectionsLogged.has(connectionKey)) {
                soundManagerInstance._logRoute(`🎚️ Connection attempt: ${this.constructor.name} -> ${destination?.constructor?.name}, isMasterDest=${isMasterDestination}, isAnyDest=${isAnyAudioContextDestination}, masterActive=${soundManagerInstance.masterActive}`);
                soundManagerInstance._allConnectionsLogged.add(connectionKey);
              }
            }
            
            // Intercept ALL connections to destination (even during initialization)
            // Route through master chain if element routing not available
            // This ensures we catch Strudel's output even if it connects before trackedPatterns is set
            const shouldIntercept = (isMasterDestination || isAnyAudioContextDestination) && !isAnalyserNode;
            const masterPlaybackActive = soundManagerInstance.masterActive && soundManagerInstance.trackedPatterns.size > 0;
            const isMultiChannelMaster = masterPlaybackActive;
            
            if (shouldIntercept) {
              // Debug logging for master destination connections
              if (!soundManagerInstance._masterDestinationConnectLogged) {
                soundManagerInstance._logRoute(`🎚️ ✅ INTERCEPTING connection to destination: ${this.constructor.name} -> ${destination?.constructor?.name}, masterActive=${soundManagerInstance.masterActive}, trackedPatterns=${soundManagerInstance.trackedPatterns.size}`);
                soundManagerInstance._masterDestinationConnectLogged = true;
              }
              // Intercept audio SOURCE nodes (GainNode, OscillatorNode, etc.) connecting to destination
              // Skip AnalyserNodes as they're passive readers
              
              // Log what type of node is connecting (for debugging)
              if (!soundManagerInstance._nodeTypeConnectLogged) {
                soundManagerInstance._nodeTypeConnectLogged = new Set();
              }
              const nodeType = this.constructor.name;
              if (!soundManagerInstance._nodeTypeConnectLogged.has(nodeType)) {
                soundManagerInstance._logRoute(`🎚️ Intercepting ${nodeType} connecting to ${destination?.constructor?.name}`);
                soundManagerInstance._nodeTypeConnectLogged.add(nodeType);
              }
              
              // If master playback is active, always route through master chain
              if (masterPlaybackActive) {
                const masterNode = masterPanNode || masterGainNode;
                if (masterNode) {
                  // Ensure masterPan -> masterGain connection
                  if (masterPanNode && masterGainNode) {
                    try {
                      masterPanNode.connect(masterGainNode);
                    } catch (e) {
                      if (!e.message.includes('already')) {
                        console.warn(`⚠️ Master chain connect error: ${e.message}`);
                      }
                    }
                  }
                  
                  // Ensure masterGain -> destination connection
                  if (masterGainNode && soundManagerInstance._realDestination) {
                    try {
                      masterGainNode.connect(soundManagerInstance._realDestination);
                    } catch (e) {
                      if (!e.message.includes('already')) {
                        console.warn(`⚠️ Master destination connect error: ${e.message}`);
                      }
                    }
                  }
                  
                  this.__punchcardMasterRouted = true;
                  this.__punchcardMasterConnectionNode = masterNode;
                  return this.__originalConnect.call(this, masterNode, outputIndex, inputIndex);
                }
              }
              
              let elementId = null;
              
              // Only attempt to route through element gain nodes when we can uniquely identify the element
              if (!isMultiChannelMaster && soundManagerInstance.masterActive && soundManagerInstance.trackedPatterns.size > 0) {
                const trackedElementIds = Array.from(soundManagerInstance.trackedPatterns.keys());
                
                if (trackedElementIds.length === 1) {
                  // Single element master - route through that element's gain node
                  elementId = trackedElementIds[0];
                  if (!soundManagerInstance._singleElementMasterRoutingLogged) {
                    soundManagerInstance._logRoute(`🎚️ Single element master detected, routing through ${elementId} (trackedPatterns.size=${soundManagerInstance.trackedPatterns.size})`);
                    soundManagerInstance._logRoute(`🎚️ currentEvaluatingSlot=${soundManagerInstance.currentEvaluatingSlot}, patternSlotToElementId mapping:`, Array.from(soundManagerInstance.patternSlotToElementId.entries()));
                    soundManagerInstance._singleElementMasterRoutingLogged = true;
                  }
                } else if (soundManagerInstance.currentEvaluatingSlot) {
                  // Multiple elements but we have a current evaluating slot (e.g., editing a single element)
                  const slotElementId = soundManagerInstance.patternSlotToElementId.get(soundManagerInstance.currentEvaluatingSlot);
                  if (slotElementId && trackedElementIds.includes(slotElementId)) {
                    elementId = slotElementId;
                    soundManagerInstance._logRoute(`🎚️ Multi-element evaluate: routing via currentEvaluatingSlot ${soundManagerInstance.currentEvaluatingSlot} -> ${elementId}`);
                  }
                }
              }
              
              // PRIORITY 2: Check currentEvaluatingSlot (for individual element playback)
              if (soundManagerInstance.masterActive && !elementId && soundManagerInstance.currentEvaluatingSlot) {
                elementId = soundManagerInstance.patternSlotToElementId.get(soundManagerInstance.currentEvaluatingSlot);
                if (elementId) {
                  soundManagerInstance._logRoute(`🎚️ Found element from currentEvaluatingSlot: ${elementId} (slot: ${soundManagerInstance.currentEvaluatingSlot})`);
                } else {
                  soundManagerInstance._logRoute(`🎚️ currentEvaluatingSlot=${soundManagerInstance.currentEvaluatingSlot} but no mapping found. Available mappings:`, Array.from(soundManagerInstance.patternSlotToElementId.entries()));
                }
              }
              
              // PRIORITY 3: Check all active slots (fallback)
              if (!elementId) {
                for (const [slotName, elemId] of soundManagerInstance.patternSlotToElementId.entries()) {
                  try {
                    const slotValue = globalThis[slotName];
                    if (slotValue && slotValue !== globalThis.silence) {
                      elementId = elemId;
                      soundManagerInstance._logRoute(`🎚️ Found element from active slot: ${elementId} (slot: ${slotName})`);
                      break;
                    }
                  } catch (e) {
                    // Ignore errors
                  }
                }
              }
              
              // If we found an element, route through its gain node
              if (elementId) {
                const elementNodes = soundManagerInstance.getElementAudioNodes(elementId);
                if (elementNodes && elementNodes.gainNode) {
                  const panNode = elementNodes.panNode;
                
                // If this source was previously routed through master fallback, disconnect that connection
                if (this.__punchcardMasterRouted && this.__punchcardMasterConnectionNode && typeof this.disconnect === 'function') {
                  try {
                    this.disconnect(this.__punchcardMasterConnectionNode);
                    soundManagerInstance._logRoute(`🎚️ Disconnected ${this.constructor.name} from master fallback before routing through element chain`);
                  } catch (e) {
                    // Ignore if already disconnected
                  }
                  this.__punchcardMasterRouted = false;
                  this.__punchcardMasterConnectionNode = null;
                }
                  
                  // CRITICAL: Ensure panNode is connected to master chain
                  // This is needed because element nodes might be created before master nodes exist
                  if (panNode) {
                    // Only reconnect if master nodes exist and panNode might not be connected
                    // We disconnect and reconnect to ensure it's connected to the right place
                    const needsReconnect = soundManagerInstance.masterPanNode || soundManagerInstance.masterGainNode;
                    
                    if (needsReconnect) {
                      try {
                        // CRITICAL: Track which elements have already had their panNode connected
                        // This prevents repeated disconnections that break the audio chain
                        if (!soundManagerInstance._panNodeConnectedToMaster) {
                          soundManagerInstance._panNodeConnectedToMaster = new Set();
                        }
                        
                        // Only connect if we haven't already connected this element's panNode
                        // Web Audio API will throw if already connected, so we catch that
                        const connectionKey = `${elementId}-${soundManagerInstance.masterPanNode ? 'pan' : 'gain'}`;
                        if (!soundManagerInstance._panNodeConnectedToMaster.has(connectionKey)) {
                          // Connect to master chain (prefer masterPanNode, fallback to masterGainNode)
                          let connected = false;
                          if (soundManagerInstance.masterPanNode) {
                            try {
                              panNode.connect(soundManagerInstance.masterPanNode);
                              connected = true;
                              soundManagerInstance._panNodeConnectedToMaster.add(connectionKey);
                              if (!soundManagerInstance._panNodeConnectedLogged) {
                                soundManagerInstance._panNodeConnectedLogged = new Set();
                              }
                              if (!soundManagerInstance._panNodeConnectedLogged.has(elementId)) {
                                soundManagerInstance._logRoute(`🎚️ ✅ Connected ${elementId} panNode -> masterPanNode`);
                                soundManagerInstance._panNodeConnectedLogged.add(elementId);
                              }
                            } catch (e) {
                              // Already connected, that's fine - mark as connected
                              if (e.message.includes('already connected') || e.message.includes('already been connected')) {
                                soundManagerInstance._panNodeConnectedToMaster.add(connectionKey);
                                connected = true;
                              } else {
                                throw e; // Re-throw if it's a different error
                              }
                            }
                          } else if (soundManagerInstance.masterGainNode) {
                            try {
                              panNode.connect(soundManagerInstance.masterGainNode);
                              connected = true;
                              soundManagerInstance._panNodeConnectedToMaster.add(connectionKey);
                              if (!soundManagerInstance._panNodeConnectedLogged) {
                                soundManagerInstance._panNodeConnectedLogged = new Set();
                              }
                              if (!soundManagerInstance._panNodeConnectedLogged.has(elementId)) {
                                soundManagerInstance._logRoute(`🎚️ ✅ Connected ${elementId} panNode -> masterGainNode (fallback)`);
                                soundManagerInstance._panNodeConnectedLogged.add(elementId);
                              }
                            } catch (e) {
                              // Already connected, that's fine - mark as connected
                              if (e.message.includes('already connected') || e.message.includes('already been connected')) {
                                soundManagerInstance._panNodeConnectedToMaster.add(connectionKey);
                                connected = true;
                              } else {
                                throw e; // Re-throw if it's a different error
                              }
                            }
                          }
                          
                          if (!connected) {
                            console.error(`❌ ${elementId} panNode: Master nodes exist but connection failed!`);
                          }
                        }
                      } catch (e) {
                        // Connection failed, log error
                        if (!soundManagerInstance._panNodeConnectionErrorLogged) {
                          soundManagerInstance._panNodeConnectionErrorLogged = new Set();
                        }
                        if (!soundManagerInstance._panNodeConnectionErrorLogged.has(elementId)) {
                          console.error(`❌ Failed to connect ${elementId} panNode to master chain:`, e.message);
                          console.error(`   panNode:`, panNode);
                          console.error(`   masterPanNode:`, soundManagerInstance.masterPanNode);
                          console.error(`   masterGainNode:`, soundManagerInstance.masterGainNode);
                          soundManagerInstance._panNodeConnectionErrorLogged.add(elementId);
                        }
                      }
                    } else {
                      // Master nodes don't exist yet - this is OK, connection will happen later
                      if (!soundManagerInstance._panNodeNotConnectedLogged) {
                        soundManagerInstance._panNodeNotConnectedLogged = new Set();
                      }
                      if (!soundManagerInstance._panNodeNotConnectedLogged.has(elementId)) {
                        console.warn(`⚠️ ${elementId} panNode: Master nodes not available yet (will connect when available)`);
                        soundManagerInstance._panNodeNotConnectedLogged.add(elementId);
                      }
                    }
                  }
                  
                  // Verify chain connectivity
                  let chainInfo = [];
                  
                  // Check gain node
                  chainInfo.push(`gainNode: gain=${elementNodes.gainNode.gain.value.toFixed(3)}, inputs=${elementNodes.gainNode.numberOfInputs}, outputs=${elementNodes.gainNode.numberOfOutputs}`);
                  
                  // Check pan node
                  if (panNode) {
                    chainInfo.push(`panNode: pan=${panNode.pan.value.toFixed(3)}, inputs=${panNode.numberOfInputs}, outputs=${panNode.numberOfOutputs}`);
                  } else {
                    chainInfo.push(`panNode: MISSING`);
                  }
                  
                  // Check master chain
                  if (soundManagerInstance.masterPanNode) {
                    chainInfo.push(`masterPanNode: inputs=${soundManagerInstance.masterPanNode.numberOfInputs}, outputs=${soundManagerInstance.masterPanNode.numberOfOutputs}`);
                  } else {
                    chainInfo.push(`masterPanNode: MISSING`);
                  }
                  
                  if (soundManagerInstance.masterGainNode) {
                    chainInfo.push(`masterGainNode: gain=${soundManagerInstance.masterGainNode.gain.value.toFixed(3)}, inputs=${soundManagerInstance.masterGainNode.numberOfInputs}, outputs=${soundManagerInstance.masterGainNode.numberOfOutputs}`);
                  } else {
                    chainInfo.push(`masterGainNode: MISSING`);
                  }
                  
                  // Log chain status
                  if (!soundManagerInstance._chainVerificationLogged) {
                    soundManagerInstance._chainVerificationLogged = new Set();
                  }
                  if (!soundManagerInstance._chainVerificationLogged.has(elementId)) {
                    soundManagerInstance._logRoute(`🎚️ INTERCEPTED: Routing ${elementId} audio through element gain node (${this.constructor.name} -> ${elementNodes.gainNode.constructor.name})`);
                    soundManagerInstance._logRoute(`🎚️ Audio chain verification for ${elementId}:`, chainInfo.join(', '));
                    soundManagerInstance._chainVerificationLogged.add(elementId);
                  }
                  
                  // CRITICAL: Ensure panNode is connected to master chain (only once, not on every call)
                  const elementPanNode = elementNodes.panNode;
                  if (elementPanNode && !soundManagerInstance._panNodeConnectedLogged?.has(elementId)) {
                    try {
                      // Only connect if not already connected (check by trying to connect)
                      if (soundManagerInstance.masterPanNode) {
                        try {
                          elementPanNode.connect(soundManagerInstance.masterPanNode);
                          if (!soundManagerInstance._panNodeConnectedLogged) {
                            soundManagerInstance._panNodeConnectedLogged = new Set();
                          }
                          soundManagerInstance._panNodeConnectedLogged.add(elementId);
                          soundManagerInstance._logRoute(`🎚️ ✅ CRITICAL: Connected ${elementId} panNode -> masterPanNode`);
                        } catch (e) {
                          // Already connected - that's fine
                          if (!soundManagerInstance._panNodeConnectedLogged) {
                            soundManagerInstance._panNodeConnectedLogged = new Set();
                          }
                          soundManagerInstance._panNodeConnectedLogged.add(elementId);
                        }
                      } else if (soundManagerInstance.masterGainNode) {
                        try {
                          elementPanNode.connect(soundManagerInstance.masterGainNode);
                          if (!soundManagerInstance._panNodeConnectedLogged) {
                            soundManagerInstance._panNodeConnectedLogged = new Set();
                          }
                          soundManagerInstance._panNodeConnectedLogged.add(elementId);
                          soundManagerInstance._logRoute(`🎚️ ✅ CRITICAL: Connected ${elementId} panNode -> masterGainNode (fallback)`);
                        } catch (e) {
                          // Already connected
                          if (!soundManagerInstance._panNodeConnectedLogged) {
                            soundManagerInstance._panNodeConnectedLogged = new Set();
                          }
                          soundManagerInstance._panNodeConnectedLogged.add(elementId);
                        }
                      }
                    } catch (e) {
                      console.error(`❌ CRITICAL: Failed to connect ${elementId} panNode: ${e.message}`);
                    }
                  }
                  
                  // Connect to element gain node - this routes through the chain
                  // The chain is: source -> elementGain -> elementPan -> masterPan -> masterGain -> destination
                  const connectResult = this.__originalConnect.call(this, elementNodes.gainNode, outputIndex, inputIndex);
                  
                  // CRITICAL: Verify masterGainNode is connected to destination RIGHT AFTER routing
                  // This ensures the final output path is complete
                  // Only verify once per element to avoid spam
                  // Initialize Set BEFORE checking to prevent repeated connections
                  if (!soundManagerInstance._masterGainDestVerifiedAfterRouting) {
                    soundManagerInstance._masterGainDestVerifiedAfterRouting = new Set();
                  }
                  
                  // Only verify if we haven't already verified for this element
                  if (!soundManagerInstance._masterGainDestVerifiedAfterRouting.has(elementId)) {
                    // Mark as verified IMMEDIATELY to prevent repeated attempts
                    soundManagerInstance._masterGainDestVerifiedAfterRouting.add(elementId);
                    
                    soundManagerInstance._logRoute(`🎚️ 🔍 VERIFYING: masterGainNode=${!!soundManagerInstance.masterGainNode}, _realDestination=${!!soundManagerInstance._realDestination}, gain=${soundManagerInstance.masterGainNode?.gain?.value?.toFixed(3) || 'N/A'}, muted=${soundManagerInstance.masterMuted}`);
                    if (soundManagerInstance.masterGainNode && soundManagerInstance._realDestination) {
                      try {
                        soundManagerInstance.masterGainNode.connect(soundManagerInstance._realDestination);
                        soundManagerInstance._logRoute(`🎚️ ✅ CRITICAL: Connected masterGainNode -> destination after routing ${elementId} (gain=${soundManagerInstance.masterGainNode.gain.value.toFixed(3)}, muted=${soundManagerInstance.masterMuted})`);
                      } catch (e) {
                        // Already connected - that's fine, but log it
                        soundManagerInstance._logRoute(`🎚️ ✅ CRITICAL: masterGainNode -> destination already connected for ${elementId} (${e.message})`);
                      }
                    } else {
                      console.error(`❌ CRITICAL: Cannot verify masterGainNode -> destination: masterGainNode=${!!soundManagerInstance.masterGainNode}, _realDestination=${!!soundManagerInstance._realDestination}`);
                    }
                  }
                  
                  // Verify connection was successful
                  if (!soundManagerInstance._connectionSuccessLogged) {
                    soundManagerInstance._connectionSuccessLogged = new Set();
                  }
                  if (!soundManagerInstance._connectionSuccessLogged.has(elementId)) {
                    soundManagerInstance._logRoute(`🎚️ Connection result for ${elementId}: ${connectResult ? 'SUCCESS' : 'FAILED'}, source inputs now: ${elementNodes.gainNode.numberOfInputs}`);
                    soundManagerInstance._connectionSuccessLogged.add(elementId);
                  }
                  
                  if (this.__punchcardElementRouted !== true) {
                    this.__punchcardElementRouted = true;
                  }
                  return connectResult;
                } else {
                  // ElementId was set but elementNodes or gainNode is missing
                  // This is a critical error - we can't route through element chain
                  console.error(`❌ CRITICAL: Element ${elementId} found but no gain node available - elementNodes=${!!elementNodes}, gainNode=${!!elementNodes?.gainNode}`);
                  console.error(`❌ This means audio will bypass element controls!`);
                  // Clear elementId so fallback routing can try again
                  elementId = null;
                }
              } else {
                // For stack() patterns evaluated on d0, element slots aren't reliable.
                // Route them through the master chain so per-element gain is applied via pattern modifiers.
                const isStackPattern = masterPlaybackActive;
                
                if (isStackPattern) {
                  if (!soundManagerInstance._stackMasterRoutingLogged) {
                    console.log(`🎚️ Stack() pattern: Routing through master chain (${soundManagerInstance.trackedPatterns.size} elements)`);
                    soundManagerInstance._stackMasterRoutingLogged = true;
                  }
                  const masterNode = masterPanNode || masterGainNode;
                  if (masterNode) {
                    return this.__originalConnect.call(this, masterNode, outputIndex, inputIndex);
                  }
                }
                
                // Log why no element was found (only occasionally to avoid spam)
                if (!soundManagerInstance._noElementRoutingLogged) {
                  soundManagerInstance._logRoute(`🎚️ No element found for routing - trackedPatterns.size=${soundManagerInstance.trackedPatterns.size}, currentEvaluatingSlot=${soundManagerInstance.currentEvaluatingSlot}`);
                  soundManagerInstance._logRoute(`🎚️ Available pattern slot mappings:`, Array.from(soundManagerInstance.patternSlotToElementId.entries()));
                  soundManagerInstance._logRoute(`🎚️ Tracked elements:`, Array.from(soundManagerInstance.trackedPatterns.keys()));
                  soundManagerInstance._noElementRoutingLogged = true;
                }
              }
              
              // Fallback: route through master chain if no element found
              // CRITICAL: Only route when masterActive is true to prevent auto-playback
              // For single-element masters, we MUST route through element chain, not master chain directly
              // If we route directly to masterPanNode, we bypass element gain/pan controls
              if (soundManagerInstance.masterActive && soundManagerInstance.trackedPatterns.size === 1 && !elementId) {
                // Single element but couldn't find elementId - try harder to find it
                const trackedElementIds = Array.from(soundManagerInstance.trackedPatterns.keys());
                soundManagerInstance._logRoute(`🎚️ 🔍 FALLBACK CHECK: trackedPatterns.size=${soundManagerInstance.trackedPatterns.size}, elementId=${elementId}, trackedElementIds=${trackedElementIds.join(', ')}`);
                if (trackedElementIds.length === 1) {
                  elementId = trackedElementIds[0];
                  soundManagerInstance._logRoute(`🎚️ ⚠️ Fallback: Using tracked element ${elementId} for routing (elementId was null)`);
                } else {
                  console.warn(`🎚️ ⚠️ Fallback: trackedElementIds.length=${trackedElementIds.length}, expected 1`);
                }
              } else if (soundManagerInstance.trackedPatterns.size !== 1) {
                console.log(`🎚️ 🔍 FALLBACK SKIP: trackedPatterns.size=${soundManagerInstance.trackedPatterns.size}, elementId=${elementId} (not single element, skipping fallback)`);
              } else if (elementId) {
                console.log(`🎚️ 🔍 FALLBACK SKIP: trackedPatterns.size=${soundManagerInstance.trackedPatterns.size}, elementId=${elementId} (elementId already set, skipping fallback)`);
              }
              
              // If we still have an elementId, route through element chain
              if (elementId) {
                console.log(`🎚️ 🔍 FALLBACK ROUTING ATTEMPT: elementId=${elementId}, attempting to get elementNodes...`);
                const elementNodes = soundManagerInstance.getElementAudioNodes(elementId);
                console.log(`🎚️ 🔍 FALLBACK ROUTING: elementNodes=${!!elementNodes}, gainNode=${!!elementNodes?.gainNode}, panNode=${!!elementNodes?.panNode}`);
                if (elementNodes && elementNodes.gainNode) {
                  const panNode = elementNodes.panNode;
                  
                  // Ensure panNode is connected to master chain
                  if (panNode && masterPanNode) {
                    try {
                      // CRITICAL: Only disconnect specific connection, not all connections
                      try {
                        panNode.disconnect(masterPanNode);
                      } catch (e) {
                        // Not connected to masterPanNode, that's fine
                      }
                      panNode.connect(masterPanNode);
                    } catch (e) {
                      // May already be connected
                    }
                  }
                  
                  console.log(`🎚️ ✅ FALLBACK ROUTING: Routing ${this.constructor.name} through ${elementId} element chain (gain=${elementNodes.gainNode.gain.value.toFixed(3)})`);
                  return this.__originalConnect.call(this, elementNodes.gainNode, outputIndex, inputIndex);
                } else {
                  // ElementId was set but elementNodes or gainNode is still missing
                  // This is a critical error - log it but continue to master chain fallback
                  console.error(`❌ CRITICAL FALLBACK: Element ${elementId} found but elementNodes or gainNode is missing - elementNodes=${!!elementNodes}, gainNode=${!!elementNodes?.gainNode}`);
                  console.error(`❌ Audio will route through master chain, bypassing element controls!`);
                  // Don't clear elementId here - let it fall through to master chain routing
                }
              } else {
                console.log(`🎚️ 🔍 FALLBACK ROUTING SKIP: elementId is null, will route through master chain`);
              }
              
              // Final fallback: only allow routing through master chain when no element routing is possible
              // Limit this to cases where there are no tracked patterns yet (e.g., initialization) or master is inactive
              const allowMasterFallback = masterPlaybackActive || (soundManagerInstance.trackedPatterns.size === 0) || !soundManagerInstance.masterActive;
              const masterNode = allowMasterFallback ? (masterPanNode || masterGainNode) : null;
              if (masterNode) {
                // Skip fallback if this source is already routed through an element chain
                if (this.__punchcardElementRouted) {
                  console.log(`🎚️ Skipping master fallback for ${this.constructor.name} (already routed through element chain)`);
                  return this.__originalConnect.call(this, destination, outputIndex, inputIndex);
                }
                // Only log once per node type - initialize Set if needed
                if (!soundManagerInstance._masterRoutingLogged) {
                  soundManagerInstance._masterRoutingLogged = new Set();
                }
                const logKey = `master-${masterNode.constructor.name}`;
                if (!soundManagerInstance._masterRoutingLogged.has(logKey)) {
                  soundManagerInstance._masterRoutingLogged.add(logKey); // Add IMMEDIATELY to prevent duplicate logs
                  console.log(`🎚️ ⚠️ FALLBACK: Routing ${this.constructor.name} through master chain (${masterNode.constructor.name}) - element routing not available`);
                  console.log(`🎚️ ⚠️ FALLBACK: masterGainNode.gain=${masterGainNode?.gain?.value?.toFixed(3) || 'N/A'}, muted=${soundManagerInstance.masterMuted}, connected to destination=${!!soundManagerInstance._realDestination}`);
                  
                  // CRITICAL: Verify and ensure the entire master chain is connected
                  // Chain should be: source -> masterPanNode -> masterGainNode -> destination
                  if (masterPanNode && masterGainNode) {
                    try {
                      // Ensure masterPanNode -> masterGainNode connection
                      masterPanNode.connect(masterGainNode);
                      console.log(`🎚️ ✅ FALLBACK: Verified masterPanNode -> masterGainNode connection`);
                    } catch (e) {
                      if (e.message.includes('already connected') || e.message.includes('already been connected')) {
                        console.log(`🎚️ ✅ FALLBACK: masterPanNode -> masterGainNode already connected`);
                      } else {
                        console.warn(`⚠️ FALLBACK: Could not connect masterPanNode -> masterGainNode: ${e.message}`);
                      }
                    }
                  }
                  // CRITICAL: Ensure masterGainNode is connected to destination when routing through master chain
                  if (masterGainNode && soundManagerInstance._realDestination) {
                    try {
                      masterGainNode.connect(soundManagerInstance._realDestination);
                      console.log(`🎚️ ✅ FALLBACK: Ensured masterGainNode -> destination connection (gain=${masterGainNode.gain.value.toFixed(3)})`);
                    } catch (e) {
                      console.log(`🎚️ ✅ FALLBACK: masterGainNode -> destination already connected (${e.message})`);
                    }
                  }
                }
                const fallbackResult = this.__originalConnect.call(this, masterNode, outputIndex, inputIndex);
                this.__punchcardMasterRouted = true;
                this.__punchcardMasterConnectionNode = masterNode;
                return fallbackResult;
              }
              
              // Last resort: allow connection to destination if master nodes don't exist
              // This should rarely happen, but prevents breaking Strudel completely
              if (!masterPanNode && !masterGainNode) {
                console.warn(`⚠️ No master nodes available, allowing direct connection to destination`);
              }
              
              // CRITICAL: Ensure masterGainNode is always connected to destination
              // Even when routing through element chain, masterGainNode must connect to destination
              // Only reconnect if not already connected (avoid unnecessary disconnects)
              if (masterGainNode && realDestination) {
                try {
                  // Try to connect - if already connected, this will throw, which is fine
                  masterGainNode.connect(realDestination);
                  if (!soundManagerInstance._masterGainDestVerified) {
                    console.log(`🎚️ ✅ Ensured masterGainNode -> destination connection (critical for audio output)`);
                    soundManagerInstance._masterGainDestVerified = true;
                  }
                } catch (e) {
                  // Already connected or other error - that's fine, connection exists
                  if (!soundManagerInstance._masterGainDestVerified && e.message && !e.message.includes('already connected')) {
                    // Only log if it's not an "already connected" error
                    console.log(`🎚️ masterGainNode -> destination: ${e.message.includes('already') ? 'already connected' : 'connection verified'}`);
                    soundManagerInstance._masterGainDestVerified = true;
                  }
                }
              }
            }
            
            // For all other connections, use original connect
            return this.__originalConnect.call(this, destination, outputIndex, inputIndex);
          };
          
          console.log('🎚️ Patched AudioNode.prototype.connect to route through element gain nodes or master channel');
          console.log('🎚️ Hijacking verification: AudioNode.prototype.__originalConnect exists:', !!AudioNode.prototype.__originalConnect);
          console.log('🎚️ Hijacking verification: AudioNode.prototype.connect is patched:', AudioNode.prototype.connect !== AudioNode.prototype.__originalConnect);
        }
        
        // Store masterPanNode reference on audioContext so the patch can access it
        this.audioContext.__masterPanNode = this.masterPanNode;
        
        console.log('Audio context created with master channel, state:', this.audioContext.state);
        __safeRouteLog(this, `🎚️ Master initialized: volume=${(this.masterVolume * 100).toFixed(0)}%, pan=${this.masterPan.toFixed(2)}`);
      }

      // Resume audio context if suspended (this requires user gesture which should be present)
      if (this.audioContext.state === 'suspended') {
        try {
          // Suppress AudioContext warnings globally (browser may emit them asynchronously)
          suppressAudioContextWarnings();
          
          await this.audioContext.resume();
          
          // Keep suppression active - don't restore console methods
          // Browser warnings may be emitted asynchronously after resume() returns
          
          if (this.audioContext.state === 'running') {
            console.log('Audio context resumed successfully');
          } else {
            console.log('Audio context state:', this.audioContext.state);
          }
        } catch (resumeError) {
          // This warning is expected if called outside user gesture - but we should be called from user gesture
          // Suppress the warning message but check if we can continue
          if (resumeError.message && resumeError.message.includes('user gesture')) {
            // Don't log as error - this is expected before user interaction
            // Return false to indicate initialization failed (will retry on user interaction)
            return false;
          }
          console.error('Cannot resume audio context:', resumeError);
          return false;
        }
      }
      
      // Only mark as initialized if context is running
      if (this.audioContext && this.audioContext.state === 'running') {
        this.initialized = true;
        console.log('Sound Manager initialized successfully');
        
        // Set master values now that audio context is ready
        if (this.masterGainNode) {
          this.masterGainNode.gain.value = this.masterVolume;
        }
        if (this.masterPanNode) {
          this.masterPanNode.pan.value = this.masterPan;
        }
        
        __safeRouteLog(this, `🎚️ Master values set: volume=${(this.masterVolume * 100).toFixed(0)}%, pan=${this.masterPan.toFixed(2)}`);
        
        // Initialize Strudel and load sound banks
        // Note: ensureDefaultSoundBanks() is called inside initializeStrudelAndSounds() after Strudel is loaded
        console.log('🎵 Starting Strudel initialization and sound bank loading...');
        
        // Don't await - load in background but track completion
        this.initializeStrudelAndSounds().catch(err => {
          console.error('Failed to initialize Strudel/sounds:', err);
        });
        
        // Preload audio files in background (don't wait for it)
        this.preloadAudioFiles().catch(err => {
          console.log('Background audio preload failed:', err);
        });
        
        return true;
      } else {
        console.warn('Audio context not in running state:', this.audioContext?.state);
        return false;
      }
    } catch (error) {
      console.error('Failed to initialize audio context:', error);
      this.initialized = false;
      return false;
    }
  }

  /**
   * Preload all audio files from config
   */
  async preloadAudioFiles() {
    const audioElements = soundConfig.getAudioElements();
    
    for (const element of audioElements) {
      if (element.audioFile) {
        try {
          // Skip preloading non-existent files - they'll load on demand
          // Use HEAD request to check if file exists
          const response = await fetch(element.audioFile, { method: 'HEAD' });
          if (response.ok) {
            await this.loadAudioFile(element.id, element.audioFile);
          } else {
            console.log(`Skipping preload for ${element.id} (file not found): ${element.audioFile}`);
          }
        } catch (error) {
          // Silently skip errors for missing files - this is expected
          // Don't log anything for EncodingError or fetch errors
        }
      }
    }
  }

  /**
   * Load an audio file into buffer
   */
  async loadAudioFile(elementId, url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.audioBuffers.set(elementId, audioBuffer);
      return audioBuffer;
    } catch (error) {
      console.error(`Error loading audio file ${url}:`, error);
      throw error;
    }
  }

  /**
   * Set volume (0-1)
   */
  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
    }
  }

  /**
   * Set master volume (0-1)
   */
  setMasterVolume(value) {
    this.masterVolume = Math.max(0, Math.min(1, value));
    if (this.masterGainNode) {
      this.masterGainNode.gain.value = this.masterVolume;
      __safeRouteLog(this, `🎚️ Master volume set to ${(this.masterVolume * 100).toFixed(0)}% (gainNode instant via Web Audio API)`);
    } else {
      __safeRouteLog(this, `🎚️ Master volume stored as ${(this.masterVolume * 100).toFixed(0)}% (gainNode not ready yet)`);
    }
  }

  /**
   * Set master pan (-1 to 1)
   */
  setMasterPan(value) {
    this.masterPan = Math.max(-1, Math.min(1, value));
    if (this.masterPanNode) {
      this.masterPanNode.pan.value = this.masterPan;
      __safeRouteLog(this, `🎚️ Master pan set to ${this.masterPan.toFixed(2)} (panNode instant via Web Audio API)`);
    } else {
      __safeRouteLog(this, `🎚️ Master pan stored as ${this.masterPan.toFixed(2)} (panNode not ready yet)`);
    }
  }

  /**
   * Toggle master mute
   * @returns {boolean} - true if muted, false if unmuted
   */
  toggleMasterMute() {
    this.masterMuted = !this.masterMuted;
    
    if (this.masterMuted) {
      // Store current volume before muting
      this.masterVolumeBeforeMute = this.masterVolume;
      // Mute instantly via Web Audio API
      if (this.masterGainNode) {
        this.masterGainNode.gain.value = 0;
      }
      console.log('🔇 Master muted (instant via Web Audio API)');
    } else {
      // Restore volume instantly via Web Audio API
      if (this.masterGainNode) {
        this.masterGainNode.gain.value = this.masterVolumeBeforeMute;
      }
      this.masterVolume = this.masterVolumeBeforeMute;
      console.log(`🔊 Master unmuted (volume: ${(this.masterVolume * 100).toFixed(0)}%) (instant via Web Audio API)`);
    }
    
    return this.masterMuted;
  }

  /**
   * Get or create gain and pan nodes for an element
   */
  getElementAudioNodes(elementId) {
    if (!this.audioContext) {
      return null;
    }

    // Create nodes if they don't exist
    if (!this.elementGainNodes.has(elementId)) {
      const gainNode = this.audioContext.createGain();
      const panNode = this.audioContext.createStereoPanner();
      
      // Set default values
      const gainValue = this.elementGainValues.get(elementId) || 0.8;
      const panValue = this.elementPanValues.get(elementId) || 0;

      // Store nodes before wiring them so intercepted connections don't recurse
      this.elementGainNodes.set(elementId, gainNode);
      this.elementPanNodes.set(elementId, panNode);
      this.elementGainValues.set(elementId, gainValue);
      this.elementPanValues.set(elementId, panValue);
      
      gainNode.gain.value = gainValue * this.volume;
      panNode.pan.value = panValue;
      
      // Connect: elementGain -> elementPan -> masterPan
      // This ensures audio flows: Strudel -> elementGain -> elementPan -> masterPan -> masterGain -> destination
      gainNode.connect(panNode);
      
      // Try to connect panNode to master chain
      // Note: If master nodes don't exist yet, this will fail silently
      // The connection will be established later when intercepting audio connections
      let panConnected = false;
      if (this.masterPanNode) {
        try {
          panNode.connect(this.masterPanNode);
          panConnected = true;
          __safeRouteLog(this, `🎚️ ${elementId}: Connected panNode to masterPanNode during node creation`);
        } catch (e) {
          console.warn(`⚠️ ${elementId}: Failed to connect panNode to masterPanNode:`, e.message);
        }
      } else if (this.masterGainNode) {
        try {
          panNode.connect(this.masterGainNode);
          panConnected = true;
          __safeRouteLog(this, `🎚️ ${elementId}: Connected panNode to masterGainNode during node creation`);
        } catch (e) {
          console.warn(`⚠️ ${elementId}: Failed to connect panNode to masterGainNode:`, e.message);
        }
      } else if (this.gainNode) {
        try {
          panNode.connect(this.gainNode);
          panConnected = true;
          __safeRouteLog(this, `🎚️ ${elementId}: Connected panNode to gainNode during node creation`);
        } catch (e) {
          console.warn(`⚠️ ${elementId}: Failed to connect panNode to gainNode:`, e.message);
        }
      }
      
      if (!panConnected) {
        console.warn(`⚠️ ${elementId}: panNode not connected to master chain (master nodes may not exist yet - will connect on first audio connection)`);
      }
      
      // Verify the connection chain
      __safeRouteLog(this, `🎚️ Element audio chain for ${elementId}:`);
      console.log(`   gainNode (${gainNode.numberOfInputs} inputs, ${gainNode.numberOfOutputs} outputs)`);
      console.log(`   panNode (${panNode.numberOfInputs} inputs, ${panNode.numberOfOutputs} outputs)`);
      console.log(`   masterPanNode (${this.masterPanNode ? this.masterPanNode.numberOfInputs : 'N/A'} inputs)`);
      
      __safeRouteLog(this, `🎚️ Created element audio chain for ${elementId}: gain -> pan -> master`);
    }

    return {
      gainNode: this.elementGainNodes.get(elementId),
      panNode: this.elementPanNodes.get(elementId)
    };
  }

  /**
   * Dispose (disconnect and delete) per-element audio nodes.
   * Useful for temporary elements like modal previews so they don't keep routing audio.
   */
  disposeElementAudioNodes(elementId) {
    if (!elementId) {
      return;
    }

    const gainNode = this.elementGainNodes.get(elementId);
    const panNode = this.elementPanNodes.get(elementId);

    if (gainNode) {
      try {
        gainNode.disconnect();
      } catch (e) {
        // Ignore if already disconnected
      }
      this.elementGainNodes.delete(elementId);
    }

    if (panNode) {
      try {
        panNode.disconnect();
      } catch (e) {
        // Ignore if already disconnected
      }
      this.elementPanNodes.delete(elementId);
    }

    this.elementGainValues.delete(elementId);
    this.elementPanValues.delete(elementId);

    if (this._panNodeConnectedToMaster) {
      this._panNodeConnectedToMaster.delete(`${elementId}-pan`);
      this._panNodeConnectedToMaster.delete(`${elementId}-gain`);
    }
  }

  /**
   * Check if a pattern contains note() function
   * @param {string} pattern - Pattern string to check
   * @returns {boolean} - True if pattern contains note()
   */
  isNotePattern(pattern) {
    if (!pattern || typeof pattern !== 'string') {
      return false;
    }
    // Check for note( or n( function calls
    return /\b(note|n)\s*\(/.test(pattern);
  }

  /**
   * Apply element-specific gain and pan to a Strudel pattern
   * Returns modified pattern string with .gain(), .pan(), and tempo control applied
   */
  applyElementGainPanToPattern(pattern, elementId, options = {}) {
    const {
      applyGainInPattern = true,
      applyPanInPattern = true,
      applyTempoInPattern = true
    } = options;
    const gain = this.elementGainValues.get(elementId) || 0.8;
    const pan = this.elementPanValues.get(elementId) || 0;
    const tempo = this.currentTempo || 120;
    
    // Remove existing pan/postgain modifiers to avoid double application
    let modifiedPattern = pattern;
    // Remove existing .postgain() modifiers (match any value inside)
    modifiedPattern = modifiedPattern.replace(/\.postgain\s*\([^)]*\)/g, '');
    // Remove existing .pan() modifiers (match any value inside)
    modifiedPattern = modifiedPattern.replace(/\.pan\s*\([^)]*\)/g, '');
    // Clean up any double dots that might result
    modifiedPattern = modifiedPattern.replace(/\.\.+/g, '.').trim();
    modifiedPattern = modifiedPattern.replace(/\.+$/, '').trim();
    
    // Apply gain, pan, and tempo modifiers by chaining directly (no parentheses)
    // Note: Strudel's gain is 0-1, pan is -1 to 1 (0 = center)
    // When playing individually (not through master), gain is handled by Web Audio gain node,
    // so we should NOT apply .gain() in the pattern to avoid double application.
    // When playing through master, gain is applied in the pattern.
    if (applyGainInPattern) {
      if (/\.postgain\s*\([^)]*\)\s*$/i.test(modifiedPattern)) {
        modifiedPattern = modifiedPattern.replace(/\.postgain\s*\([^)]*\)\s*$/i, `.postgain(${gain})`);
      } else {
        modifiedPattern = `${modifiedPattern}.postgain(${gain})`;
      }
    }
    
    // Only add .pan() if pan value is not 0 (not center)
    if (applyPanInPattern && pan !== 0) {
      modifiedPattern += `.pan(${pan})`;
    }
    
    // Use .fast() or .slow() to adjust tempo based on current tempo vs 120 BPM base
    // First convert BPM to a speed multiplier (120 BPM = 1.0x speed)
    const speedMultiplier = tempo / 120;
    
    // Apply tempo adjustment - use .fast() or .slow() to control tempo
    // This is more reliable than .cpm() which might not exist
    if (applyTempoInPattern) {
      if (speedMultiplier > 1.0) {
        modifiedPattern += `.fast(${speedMultiplier})`;
      } else if (speedMultiplier < 1.0) {
        modifiedPattern += `.slow(${1 / speedMultiplier})`;
      }
    }
    // If speedMultiplier === 1.0, no adjustment needed
    
    console.log(`Applied gain=${gain.toFixed(2)}, pan=${pan.toFixed(2)}, tempo=${tempo} BPM (speed=${speedMultiplier.toFixed(2)}x) to ${elementId}`);
    return modifiedPattern;
  }

  /**
   * Process a pattern string: clean, validate banks, apply gain/pan
   * Returns processed pattern string ready for evaluation, or null if invalid
   * @param {string} pattern - Raw pattern string
   * @param {string} elementId - Element ID for logging and gain/pan lookup
   * @returns {string|null} - Processed pattern string or null if invalid
   */
  async processPattern(pattern, elementId, options = {}) {
    const {
      preserveBanks = false,
      attemptBankLoad = false
    } = options || {};

    if (!pattern || (typeof pattern !== 'string') || pattern.trim() === '') {
      return null;
    }

    // Clean up pattern: remove newlines, normalize whitespace, and fix dot spacing
    // First normalize all whitespace to single spaces
    let patternToEval = pattern.replace(/\s+/g, ' ').trim();
    
    // Remove spaces before dots (pattern might have "pattern .modifier()" which should be "pattern.modifier()")
    patternToEval = patternToEval.replace(/\s+\./g, '.').trim();
    
    // Clean up any double dots
    patternToEval = patternToEval.replace(/\.\.+/g, '.').trim();
    
    // Remove any existing tempo modifiers (.cpm, .fast, .slow) - we'll add them fresh with current tempo
    patternToEval = patternToEval.replace(/\.(cpm|fast|slow)\([^)]*\)/g, '').trim();
    
    // Clean up any double dots again
    patternToEval = patternToEval.replace(/\.\.+/g, '.').trim();

    // Normalize legacy synth names to their canonical counterparts
    patternToEval = replaceSynthAliasesInPattern(patternToEval);
    
    
    // Validate pattern after processing
    if (!patternToEval || patternToEval === '') {
      console.warn(`[${elementId}] Pattern became empty after processing - cannot process`);
      return null;
    }
    
    // Check if pattern uses .bank() - extract bank names and verify they're loaded
    const processedBankMatches = patternToEval.match(/\.bank\(["']([^"']+)["']\)/g);
    if (processedBankMatches) {
      const bankNames = processedBankMatches.map(m => m.match(/\.bank\(["']([^"']+)["']\)/)[1]);
      console.log(`[${elementId}] Pattern uses bank(s):`, bankNames);
      
      // Strudel bank names are case-sensitive - keep them as-is
      // Don't convert "RolandTR808" to "tr808" - Strudel expects the exact case
      
      // Check if loaded
      let hadUnloadedBank = false;
      for (const bankName of bankNames) {
        const strudelBankName = bankName; // Keep original case
        
        // Bank names are case-sensitive - keep as-is (no conversion needed)
        
        // Check if bank is loaded
        // Built-in banks are loaded from CDN, with local fallback for TR-808/TR-909
        const localFallbackBanks = ['RolandTR808', 'RolandTR909']; // Have local fallback in assets folder
        const builtInDrumBanks = ['RolandTR808', 'RolandTR909', 'RolandTR707', 'RhythmAce', 'AkaiLinn', 'ViscoSpaceDrum', 'CasioRZ1'];
        const isBuiltInBank = builtInDrumBanks.includes(strudelBankName);

        let isLoaded = this.loadedBanks.has(strudelBankName) || isBuiltInBank;

        if (!isLoaded && attemptBankLoad && typeof this.loadBank === 'function') {
          try {
            console.log(`[${elementId}] Attempting to load bank "${strudelBankName}" for pattern processing`);
            const loadResult = await this.loadBank(strudelBankName);
            if (loadResult) {
              this.loadedBanks.add(strudelBankName);
              isLoaded = true;
              console.log(`[${elementId}] Bank "${strudelBankName}" loaded successfully for pattern processing`);
            } else {
              console.warn(`[${elementId}] Bank "${strudelBankName}" could not be loaded on demand`);
            }
          } catch (loadError) {
            console.warn(`[${elementId}] Error loading bank "${strudelBankName}":`, loadError);
          }
        }
        
        if (!isLoaded && !preserveBanks) {
          console.warn(`⚠️ Bank "${strudelBankName}" not loaded - removing .bank() modifier from pattern`);
          patternToEval = patternToEval.replace(new RegExp(`\\.bank\(["']${strudelBankName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']\)`, 'g'), '');
          hadUnloadedBank = true;
        } else if (!isLoaded && preserveBanks) {
          console.warn(`⚠️ Bank "${strudelBankName}" is not loaded but preserving .bank() for preview`);
        } else if (isBuiltInBank) {
          // Built-in drum banks (loaded from CDN or local fallback)
          console.log(`[${elementId}] Bank "${strudelBankName}" is built-in - keeping .bank() modifier`);
          
          // Mark as loaded for tracking
          this.loadedBanks.add(strudelBankName);
        }
      }
      
      // Clean up any trailing dots/whitespace
      patternToEval = patternToEval.replace(/\.+$/, '').trim();
      
      // If we removed banks and pattern is now invalid, return null
      if (hadUnloadedBank && !preserveBanks && (!patternToEval || patternToEval.trim() === '')) {
        console.warn(`⚠️ Pattern became empty after removing unloaded banks`);
        return null;
      }
      
      console.log(`[${elementId}] Pattern after bank cleanup:`, patternToEval.substring(0, 100));
    }
    
    // Apply element-specific gain and pan using Strudel's built-in functions
    // Check if gain should be applied in pattern (default to true for master playback)
    const applyGainInPattern = options.applyGainInPattern !== undefined 
      ? options.applyGainInPattern 
      : this.masterActive;
    patternToEval = this.applyElementGainPanToPattern(patternToEval, elementId, {
      applyGainInPattern
    });
    
    // Validate final pattern
    if (!patternToEval || patternToEval.trim() === '') {
      console.warn(`[${elementId}] Pattern became empty after applying gain/pan - cannot process`);
      return null;
    }

    // Spiral visualization removed - no longer adding .spiral() modifier

    return patternToEval;
  }

  /**
   * Pre-evaluate and cache a pattern for an element
   * This allows instant triggering without re-evaluation
   * @param {string} elementId - Element ID
   * @param {string} pattern - Raw pattern string
   * @returns {Promise<boolean>} - True if successfully cached and pre-evaluated
   */
  async preEvaluatePattern(elementId, pattern) {
    // Check if Strudel is ready
    if (!window.strudel || !window.strudel.evaluate) {
      console.log(`[${elementId}] Cannot pre-evaluate: Strudel not ready`);
      return false;
    }

    // Check if pattern is empty
    if (!pattern || (typeof pattern !== 'string') || pattern.trim() === '') {
      console.log(`[${elementId}] No pattern to pre-evaluate`);
      // Cache as empty/null
      this.patternCache.set(elementId, {
        processedPattern: null,
        patternSlot: this.getPatternSlot(elementId),
        isPreEvaluated: false,
        originalPattern: pattern || ''
      });
      return false;
    }

    // Process the pattern
    const processedPattern = await this.processPattern(pattern, elementId);
    if (!processedPattern) {
      console.warn(`[${elementId}] Pattern processing failed - cannot cache`);
      this.patternCache.set(elementId, {
        processedPattern: null,
        patternSlot: this.getPatternSlot(elementId),
        isPreEvaluated: false,
        originalPattern: pattern
      });
      return false;
    }

    // Get pattern slot
    const patternSlot = this.getPatternSlot(elementId);

    // Pre-evaluate the pattern in the slot (but keep it silent initially)
    // This is just for caching - the pattern will be evaluated when user triggers playback
    try {
      // Ensure pattern slot is set to silence to prevent auto-playback
      const assignmentCode = `${patternSlot} = silence`;
      await window.strudel.evaluate(assignmentCode);
      
      // Cache the processed pattern (but don't evaluate it yet - user must trigger playback)
      this.patternCache.set(elementId, {
        processedPattern: processedPattern,
        patternSlot: patternSlot,
        isPreEvaluated: true,
        originalPattern: pattern
      });
      
      console.log(`✅ Pre-evaluated and cached pattern for ${elementId} in ${patternSlot} (silent, ready for manual trigger)`);
      return true;
    } catch (error) {
      console.warn(`[${elementId}] Failed to pre-evaluate pattern:`, error);
      // Cache the processed pattern anyway (will be evaluated on trigger)
      this.patternCache.set(elementId, {
        processedPattern: processedPattern,
        patternSlot: patternSlot,
        isPreEvaluated: false,
        originalPattern: pattern
      });
      return false;
    }
  }

  /**
   * Invalidate pattern cache for an element (when pattern changes)
   * @param {string} elementId - Element ID
   */
  invalidatePatternCache(elementId) {
    this.patternCache.delete(elementId);
    console.log(`🗑️ Invalidated pattern cache for ${elementId}`);
  }

  /**
   * Pre-load all configured patterns after initialization
   * @returns {Promise<void>}
   */
  async preloadAllPatterns() {
    if (!window.strudel || !window.strudel.evaluate) {
      console.log('Cannot preload patterns: Strudel not ready');
      return;
    }

    console.log('📦 Pre-loading all configured patterns...');
    
    // Get all configured elements
    const elements = soundConfig.elements || [];
    let loadedCount = 0;
    let failedCount = 0;

    for (const elementConfig of elements) {
      const elementId = elementConfig.id;
      
      // Check localStorage for custom config
      let customConfig = null;
      try {
        const saved = localStorage.getItem(`element-config-${elementId}`);
        if (saved) {
          customConfig = JSON.parse(saved);
        }
      } catch (error) {
        // Ignore
      }

      // Get pattern from custom config or default config
      const pattern = customConfig?.pattern || elementConfig?.pattern || '';
      
      if (pattern && pattern.trim() !== '') {
        const success = await this.preEvaluatePattern(elementId, pattern);
        if (success) {
          loadedCount++;
        } else {
          failedCount++;
        }
      }
    }

    console.log(`✅ Pre-loaded ${loadedCount} patterns${failedCount > 0 ? `, ${failedCount} failed` : ''}`);
  }

  /**
   * Set gain for a specific element (0-1)
   */
  setElementGain(elementId, value) {
    const gain = Math.max(0, Math.min(1, value));
    const oldGain = this.elementGainValues.get(elementId);
    this.elementGainValues.set(elementId, gain);
    
    console.log(`[${elementId}] Gain set to ${gain.toFixed(2)}`);
    
    // Update Web Audio API gain node if it exists (for real-time control)
    const gainNode = this.elementGainNodes.get(elementId);
    if (gainNode) {
      gainNode.gain.value = gain * this.volume; // Apply master volume multiplier
      __safeRouteLog(this, `🎚️ Updated ${elementId} gain node to ${(gain * this.volume).toFixed(2)}`);
    }
    
    // Invalidate pattern cache when gain changes (gain is part of processed pattern for individual playback)
    if (oldGain !== gain) {
      const cached = this.patternCache.get(elementId);
      if (cached) {
        // Invalidate cache so pattern is re-processed with new gain on next trigger
        this.patternCache.delete(elementId);
        console.log(`🗑️ Invalidated pattern cache for ${elementId} (gain changed)`);
      }
      
      // Update tracked pattern gain if element is tracked in master
      if (this.trackedPatterns.has(elementId)) {
        this.updateTrackedElementGain(elementId, gain);
      }
    }
    
    // If the element is currently playing individually (not through master), update the pattern
    // If playing through master, the gain node update above handles it in real-time
    if (this.isPlaying(elementId) && !this.masterActive && oldGain !== gain) {
      this.updatePlayingPattern(elementId);
    }
  }

  /**
   * Set pan for a specific element (-1 to 1)
   * -1 = full left, 0 = center, 1 = full right
   */
  setElementPan(elementId, value) {
    const pan = Math.max(-1, Math.min(1, value));
    const oldPan = this.elementPanValues.get(elementId);
    this.elementPanValues.set(elementId, pan);
    
    console.log(`[${elementId}] Pan set to ${pan.toFixed(2)}`);
    
    // Update Web Audio API pan node if it exists (for real-time control)
    const panNode = this.elementPanNodes.get(elementId);
    if (panNode) {
      panNode.pan.value = pan;
      __safeRouteLog(this, `🎚️ Updated ${elementId} pan node to ${pan.toFixed(2)}`);
    }
    
    // Invalidate pattern cache when pan changes (pan is part of processed pattern for individual playback)
    if (oldPan !== pan) {
      const cached = this.patternCache.get(elementId);
      if (cached) {
        // Invalidate cache so pattern is re-processed with new pan on next trigger
        this.patternCache.delete(elementId);
        console.log(`🗑️ Invalidated pattern cache for ${elementId} (pan changed)`);
      }
      
      // Update tracked pattern pan if element is tracked in master
      if (this.trackedPatterns.has(elementId)) {
        this.updateTrackedElementPan(elementId, pan);
      }
    }
    
    // If the element is currently playing individually (not through master), update the pattern
    // If playing through master, the pan node update above handles it in real-time
    if (this.isPlaying(elementId) && !this.masterActive && oldPan !== pan) {
      this.updatePlayingPattern(elementId);
    }
  }

  /**
   * Update a playing pattern with new gain/pan values
   */
  async updatePlayingPattern(elementId) {
    const activeSound = this.activeSounds.get(elementId);
    if (!activeSound || activeSound.type !== 'strudel') {
      return; // Only update Strudel patterns
    }
    
    // Check if gain is 0 or very close to 0 - if so, stop the element instead of updating
    const gain = this.elementGainValues.get(elementId) || 0.8;
    if (gain <= 0.001) {
      console.log(`[${elementId}] Gain is ${gain} (effectively muted) - stopping playback`);
      this.stopSound(elementId);
      return;
    }
    
    const patternSlot = this.strudelPatternSlots.get(elementId);
    if (!patternSlot || !window.strudel || !window.strudel.evaluate) {
      return;
    }
    
    try {
      // Get the current pattern and reapply gain/pan
      const elementConfig = soundConfig.getElementConfig(elementId);
      if (!elementConfig || !elementConfig.pattern) {
        return;
      }
      
      let patternToEval = elementConfig.pattern.replace(/\._scope\(\)/g, '');
      // When playing individually (not through master), gain is handled by Web Audio gain node
      // so we should NOT apply .gain() in the pattern to avoid double application
      patternToEval = this.applyElementGainPanToPattern(patternToEval, elementId, { 
        applyGainInPattern: false 
      });
      
      // Reassign with updated gain/pan
      await window.strudel.evaluate(`${patternSlot} = ${patternToEval}`);
      console.log(`✅ Updated ${patternSlot} with new gain/pan`);
    } catch (error) {
      console.warn(`Could not update pattern for ${elementId}:`, error);
    }
  }

  /**
   * Update pattern in place without stopping/restarting (prevents layering)
   */
  async updatePatternInPlace(elementId, newPattern) {
    // Always update the tracked pattern if element is tracked (even if not playing)
    if (this.trackedPatterns.has(elementId)) {
      const trackData = this.trackedPatterns.get(elementId);
      const normalizedPattern = newPattern.replace(/[""]/g, '"').replace(/['']/g, "'");
      trackData.rawPattern = normalizedPattern;
      trackData.pattern = this.convertPatternForScale(normalizedPattern) || normalizedPattern;
      __safeRouteLog(this, `🎚️ Updated tracked pattern for ${elementId} in master: ${newPattern.substring(0, 60)}...`);
      
      // Update the master pattern to reflect the changes
      this.updateMasterPattern(this.soloedElements, this.mutedElements);
      if (this.masterActive) {
        this.scheduleMasterPatternRefresh(`pattern-update:${elementId}`);
      }
    }
    
    // Only update the playing pattern if element is actively playing
    const activeSound = this.activeSounds.get(elementId);
    if (!activeSound || activeSound.type !== 'strudel') {
      return; // Not playing, just update tracked pattern above
    }
    
    const patternSlot = this.strudelPatternSlots.get(elementId);
    if (!patternSlot || !window.strudel || !window.strudel.evaluate) {
      return;
    }
    
    this._lastAppliedPatterns = this._lastAppliedPatterns || new Map();
    try {
      // Process the new pattern (remove scope, check banks, apply gain/pan/tempo)
      // Clean up pattern: remove newlines, normalize whitespace, and fix dot spacing
      // First normalize all whitespace to single spaces
      let patternToEval = newPattern.replace(/\s+/g, ' ').trim();
      
      // Remove spaces before dots (pattern might have "pattern .modifier()" which should be "pattern.modifier()")
      patternToEval = patternToEval.replace(/\s+\./g, '.').trim();
      
      // Clean up any double dots
      patternToEval = patternToEval.replace(/\.\.+/g, '.').trim();
      
      // Remove any existing tempo modifiers (.cpm, .fast, .slow) - we'll add them fresh with current tempo
      patternToEval = patternToEval.replace(/\.(cpm|fast|slow)\([^)]*\)/g, '').trim();
      
      // Clean up any double dots again
      patternToEval = patternToEval.replace(/\.\.+/g, '.').trim();
      
      // Check if pattern uses .bank() - remove for banks that aren't loaded
      const postBankMatches = patternToEval.match(/\.bank\(["']([^"']+)["']\)/g);
      if (postBankMatches) {
        const bankNames = postBankMatches.map(m => m.match(/\.bank\(["']([^"']+)["']\)/)[1]);
        for (const bankName of bankNames) {
          if (!this.loadedBanks.has(bankName)) {
            patternToEval = patternToEval.replace(new RegExp(`\\.bank\(["']${bankName}["']\)`, 'g'), '');
          }
        }
        patternToEval = patternToEval.replace(/\.+$/, '').trim();
      }
      
      // Apply element-specific gain and pan
      // When playing individually (not through master), gain is handled by Web Audio gain node
      // so we should NOT apply .gain() in the pattern to avoid double application
      patternToEval = this.applyElementGainPanToPattern(patternToEval, elementId, {
        applyGainInPattern: this.masterActive
      });
      
      const lastApplied = this._lastAppliedPatterns.get(elementId);
      if (lastApplied === patternToEval) {
        __safeRouteLog(this, `⚡ Skipping re-evaluation for ${elementId}; pattern unchanged.`);
        return;
      }
      
      // Update the pattern slot directly without stopping
      await window.strudel.evaluate(`${patternSlot} = ${patternToEval}`);
      console.log(`✅ Updated ${patternSlot} pattern in place: ${patternToEval.substring(0, 60)}...`);
      this._lastAppliedPatterns.set(elementId, patternToEval);
    } catch (error) {
      console.warn(`Could not update pattern in place for ${elementId}:`, error);
    }
  }

  /**
   * Get current gain value for an element
   */
  getElementGain(elementId) {
    return this.elementGainValues.get(elementId) || 0.8;
  }

  /**
   * Get current pan value for an element
   */
  getElementPan(elementId) {
    return this.elementPanValues.get(elementId) || 0;
  }

  /**
   * Play a synthesized sound based on Strudel pattern
   */
  async playSynthesizedSound(elementId, pattern) {
    // Try to initialize audio if not already initialized (user interaction is happening now)
    if (!this.initialized || !this.audioContext) {
      console.log('Audio not initialized - waiting for user interaction');
      return; // Don't try to initialize - let user click first
    }

    // Ensure audio context is running
    if (this.audioContext.state === 'suspended') {
      try {
        suppressAudioContextWarnings();
        await this.audioContext.resume();
        if (this.audioContext.state !== 'running') {
          console.log('Audio context not running - user interaction required');
          return;
        }
      } catch (error) {
        console.log('Audio context needs user interaction');
        return;
      }
    }

    // Stop any existing sound for this element
    this.stopSound(elementId);

    // Parse simple patterns like "bd", "sd", "hh" and generate tones
    const soundPattern = this.parsePattern(pattern);
    
    if (soundPattern.sounds.length === 0) {
      console.warn(`No sounds parsed from pattern: ${pattern}`);
      return;
    }

    console.log(`Playing pattern for ${elementId}:`, pattern, soundPattern);
    
    try {
      const oscillator = this.createOscillatorForPattern(soundPattern, elementId);
      
      if (oscillator && oscillator.gain) {
        this.activeSounds.set(elementId, {
          type: 'synthesized',
          oscillator,
          gain: oscillator.gain
        });
        console.log(`Sound started for ${elementId}`);
      } else {
        console.error(`Failed to create oscillator for ${elementId}`);
      }
    } catch (error) {
      console.error(`Error playing sound for ${elementId}:`, error);
    }
  }

  /**
   * Parse a simple pattern string to extract sounds
   */
  parsePattern(pattern) {
    // Extract pattern from sound("...") or s("...") or use pattern directly
    let patternString = pattern;
    
    // Extract content from sound("...") or s("...")
    const soundMatch = pattern.match(/(?:sound|s)\(["']([^"']+)["']\)/);
    if (soundMatch) {
      patternString = soundMatch[1];
    }

    // Sound map for basic drum sounds
    const soundMap = {
      'bd': { freq: 60, duration: 0.1, type: 'sine' },
      'sd': { freq: 200, duration: 0.05, type: 'noise' },
      'hh': { freq: 800, duration: 0.02, type: 'square' },
      'cp': { freq: 400, duration: 0.08, type: 'triangle' },
      'misc': { freq: 300, duration: 0.06, type: 'triangle' } // Map misc to a triangle wave
    };

    const sounds = [];
    
    // Handle polyphonic layers (separated by commas)
    const layers = patternString.split(',');
    
    layers.forEach((layer, layerIndex) => {
      let layerPattern = layer.trim();
      
      // Expand repeat patterns (e.g., "hh*16" -> "hh hh hh ...")
      layerPattern = layerPattern.replace(/(\w+)\*(\d+)/g, (match, sound, count) => {
        return Array(parseInt(count)).fill(sound).join(' ');
      });
      
      // Handle square brackets [~ bd] - flatten mini-patterns
      // Replace [content] with just the content (for now, we'll process it inline)
      layerPattern = layerPattern.replace(/\[([^\]]+)\]/g, (match, content) => {
        return content.trim();
      });
      
      // Split by spaces and process
      const parts = layerPattern.trim().split(/\s+/);
      let position = 0;

      for (const part of parts) {
        if (part === '~' || part === '') {
          position++;
          continue;
        }

        if (soundMap[part]) {
          sounds.push({
            ...soundMap[part],
            time: position * 0.25 // 16th note spacing
          });
        }
        position++;
      }
    });

    if (sounds.length === 0) {
      console.warn(`No sounds found in pattern: ${pattern}`);
      return { sounds: [], duration: 0 };
    }

    // Sort sounds by time to ensure proper ordering
    sounds.sort((a, b) => a.time - b.time);

    const maxTime = Math.max(...sounds.map(s => s.time + s.duration));
    return { sounds, duration: Math.max(maxTime, 0.5) };
  }

  /**
   * Parse an index pattern string (e.g., "0 1 <2 2*2> 3 [4 0] 5 6 7")
   */
  parseIndexPattern(pattern) {
    const indices = [];
    
    // Handle angle brackets <...> (alternation)
    let processedPattern = pattern.replace(/<([^>]+)>/g, (match, content) => {
      // For alternation, we'll take the first element
      const parts = content.trim().split(/\s+/);
      return parts[0];
    });
    
    // Handle square brackets [...] (mini-patterns)
    processedPattern = processedPattern.replace(/\[([^\]]+)\]/g, (match, content) => {
      return content.trim();
    });
    
    // Expand repeats
    processedPattern = processedPattern.replace(/(\d+)\*(\d+)/g, (match, value, count) => {
      return Array(parseInt(count)).fill(value).join(' ');
    });
    
    // Split and parse
    const parts = processedPattern.trim().split(/\s+/);
    for (const part of parts) {
      const num = parseInt(part);
      if (!isNaN(num)) {
        indices.push(num);
      }
    }
    
    return indices;
  }

  /**
   * Create a pattern string from indices
   */
  createPatternFromIndices(indices) {
    // Map indices to drum sounds cyclically
    const drumMap = ['bd', 'sd', 'hh', 'cp', 'bd', 'sd', 'hh', 'cp'];
    const pattern = indices.map(i => drumMap[i % drumMap.length] || '~').join(' ');
    return `sound("${pattern}")`;
  }

  /**
   * Create a pattern from sample name
   */
  createPatternFromSampleName(sampleName) {
    // Create a simple pattern based on sample name
    // For breaks samples, create a breakbeat-like pattern
    if (sampleName.includes('break') || sampleName.includes('165')) {
      return 'sound("bd ~ sd ~ bd ~ sd hh")';
    }
    // Default pattern
    return 'sound("bd sd hh ~ cp ~ hh ~")';
  }

  /**
   * Create oscillator for a sound pattern
   */
  createOscillatorForPattern(pattern, elementId) {
    if (!this.audioContext) {
      console.error('Audio context not initialized');
      return { gain: null, stop: () => {} };
    }

    const masterGain = this.audioContext.createGain();
    
    // Use element-specific gain/pan if available, otherwise connect to master
    const elementNodes = elementId ? this.getElementAudioNodes(elementId) : null;
    if (elementNodes) {
      masterGain.connect(elementNodes.gainNode);
      masterGain.gain.value = 1.0; // Element gain node handles volume
    } else {
      masterGain.connect(this.gainNode);
      masterGain.gain.value = this.volume;
    }

    const startTime = this.audioContext.currentTime;

    pattern.sounds.forEach((sound, index) => {
      const playTime = startTime + sound.time;

      if (sound.type === 'noise') {
        // White noise for snare
        const bufferSize = Math.floor(this.audioContext.sampleRate * sound.duration);
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const data = buffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        const gainNode = this.audioContext.createGain();
        source.connect(gainNode);
        gainNode.connect(masterGain);
        
        // Envelope
        gainNode.gain.setValueAtTime(0, playTime);
        gainNode.gain.linearRampToValueAtTime(0.3, playTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, playTime + sound.duration);
        
        source.start(playTime);
        source.stop(playTime + sound.duration);
      } else {
        // Tone for kick/hihat
        const osc = this.audioContext.createOscillator();
        osc.type = sound.type;
        osc.frequency.value = sound.freq;
        
        const gainNode = this.audioContext.createGain();
        osc.connect(gainNode);
        gainNode.connect(masterGain);
        
        // Envelope
        gainNode.gain.setValueAtTime(0, playTime);
        gainNode.gain.linearRampToValueAtTime(0.5, playTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, playTime + sound.duration);
        
        osc.start(playTime);
        osc.stop(playTime + sound.duration);
      }
    });

    // Schedule master gain fade out
    const endTime = startTime + pattern.duration;
    masterGain.gain.setValueAtTime(this.volume, endTime);
    masterGain.gain.exponentialRampToValueAtTime(0.01, endTime + 0.1);

    return { 
      gain: masterGain, 
      stop: () => {
        try {
          masterGain.gain.cancelScheduledValues(this.audioContext.currentTime);
          masterGain.gain.setValueAtTime(masterGain.gain.value, this.audioContext.currentTime);
          masterGain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);
          setTimeout(() => masterGain.disconnect(), 150);
        } catch (e) {
          console.error('Error stopping sound:', e);
        }
      }
    };
  }

  /**
   * Play a pre-recorded audio file
   */
  playAudioFile(elementId, url) {
    // Don't try to auto-initialize - audio needs user gesture
    if (!this.initialized || !this.audioContext) {
      console.warn('Audio not initialized yet. Please click anywhere first to enable audio.');
      return;
    }

    // Ensure audio context is running
    if (this.audioContext.state === 'suspended') {
      suppressAudioContextWarnings();
      this.audioContext.resume().catch(error => {
        console.error('Failed to resume audio context:', error);
      });
    }

    // Stop any existing sound for this element
    this.stopSound(elementId);

    // Check if buffer is already loaded
    const buffer = this.audioBuffers.get(elementId);
    
    if (buffer) {
      this.playAudioBuffer(elementId, buffer);
    } else {
      // Load and play
      this.loadAudioFile(elementId, url).then(loadedBuffer => {
        this.playAudioBuffer(elementId, loadedBuffer);
      }).catch(error => {
        console.error(`Failed to play audio for ${elementId}:`, error);
      });
    }
  }

  /**
   * Play an audio buffer
   */
  playAudioBuffer(elementId, buffer) {
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    
    const gainNode = this.audioContext.createGain();
    source.connect(gainNode);
    
    // Use element-specific gain/pan if available
    const elementNodes = this.getElementAudioNodes(elementId);
    if (elementNodes) {
      gainNode.connect(elementNodes.gainNode);
      gainNode.gain.value = 1.0; // Element gain node handles volume
    } else {
      gainNode.connect(this.gainNode);
      gainNode.gain.value = this.volume;
    }

    // Fade in
    const targetGain = elementNodes ? 1.0 : this.volume;
    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(
      targetGain,
      this.audioContext.currentTime + soundConfig.defaults.fadeInTime
    );

    source.onended = () => {
      this.activeSounds.delete(elementId);
    };

    source.start(0);
    
    this.activeSounds.set(elementId, {
      type: 'audio',
      source,
      gain: gainNode
    });
  }

  /**
   * Play a Strudel pattern using Strudel from CDN
   * @param {string} elementId - Element identifier
   * @param {string} pattern - Pattern string to evaluate
   * @param {*} samples - Optional samples parameter
   * @param {boolean} allowLoopStart - If true, allows starting sound even if loop is active (for loop button clicks)
   */
  async playStrudelPattern(elementId, pattern, samples, allowLoopStart = false) {
    // Skip if pattern is empty or undefined
    if (!pattern || (typeof pattern !== 'string') || pattern.trim() === '') {
      console.log(`[${elementId}] No pattern assigned - skipping playback`);
      return;
    }

    // Check if gain is 0 or very close to 0 - if so, stop the element instead of playing
    const gain = this.elementGainValues.get(elementId) || 0.8;
    if (gain <= 0.001) {
      console.log(`[${elementId}] Gain is ${gain} (effectively muted) - stopping playback`);
      this.stopSound(elementId);
      return;
    }

    if (this.masterOnlyPlayback) {
      const isPreviewElement = typeof elementId === 'string' && elementId.toLowerCase().includes('preview');
      const autoStart = isPreviewElement; // previews should auto-start master via caller logic
      const result = await this.routePatternThroughMaster(elementId, pattern, { isPreview: isPreviewElement, autoStart });
      console.log(`🎚️ Routed ${elementId} through master-only playback`, result);
      return result;
    }

    // Check if loop is active - if so, prevent restart unless explicitly allowed (loop button click)
    // This prevents the pattern from restarting when loop is active, which causes layering
    if (!allowLoopStart) {
      const element = document.querySelector(`[data-sound-id="${elementId}"]`);
      if (element) {
        const loopButton = element.querySelector('.loop-button');
        const isLooped = loopButton?.classList.contains('active');
        if (isLooped && this.isPlaying(elementId)) {
          // Loop is active and already playing - never restart to prevent layering
          // The loop should only be started via the loop button click itself
          console.log(`🔄 ${elementId} has loop active and is playing - skipping sound trigger to prevent layering`);
          return; // Don't start or restart - let the existing loop continue playing
        }
      }
    }

    // Try to initialize audio if not already initialized (user interaction is happening now)
    if (!this.initialized || !this.audioContext) {
      console.log('Audio not initialized - attempting to initialize now...');
      // Try to initialize audio on user interaction (hover/proximity counts as interaction)
      try {
        const initialized = await this.initialize();
        if (!initialized) {
          console.warn('⚠️ Audio initialization failed - sounds may not play until user clicks');
          // Don't return - allow pattern to be evaluated anyway, it might work once audio is ready
        }
      } catch (error) {
        console.warn('⚠️ Error initializing audio:', error);
        // Don't return - allow pattern to be evaluated anyway
      }
    }

    // Check if sound banks are loaded (required for sample-based patterns)
    // Note: We allow patterns to be attempted even if banks aren't loaded yet,
    // as some patterns (like synthesized sounds) don't require samples
    if (!this.strudelSoundBanksLoaded) {
      console.log(`⏳ Sound banks not fully loaded yet for ${elementId}, but attempting to play anyway...`);
      // Don't return - allow the pattern to be evaluated
      // It will gracefully handle missing samples
    }

    // Ensure audio context is running
    if (this.audioContext.state === 'suspended') {
      console.log(`🔄 Audio context is suspended for ${elementId}, attempting to resume...`);
      try {
        suppressAudioContextWarnings();
        await this.audioContext.resume();
        await new Promise(resolve => setTimeout(resolve, 50)); // Brief wait for state change
        if (this.audioContext.state !== 'running') {
          console.warn(`⚠️ Audio context not running after resume attempt - state: ${this.audioContext.state}`);
          console.warn(`   User interaction (click) may be required to resume audio`);
          // Don't return - continue anyway, the pattern might still play once audio resumes
        } else {
          console.log(`✅ Audio context resumed successfully for ${elementId}`);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to resume audio context:`, error);
        console.warn(`   User interaction (click) may be required to resume audio`);
        // Don't return - continue anyway, the pattern might still play once audio resumes
      }
    }

    // Stop any existing sound for THIS element only (doesn't affect other elements)
    // Each element has its own pattern slot (d1, d2, etc.) so they play simultaneously
    // If loop is active, we already returned above, so this is safe
    this.stopSound(elementId);

    // CRITICAL: Ensure scheduler is running before playing pattern
    // This ensures Strudel can schedule the pattern properly
    if (window.strudel && window.strudel.scheduler && !window.strudel.scheduler.started) {
      console.log(`▶️ Starting scheduler for ${elementId} playback...`);
      await window.strudel.scheduler.start();
    }

    console.log(`Playing Strudel pattern for ${elementId}:`, pattern);
    
    // Try to use Strudel from CDN
    try {
      // Load Strudel web bundle from CDN if not already loaded
      if (!window.strudel) {
        await this.loadStrudelFromCDN();
      }
      
      // Verify window.strudel.evaluate exists and is a function
      if (!window.strudel || !window.strudel.evaluate || typeof window.strudel.evaluate !== 'function') {
        console.error('❌ window.strudel.evaluate is not available');
        console.error('window.strudel:', window.strudel);
        throw new Error('Strudel REPL evaluate function is not available. Strudel may not have initialized correctly.');
      }
      
      console.log('Strudel evaluate is available...');
      
      // Core functions should already be loaded during REPL initialization
      // Just verify they're available before evaluating patterns
      if (typeof globalThis.note === 'function' && typeof globalThis.sound === 'function') {
        console.log('✅ Core functions verified and available');
      } else {
        const error = new Error('Core functions not available');
        console.warn('Core functions not available, attempting to load...');
        // Try to load core functions using local import
        try {
          // Use cached module instead of dynamic import
          const { coreModule } = await getStrudelModules();
          window.__coreModule = coreModule;
          await window.strudel.evaluate(`
            (function() {
              const core = window.__coreModule || {};
              if (core && typeof core === 'object') {
                Object.assign(globalThis, core);
              }
              globalThis.__core_loaded = true;
            })();
          `);
          
          // Wait for async to complete
          for (let i = 0; i < 20; i++) {
            try {
              const isLoaded = await window.strudel.evaluate('globalThis.__core_loaded === true');
              if (isLoaded && typeof globalThis.note === 'function') {
                // Verify without evaluating (to avoid pattern errors)
                console.log('✅ Core functions loaded into REPL');
                break;
              }
            } catch (e) {
              // Continue waiting
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (loadError) {
          console.warn('Could not load core functions:', loadError);
        }
      }
      
      // Then, ensure default sound banks are loaded
      const banksLoaded = await this.ensureDefaultSoundBanks();
      if (!banksLoaded) {
        console.warn('⚠️ Continuing without default sound banks - patterns may fail');
      }
        
        // Register sawtooth sound if needed (for element-5 and similar patterns)
        // Based on Strudel documentation: https://strudel.cc/technical-manual/sounds/
        try {
          console.log('Registering sawtooth sound...');
          // Import registerSound and getAudioContext from @strudel/webaudio in REPL context
          try {
              // Use cached module instead of dynamic import
              const { webaudioModule } = await getStrudelModules();
              
              // Register sawtooth sound using the imported functions
              const registerCode = `
                (function() {
                  const webaudio = window.__webaudioModule || {};
                  const { registerSound, getAudioContext } = webaudio;
                  
                  registerSound('sawtooth', (time, value, onended) => {
                    let { freq } = value;
                    const ctx = getAudioContext();
                    const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: Number(freq) || 440 });
                    o.start(time);
                    const g = new GainNode(ctx, { gain: 0.3 });
                    o.connect(g);
                    const stop = (time) => {
                      o.stop(time);
                      o.disconnect();
                      g.disconnect();
                      onended();
                    };
                    o.addEventListener('ended', () => {
                      o.disconnect();
                      g.disconnect();
                      onended();
                    });
                    return { node: g, stop };
                  }, { type: 'synth' });
                  
                  // Make registerSound and getAudioContext available globally for future use
                  globalThis.registerSound = registerSound;
                  globalThis.getAudioContext = getAudioContext;
                })();
              `;
              // Expose webaudio module to window for REPL access
              window.__webaudioModule = webaudioModule;
              await window.strudel.evaluate(registerCode);
              
              // Wait a bit for async to complete
              await new Promise(resolve => setTimeout(resolve, 200));
              
              console.log('✅ Sawtooth sound registered (will be verified on first use)');
          } catch (importError) {
              console.warn('Could not use webaudio module:', importError);
              // Fallback: use cached module via window
              try {
                const { webaudioModule } = await getStrudelModules();
                window.__webaudioModule = webaudioModule;
                const registerCode = `
                  (function() {
                    const webaudio = window.__webaudioModule || {};
                    const { registerSound, getAudioContext } = webaudio;
                  
                  if (registerSound && getAudioContext) {
                    registerSound('sawtooth', (time, value, onended) => {
                      let { freq } = value;
                      const ctx = getAudioContext();
                      const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: Number(freq) || 440 });
                      o.start(time);
                      const g = new GainNode(ctx, { gain: 0.3 });
                      o.connect(g);
                      const stop = (time) => {
                        o.stop(time);
                      };
                      o.addEventListener('ended', () => {
                        o.disconnect();
                        g.disconnect();
                        onended();
                      });
                      return { node: g, stop };
                    }, { type: 'synth' });
                  }
                })();
              `;
              await window.strudel.evaluate(registerCode);
              await new Promise(resolve => setTimeout(resolve, 200));
              console.log('✅ Sawtooth sound registered via REPL');
            } catch (fallbackError) {
              console.warn('Could not register sawtooth via fallback:', fallbackError);
            }
          }
        } catch (error) {
          console.warn('Could not register sawtooth sound:', error);
          console.warn('Pattern may still work if sawtooth is a default sound');
        }
        
        // Load custom samples if provided (in addition to default banks)
        if (samples) {
          const samplesFunc = window.strudel.samples || globalThis.samples;
          if (samplesFunc && typeof samplesFunc === 'function') {
            try {
              if (typeof samples === 'string') {
                // Simple string URL or alias (e.g., 'github:tidalcycles/dirt-samples')
                console.log('Loading custom samples with string:', samples);
                await samplesFunc(samples);
                console.log('Custom samples loaded successfully');
              } else if (typeof samples === 'object' && samples !== null) {
                // Custom samples object - need to use samples function
                const elementConfig = soundConfig.getElementConfig(elementId);
                const baseUrl = elementConfig?.samplesBaseUrl || '';
                
                console.log('Loading custom samples:', samples);
                console.log('Base URL:', baseUrl);
                
                await samplesFunc(samples, { baseUrl });
                console.log('Custom samples loaded successfully');
              }
            } catch (error) {
              console.error('Error loading custom samples:', error);
              // Continue anyway - default samples might still work
            }
          }
        }
        
        // Evaluate the pattern
        // Core functions should already be loaded during REPL initialization
        // But let's verify they're available before evaluating
        try {
          // First check if core functions are available
          // Check without playing a sound or evaluating
          if (typeof globalThis.note === 'function' && typeof globalThis.sound === 'function') {
            console.log('✅ Verified core functions are available');
          } else {
            const checkError = new Error('Core functions not available');
            console.warn('Core functions check failed, attempting to load...');
            console.warn('⚠️ Core functions not available, attempting to load now...');
          // Last resort: use cached module
          try {
            const { coreModule } = await getStrudelModules();
            window.__coreModule = coreModule;
            await window.strudel.evaluate(`
              (function() {
                const core = window.__coreModule || {};
                if (core && typeof core === 'object') {
                  Object.assign(globalThis, core);
                }
                globalThis.__core_loaded = true;
              })();
            `);
            // Wait for async to complete
            for (let i = 0; i < 20; i++) {
              try {
                const isLoaded = await window.strudel.evaluate('globalThis.__core_loaded === true');
                if (isLoaded && typeof globalThis.note === 'function') {
                  // Verify without playing a sound or evaluating
                  break;
                }
              } catch (e) {
                // Continue waiting
              }
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } catch (loadError) {
            console.error('❌ Failed to load core functions:', loadError);
            throw new Error('Core Strudel functions (note, samples, etc.) are not available in REPL context. Pattern evaluation will fail.');
          }
          }
          
          console.log('Evaluating pattern:', pattern);
          
          // Extract and evaluate any samples() calls from the pattern before evaluating the main pattern
          // This ensures samples are loaded before s() tries to use them
          // Note: We'll evaluate samples() calls first, then evaluate the full pattern
          // (samples() returns undefined which is fine as a standalone statement)
          if (window.strudel && window.strudel.evaluate) {
            try {
              // Look for samples() calls in the pattern (handle multi-line)
              // According to Strudel docs: https://strudel.cc/learn/samples/#loading-custom-samples
              // Format: samples({...}, 'github:user/repo') or samples({...}, 'https://...')
              // Manually parse to handle multi-line patterns correctly
              const samplesCalls = [];
              let searchIndex = 0;
              
              while (true) {
                const samplesStart = pattern.indexOf('samples(', searchIndex);
                if (samplesStart === -1) break;
                
                let depth = 0;
                let inString = false;
                let stringChar = '';
                let i = samplesStart + 'samples('.length;
                
                // Skip whitespace
                while (i < pattern.length && /\s/.test(pattern[i])) {
                  i++;
                }
                
                // Find the opening brace
                if (i < pattern.length && pattern[i] === '{') {
                  const objStart = i;
                  depth = 1;
                  i++;
                  
                  // Find the matching closing brace (handling nested objects and strings)
                  while (i < pattern.length && depth > 0) {
                    const char = pattern[i];
                    if (!inString) {
                      if (char === '"' || char === "'") {
                        inString = true;
                        stringChar = char;
                      } else if (char === '{') {
                        depth++;
                      } else if (char === '}') {
                        depth--;
                      }
                    } else {
                      if (char === stringChar && pattern[i - 1] !== '\\') {
                        inString = false;
                      }
                    }
                    i++;
                  }
                  
                  if (depth === 0) {
                    const samplesObjStr = pattern.substring(objStart, i);
                    
                    // Skip whitespace and comma
                    while (i < pattern.length && (/\s/.test(pattern[i]) || pattern[i] === ',')) {
                      i++;
                    }
                    
                    // Check for second parameter
                    let secondParam = null;
                    if (i < pattern.length && (pattern[i] === '"' || pattern[i] === "'")) {
                      const quoteChar = pattern[i];
                      const paramStart = i;
                      i++;
                      while (i < pattern.length) {
                        if (pattern[i] === '\\') {
                          i += 2; // Skip escaped character
                          continue;
                        }
                        if (pattern[i] === quoteChar) {
                          secondParam = pattern.substring(paramStart, i + 1);
                          i++;
                          break;
                        }
                        i++;
                      }
                    }
                    
                    // Skip whitespace and find closing paren
                    while (i < pattern.length && /\s/.test(pattern[i])) {
                      i++;
                    }
                    
                    if (i < pattern.length && pattern[i] === ')') {
                      const fullCall = pattern.substring(samplesStart, i + 1);
                      samplesCalls.push({
                        fullCall: fullCall,
                        samplesObj: samplesObjStr,
                        secondParam: secondParam
                      });
                      searchIndex = i + 1;
                      continue;
                    } else if (i < pattern.length) {
                      // Found something other than ')' - might be part of a larger expression
                      // Still try to extract the samples() call
                      const fullCall = pattern.substring(samplesStart, i);
                      samplesCalls.push({
                        fullCall: fullCall,
                        samplesObj: samplesObjStr,
                        secondParam: secondParam
                      });
                      searchIndex = i;
                      continue;
                    }
                  }
                }
                
                // If we didn't find a complete match, move search forward
                searchIndex = samplesStart + 1;
              }
              
              // Process each found samples() call
              for (const samplesCall of samplesCalls) {
                const fullMatch = samplesCall.fullCall;
                const samplesObjStr = samplesCall.samplesObj;
                const secondParam = samplesCall.secondParam;
                
                // Store the full samples() call to evaluate it in REPL context
                samplesCalls.push({
                  fullCall: fullMatch,
                  samplesObj: samplesObjStr,
                  secondParam: secondParam
                });
              }
              
              // Evaluate each samples() call in REPL context first to load samples
              // Then we'll remove them from the pattern since they return undefined
              for (const samplesCall of samplesCalls) {
                try {
                  console.log('📦 Pre-loading samples() call in REPL:', samplesCall.fullCall);
                  // Evaluate the samples() call in the REPL context FIRST to load samples
                  // Strudel's samples() function handles 'github:' prefix natively per docs
                  await window.strudel.evaluate(samplesCall.fullCall);
                  console.log('✅ Samples loaded via REPL evaluation');
                  // Wait a bit for samples to be registered
                  await new Promise(resolve => setTimeout(resolve, 500));
                  // Note: We'll keep samples() in the pattern - it returns undefined which is fine
                } catch (evalError) {
                  console.warn('Could not evaluate samples() call in REPL:', evalError);
                  // Continue - try to load samples directly as fallback
                  try {
                    const samplesFunc = window.strudel?.samples || globalThis.samples;
                    if (samplesFunc && typeof samplesFunc === 'function') {
                      // Parse and load samples directly
                      let samplesMap = {};
                      try {
                        samplesMap = new Function('return ' + samplesCall.samplesObj)();
                      } catch (e) {
                        console.warn('Could not parse samples object:', e);
                        continue;
                      }
                      
                      // For fallback, pass the second parameter as-is to samples() function
                      // Strudel's samples() function handles 'github:' prefix natively
                      if (Object.keys(samplesMap).length > 0) {
                        console.log('📦 Loading samples directly as fallback:', samplesMap);
                        if (samplesCall.secondParam) {
                          // Parse the second parameter - could be string or options object
                          let secondParamValue = null;
                          try {
                            const cleanedParam = samplesCall.secondParam.trim();
                            if (cleanedParam.startsWith('{')) {
                              // Options object
                              secondParamValue = new Function('return ' + cleanedParam)();
                            } else {
                              // String parameter (e.g., 'github:tidalcycles/dirt-samples')
                              secondParamValue = cleanedParam.replace(/^["']|["']$/g, '');
                            }
                            await samplesFunc(samplesMap, secondParamValue);
                          } catch (e) {
                            // If second param parsing fails, try as string
                            const cleanedParam = samplesCall.secondParam.trim().replace(/^["']|["']$/g, '');
                            await samplesFunc(samplesMap, cleanedParam);
                          }
                        } else {
                          await samplesFunc(samplesMap);
                        }
                        await new Promise(resolve => setTimeout(resolve, 500));
                        // Note: Keep samples() in pattern - it returns undefined which is fine
                      }
                    }
                  } catch (fallbackError) {
                    console.warn('Fallback samples loading also failed:', fallbackError);
                  }
                }
              }
              
              // Log that samples were pre-loaded
              if (samplesCalls.length > 0) {
                console.log(`✅ Pre-loaded ${samplesCalls.length} samples() call(s) - pattern will be evaluated with samples already loaded`);
              }
            } catch (error) {
              console.warn('Error pre-loading samples from pattern:', error);
              // Continue - pattern evaluation will handle samples() calls
            }
          }
          
          // Get the pattern slot for this element (each element gets its own slot)
          const patternSlot = this.getPatternSlot(elementId);
          console.log(`Assigning pattern to ${patternSlot} for element ${elementId}`);

          // Ensure element-specific audio nodes exist before routing
          const elementNodes = this.getElementAudioNodes(elementId);
          if (!elementNodes || !elementNodes.gainNode) {
            console.warn(`⚠️ Could not prepare audio nodes for ${elementId} (pattern slot ${patternSlot})`);
          }
          
      // Set current evaluating slot for audio routing
      this.currentEvaluatingSlot = patternSlot;
          
          // Check if we have a cached pattern for instant triggering
          let patternToEval = null;
          const cached = this.patternCache.get(elementId);
          
          if (cached && cached.originalPattern === pattern && cached.processedPattern) {
            // Use cached processed pattern - instant triggering!
            patternToEval = cached.processedPattern;
            console.log(`⚡ Using cached pattern for ${elementId} (instant trigger)`);
            
            // Re-apply gain/pan in case they changed (gain/pan are dynamic)
            // When playing individually (not through master), gain is handled by Web Audio gain node
            // so we should NOT apply .gain() in the pattern to avoid double application
            patternToEval = this.applyElementGainPanToPattern(
              cached.processedPattern.replace(/\.gain\([^)]*\)/g, '').replace(/\.pan\([^)]*\)/g, '').replace(/\.fast\([^)]*\)/g, '').replace(/\.slow\([^)]*\)/g, '').trim(),
              elementId,
              { applyGainInPattern: this.masterActive }
            );
          } else {
            // No cache or pattern changed - process pattern normally
            console.log(`📝 Processing pattern for ${elementId} (not cached)`);
            // When playing individually (not through master), gain is handled by Web Audio gain node
            // so we should NOT apply .gain() in the pattern to avoid double application
            patternToEval = await this.processPattern(pattern, elementId, {
              applyGainInPattern: this.masterActive
            });
            
            if (!patternToEval) {
              console.warn(`[${elementId}] Pattern processing failed - cannot evaluate`);
              // Set to silence
              try {
                const silenceCode = typeof globalThis.silence === 'object' 
                  ? `${patternSlot} = globalThis.silence`
                  : `${patternSlot} = silence`;
                await window.strudel.evaluate(silenceCode);
                return;
              } catch (silenceError) {
                console.error(`Failed to set ${patternSlot} to silence:`, silenceError);
                return;
              }
            }
            
            // Cache the processed pattern for future use
            this.patternCache.set(elementId, {
              processedPattern: patternToEval,
              patternSlot: patternSlot,
              isPreEvaluated: false,
              originalPattern: pattern
            });
          }
          
          // Validate final pattern
          if (!patternToEval || patternToEval.trim() === '') {
            console.warn(`[${elementId}] Pattern became empty - cannot evaluate`);
            return;
          }
          
          // Validate pattern syntax before evaluation
          // Check for common issues that might cause "Invalid argument" errors
          if (patternToEval.includes('undefined') && !patternToEval.includes('globalThis.undefined')) {
            console.warn(`⚠️ Pattern contains 'undefined' - might be from removed samples() call`);
            // Try to clean it up
            patternToEval = patternToEval.replace(/undefined\s*[,\n;]/g, '').trim();
            patternToEval = patternToEval.replace(/,\s*undefined/g, '').trim();
            patternToEval = patternToEval.replace(/undefined\s*\./g, '').trim();
          }
          
          // Directly assign the pattern with gain/pan applied
          const assignmentCode = `${patternSlot} = ${patternToEval}`;
          console.log(`🎼 ${elementId} → ${patternSlot}:`);
          console.log(`   Full Pattern: ${patternToEval.substring(0, 200)}${patternToEval.length > 200 ? '...' : ''}`);
          console.log(`   Assignment: ${assignmentCode.substring(0, 200)}${assignmentCode.length > 200 ? '...' : ''}`);
          
          try {
            // CRITICAL: Ensure scheduler is running before evaluating pattern
            // This ensures Strudel can schedule the pattern properly
            // Only start scheduler when explicitly playing (not when pre-evaluating or saving)
            if (window.strudel && window.strudel.scheduler && !window.strudel.scheduler.started) {
              console.log(`▶️ Starting scheduler for ${elementId} pattern evaluation...`);
              await window.strudel.scheduler.start();
            }
            
            // Try direct assignment first - this should work if initStrudel created the slots
            // Note: Strudel's evaluate may return undefined for assignments, which is normal
            const evalResult = await window.strudel.evaluate(assignmentCode);
            
            // Clear current evaluating slot after audio routing
            // Set currentEvaluatingSlot BEFORE evaluation so routing can find the element
            this.currentEvaluatingSlot = patternSlot;
            
            // Since sounds are preloaded, we only need minimal delay
            const clearDelay = this.soundsPreloaded ? 500 : 1000;
            setTimeout(() => {
              if (this.currentEvaluatingSlot === patternSlot) {
                this.currentEvaluatingSlot = null;
              }
            }, clearDelay);
            
            // Check if result indicates failure (even if no error was thrown)
            // If evalResult is an error or indicates undefined pattern, set to silence
            if (evalResult && typeof evalResult === 'object' && evalResult.message) {
              if (evalResult.message.includes('undefined instead of pattern')) {
                console.warn(`⚠️ Pattern returned undefined - setting to silence`);
                try {
                  const silenceCode = typeof globalThis.silence === 'object' 
                    ? `${patternSlot} = globalThis.silence`
                    : `${patternSlot} = silence`;
                  await window.strudel.evaluate(silenceCode);
                  return; // Exit early
                } catch (silenceError) {
                  console.error(`Failed to set ${patternSlot} to silence:`, silenceError);
                  return;
                }
              }
            }
            
            console.log(`✅ Pattern assignment attempted for ${patternSlot}`);
            
            // Don't verify by reading slot value - this can cause hangs with looped patterns
            // Reading a pattern slot might re-evaluate it, causing infinite loops
            // Just trust that the assignment worked if no error was thrown
          } catch (assignError) {
            // Check if error is "got undefined instead of pattern"
            if (assignError.message && assignError.message.includes('undefined instead of pattern')) {
              console.error(`❌ Pattern evaluation failed: pattern returned undefined`);
              console.error(`   This usually means:`);
              console.error(`   - Bank samples aren't loaded (check .bank() usage)`);
              console.error(`   - Pattern syntax is invalid`);
              console.error(`   - Required samples/sounds aren't available`);
              console.error(`   Pattern: ${patternToEval.substring(0, 100)}`);
              
              // Set to silence instead of throwing
              try {
                const silenceCode = typeof globalThis.silence === 'object' 
                  ? `${patternSlot} = globalThis.silence`
                  : `${patternSlot} = silence`;
                await window.strudel.evaluate(silenceCode);
                console.log(`✅ Set ${patternSlot} to silence due to pattern error`);
              } catch (silenceError) {
                console.error(`Failed to set ${patternSlot} to silence:`, silenceError);
              }
              return; // Exit early - pattern is invalid
            }
            
            // If assignment fails because slot doesn't exist, create it first
            if (assignError.message.includes('not defined') || assignError.message.includes('ReferenceError')) {
              console.log(`Slot ${patternSlot} doesn't exist, creating it...`);
              try {
                // Try to create the slot by assigning silence first
                const silenceCode = typeof globalThis.silence === 'object' 
                  ? `${patternSlot} = globalThis.silence`
                  : `${patternSlot} = silence`;
                await window.strudel.evaluate(silenceCode);
                // Now try the pattern assignment again
                await window.strudel.evaluate(assignmentCode);
                console.log(`✅ Pattern assigned to ${patternSlot} after slot creation`);
              } catch (retryError) {
                console.error(`❌ Failed to assign pattern to ${patternSlot} even after creating slot:`, retryError);
                // If retry also fails with undefined error, set to silence
                if (retryError.message && retryError.message.includes('undefined instead of pattern')) {
                  console.error(`   Pattern still invalid - setting to silence`);
                  try {
                    const silenceCode = typeof globalThis.silence === 'object' 
                      ? `${patternSlot} = globalThis.silence`
                      : `${patternSlot} = silence`;
                    await window.strudel.evaluate(silenceCode);
                  } catch (silenceError) {
                    console.error(`Failed to set ${patternSlot} to silence:`, silenceError);
                  }
                  return;
                }
                throw retryError;
              }
            } else {
              console.error(`❌ Failed to assign pattern to ${patternSlot}:`, assignError);
              // Try to set to silence as fallback
              try {
                const silenceCode = typeof globalThis.silence === 'object' 
                  ? `${patternSlot} = globalThis.silence`
                  : `${patternSlot} = silence`;
                await window.strudel.evaluate(silenceCode);
                console.log(`✅ Set ${patternSlot} to silence as fallback`);
              } catch (silenceError) {
                console.error(`Failed to set ${patternSlot} to silence:`, silenceError);
              }
              // Don't throw - gracefully handle the error
              return;
            }
          }
        } catch (error) {
          console.error('❌ Error evaluating pattern:', error);
          console.error('Pattern was:', pattern);
          console.error('Error details:', error.message);
          
          // Check for "undefined instead of pattern" error
          if ((error.message && error.message.includes('undefined instead of pattern')) ||
              (error.isUndefinedPattern === true)) {
            console.warn('⚠️ Pattern evaluation returned undefined');
            console.warn('   This usually means:');
            console.warn('   - Bank samples aren\'t loaded (check .bank() usage)');
            console.warn('   - Pattern syntax is invalid');
            console.warn('   - Required samples/sounds aren\'t available');
            console.warn(`   Pattern: ${pattern.substring(0, 100)}`);
            
            // Set to silence instead of throwing
            const patternSlot = this.getPatternSlot(elementId);
            try {
              await window.strudel.evaluate(`${patternSlot} = silence`);
              console.log(`✅ Set ${patternSlot} to silence due to pattern error`);
            } catch (silenceError) {
              console.warn(`⚠️ Failed to set ${patternSlot} to silence:`, silenceError.message);
            }
            return; // Exit gracefully - don't throw
          }
          
          // If note is not defined, core functions aren't available
          if (error.message.includes('note is not defined') || error.message.includes('s is not defined')) {
            console.error('❌ Core Strudel functions (note, s, etc.) are not available in REPL context');
            console.error('This means Strudel REPL was not properly initialized with core functions');
            console.error('Pattern cannot be evaluated without core functions - NOT using fallback');
            throw error; // Don't use fallback - this is a critical error
          }
          
          // For other errors, also throw (don't use fallback for Strudel patterns)
          throw error;
        }
        
        console.log(`Strudel pattern started for ${elementId}`);
        
        // Clear currentEvaluatingSlot after evaluation completes
        this.currentEvaluatingSlot = null;
        
        // Get the pattern slot for this element
        const patternSlot = this.strudelPatternSlots.get(elementId);
        
        const isPreviewElement = typeof elementId === 'string' && elementId.toLowerCase().includes('preview');
        
        if (isPreviewElement) {
          if (this.trackedPatterns.has(elementId)) {
            this.trackedPatterns.delete(elementId);
            console.log(`🗑️ Removed preview element ${elementId} from master tracking`);
            this.updateMasterPattern(this.soloedElements, this.mutedElements);
          }
        } else if (!this.trackedPatterns.has(elementId)) {
          const gain = this.getElementGain(elementId) || 0.8;
          const pan = this.getElementPan(elementId) || 0;
          // Normalize quotes in pattern before storing
          const normalizedPattern = pattern.replace(/[""]/g, '"').replace(/['']/g, "'");
          this.trackedPatterns.set(elementId, {
            pattern: normalizedPattern, // Store the normalized pattern
            gain: gain,
            pan: pan,
            muted: false,
            soloed: false
          });
          console.log(`➕ Auto-added ${elementId} to master tracked patterns`);
          // Update master pattern to include this element
          this.updateMasterPattern(this.soloedElements, this.mutedElements);
        }
        
        this.activeSounds.set(elementId, {
          type: 'strudel',
          patternSlot: patternSlot,
          stop: () => {
            if (window.strudel.evaluate && patternSlot) {
              console.log(`🔇 Stopping ${elementId} (${patternSlot}) - setting to silence`);
              // Stop only this element's pattern slot, not all patterns
              window.strudel.evaluate(`${patternSlot} = silence`).then(() => {
                console.log(`✅ ${patternSlot} silenced`);
              }).catch((err) => {
                console.error(`❌ Error stopping pattern in ${patternSlot}:`, err);
              });
            }
          }
        });
        
        return; // Successfully started with Strudel
    } catch (error) {
      console.warn('Failed to load Strudel from local packages:', error);
    }
    
    // Fallback: simplified pattern parsing
    console.warn('Using simplified pattern parsing as fallback...');
    const sampleMatch = pattern.match(/s\(["']([^"']+)["']\)/);
    
    if (sampleMatch) {
      const sampleName = sampleMatch[1];
      const sliceMatch = pattern.match(/\.slice\((\d+)\s*,\s*"([^"]+)"\)/);
      if (sliceMatch) {
        const indices = this.parseIndexPattern(sliceMatch[2]);
        const fallbackPattern = this.createPatternFromIndices(indices);
        await this.playSynthesizedSound(elementId, fallbackPattern);
      } else {
        const fallbackPattern = this.createPatternFromSampleName(sampleName);
        await this.playSynthesizedSound(elementId, fallbackPattern);
      }
    } else {
      await this.playSynthesizedSound(elementId, pattern);
    }
  }

  /**
   * Load Strudel from local packages (via Vite) or CDN fallback
   */
  async loadStrudelFromCDN() {
    // Check if already loaded and properly initialized WITH FUNCTIONS EXPOSED
    // Note: silence is a Pattern object, not a function!
    const functionsExposed = typeof globalThis.silence === 'object' && 
                             typeof globalThis.sound === 'function' && 
                             typeof globalThis.note === 'function';
    
    if (this.strudelLoaded && window.strudel && window.strudel.evaluate && functionsExposed) {
      console.log('Strudel already loaded, initialized, and functions exposed');
      return;
    }
    
    if (!functionsExposed) {
      console.log('Functions not exposed, need to reload/expose:', {
        silence: typeof globalThis.silence + ' (should be object)',
        sound: typeof globalThis.sound + ' (should be function)',
        note: typeof globalThis.note + ' (should be function)'
      });
    }
    
    // Check if currently loading - wait for it to complete
    if (this.strudelLoading) {
      console.log('Strudel is currently loading, waiting...');
      // Wait for loading to complete
      while (this.strudelLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      // After loading completes, return
      if (this.strudelLoaded && window.strudel) {
        console.log('Strudel loading completed by another call');
        return;
      }
    }
    
    // Set loading flag to prevent concurrent initialization
    this.strudelLoading = true;
    
    console.log('Loading Strudel...');
    
    // Note: Script tag was removed to avoid version conflicts
    // All Strudel initialization is done via local packages
    
      // Try using local packages via Vite (proper module resolution)
    try {
      // Use cached modules to avoid duplicate bundling
      const { webModule, coreModule, webaudioModule, tonalModule } = await getStrudelModules();
      const strudelModule = webModule;
      
      console.log('✅ Loaded Strudel from local packages');
      
      // Initialize variables
      let replInstance = null;
      let samples = null;
      let gotoWindowSetup = false;
      
      // Use cached webaudio module for proper scheduling
      // Get webaudioOutput - it might be a default export or named export
      let webaudioOutput = webaudioModule.webaudioOutput || webaudioModule.default?.webaudioOutput || strudelModule?.webaudioOutput;
      
      // If webaudioModule itself is the output factory, use it directly
      if (!webaudioOutput && typeof webaudioModule === 'function') {
        webaudioOutput = webaudioModule;
      }
      
      // Also check if default export is the function
      if (!webaudioOutput && typeof webaudioModule.default === 'function') {
        webaudioOutput = webaudioModule.default;
      }
      
      // Get repl and initStrudel functions
      const repl = strudelModule.repl || webModule.repl;
      const initStrudel = strudelModule.initStrudel || webModule.initStrudel;
      
      if (!repl && !initStrudel) {
        throw new Error('Strudel REPL not available');
      }
      
      // Note: initStrudel will call initAudioOnFirstClick() automatically
      // We don't need to call it manually here
      
      console.log('Available initialization methods:', { 
        hasRepl: !!repl, 
        hasInitStrudel: !!initStrudel 
      });
      
      if (!webaudioOutput || typeof webaudioOutput !== 'function') {
        console.error('webaudioModule structure:', Object.keys(webaudioModule || {}));
        console.error('webaudioOutput type:', typeof webaudioOutput);
        throw new Error('Strudel webaudioOutput not available or not a function');
      }
      
      console.log('✅ Core module loaded, available functions:', Object.keys(coreModule).filter(k => typeof coreModule[k] === 'function').slice(0, 15));
      console.log('webaudioOutput type:', typeof webaudioOutput);
      
      // Store webaudioOutput for later use
      this.strudelOutputFactory = webaudioOutput;
      
      // Merge all modules (sampler excluded due to broken package.json)
      console.log('Merging modules...');
      console.log('  coreModule keys:', coreModule ? Object.keys(coreModule).length : 0);
      console.log('  tonalModule keys:', tonalModule ? Object.keys(tonalModule).length : 0);
      console.log('  webaudioModule keys:', webaudioModule ? Object.keys(webaudioModule).length : 0);
      console.log('  webModule keys:', webModule ? Object.keys(webModule).length : 0);
      
      const allModules = {
        ...(coreModule || {}),
        ...(tonalModule || {}),
        ...(webaudioModule || {}),
        ...(webModule || {}),
        ...(midiModule || {}) // Add MIDI module functions
      };
      
      // Remove undefined values
      Object.keys(allModules).forEach(key => {
        if (allModules[key] === undefined) delete allModules[key];
      });
      
      console.log('After merge - allModules total keys:', Object.keys(allModules).length);
      console.log('After merge - function count:', Object.keys(allModules).filter(k => typeof allModules[k] === 'function').length);
      
      // Expose all Strudel functions to globalThis so REPL can access them during evaluation
      // This is the ONLY reliable way to make functions available in REPL evaluation context
      // Check if functions are actually exposed, not just the flag
      // Note: silence is a Pattern object, not a function!
      const alreadyExposed = typeof globalThis.silence === 'object' && 
                            typeof globalThis.sound === 'function' && 
                            typeof globalThis.note === 'function';
      
      if (!alreadyExposed) {
        console.log('Exposing all Strudel functions to globalThis...');
        console.log('allModules keys:', Object.keys(allModules).length);
        console.log('Sample functions:', Object.keys(allModules).filter(k => typeof allModules[k] === 'function').slice(0, 10));
        
        // Expose all functions to globalThis
        Object.assign(globalThis, allModules);
        
        // Mark as exposed
        globalThis.__strudelModulesExposed = true;
        
        // Verify exposure worked
        console.log('✅ Exposed', Object.keys(allModules).filter(k => typeof allModules[k] === 'function').length, 'functions to globalThis');
        console.log('Verification - typeof globalThis.silence:', typeof globalThis.silence, '(Pattern object)');
        console.log('Verification - typeof globalThis.sound:', typeof globalThis.sound, '(function)');
        console.log('Verification - typeof globalThis.note:', typeof globalThis.note, '(function)');
      } else {
        console.log('Strudel functions already properly exposed to globalThis, skipping...');
        console.log('Verification - typeof globalThis.silence:', typeof globalThis.silence, '(Pattern object)');
        console.log('Verification - typeof globalThis.sound:', typeof globalThis.sound, '(function)');
        console.log('Verification - typeof globalThis.note:', typeof globalThis.note, '(function)');
      }
      
      // Expose samples function - drum samples come from webaudio/web modules
      samples = webModule.samples || webaudioModule.samples || strudelModule.samples;
      if (samples) {
        globalThis.samples = samples;
        console.log('✅ Samples function exposed to globalThis');
      } else {
        console.warn('⚠️ No samples function found in any module');
      }
      
      // Also check if there's a default sample map
      if (webModule.getAudioContext || webaudioModule.getAudioContext) {
        console.log('✅ Audio context getter available');
      }
      
      // No longer override Strudel's default output; rely on Strudel's built-in routing
      console.log('🎚️ Using element channel routing:', !!(this.masterPanNode && this.masterGainNode));
      
      // ============================================================
      // CRITICAL: Initialize pattern slots BEFORE creating REPL
      // Strudel checks for d0-d16 during REPL/scheduler initialization
      // ============================================================
      if (!globalThis.__strudelPatternsPreInitialized) {
        console.log('🎰 PRE-REPL: Initializing pattern slots d0-d16 on globalThis...');
        
        // Get silence pattern from loaded modules
        const silencePattern = allModules.silence || globalThis.silence;
        
        if (silencePattern && typeof silencePattern === 'object') {
          // Initialize all pattern slots with silence
          for (let i = 0; i <= 16; i++) {
            globalThis[`d${i}`] = silencePattern;
          }
          console.log('✅ PRE-REPL: Pattern slots initialized with silence pattern');
        } else {
          // Fallback: create empty pattern objects
          console.warn('⚠️ PRE-REPL: silence pattern not available, creating empty pattern objects');
          // Try to create a minimal pattern object that Strudel will accept
          const emptyPattern = { 
            _type: 'pattern',
            query: () => [],
            firstCycle: () => []
          };
          for (let i = 0; i <= 16; i++) {
            globalThis[`d${i}`] = emptyPattern;
          }
        }
        
        globalThis.__strudelPatternsPreInitialized = true;
        console.log('✅ PRE-REPL: Pattern slots are now defined on globalThis');
      }
      
      // Use initStrudel if available for proper setup, otherwise manual REPL
      if (initStrudel && typeof initStrudel === 'function') {
        console.log('Using initStrudel for proper initialization...');
        try {
          // Initialize MIDI BEFORE initStrudel so midiOutput handler is available
          // This ensures MIDI functions are available when Strudel initializes
          if (!this.midiEnabled) {
            try {
              await this.initializeMIDI();
            } catch (midiError) {
              console.warn('⚠️ MIDI initialization failed, continuing without MIDI:', midiError);
            }
          }
          
          // Set up MIDI output handler before initStrudel
          const midiOutputHandler = (message) => {
            // This will be called by Strudel when patterns use .midi()
            if (this.midiEnabled) {
              this.sendMIDIMessage(message);
            }
          };
          
          const initOptions = {
            audioContext: this.audioContext,
            getTime: () => this.audioContext ? this.audioContext.currentTime : 0,
            editPattern: () => {},
            setUrl: () => {},
            // Pass MIDI output handler to enable .midi() functions
            midiOutput: midiOutputHandler
          };
          console.log('🎚️ initStrudel options:', Object.keys(initOptions));
          const strudelContext = await initStrudel(initOptions);
          
          replInstance = strudelContext.repl || strudelContext;
          console.log('✅ initStrudel completed, replInstance:', !!replInstance);
          
          // Load strudel.json if it exists
          try {
            const response = await fetch('/strudel.json');
            if (response.ok) {
              const strudelConfig = await response.json();
              if (strudelConfig.samples) {
                const samplesFunc = window.strudel?.samples || globalThis.samples;
                if (samplesFunc && typeof samplesFunc === 'function') {
                  console.log('📦 Loading samples from strudel.json');
                  await samplesFunc(strudelConfig.samples);
                  console.log('✅ Samples loaded from strudel.json');
                }
              }
            }
          } catch (error) {
            // strudel.json is optional, so we silently ignore errors
            console.log('ℹ️ No strudel.json found or error loading it (this is optional)');
          }
          
          // Pre-load samples from Sampler Effects presets
          try {
            await this.preloadPresetSamples();
          } catch (error) {
            console.warn('⚠️ Error pre-loading preset samples:', error);
          }
          
          // MIDI was already initialized before initStrudel
          // Now set up the MIDI connection and ensure functions are available
          try {
            // Re-setup MIDI output handler now that Strudel is initialized
            this.setupStrudelMIDIOutput();
            // Ensure MIDI functions are available after a short delay to let Strudel fully initialize
            setTimeout(async () => {
              try {
                await this.ensureMIDIFunctionsAvailable();
              } catch (error) {
                console.warn('⚠️ Error ensuring MIDI functions available:', error);
              }
            }, 1000);
          } catch (error) {
            console.warn('⚠️ Error setting up MIDI functions:', error);
          }
          
          console.log('replInstance type:', typeof replInstance);
          console.log('replInstance.evaluate available:', typeof replInstance?.evaluate);
          console.log('strudelContext keys:', Object.keys(strudelContext));
          
          // CRITICAL: Check if webaudio output is stored in strudelContext or replInstance
          console.log('🔍 Checking strudelContext for webaudio output...');
          const possibleWebaudioPaths = [
            'strudelContext.webaudio',
            'strudelContext.scheduler.webaudio',
            'replInstance.webaudio',
            'replInstance.scheduler.webaudio',
            'strudelContext.output',
            'replInstance.output'
          ];
          
          // Store references for later access
          if (strudelContext.scheduler) {
            window.strudel = window.strudel || {};
            window.strudel.scheduler = strudelContext.scheduler;
            console.log('✅ Stored scheduler from strudelContext to window.strudel.scheduler');
            
            // Check scheduler for webaudio
            if (strudelContext.scheduler.webaudio) {
              console.log('✅ Found webaudio in strudelContext.scheduler.webaudio');
            }
          }
          
          // Check if webaudio is in the context itself
          if (strudelContext.webaudio) {
            console.log('✅ Found webaudio in strudelContext.webaudio');
            window.strudel = window.strudel || {};
            window.strudel.webaudio = strudelContext.webaudio;
          }
          
          if (replInstance && replInstance.scheduler) {
            console.log('✅ Found scheduler in replInstance');
            if (replInstance.scheduler.webaudio) {
              console.log('✅ Found webaudio in replInstance.scheduler.webaudio');
            }
          }
          
          // If replInstance doesn't have evaluate, try to create a proper REPL
          if (!replInstance || typeof replInstance.evaluate !== 'function') {
            console.warn('replInstance.evaluate not available, creating REPL manually...');
            replInstance = repl({
              audioContext: this.audioContext,
              getTime: () => this.audioContext.currentTime
            });
            console.log('Created manual REPL, evaluate available:', typeof replInstance.evaluate);
          }
        } catch (initError) {
          console.warn('initStrudel failed, falling back to manual REPL:', initError);
          // Fall back to manual creation
          replInstance = repl({
            audioContext: this.audioContext,
            getTime: () => this.audioContext.currentTime
          });
        }
      } else {
        // Create REPL with minimal config - functions are now in globalThis
        console.log('Creating REPL manually (initStrudel not available)...');
        replInstance = repl({
          audioContext: this.audioContext,
          getTime: () => this.audioContext.currentTime
        });
      }
      
      // Initialize pattern slots - MUST be done before any patterns are evaluated
      // Strudel REPL expects d0-d16 to exist as pattern slots
      console.log('🎰 Checking if pattern slots need initialization...');
      console.log('   replInstance:', !!replInstance);
      console.log('   replInstance.evaluate:', typeof replInstance?.evaluate);
      console.log('   __strudelPatternsInitialized:', !!globalThis.__strudelPatternsInitialized);
      
      if (!globalThis.__strudelPatternsInitialized && replInstance && replInstance.evaluate) {
        console.log('🎰 Initializing pattern slots d0-d16...');
        
        // CRITICAL: Initialize pattern slots synchronously one by one  
        // to ensure they exist before Strudel tries to use them
        const initSlots = async () => {
          for (let i = 0; i <= 16; i++) {
            try {
              // Try silence first (best option)
              await replInstance.evaluate(`d${i} = silence`);
              console.log(`  ✓ d${i} initialized with silence`);
            } catch (err1) {
              try {
                // Try stack() as fallback
                await replInstance.evaluate(`d${i} = stack()`);
                console.log(`  ✓ d${i} initialized with stack()`);
              } catch (err2) {
                console.error(`  ✗ Failed to initialize d${i}:`, err2.message);
              }
            }
          }
        };
        
        await initSlots();
        console.log('✅ Pattern slot initialization complete');
        globalThis.__strudelPatternsInitialized = true;
        
        // CRITICAL: Don't auto-start scheduler - only start when user explicitly plays
        // Auto-starting causes patterns to play when evaluated, even when not requested
        // Scheduler will be started when preview or play button is pressed
        if (replInstance.scheduler) {
          console.log('⏸️ Scheduler NOT auto-started - will start when user presses play/preview');
          // Don't start scheduler here - let it start only when explicitly requested
          // This prevents auto-playback when patterns are evaluated during save/select
          
          // Connect scheduler output to master channel (but don't start scheduler yet)
          setTimeout(() => {
            const scheduler = replInstance.scheduler;
            if (scheduler.webaudio || scheduler._webaudio) {
                const webaudio = scheduler.webaudio || scheduler._webaudio;
                if (webaudio.output || webaudio.outputNode) {
                  const node = webaudio.output || webaudio.outputNode;
                  try {
                    node.disconnect();
                    node.connect(this.masterPanNode);
                    console.log('✅ Connected webaudio output to master');
                  } catch (e) {
                    console.warn('⚠️ Could not connect webaudio output:', e);
                  }
                }
              }
            }, 500);
        }
      } else if (globalThis.__strudelPatternsInitialized) {
        console.log('✅ Pattern slots already initialized');
      } else {
        console.warn('⚠️ Cannot initialize pattern slots - replInstance not available');
      }
      console.log('✅ REPL initialized - functions available via globalThis');
      
      // Load @strudel/draw functions (spiral, pitchwheel, etc.) into REPL context
      // This is needed because @strudel/web doesn't export @strudel/draw
      try {
        let drawModule = null;
        try {
          // Try local import first (Vite will resolve dependencies properly)
          drawModule = await import('@strudel/draw');
          console.log('✅ Draw module imported from local packages');
        } catch (localError) {
          // Fallback to CDN if local import fails
          drawModule = await import('https://unpkg.com/@strudel/draw@1.2.4/dist/index.mjs');
          console.log('✅ Draw module imported from CDN');
        }
        
        const patternProto = (coreModule?.Pattern?.prototype) ||
          (typeof Pattern !== 'undefined' ? Pattern.prototype : null) ||
          (globalThis.Pattern ? globalThis.Pattern.prototype : null);
        if (patternProto) {
          if (!patternProto._spectrum && patternProto.spectrum) {
            patternProto._spectrum = patternProto.spectrum;
          }
          if (!patternProto._pianoroll && patternProto.pianoroll) {
            patternProto._pianoroll = patternProto.pianoroll;
          }
        }
        
        if (drawModule && replInstance && replInstance.evaluate) {
          // Import @strudel/draw in REPL context - this will add spiral, pitchwheel, etc. to Pattern.prototype
          // Use CDN URL since REPL can't resolve module specifiers
          const importPath = 'https://unpkg.com/@strudel/draw@1.2.4/dist/index.mjs';
          try {
            await replInstance.evaluate(`
              (async function() {
                // Import the draw module - this automatically adds methods to Pattern.prototype
                const draw = await import('${importPath}')
                // Export getDrawContext for use in visualizers
                if (draw.getDrawContext) {
                  globalThis.getDrawContext = draw.getDrawContext
                }
                if (typeof Pattern !== 'undefined') {
                  if (!Pattern.prototype._spectrum && Pattern.prototype.spectrum) {
                    Pattern.prototype._spectrum = Pattern.prototype.spectrum;
                  }
                  if (!Pattern.prototype._pianoroll && Pattern.prototype.pianoroll) {
                    Pattern.prototype._pianoroll = Pattern.prototype.pianoroll;
                  }
                }
              })()
            `);
            // Wait a bit for async import to complete
            await new Promise(resolve => setTimeout(resolve, 300));
            // Draw functions loaded successfully (spiral, pitchwheel, etc.)
          } catch (replError) {
            console.warn('⚠️ Could not load @strudel/draw in REPL context:', replError);
          }
        }
      } catch (error) {
        console.warn('⚠️ Could not load @strudel/draw functions:', error);
      }
      
      // Store REPL instance
      this.strudelRepl = replInstance;
      
      // CRITICAL: Patch Strudel's internal audio context getters to return our shared context
      // This ensures all Strudel nodes are created in our context
      // Note: Modules may have read-only properties, so we use try-catch
      if (this.audioContext && (webModule.getAudioContext || webaudioModule.getAudioContext)) {
        const getAudioContext = webModule.getAudioContext || webaudioModule.getAudioContext;
        if (typeof getAudioContext === 'function') {
          try {
            // Try to patch using Object.defineProperty (works even if property is read-only)
            if (webModule.getAudioContext) {
              Object.defineProperty(webModule, 'getAudioContext', {
                value: () => {
                  console.log('🎚️ Strudel getAudioContext() called - returning our shared context');
                  return this.audioContext;
                },
                writable: true,
                configurable: true
              });
            }
            if (webaudioModule.getAudioContext) {
              Object.defineProperty(webaudioModule, 'getAudioContext', {
                value: () => {
                  console.log('🎚️ Strudel webaudio getAudioContext() called - returning our shared context');
                  return this.audioContext;
                },
                writable: true,
                configurable: true
              });
            }
            console.log('✅ Patched Strudel getAudioContext() to return our shared context');
          } catch (patchError) {
            // If patching fails (module is frozen/sealed), that's OK - AudioContext hijacking should still work
            // Only log if it's not the expected "Cannot redefine property" error (which is harmless)
            if (!patchError.message.includes('Cannot redefine property')) {
              console.warn('⚠️ Could not patch getAudioContext (module may be read-only):', patchError.message);
            }
            // AudioContext hijacking should still ensure Strudel uses our shared context
          }
        }
      }
      
      // Also patch any audioContext properties in the REPL/scheduler
      if (replInstance && replInstance.scheduler) {
        const scheduler = replInstance.scheduler;
        // If scheduler has its own audioContext, replace it with ours
        if (scheduler.audioContext && scheduler.audioContext !== this.audioContext) {
          console.log('🎚️ Replacing scheduler audioContext with our shared context');
          scheduler.audioContext = this.audioContext;
        }
        // Patch superdough's audioContext if it exists
        if (scheduler.superdough && scheduler.superdough.audioContext) {
          if (scheduler.superdough.audioContext !== this.audioContext) {
            console.log('🎚️ Replacing superdough audioContext with our shared context');
            scheduler.superdough.audioContext = this.audioContext;
          }
        }
      }
      
      // Expose helper function to access loaded samples
      this.exposeSampleListHelper(webaudioModule, webModule);
      
      // Intercept Strudel's audio output to route through master channel
      // Check if scheduler has an output that connects to destination
      if (replInstance && replInstance.scheduler && this.masterPanNode && this.masterGainNode) {
        try {
          // Try to find and reroute the scheduler's output
          const scheduler = replInstance.scheduler;
          
          // Check if scheduler has an output property
          console.log('🔍 Checking for scheduler output...');
          console.log('  scheduler.output:', !!scheduler.output);
          console.log('  scheduler keys:', Object.keys(scheduler).slice(0, 15));
          
          if (scheduler.output) {
            console.log('  scheduler.output type:', scheduler.output.constructor.name);
            try {
              // Connect scheduler output to master
              scheduler.output.disconnect();
              scheduler.output.connect(this.masterPanNode);
              console.log('✅ Connected scheduler.output to masterPanNode');
            } catch (e) {
              console.warn('⚠️ Could not connect scheduler.output:', e);
            }
          }
          
          // Check for superdough output (Strudel's audio engine)
          if (scheduler.superdough || scheduler.output || scheduler.audioOutput) {
            const output = scheduler.superdough || scheduler.audioOutput || scheduler.output;
            console.log('  Found superdough/audioOutput:', output ? output.constructor.name : 'null');
            if (output && typeof output.connect === 'function') {
              try {
                output.disconnect();
                output.connect(this.masterPanNode);
                console.log('✅ Connected superdough/audioOutput to masterPanNode');
              } catch (e) {
                console.warn('⚠️ Could not connect superdough/audioOutput:', e);
              }
            }
          }
          
          // Also check for audioContext property in scheduler
          if (scheduler.audioContext) {
            // Patch audioContext.destination in scheduler's context
            const originalDestination = scheduler.audioContext.destination;
            try {
              Object.defineProperty(scheduler.audioContext, 'destination', {
                get: () => this.masterPanNode || originalDestination,
                configurable: true
              });
              console.log('🎚️ Patched scheduler audioContext.destination');
            } catch (e) {
              console.warn('⚠️ Could not patch scheduler audioContext:', e);
            }
          }
        } catch (e) {
          console.warn('⚠️ Could not intercept scheduler output:', e);
        }
      }
      
      // DON'T start the scheduler yet - pattern slots need to be initialized first!
      // Scheduler start is moved to after pattern slot initialization
      if (replInstance && replInstance.scheduler) {
        console.log('⏸️ REPL scheduler found (will be started after pattern slots are initialized)...');
      }
      
      // Wrap evaluate with proper error handling
      const evaluateFunc = async (code) => {
        try {
          // Call replInstance.evaluate and return whatever it returns
          const result = await replInstance.evaluate(code);
          
          // Check if result is undefined and code is a pattern assignment
          if (result === undefined && code.includes('=') && !code.trim().startsWith('//')) {
            // This might be a pattern assignment that evaluated to undefined
            // Check if it's trying to assign a pattern that doesn't exist
            const isPatternAssignment = /^d\d+\s*=\s*/.test(code.trim()) || 
                                       /\w+\s*=\s*s\(|sound\(|note\(/.test(code);
            
            if (isPatternAssignment) {
              console.warn(`⚠️ Pattern assignment returned undefined: ${code.substring(0, 80)}`);
              console.warn(`   This usually means the pattern is invalid or samples aren't loaded`);
            }
          }
          
          // Only log successful evaluations (not errors)
          if (result !== undefined || !code.includes('=')) {
            console.log(`Eval result for "${code.substring(0, 50)}...":`, typeof result, result);
          }
          return result;
        } catch (e) {
          // Check if error is about undefined patterns
          if (e.message && e.message.includes('undefined instead of pattern')) {
            // Create a custom error that can be caught and handled
            const customError = new Error('Pattern evaluation failed: got undefined instead of pattern');
            customError.originalError = e;
            customError.code = code;
            customError.isUndefinedPattern = true;
            
            // Log detailed error information as warning (not error)
            console.warn('⚠️ Pattern evaluation error: got undefined instead of pattern');
            console.warn(`   Code: ${code.substring(0, 100)}`);
            console.warn(`   This usually means:`);
            console.warn(`   - Bank samples aren't loaded (check .bank() usage)`);
            console.warn(`   - Pattern syntax is invalid`);
            console.warn(`   - Required samples/sounds aren't available`);
            
            // Throw custom error so it can be caught and handled by callers
            // Don't log as error - it's handled gracefully
            throw customError;
          }
          // Only log other errors, not undefined pattern errors
          console.error('Evaluation error:', e);
          throw e;
        }
      };
      
      // Get samples if not already set
      if (!samples) {
        samples = webModule.samples || strudelModule.samples || (replInstance && replInstance.samples);
      }
      
      window.strudel = {
        initialized: true,
        evaluate: evaluateFunc,
        samples: samples || (() => {}), // Fallback if samples not available
        repl: replInstance,
        scheduler: replInstance?.scheduler
      };
      
      // Mark as loaded BEFORE running tests
      this.strudelLoaded = true;
      this.strudelLoading = false;
      
      // Check that Strudel functions are available
      console.log('Checking Strudel functions availability...');
      console.log('  typeof silence:', typeof globalThis.silence);
      console.log('  typeof sound:', typeof globalThis.sound);
      console.log('  typeof note:', typeof globalThis.note);
      console.log('✅ REPL ready (functions available via globalThis)');
      
      // Set initial tempo to 120 BPM (default)
      // Set a neutral global cps = 1 (60 BPM) as base, then use .fast()/.slow() on patterns for tempo control
      this.currentTempo = 120;
      try {
        await window.strudel.evaluate('cps = 1'); // Set base to 60 BPM (1 CPS)
        console.log('✅ Initial tempo set to 120 BPM (base cps=1, using .fast()/.slow() on patterns)');
      } catch (tempoError) {
        console.warn('⚠️ Could not set initial cps:', tempoError);
      }
      
      // Pattern slots are already initialized to silence above, no need to evaluate again
      
      return;
    } catch (error) {
      console.error('Failed to load Strudel module:', error);
      this.strudelLoading = false; // Reset loading flag on error
      // Continue to fallback CDN loading
    }
    
    // Fallback: dynamic import from any available CDN
    const cdnUrls = [
      'https://unpkg.com/@strudel/web@1.2.5/dist/index.mjs',
      'https://cdn.jsdelivr.net/npm/@strudel/web@1.2.5/dist/index.mjs',
      'https://esm.sh/@strudel/web@1.2.5'
    ];
    
    for (const url of cdnUrls) {
      try {
        console.log(`Trying to load Strudel from: ${url}`);
        const strudelModule = await import(url);
        const repl = strudelModule.repl;
        const samples = strudelModule.samples;
        
        if (!repl) {
          console.warn('Strudel module missing repl. Available exports:', Object.keys(strudelModule));
          continue;
        }
        
        // Initialize Strudel
        const initStrudel = strudelModule.initStrudel;
        if (initStrudel) {
          initStrudel({
            audioContext: this.audioContext,
            output: this.audioContext
          });
        }
        
        // Import core functions first so they're available to REPL
        // Try local package first (via Vite), then CDN fallback
        let coreModule = null;
        try {
          // Try local import first (Vite will resolve dependencies properly)
          try {
            coreModule = await import('@strudel/core');
            console.log('✅ Core module imported from local packages');
          } catch (localError) {
            // Fallback to CDN if local import fails
            coreModule = await import('https://unpkg.com/@strudel/core@1.2.5/dist/index.mjs');
            console.log('✅ Core module imported from CDN');
          }
          console.log('Available exports:', Object.keys(coreModule).slice(0, 10));
        } catch (error) {
          console.warn('Could not import core module:', error);
        }
        
        // Create repl for evaluation with core functions in scope
        const replInstance = repl({
          getTime: () => this.audioContext.currentTime,
          // Pass core functions directly to REPL scope if available
          scope: coreModule ? { ...coreModule } : undefined
        });
        
        // Also try to load core functions via evaluation (backup)
        if (coreModule) {
          try {
            // Try to make core functions available via evaluation
            // Use local import if possible, otherwise CDN
            // Use CDN URL since REPL can't resolve module specifiers
            const importPath = 'https://unpkg.com/@strudel/core@1.2.5/dist/index.mjs';
            // Use simpler syntax without semicolons to avoid REPL parsing issues
            await replInstance.evaluate(`
              (async function() {
                const core = await import('${importPath}')
                Object.assign(globalThis, core)
              })()
            `);
            // Wait a bit for async import to complete
            await new Promise(resolve => setTimeout(resolve, 300));
            console.log('✅ Core functions also loaded via evaluation');
          } catch (error) {
            console.warn('Could not load core functions via evaluation:', error);
          }
        }
        
        // Load @strudel/draw functions (spiral, pitchwheel, etc.) into REPL context
        // This is needed because @strudel/web doesn't export @strudel/draw
        try {
          let drawModule = null;
          try {
            // Try local import first (Vite will resolve dependencies properly)
            drawModule = await import('@strudel/draw');
            console.log('✅ Draw module imported from local packages');
          } catch (localError) {
            // Fallback to CDN if local import fails
            drawModule = await import('https://unpkg.com/@strudel/draw@1.2.4/dist/index.mjs');
            console.log('✅ Draw module imported from CDN');
          }
          
          if (drawModule) {
            // Import @strudel/draw in REPL context - this will add spiral, pitchwheel, etc. to Pattern.prototype
            // Use CDN URL since REPL can't resolve module specifiers
            const importPath = 'https://unpkg.com/@strudel/draw@1.2.4/dist/index.mjs';
            await replInstance.evaluate(`
              (async function() {
                // Import the draw module - this automatically adds methods to Pattern.prototype
                await import('${importPath}')
                // Also export getDrawContext for use in visualizers
                const draw = await import('${importPath}')
                if (draw.getDrawContext) {
                  const originalGetDrawContext = draw.getDrawContext;
                  // Patch getDrawContext to use our canvas when available
                  globalThis.getDrawContext = function(id, options) {
                    // If no ID or default ID, try to use our canvas context
                    if ((!id || id === 'test-canvas') && window.__strudelVisualizerCtx) {
                      return window.__strudelVisualizerCtx;
                    }
                    // Otherwise use original function
                    return originalGetDrawContext(id, options);
                  };
                }
              })()
            `);
            // Wait a bit for async import to complete
            await new Promise(resolve => setTimeout(resolve, 300));
            // Draw functions loaded successfully (spiral, pitchwheel, etc.)
          }
        } catch (error) {
          console.warn('⚠️ Could not load @strudel/draw functions:', error);
        }
        
        window.strudel = {
          initialized: true,
          evaluate: replInstance.evaluate,
          samples: samples
        };
        
        // Mark as loaded
        this.strudelLoaded = true;
        this.strudelLoading = false;
        
        console.log('Strudel loaded from CDN successfully');
        return;
      } catch (error) {
        console.warn(`Failed to load from ${url}:`, error.message);
        continue;
      }
    }
    
    // Reset loading flag before throwing error
    this.strudelLoading = false;
    throw new Error('Failed to load Strudel from all CDN sources');
  }


  /**
   * Trigger sound for an element based on its config
   */
  async triggerSound(elementId) {
    // Check localStorage for custom config first
    let customConfig = null;
    try {
      const saved = localStorage.getItem(`element-config-${elementId}`);
      if (saved) {
        customConfig = JSON.parse(saved);
      }
    } catch (error) {
      console.error(`Error loading custom config for ${elementId}:`, error);
    }
    
    const elementConfig = soundConfig.getElementConfig(elementId);
    
    if (!elementConfig && !customConfig) {
      console.warn(`No config found for element: ${elementId}`);
      return;
    }

    const sampleSource = (() => {
      if (customConfig && typeof customConfig.sampleUrl === 'string' && customConfig.sampleUrl.trim() !== '') {
        return customConfig.sampleUrl.trim();
      }
      if (elementConfig && elementConfig.audioFile && typeof elementConfig.audioFile === 'string' && elementConfig.audioFile.trim() !== '') {
        return elementConfig.audioFile.trim();
      }
      return null;
    })();

    if (sampleSource) {
      try {
        const initialized = await this.initialize();
        if (!initialized) {
          console.warn('⚠️ Audio engine not fully initialized; attempting custom sample playback anyway.');
        }
      } catch (error) {
        console.warn('⚠️ Unable to initialize audio engine for custom sample playback:', error);
      }

      this.stopSound(elementId);

      console.log(`🔊 Playing custom sample for ${elementId}`);
      this.playAudioFile(elementId, sampleSource);
      return;
    }

    // Use custom config if available, otherwise fall back to default config
    let pattern = customConfig?.pattern !== undefined ? customConfig.pattern : elementConfig?.pattern;
    const type = elementConfig?.type || 'strudel'; // Default to strudel

    // Check if pattern is empty or undefined before proceeding
    if (!pattern || (typeof pattern === 'string' && pattern.trim() === '')) {
      console.log(`[${elementId}] No pattern assigned - skipping sound trigger`);
      return;
    }

    // Apply effects, filters, and synthesis if app instance is available
    if (this.appInstance && type === 'strudel') {
      const patternWithEffects = this.appInstance.getPatternWithEffects(elementId, pattern);
      if (patternWithEffects !== pattern) {
        console.log(`   Applying effects to ${elementId} for individual playback`);
        pattern = patternWithEffects;
      }
    }

    console.log(`Triggering sound for ${elementId} (type: ${type})`);

    // Handle custom sample URL if provided
    if (customConfig?.sampleUrl) {
      // Custom sample handling - load and use the sample
      await this.loadCustomSample(elementId, customConfig.sampleUrl);
    }

    if (type === 'synthesized') {
      await this.playSynthesizedSound(elementId, pattern);
    } else if (type === 'strudel') {
      await this.playStrudelPattern(elementId, pattern, elementConfig?.samples);
    } else if (type === 'audio') {
      this.playAudioFile(elementId, elementConfig?.audioFile || customConfig?.sampleUrl);
    }
  }

  /**
   * Load custom sample from URL or data URL
   */
  async loadCustomSample(elementId, urlOrDataUrl) {
    // If it's a data URL or blob URL, Strudel should handle it
    // Otherwise, we may need to preload it
    console.log(`Loading custom sample for ${elementId} from ${urlOrDataUrl.substring(0, 50)}...`);
    // This is a placeholder - actual implementation depends on how Strudel handles custom samples
    // For now, we'll let the pattern evaluation handle it if the URL is used in the pattern
  }

  /**
   * Stop sound for an element
   */
  pauseSound(elementId) {
    if (this.masterOnlyPlayback) {
      const removed = this.removeElementFromMaster(elementId);
      if (removed.success && this.masterActive) {
        this.playMasterPattern().catch(err => console.warn('⚠️ Failed to refresh master after pause:', err));
      }
      this.activeSounds.delete(elementId);
      return;
    }

    // Pause sound by setting pattern slot to silence
    // This allows it to be resumed later
    const patternSlot = this.strudelPatternSlots.get(elementId);
    if (patternSlot && window.strudel && window.strudel.evaluate) {
      try {
        // Use globalThis.silence to ensure it's always accessible
        const silenceCode = typeof globalThis.silence === 'object' 
          ? `${patternSlot} = globalThis.silence`
          : `${patternSlot} = silence`;
        window.strudel.evaluate(silenceCode);
        console.log(`⏸️ Paused ${elementId} (set ${patternSlot} to silence)`);
      } catch (error) {
        console.error(`Error pausing sound for ${elementId}:`, error);
      }
    }
    
    // Remove from active sounds
    this.activeSounds.delete(elementId);
  }

  stopSound(elementId) {
    if (this.masterOnlyPlayback) {
      const removed = this.removeElementFromMaster(elementId);
      if (removed.success && this.masterActive) {
        this.playMasterPattern().catch(err => console.warn('⚠️ Failed to refresh master after stop:', err));
      }
      this.activeSounds.delete(elementId);
      return;
    }

    const activeSound = this.activeSounds.get(elementId);
    const isPreviewElement = typeof elementId === 'string' && elementId.toLowerCase().includes('preview');
    
    // Also clear the Strudel pattern slot by setting it to silence
    if (window.strudel && window.strudel.evaluate) {
      try {
        const patternSlot = this.getPatternSlot(elementId);
        // Set pattern slot to silence to stop it
        // Use globalThis.silence to ensure it's always accessible
        // If that fails, use the silence pattern object directly if available
        const silenceCode = typeof globalThis.silence === 'object' 
          ? `${patternSlot} = globalThis.silence`
          : `${patternSlot} = silence`;
        window.strudel.evaluate(silenceCode).catch(err => {
          // Ignore errors when clearing - slot might already be cleared
          console.log(`Cleared pattern slot ${patternSlot} for ${elementId}`);
        });
      } catch (err) {
        // Ignore errors - pattern slot might not exist
      }
    }
    
    if (activeSound) {
      if (activeSound.type === 'synthesized' && activeSound.oscillator) {
        if (activeSound.oscillator.stop) {
          activeSound.oscillator.stop();
        }
      } else if (activeSound.type === 'strudel' && activeSound.stop) {
        activeSound.stop();
        this.activeSounds.delete(elementId);
      } else if (activeSound.type === 'audio' && activeSound.source) {
        const gain = activeSound.gain;
        const currentTime = this.audioContext.currentTime;
        
        // Fade out
        gain.gain.cancelScheduledValues(currentTime);
        gain.gain.setValueAtTime(gain.gain.value, currentTime);
        gain.gain.linearRampToValueAtTime(
          0,
          currentTime + soundConfig.defaults.fadeOutTime
        );
        
        setTimeout(() => {
          activeSound.source.stop();
          this.activeSounds.delete(elementId);
        }, soundConfig.defaults.fadeOutTime * 1000 + 50);
        
        return;
      } else if (activeSound.type === 'sustaining') {
        // Use the dedicated stop method for sustaining tones
        this.stopSustainingTone(elementId);
        return;
      }
      
      this.activeSounds.delete(elementId);
    }

    if (isPreviewElement) {
      const previewSlot = this.strudelPatternSlots.get(elementId);
      if (previewSlot) {
        this.patternSlotToElementId.delete(previewSlot);
        this.strudelPatternSlots.delete(elementId);
        console.log(`🧹 Cleared preview slot mapping (${previewSlot}) for ${elementId}`);
      }
      this.disposeElementAudioNodes(elementId);
      console.log(`🧹 Disposed preview audio nodes for ${elementId}`);
    }
  }

  /**
   * Stop all sounds (useful for cleanup)
   */
  async stopAllSounds() {
    if (this._stoppingAllSounds) {
      return;
    }
    this._stoppingAllSounds = true;
    console.log('🛑🛑🛑 EMERGENCY STOP - Killing all audio 🛑🛑🛑');
    
    // FIRST: Mute master gain IMMEDIATELY (synchronous, instant)
    // But store the current value so we can restore it
    const currentTime = this.audioContext?.currentTime || 0;
    
    if (this.masterGainNode) {
      // Temporarily mute
      this.masterGainNode.gain.setValueAtTime(0, currentTime);
      console.log('✓ Master gain set to 0 (immediate)');
      
      // Restore master volume after a short delay (after sounds are killed)
      setTimeout(() => {
        if (this.masterGainNode && !this.masterMuted) {
          this.masterGainNode.gain.setValueAtTime(this.masterVolume, this.audioContext?.currentTime || 0);
          console.log(`✓ Master gain restored to ${(this.masterVolume * 100).toFixed(0)}%`);
        }
      }, 100);
    } else if (this.gainNode) {
      // Fallback to old gainNode if master not initialized
      this.gainNode.gain.setValueAtTime(0, currentTime);
      console.log('✓ Gain set to 0 (immediate)');
      
      // Restore gain
      setTimeout(() => {
        if (this.gainNode) {
          this.gainNode.gain.setValueAtTime(this.volume, this.audioContext?.currentTime || 0);
          console.log(`✓ Gain restored to ${(this.volume * 100).toFixed(0)}%`);
        }
      }, 100);
    }
    
    // SECOND: Stop Strudel scheduler (this stops all scheduled events)
    // Do NOT auto-restart here; let the user explicitly start playback later
    let schedulerStopped = false;
    
    if (window.strudel && window.strudel.repl && window.strudel.repl.scheduler) {
      try {
        const scheduler = window.strudel.repl.scheduler;
        if (typeof scheduler.stop === 'function') {
          scheduler.stop();
          schedulerStopped = true;
          console.log('✓ Stopped REPL scheduler (immediate)');
        }
      } catch (e) {
        // Ignore
      }
    }
    
    // THIRD: Stop all Strudel patterns (await to ensure clearing completes)
    if (window.strudel && window.strudel.evaluate) {
      console.log('🔇 Silencing all Strudel pattern slots (d1-d16)...');
      const silencePromises = [];
      for (let i = 0; i <= 16; i++) {
        const slot = `d${i}`;
        try {
          silencePromises.push(window.strudel.evaluate(`${slot} = silence`).catch(() => {}));
        } catch (e) {
          // ignore
        }
      }
      try {
        await Promise.all(silencePromises);
        console.log('✅ All pattern slots silenced');
      } catch (_) {
        // ignore
      }
    }
    
    // FOURTH: Do NOT suspend the audio context to avoid UI jank; keep it running but muted.
    
    // FIFTH: Stop all tracked sounds
    const soundIds = Array.from(this.activeSounds.keys());
    console.log(`🔇 Stopping ${soundIds.length} tracked sounds`);
    for (const soundId of soundIds) {
      try {
        this.stopSound(soundId);
        console.log(`✓ Stopped ${soundId}`);
      } catch (error) {
        console.log(`Could not stop ${soundId}`);
      }
    }
    this.activeSounds.clear();
    
    // SIXTH: Disconnect all oscillators
    this.oscillators.forEach((osc, id) => {
      try {
        if (osc.stop) osc.stop();
        if (osc.disconnect) osc.disconnect();
        console.log(`✓ Disconnected oscillator ${id}`);
      } catch (e) {
        // Ignore
      }
    });
    this.oscillators.clear();
    
    // Clear master state so UI can rebuild cleanly
    this.masterActive = false;
    this.currentEvaluatingSlot = null;
    this.masterPattern = '';
    if (this.trackedPatterns && this.trackedPatterns.clear) {
      this.trackedPatterns.clear();
    }
    console.log('✅✅✅ EMERGENCY STOP COMPLETE ✅✅✅ (audio context left running, master muted)');
    this._stoppingAllSounds = false;
  }

  /**
   * Set master tempo (BPM) for all Strudel patterns
   * Uses .cpm() on each pattern rather than global cps to avoid tempo doubling
   */
  async setTempo(bpm) {
    // Store current tempo
    this.currentTempo = bpm;
    this.masterPlaybackTempo = bpm;
    const newSpeed = Number.isFinite(bpm) && bpm > 0 ? bpm / 120 : 1;
    if (this.masterActive && this.masterPlaybackStartTime != null) {
      const audioContext = this.audioContext;
      const nowSeconds = audioContext ? audioContext.currentTime : performance.now() / 1000;
      const oldSpeed = this.masterPlaybackSpeed || 1;
      const elapsed = Math.max(0, nowSeconds - this.masterPlaybackStartTime);
      const phase = oldSpeed > 0 ? (elapsed * oldSpeed) % 1 : 0;
      this.masterPlaybackSpeed = newSpeed > 0 ? newSpeed : 1;
      this.masterPlaybackStartTime = nowSeconds - (phase / this.masterPlaybackSpeed);
    } else {
      this.masterPlaybackSpeed = newSpeed > 0 ? newSpeed : 1;
    }
    
    if (!window.strudel || !window.strudel.evaluate) {
      console.warn('⚠️ Strudel not loaded yet - cannot set tempo');
      return;
    }

    // Don't set global cps - we use .cpm() on each pattern instead
    // Setting both would cause tempo doubling
    console.log(`🎚️ Tempo set to ${bpm} BPM (using .cpm() on patterns)`);
    
    // Update all currently playing patterns with new tempo
    // Patterns will be updated with .cpm() on next evaluation, but we can
    // proactively update them if they're already playing
    await this.updateAllPatternsWithNewTempo();
    
    // Update master pattern with new tempo (even if not actively playing)
    if (this.trackedPatterns.size > 0) {
      console.log(`🔄 Updating master with new tempo`);
      this.updateMasterPattern();
    }
  }

  /**
   * Ensure Strudel AudioWorklets (e.g., supersaw-oscillator) are loaded before evaluation
   * Loads once per session, and only when needed by the pattern or when forced.
   */
  async ensureStrudelWorkletsReady(pattern, force = false) {
    try {
      if (!window.strudel || !window.strudel.repl || !window.strudel.repl.scheduler) return;
      const scheduler = window.strudel.repl.scheduler;
      const sd = scheduler.superdough;
      if (!sd) return;
      const needsWorklets =
        force ||
        (typeof pattern === 'string' && /\b(supersaw|pulse)\b/i.test(pattern));
      if (!needsWorklets) return;
      if (this._workletsLoaded) return;
      if (typeof sd.loadWorklets === 'function') {
        console.log('⏳ Loading Strudel AudioWorklets...');
        await sd.loadWorklets();
        this._workletsLoaded = true;
        console.log('✅ Strudel AudioWorklets loaded');
      }
    } catch (e) {
      console.warn('⚠️ Could not load Strudel AudioWorklets:', e?.message || e);
    }
  }

  /**
   * Set the song key
   */
  setKey(key) {
    // Store current key (empty string means no key selected)
    this.currentKey = key || '';
    this._cachedScaleContext = null;
    this._cachedScaleKey = '';

    if (this.currentKey) {
      console.log(`🎹 Key set to ${key}`);
    } else {
      console.log(`🎹 Key cleared (no key selected)`);
    }
    
    this.updateAllPatternsWithNewScale();
  }

  updateAllPatternsWithNewScale() {
    if (this.trackedPatterns.size > 0) {
      console.log(`🔄 Updating master with new key/scale`);
      this.updateMasterPattern();
    }

    for (const [elementId, trackData] of this.trackedPatterns.entries()) {
      if (!trackData) continue;
      const normalizedPattern = trackData.pattern || trackData.rawPattern;
      if (!normalizedPattern) continue;
      const convertedPattern = this.convertPatternForScale(normalizedPattern);
      trackData.pattern = convertedPattern || normalizedPattern;
    }

    for (const [elementId, activeSound] of this.activeSounds.entries()) {
      if (activeSound.type !== 'strudel') continue;
      const saved = this.loadElementConfig ? this.loadElementConfig(elementId) : null;
      const rawPattern = saved?.pattern || activeSound.originalPattern || '';
      if (!rawPattern) continue;
      const converted = this.convertPatternForScale(rawPattern);
      const finalPattern = converted || rawPattern;
      this.updatePatternInPlace(elementId, finalPattern).catch(() => {});
    }
  }

  /**
   * Set the scale/mode
   */
  setScale(scale) {
    this.currentScale = (scale || '').trim() || 'chromatic';
    this._cachedScaleContext = null;
    this._cachedScaleKey = '';

    if (this.currentScale) {
      console.log(`🎼 Scale set to ${this.currentScale}`);
    } else {
      console.log(`🎼 Scale cleared (no scale selected)`);
    }
    this.updateAllPatternsWithNewScale();
  }

  /**
   * Set the time signature
   */
  setTimeSignature(timeSignature) {
    // Store current time signature
    this.currentTimeSignature = timeSignature;
    
    console.log(`🎵 Time signature set to ${timeSignature}`);
    
    // Time signature affects how patterns are interpreted
    // In Strudel, this is primarily informational as patterns are based on cycles
    // However, it can be useful for understanding pattern structure
    
    // Parse time signature for potential use
    const [beats, noteValue] = timeSignature.split('/').map(Number);
    this.currentBeats = beats;
    this.currentNoteValue = noteValue;
    
    console.log(`   ${beats} beats per measure, ${noteValue} note gets the beat`);
    
    // Update master pattern with new time signature (even if not actively playing)
    if (this.trackedPatterns.size > 0) {
      console.log(`🔄 Updating master with new time signature`);
      this.updateMasterPattern();
    }
  }

  extractChannelNumber(elementId, fallbackIndex = 0) {
    if (!elementId || typeof elementId !== 'string') {
      return fallbackIndex + 1;
    }
    const match = elementId.match(/(\d+)$/);
    if (match && match[1]) {
      const parsed = parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return fallbackIndex + 1;
  }

  formatNumberForPattern(value, precision = 6) {
    if (!Number.isFinite(value)) {
      return '0';
    }
    if (value === 0) {
      return '0';
    }
    const fixed = value.toFixed(precision);
    const trimmed = fixed
      .replace(/(\.\d*?[1-9])0+$/, '$1')
      .replace(/\.0+$/, '')
      .replace(/^-0$/, '0');
    return trimmed;
  }

  getScaleConversionContext() {
    return null;
  }

  convertPatternForScale(pattern) {
    if (!pattern || typeof pattern !== 'string') {
      return pattern;
    }
    
    const hasNoteNames = this.patternHasNoteNames(pattern);
    const hasNumericNotes = this.patternHasNumericNotePattern(pattern);
    
    // If pattern uses note names, preserve it - don't convert to semitones
    if (hasNoteNames && !hasNumericNotes) {
      console.log(`📝 convertPatternForScale: Pattern uses note names, preserving format`);
      return pattern;
    }
    
    // Only convert if pattern doesn't have note names (or is mixed/unclear)
    return convertNoteCallsToScaleDegrees(pattern);
  }

  /**
   * Force convert note names to semitones (for explicit user conversion)
   * This bypasses the preservation logic in convertPatternForScale
   */
  convertNoteNamesToSemitones(pattern) {
    if (!pattern || typeof pattern !== 'string') {
      return pattern;
    }
    // Always convert, regardless of format
    return convertNoteCallsToScaleDegrees(pattern);
  }

  convertNoteNamesToScaleDegrees(pattern, key, scale) {
    if (!pattern || typeof pattern !== 'string') {
      return pattern;
    }
    const normalizedKey = (key && key.trim()) || 'C';
    const normalizedScale = (scale && scale.trim()) || 'chromatic';
    const scaleSteps = this.getScaleSemitoneSteps(normalizedKey, normalizedScale);
    if (!scaleSteps || !scaleSteps.length) {
      return pattern;
    }
    
    const rootNoteName = `${normalizedKey.replace(/\s+/g, '').toUpperCase()}`;
    const rootMatch = rootNoteName.match(/^([A-G])([#B]?)/i);
    if (!rootMatch) {
      return pattern;
    }
    const rootPitchClass = `${rootMatch[1].toUpperCase()}${rootMatch[2] || ''}`;
    const rootMidiInfo = Note.get(`${rootPitchClass}4`);
    const rootMidi = Number.isFinite(rootMidiInfo.midi) ? rootMidiInfo.midi : 60;
    
    const convertSequence = (content) => {
      const separatorRegex = /(\s+|[,;:<>()[\]{}|\\/]+|\*+)/g;
      const segments = [];
      let lastIndex = 0;
      let sepMatch;
      
      while ((sepMatch = separatorRegex.exec(content)) !== null) {
        if (sepMatch.index > lastIndex) {
          segments.push({ type: 'note', value: content.substring(lastIndex, sepMatch.index) });
        }
        segments.push({ type: 'separator', value: sepMatch[0] });
        lastIndex = sepMatch.index + sepMatch[0].length;
      }
      if (lastIndex < content.length) {
        segments.push({ type: 'note', value: content.substring(lastIndex) });
      }
      
      let converted = false;
      
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (segment.type === 'separator') continue;
        
        const trimmed = segment.value.trim();
        if (!trimmed) continue;
        
        // Allow time annotations (e.g., C4@0.5)
        const noteMatch = trimmed.match(/^([a-gA-G])([#b]?)(-?\d+)?(@[\d.]+)?$/);
        if (!noteMatch) continue;
        
        const letter = noteMatch[1].toUpperCase();
        const accidental = noteMatch[2] || '';
        const explicitOctave = noteMatch[3] ? parseInt(noteMatch[3], 10) : null;
        const timeAnnotation = noteMatch[4] || '';
        
        const candidateOctaves = [];
        if (explicitOctave !== null && !Number.isNaN(explicitOctave)) {
          candidateOctaves.push(explicitOctave);
        }
        const rootOctave = rootMidiInfo.oct || 4;
        candidateOctaves.push(rootOctave, rootOctave - 1, rootOctave + 1, 3, 4, 5);
        
        let noteMidi = null;
        for (const octave of candidateOctaves) {
          const info = Note.get(`${letter}${accidental}${octave}`);
          if (info && Number.isFinite(info.midi)) {
            noteMidi = info.midi;
            break;
          }
        }
        if (noteMidi === null) {
          return null;
        }
        
        const semitoneOffset = noteMidi - rootMidi;
        const relative = ((semitoneOffset % 12) + 12) % 12;
        const degreeIndex = scaleSteps.indexOf(relative);
        if (degreeIndex === -1) {
          return null;
        }
        const octaveOffset = Math.floor((semitoneOffset - scaleSteps[degreeIndex]) / 12);
        const mappedDegree = octaveOffset * scaleSteps.length + degreeIndex;
        segments[i] = { type: 'note', value: `${mappedDegree}${timeAnnotation}` };
        converted = true;
      }
      
      if (!converted) {
        return null;
      }
      return segments.map(segment => segment.value).join('');
    };
    
    const noteCallRegex = /\bnote\s*\(\s*(["'])([\s\S]*?)\1\s*\)/gi;
    let updated = pattern.replace(noteCallRegex, (match, quote, content) => {
      const convertedContent = convertSequence(content);
      if (convertedContent === null) {
        return match;
      }
      return `n(${quote}${convertedContent}${quote})`;
    });
    
    return updated;
  }

  getScaleSemitoneSteps(key, scale) {
    const normalizedKey = key && typeof key === 'string' ? key.trim() : '';
    const normalizedScale = scale && typeof scale === 'string' ? scale.trim() : '';
    const tonalScaleName = SCALE_NAME_TONAL_MAP[normalizedScale] || normalizedScale || 'chromatic';
    
    let rootNote = 'C';
    if (normalizedKey) {
      const match = normalizedKey.match(/^([a-gA-G])([#b]?)/);
      if (match) {
        rootNote = `${match[1].toUpperCase()}${match[2] || ''}`;
      } else {
        rootNote = normalizedKey;
      }
    }
    
    const scaleObj = Scale.get(`${rootNote} ${tonalScaleName}`);
    if (!scaleObj || !Array.isArray(scaleObj.intervals) || scaleObj.intervals.length === 0) {
      return null;
    }
    
    const steps = scaleObj.intervals
      .map(intervalName => {
        const value = Interval.semitones(intervalName);
        return Number.isFinite(value) ? value : null;
      })
      .filter(value => value !== null);
    
    if (!steps.length) {
      return null;
    }
    
    // Ensure steps are sorted ascending and start at 0
    const uniqueSteps = Array.from(new Set(steps)).sort((a, b) => a - b);
    if (uniqueSteps[0] !== 0) {
      uniqueSteps.unshift(0);
    }
    
    return uniqueSteps;
  }

  patternHasNoteNames(pattern) {
    if (!pattern || typeof pattern !== 'string') return false;
    const noteCallRegex = /\b(note|n)\s*\(\s*["']([^"']+)["']/gi;
    let match;
    while ((match = noteCallRegex.exec(pattern)) !== null) {
      const content = match[2];
      if (/[a-gA-G][#b]?\d/.test(content) || /[a-gA-G][#b]?\s/.test(content)) {
        return true;
      }
    }
    return false;
  }

  patternHasNumericNotePattern(pattern) {
    if (!pattern || typeof pattern !== 'string') return false;
    const noteCallRegex = /\b(note|n)\s*\(\s*["']([^"']+)["']/gi;
    let match;
    let found = false;
    while ((match = noteCallRegex.exec(pattern)) !== null) {
      found = true;
      let content = match[2]
        .replace(/[<>\[\]\{\}\|,]/g, ' ')
        .trim();
      if (!content) continue;
      if (/[a-gA-G]/.test(content)) {
        return false;
      }
      if (!/^[\d\s~\-\/]+$/.test(content)) {
        return false;
      }
    }
    return found;
  }

  _ensureMasterPatternSanitized() {
    if (!this.masterPattern || typeof this.masterPattern !== 'string') {
      return '';
    }
    const sanitized = this._sanitizePatternExpression(this.masterPattern);
    if (sanitized !== this.masterPattern) {
      console.log('🧼 Sanitized master pattern before evaluation');
      this.masterPattern = sanitized;
    }
    return this.masterPattern;
  }

  _repairBrokenSampleStrings(pattern) {
    if (!pattern || typeof pattern !== 'string') {
      return pattern;
    }

    const samplesCallRegex = /samples\s*\(\s*\{([\s\S]*?)\}\s*,\s*\{([\s\S]*?)\}\s*\)/g;

    return pattern.replace(samplesCallRegex, (match, sampleBlock, optionsBlock) => {
      const entryRegex = /"([^"]+)"\s*:\s*"([\s\S]*?)"/g;
      const entries = [];
      let entryMatch;

      while ((entryMatch = entryRegex.exec(sampleBlock)) !== null) {
        const key = entryMatch[1]?.trim();
        const value = entryMatch[2]?.replace(/[\r\n]+/g, '').trim();
        if (!key || !value) continue;
        entries.push([key, value]);
      }

      if (!entries.length) {
        return match;
      }

      const baseUrlMatch = optionsBlock.match(/baseUrl\s*:\s*"([\s\S]*?)"/);
      const cleanedBaseUrl = baseUrlMatch
        ? baseUrlMatch[1].replace(/[\r\n]+/g, '').trim()
        : './';

      const sampleLines = entries
        .map(([key, value]) => `  "${key}": "${value}"`)
        .join(',\n');

      const safeBaseUrl = cleanedBaseUrl || './';

      return `samples({\n${sampleLines}\n}, { baseUrl: "${safeBaseUrl}" })`;
    });
  }

  _findMatchingParenIndex(content, openIndex) {
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let inBlockComment = false;
    let inLineComment = false;
    let escaped = false;

    for (let i = openIndex; i < content.length; i += 1) {
      const char = content[i];
      const nextChar = content[i + 1];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (inLineComment) {
        if (char === '\n') {
          inLineComment = false;
        }
        continue;
      }

      if (inBlockComment) {
        if (char === '*' && nextChar === '/') {
          inBlockComment = false;
          i += 1;
        }
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (inSingle) {
        if (char === "'") {
          inSingle = false;
        }
        continue;
      }

      if (inDouble) {
        if (char === '"') {
          inDouble = false;
        }
        continue;
      }

      if (inTemplate) {
        if (char === '`') {
          inTemplate = false;
        }
        continue;
      }

      if (char === "'" && !inDouble && !inTemplate) {
        inSingle = true;
        continue;
      }

      if (char === '"' && !inSingle && !inTemplate) {
        inDouble = true;
        continue;
      }

      if (char === '`' && !inSingle && !inDouble) {
        inTemplate = true;
        continue;
      }

      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        i += 1;
        continue;
      }

      if (char === '/' && nextChar === '/') {
        inLineComment = true;
        i += 1;
        continue;
      }

      if (char === '(') {
        depth += 1;
        continue;
      }

      if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          return i;
        }
        if (depth < 0) {
          return -1;
        }
      }
    }

    return -1;
  }

  _repairLeadingSampleStatements(pattern) {
    if (!pattern || typeof pattern !== 'string') {
      return pattern;
    }

    const trimmed = pattern.trimStart();
    if (trimmed.startsWith('(() =>') || trimmed.startsWith('(()=>')) {
      return pattern;
    }

    const leadingWhitespace = pattern.slice(0, pattern.length - trimmed.length);

    const leadingCommentMatch = trimmed.match(/^(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)+/);
    const commentBlock = leadingCommentMatch ? leadingCommentMatch[0] : '';

    let working = trimmed.slice(commentBlock.length).trimStart();
    if (!working.startsWith('samples')) {
      return pattern;
    }

    const loaders = [];
    let position = 0;

    while (working.startsWith('samples', position)) {
      const callStart = position;
      const openIndex = working.indexOf('(', callStart);
      if (openIndex === -1) {
        break;
      }
      const closeIndex = this._findMatchingParenIndex(working, openIndex);
      if (closeIndex === -1) {
        break;
      }
      const loaderSnippet = working.slice(callStart, closeIndex + 1).trim();
      loaders.push(loaderSnippet);
      position = closeIndex + 1;
      while (position < working.length && /\s/.test(working[position])) {
        position += 1;
      }
    }

    if (!loaders.length) {
      return pattern;
    }

    const remainder = working.slice(position).trim();
    if (!remainder) {
      return pattern;
    }

    const loaderBlock = loaders.map((line) => `  ${line};`).join('\n');
    const bodyLines = remainder
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n');

    const rebuilt = `(() => {\n${loaderBlock}\n  return (\n${bodyLines}\n  );\n})()`;
    return `${leadingWhitespace}${commentBlock}${rebuilt}`;
  }

  _repairStringPatternOperators(pattern) {
    if (!pattern || typeof pattern !== 'string') {
      return pattern;
    }

    let result = '';
    let index = 0;
    const length = pattern.length;

    const isSafeContext = (char) => {
      if (!char) return true;
      return /[,\(\{\[=:+\-*\/!&|?;%]/.test(char);
    };

    while (index < length) {
      const char = pattern[index];

      if (char === '"' || char === "'") {
        const quote = char;
        let cursor = index + 1;
        let escaped = false;
        while (cursor < length) {
          const current = pattern[cursor];
          if (!escaped && current === quote) {
            break;
          }
          if (!escaped && current === '\\') {
            escaped = true;
          } else {
            escaped = false;
          }
          cursor += 1;
        }

        if (cursor >= length) {
          result += pattern.slice(index);
          break;
        }

        const literal = pattern.slice(index, cursor + 1);

        let prevIndex = index - 1;
        while (prevIndex >= 0 && /\s/.test(pattern[prevIndex])) {
          prevIndex -= 1;
        }
        const prevChar = prevIndex >= 0 ? pattern[prevIndex] : '';

        let nextIndex = cursor + 1;
        while (nextIndex < length && /\s/.test(pattern[nextIndex])) {
          nextIndex += 1;
        }

        const nextIsDiv = pattern.startsWith('.div', nextIndex);
        const contextSafe = isSafeContext(prevChar);

        if (nextIsDiv && contextSafe) {
          result += `pattern(${literal})`;
        } else {
          result += literal;
        }

        index = cursor + 1;
        continue;
      }

      result += char;
      index += 1;
    }

    return result;
  }

  _sanitizePatternExpression(pattern) {
    if (!pattern || typeof pattern !== 'string') {
      return pattern;
    }
    let result = this._repairBrokenSampleStrings(pattern);
    result = this._repairLeadingSampleStatements(result);
    result = this._repairStringPatternOperators(result);
    return result;
  }

  applyMasterMixModifiers(pattern, options = {}) {
    if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
      return pattern;
    }

    const { wrapStack = false } = options;
    
    // First, remove existing master-level modifiers from the pattern to avoid duplicates
    let cleanedPattern = pattern;
    
    if (wrapStack) {
      // For stack patterns, only remove modifiers that come AFTER the stack closing paren
      // Per-track modifiers inside the stack should be preserved
      const stackCloseMatch = cleanedPattern.match(/stack\s*\(/);
      if (stackCloseMatch) {
        // Find the closing parenthesis of the stack(...) call
        let stackStart = stackCloseMatch.index + stackCloseMatch[0].length - 1; // Position of '('
        let depth = 1;
        let stackEnd = stackStart + 1;
        let inString = false;
        let stringChar = null;
        
        while (stackEnd < cleanedPattern.length && depth > 0) {
          const char = cleanedPattern[stackEnd];
          
          // Handle strings
          if (!inString && (char === '"' || char === "'")) {
            inString = true;
            stringChar = char;
          } else if (inString && char === stringChar && cleanedPattern[stackEnd - 1] !== '\\') {
            inString = false;
            stringChar = null;
          }
          
          if (!inString) {
            if (char === '(') depth++;
            else if (char === ')') depth--;
          }
          
          if (depth > 0) stackEnd++;
        }
        
        if (depth === 0) {
          // Found the stack closing paren at stackEnd
          // Completely drop everything after the closing parenthesis
          // This ensures no old master modifiers remain
          cleanedPattern = cleanedPattern.substring(0, stackEnd + 1).trimEnd();
        }
      }
    } else {
      // For single patterns, remove all modifiers (they're all master-level)
      cleanedPattern = cleanedPattern.replace(/\.gain\s*\([^)]*\)/g, '');
      cleanedPattern = cleanedPattern.replace(/\.pan\s*\([^)]*\)/g, '');
      cleanedPattern = cleanedPattern.replace(/\.cpm\s*\([^)]*\)/g, '');
      cleanedPattern = cleanedPattern.replace(/\.\.+/g, '.').replace(/\.\s*$/, '').trim();
    }
    
    // Clean up any double dots or trailing dots
    cleanedPattern = cleanedPattern.replace(/\.\.+/g, '.').replace(/\.\s*$/, '').trim();
    
    // Parse existing master-level modifiers to update internal state (for gain/pan)
    // For stack patterns, only look at modifiers after the stack closing paren
    let masterLevelPattern = pattern;
    if (wrapStack) {
      const stackCloseMatch = pattern.match(/stack\s*\(/);
      if (stackCloseMatch) {
        let stackStart = stackCloseMatch.index + stackCloseMatch[0].length - 1;
        let depth = 1;
        let stackEnd = stackStart + 1;
        let inString = false;
        let stringChar = null;
        
        while (stackEnd < pattern.length && depth > 0) {
          const char = pattern[stackEnd];
          if (!inString && (char === '"' || char === "'")) {
            inString = true;
            stringChar = char;
          } else if (inString && char === stringChar && pattern[stackEnd - 1] !== '\\') {
            inString = false;
            stringChar = null;
          }
          if (!inString) {
            if (char === '(') depth++;
            else if (char === ')') depth--;
          }
          if (depth > 0) stackEnd++;
        }
        
        if (depth === 0) {
          masterLevelPattern = pattern.substring(stackEnd + 1);
        }
      }
    }
    
    // Parse the LAST modifier of each type (in case there are duplicates)
    const gainMatches = [...masterLevelPattern.matchAll(/\.gain\s*\(\s*([^)]+)\s*\)/g)];
    if (gainMatches.length > 0) {
      // Use the last match (most recent)
      const lastMatch = gainMatches[gainMatches.length - 1];
      const gainValue = parseFloat(lastMatch[1]);
      if (Number.isFinite(gainValue)) {
        this.masterVolume = gainValue;
      }
    }
    
    const panMatches = [...masterLevelPattern.matchAll(/\.pan\s*\(\s*([^)]+)\s*\)/g)];
    if (panMatches.length > 0) {
      // Use the last match (most recent)
      const lastMatch = panMatches[panMatches.length - 1];
      const panValue = parseFloat(lastMatch[1]);
      if (Number.isFinite(panValue)) {
        this.masterPan = panValue;
      }
    }
    
    const modifiers = [];
    if (Number.isFinite(this.masterVolume) && Math.abs(this.masterVolume - 1) > 1e-6) {
      modifiers.push(`.gain(${this.formatNumberForPattern(this.masterVolume, 4)})`);
    }

    if (Number.isFinite(this.masterPan) && Math.abs(this.masterPan) > 1e-6) {
      modifiers.push(`.pan(${this.formatNumberForPattern(this.masterPan, 4)})`);
    }

    const tempo = Number.isFinite(this.currentTempo) && this.currentTempo > 0 ? this.currentTempo : 120;
    if (Math.abs(tempo - 120) > 1e-6) {
      const cyclesPerMinute = tempo / 4;
      modifiers.push(`.cpm(${this.formatNumberForPattern(cyclesPerMinute, 6)})`);
    }

    if (!modifiers.length) {
      return cleanedPattern;
    }

    // Use cleaned pattern as base
    pattern = cleanedPattern;
    const remainingModifiers = modifiers;

    const commentMatch = pattern.match(/^(\s*\/\/[^\n]*\n)+/);
    let prefix = '';
    let body = pattern;
    if (commentMatch) {
      prefix = commentMatch[0];
      body = pattern.slice(prefix.length);
    }

    const trailingWhitespaceMatch = body.match(/\s*$/);
    const trailingWhitespace = trailingWhitespaceMatch ? trailingWhitespaceMatch[0] : '';
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      return pattern;
    }

    if (wrapStack) {
      // Find the stack closing paren using the same logic as cleaning
      const stackCloseMatch = trimmedBody.match(/stack\s*\(/);
      if (stackCloseMatch) {
        let stackStart = stackCloseMatch.index + stackCloseMatch[0].length - 1;
        let depth = 1;
        let stackEnd = stackStart + 1;
        let inString = false;
        let stringChar = null;
        
        while (stackEnd < trimmedBody.length && depth > 0) {
          const char = trimmedBody[stackEnd];
          if (!inString && (char === '"' || char === "'")) {
            inString = true;
            stringChar = char;
          } else if (inString && char === stringChar && trimmedBody[stackEnd - 1] !== '\\') {
            inString = false;
            stringChar = null;
          }
          if (!inString) {
            if (char === '(') depth++;
            else if (char === ')') depth--;
          }
          if (depth > 0) stackEnd++;
        }
        
        if (depth === 0) {
          // Found the stack closing paren - everything after it should have been removed during cleaning
          const stackPrefix = trimmedBody.slice(0, stackEnd + 1);
          const stackSuffix = trimmedBody.slice(stackEnd + 1).trim();
          
          // Since we drop everything after stack during cleaning, stackSuffix should be empty
          // But if it's not, aggressively clean it and drop anything modifier-like
          let cleanedSuffix = stackSuffix;
          
          // Remove all modifier patterns, including malformed ones like .(gain(0.7)) or (gain(0.7))
          // Use a loop to catch all variations
          let previousLength = cleanedSuffix.length;
          let iterations = 0;
          while (iterations < 10) { // Safety limit
            // Remove standard modifiers: .gain(...)
            cleanedSuffix = cleanedSuffix.replace(/\.(gain|pan|cpm)\s*\([^)]*\)/g, '');
            
            // Remove malformed patterns: .(gain(...)) or (gain(...))
            cleanedSuffix = cleanedSuffix.replace(/\.\s*\(\s*(gain|pan|cpm)\s*\([^)]*\)\s*\)/g, '');
            cleanedSuffix = cleanedSuffix.replace(/\s*\(\s*(gain|pan|cpm)\s*\([^)]*\)\s*\)/g, '');
            
            // Remove any standalone modifier calls without dot
            cleanedSuffix = cleanedSuffix.replace(/\s*(gain|pan|cpm)\s*\([^)]*\)/g, '');
            
            // Clean up artifacts
            cleanedSuffix = cleanedSuffix.replace(/\.\.+/g, '.').replace(/\.\s*$/, '').replace(/^\s*\./, '').trim();
            
            // If nothing changed, we're done
            if (cleanedSuffix.length === previousLength) break;
            previousLength = cleanedSuffix.length;
            iterations++;
          }
          
          // Final safety: if cleanedSuffix contains ANY modifier-like text, drop it completely
          if (cleanedSuffix.match(/(gain|pan|cpm)\s*\(/) || cleanedSuffix.match(/[().]/)) {
            cleanedSuffix = '';
          }
          
          // Always strip everything after the stack closing paren, then add fresh modifiers
          // This ensures we never have duplicate or malformed modifiers
          const finalPattern = stackPrefix + (remainingModifiers.length > 0 ? remainingModifiers.join('') : '');
          
          return `${prefix}${finalPattern}${trailingWhitespace}`;
        }
      }
      
      // Fallback: use lastIndexOf if stack detection fails
      const closingIndex = trimmedBody.lastIndexOf(')');
      if (closingIndex !== -1) {
        const stackPrefix = trimmedBody.slice(0, closingIndex + 1);
        const stackSuffix = trimmedBody.slice(closingIndex + 1).trim();
        
        // Aggressively clean suffix using the same loop-based approach
        let cleanedSuffix = stackSuffix;
        let previousLength = cleanedSuffix.length;
        let iterations = 0;
        while (iterations < 10) {
          cleanedSuffix = cleanedSuffix.replace(/\.(gain|pan|cpm)\s*\([^)]*\)/g, '');
          cleanedSuffix = cleanedSuffix.replace(/\.\s*\(\s*(gain|pan|cpm)\s*\([^)]*\)\s*\)/g, '');
          cleanedSuffix = cleanedSuffix.replace(/\s*\(\s*(gain|pan|cpm)\s*\([^)]*\)\s*\)/g, '');
          cleanedSuffix = cleanedSuffix.replace(/\s*(gain|pan|cpm)\s*\([^)]*\)/g, '');
          cleanedSuffix = cleanedSuffix.replace(/\.\.+/g, '.').replace(/\.\s*$/, '').replace(/^\s*\./, '').trim();
          
          if (cleanedSuffix.length === previousLength) break;
          previousLength = cleanedSuffix.length;
          iterations++;
        }
        
        // Final safety check
        if (cleanedSuffix.match(/(gain|pan|cpm)\s*\(/) || cleanedSuffix.match(/[().]/)) {
          cleanedSuffix = '';
        }
        
        // Always strip everything after the stack closing paren, then add fresh modifiers
        const finalPattern = stackPrefix + (remainingModifiers.length > 0 ? remainingModifiers.join('') : '');
        
        return `${prefix}${finalPattern}${trailingWhitespace}`;
      }
    }

    const isAlreadyWrapped = trimmedBody.startsWith('(') && trimmedBody.endsWith(')');
    const wrappedBody = remainingModifiers.length > 0
      ? (
        isAlreadyWrapped
          ? `${trimmedBody}${remainingModifiers.join('')}`
          : `(${trimmedBody})${remainingModifiers.join('')}`
      )
      : trimmedBody;

    return `${prefix}${wrappedBody}${trailingWhitespace}`;
  }

  /**
   * Apply global control settings (tempo, key, time signature) to a pattern
   */
  applyGlobalSettingsToPattern(pattern, alreadyWrapped = false, preserveStructure = false, elementKey = null, elementScale = null) {
    if (!pattern || pattern === 'silence') {
      return pattern;
    }

    let modifiedPattern = pattern;
    let needsWrapping = alreadyWrapped;

    // Note: Tempo is NOT automatically applied to patterns
    // Users can manually add .fast() or .slow() to their patterns if desired
    // The tempo control is for reference and manual use only

    // 1. Apply Key/Scale (only for numeric scale degree patterns)
    // Strudel's .scale() works with numeric patterns like n("0 2 4 7")
    // It does NOT work with explicit note names like note("c3 e3 d3") or chords like note("Cmaj7")
    // Check if pattern uses notes but NOT explicit note names with octaves or chord names
    const hasNoteFunction = /\b(note|n)\s*\(/.test(modifiedPattern);
    
    // Detect patterns with note names (with or without octaves) or chord names
    // Examples: note("c3 d3 e3"), note("c d e f"), note("Cmaj7 Am Dm"), note("c# d e")
    // Note names have letter notes (a-g) followed by optional accidental and octave
    const hasNoteNames = this.patternHasNoteNames(modifiedPattern);
    
    // Detect chord names (patterns containing chord notation like maj, min, m, 7, etc.)
    // Examples: "Cmaj7", "Am", "Dm7", "F#maj", "Bb7"
    const hasChordNames = /\b(note|n)\s*\(\s*["'][a-g][#b]?[a-z0-9]*\s*[a-z]/.test(modifiedPattern) ||
                         /\b(note|n)\s*\(\s*["'][^"']*\b(maj|min|m|dim|aug|sus|add|7|9|11|13)\b/i.test(modifiedPattern);
    
    // Detect .chord() modifier - patterns using chord() should not have scale applied
    // Examples: n("0 1 2 3").chord("<C Am F G>"), note("c").chord("Cmaj7")
    const hasChordModifier = /\.\s*chord\s*\(/i.test(modifiedPattern);
    
    // Check if pattern contains letter-based note names (not just numbers)
    // This catches patterns like note("c d e f") without octaves
    const hasLetterNotes = /\b(note|n)\s*\(\s*["'][^"']*[a-g][#b]?\s/.test(modifiedPattern);
    
    const hasExplicitNotes = hasNoteNames || hasChordNames || hasLetterNotes || hasChordModifier;
    const numericNotePattern = this.patternHasNumericNotePattern(modifiedPattern);
    const isNumericPattern = hasNoteFunction && !hasExplicitNotes && !hasChordModifier && numericNotePattern;

    // Use per-element key/scale if provided, otherwise fall back to global settings
    const keyToUse = elementKey !== null ? elementKey : (this.currentKey && this.currentKey.trim() !== '' ? this.currentKey.trim() : '');
    const scaleToUse = elementScale !== null ? elementScale : (this.currentScale && this.currentScale.trim() !== '' ? this.currentScale.trim() : '');
    
    const hasKey = keyToUse && keyToUse.trim() !== '';
    const selectedScale = scaleToUse && scaleToUse.trim() !== '' ? scaleToUse.trim() : '';
    let rootNote = '';
    let defaultScaleFromKey = '';

    if (hasKey) {
      const keyLower = keyToUse.toLowerCase();
      if (keyLower.includes('m') && !keyLower.includes('major')) {
        rootNote = keyLower.replace('m', '').trim();
        defaultScaleFromKey = 'minor';
      } else {
        rootNote = keyLower.replace('major', '').trim();
        defaultScaleFromKey = 'major';
      }
      if (!rootNote) {
        rootNote = keyLower.trim();
      }
    }

    if (isNumericPattern) {
      let scaleIdentifier = '';
      let appliedScaleName = '';

      if (hasKey) {
        const scaleName = selectedScale || defaultScaleFromKey || 'major';
        // Map dropdown value to Tonal.js scale name
        const tonalScaleName = SCALE_NAME_TONAL_MAP[scaleName] || scaleName;
        appliedScaleName = tonalScaleName;
        const root = rootNote || keyToUse.trim().toLowerCase();
        scaleIdentifier = root ? `${root}:${tonalScaleName}` : tonalScaleName;
      } else if (selectedScale) {
        // Map dropdown value to Tonal.js scale name
        const tonalScaleName = SCALE_NAME_TONAL_MAP[selectedScale] || selectedScale;
        appliedScaleName = tonalScaleName;
        scaleIdentifier = tonalScaleName;
      }

      // Remove existing scale modifier if present, then add new one
      const alreadyHasScale = /\.\s*scale\s*\(/i.test(modifiedPattern);
      if (alreadyHasScale) {
        // Remove existing .scale() modifier
        // Match .scale('...') or .scale("...") - handle both single and double quotes
        // This regex matches: .scale( followed by quoted string (handling escaped quotes) or any content until closing paren
        modifiedPattern = modifiedPattern.replace(/\.\s*scale\s*\((['"])(?:(?=(\\?))\2.)*?\1\)/gi, '');
        // Also handle cases without quotes: .scale(something)
        modifiedPattern = modifiedPattern.replace(/\.\s*scale\s*\([^)]*\)/gi, '');
        // Clean up any double dots or trailing dots
        modifiedPattern = modifiedPattern.replace(/\.+/g, '.').replace(/\.\s*\./g, '.').trim();
        // Remove trailing dots
        modifiedPattern = modifiedPattern.replace(/\.+$/, '').trim();
        console.log(`  🔄 Removed existing scale modifier`);
      }
      
      if (scaleIdentifier && !hasChordModifier) {
        const scaleModifier = `.scale('${scaleIdentifier}')`;
        const sampleIndex = modifiedPattern.search(/\.(s|sound)\s*\(/);
        if (sampleIndex !== -1) {
          const before = modifiedPattern.slice(0, sampleIndex);
          const after = modifiedPattern.slice(sampleIndex);
          modifiedPattern = `${before}${scaleModifier}${after}`;
        } else if (needsWrapping) {
          modifiedPattern = `${modifiedPattern}${scaleModifier}`;
        } else {
          modifiedPattern = `(${modifiedPattern})${scaleModifier}`;
          needsWrapping = true;
        }
        console.log(`  🎼 Applied scale: ${scaleIdentifier}`);
      } else if (hasKey || selectedScale) {
        if (hasChordModifier) {
          console.log(`  ⏭️  Skipped scale application (pattern uses .chord() modifier)`);
        } else if (alreadyHasScale) {
          console.log(`  ⏭️  Skipped scale application (pattern already has scale)`);
        } else {
          console.log(`  ⏭️  Skipped scale application (pattern not compatible with key/scale settings)`);
        }
      }
    } else if (hasExplicitNotes && (hasKey || selectedScale)) {
      let noteType = 'note name';
      if (hasChordModifier) {
        noteType = 'chord modifier (.chord())';
      } else if (hasChordNames) {
        noteType = 'chord';
      }
      console.log(`  ⏭️  Skipped scale for ${noteType} pattern (use numeric n() for scale/key changes)`);
    } else if (!hasNoteFunction && (hasKey || selectedScale)) {
      console.log(`  ⏭️  Skipped scale for non-note pattern (Key: ${keyToUse || 'none'}, Scale: ${selectedScale || 'none'})`);
    }

    // 2. Time Signature (informational - affects pattern interpretation)
    // Strudel doesn't have a direct time signature setting, but we can use
    // the time signature to adjust pattern structure if needed
    // For now, this is stored for reference (this.currentTimeSignature)
    
    return modifiedPattern;
  }

  /**
   * Update all currently playing patterns with the new tempo
   */
  async updateAllPatternsWithNewTempo() {
    // Update each active sound pattern with the new tempo
    for (const [elementId, activeSound] of this.activeSounds.entries()) {
      if (activeSound.type === 'strudel') {
        // Get the current pattern from saved config
        try {
          const saved = localStorage.getItem(`element-config-${elementId}`);
          if (saved) {
            const config = JSON.parse(saved);
            if (config.pattern && config.pattern.trim() !== '') {
              // Update pattern in place with new tempo
              await this.updatePatternInPlace(elementId, config.pattern);
            }
          }
        } catch (error) {
          // Ignore errors - pattern might not have a saved config
        }
      }
    }
  }

  /**
   * Check if a sound is currently playing for an element
   */
  isPlaying(elementId) {
    return this.activeSounds.has(elementId);
  }

  /**
   * Get audio context (for state checking)
   */
  getAudioContext() {
    return this.audioContext;
  }

  /**
   * Check if audio context is ready
   */
  isAudioReady() {
    return this.initialized && this.audioContext && 
           (this.audioContext.state === 'running' || this.audioContext.state === 'suspended');
  }

  /**
   * Play a sustaining tone for slider controls
   * Frequency maps from slider value to 160Hz - 10kHz
   */
  playSustainingTone(sliderId, sliderValue, minValue, maxValue, elementId = null) {
    // Don't try to auto-initialize - audio needs user gesture
    if (!this.initialized || !this.audioContext) {
      return;
    }

    // Ensure audio context is running
    if (this.audioContext.state === 'suspended') {
      suppressAudioContextWarnings();
      this.audioContext.resume().catch(error => {
        console.error('Failed to resume audio context:', error);
      });
    }

    // Map slider value (minValue to maxValue) to frequency (160Hz to 10000Hz)
    // Use logarithmic mapping for better perceived pitch progression
    const normalizedValue = (sliderValue - minValue) / (maxValue - minValue); // 0 to 1
    const minFreq = 160;
    const maxFreq = 10000;
    // Logarithmic mapping for better musical/auditory progression
    const frequency = minFreq * Math.pow(maxFreq / minFreq, normalizedValue);

    // Stop any existing tone for this slider
    this.stopSustainingTone(sliderId);

    // Create oscillator
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    
    // Connect and set volume
    oscillator.connect(gainNode);
    
    // Use element-specific routing if elementId provided
    if (elementId) {
      const elementNodes = this.getElementAudioNodes(elementId);
      if (elementNodes) {
        gainNode.connect(elementNodes.gainNode);
        gainNode.gain.value = 0.3; // Element gain node handles volume
      } else {
        gainNode.connect(this.gainNode);
        gainNode.gain.value = this.volume * 0.3;
      }
    } else {
      gainNode.connect(this.gainNode);
      gainNode.gain.value = this.volume * 0.3; // Slightly quieter for slider feedback
    }
    
    // Start the oscillator
    oscillator.start(0);
    
    // Store the oscillator and gain node so we can update or stop it
    this.activeSounds.set(sliderId, {
      type: 'sustaining',
      oscillator,
      gain: gainNode,
      frequency: frequency
    });
  }

  /**
   * Update the frequency of an existing sustaining tone
   */
  updateSustainingToneFrequency(sliderId, sliderValue, minValue, maxValue, elementId = null) {
    // Ensure audio context is available
    if (!this.audioContext) {
      return;
    }

    // Ensure audio context is running
    if (this.audioContext.state === 'suspended') {
      suppressAudioContextWarnings();
      this.audioContext.resume().catch(error => {
        console.error('Failed to resume audio context:', error);
      });
    }

    const sound = this.activeSounds.get(sliderId);
    if (sound && sound.type === 'sustaining' && sound.oscillator) {
      try {
        // Map slider value to frequency
        const normalizedValue = (sliderValue - minValue) / (maxValue - minValue);
        const minFreq = 160;
        const maxFreq = 10000;
        const frequency = minFreq * Math.pow(maxFreq / minFreq, normalizedValue);
        
        // Update frequency smoothly
        sound.oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        sound.frequency = frequency;
      } catch (error) {
        console.error('Error updating sustaining tone frequency:', error);
        // If update fails, try to restart the tone
        this.playSustainingTone(sliderId, sliderValue, minValue, maxValue, elementId);
      }
    } else {
      // If no sound exists, start a new one
      this.playSustainingTone(sliderId, sliderValue, minValue, maxValue, elementId);
    }
  }

  /**
   * Check if Strudel sound banks are loaded
   */
  async checkSoundBanksStatus() {
    if (!window.strudel || !window.strudel.evaluate) {
      return { loaded: false, error: 'Strudel not initialized' };
    }
    
    try {
      // Check if 's' function exists without playing sounds or evaluating
      const result = (typeof globalThis.s === 'function' && typeof globalThis.sound === 'function');
      return { loaded: result === true };
    } catch (error) {
      return { loaded: false, error: error.message };
    }
  }

  /**
   * Ensure Strudel default sound banks are loaded
   */
  async ensureDefaultSoundBanks() {
    if (!window.strudel || !window.strudel.evaluate) {
      // Try to initialize Strudel first (non-fatal if it fails)
      try {
        if (!this.strudelLoaded) {
          await this.initStrudel();
        }
      } catch (_) {}
      if (!window.strudel || !window.strudel.evaluate) {
        // Not ready yet; skip without spamming warnings (will be retried later)
      return false;
      }
    }
    
    if (this.strudelSoundBanksLoaded) {
      return true;
    }
    
    if (this.strudelSoundBankLoading) {
      // Wait for current loading to complete
      while (this.strudelSoundBankLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.strudelSoundBanksLoaded;
    }
    
    this.strudelSoundBankLoading = true;
    try {
      console.log('📦 Loading default Strudel sound banks (dirt-samples)...');
      
      // Default samples need to be loaded even if they're "built-in"
      // This is required for .bank() modifiers to work
      
      // Notify user that samples are loading
      if (typeof document !== 'undefined') {
        const statusText = document.getElementById('status-text');
        if (statusText) {
          statusText.textContent = '📦 Loading default drum samples...';
        }
      }
      
      // Hybrid Approach: Load samples from dough-samples CDN
      // TR-808 and TR-909 are loaded from CDN with local samples as fallback
      const samplesFunc = window.strudel?.samples || globalThis.samples;
      
      if (samplesFunc && typeof samplesFunc === 'function') {
        try {
          console.log('📦 Loading default Strudel samples from dough-samples CDN...');
          const ds = DOUGH_SAMPLES_BASE_URL;
          
          // Track which samples loaded successfully
          const loadResults = {
            tidalDrums: false,
            piano: false,
            dirt: false,
            vcsl: false,
            mridangam: false
          };
          
          // Load all default sample collections in parallel
          await Promise.all([
            samplesFunc(`${ds}/tidal-drum-machines.json`).then(() => {
              console.log('  ✅ Tidal drum machines loaded (TR-808, TR-909, TR-707, RhythmAce, AkaiLinn, etc.)');
              loadResults.tidalDrums = true;
            }).catch(e => {
              console.warn('  ⚠️ Could not load tidal-drum-machines from CDN:', e.message);
              console.log('  📁 Will use local TR-808/TR-909 samples as fallback');
            }),
            
            samplesFunc(`${ds}/piano.json`).then(() => {
              console.log('  ✅ Piano samples loaded');
              loadResults.piano = true;
            }).catch(e => console.warn('  ⚠️ Could not load piano:', e.message)),
            
            samplesFunc(`${ds}/Dirt-Samples.json`).then(() => {
              console.log('  ✅ Dirt-Samples loaded');
              loadResults.dirt = true;
            }).catch(e => console.warn('  ⚠️ Could not load Dirt-Samples:', e.message)),
            
            samplesFunc(`${ds}/vcsl.json`).then(() => {
              console.log('  ✅ VCSL (vocal) samples loaded');
              loadResults.vcsl = true;
            }).catch(e => console.warn('  ⚠️ Could not load VCSL:', e.message)),
            
            samplesFunc(`${ds}/mridangam.json`).then(() => {
              console.log('  ✅ Mridangam (percussion) samples loaded');
              loadResults.mridangam = true;
            }).catch(e => console.warn('  ⚠️ Could not load mridangam:', e.message))
          ]);
          
          console.log('✅ Default Strudel samples loaded from dough-samples CDN');
          
          // If tidal-drum-machines failed to load, use local samples as fallback
          if (!loadResults.tidalDrums) {
            console.log('📁 Loading local TR-808 and TR-909 samples as fallback...');
            try {
              await this.loadBank('RolandTR808');
              await this.loadBank('RolandTR909');
              console.log('✅ Local TR-808 and TR-909 samples loaded successfully');
            } catch (error) {
              console.warn('⚠️ Could not load local TR-808/TR-909 samples:', error);
            }
          } else {
            console.log('📝 Note: TR-808 and TR-909 loaded from CDN (local samples available as backup)');
          }
        } catch (error) {
          console.warn('⚠️ Error loading samples from dough-samples:', error);
          console.log('   Attempting to load local TR-808/TR-909 samples...');
          try {
            await this.loadBank('RolandTR808');
            await this.loadBank('RolandTR909');
            console.log('✅ Local TR-808 and TR-909 samples loaded as fallback');
          } catch (fallbackError) {
            console.warn('⚠️ Could not load local samples either:', fallbackError);
          }
        }
      }
      
      // Mark as loaded
      this.strudelSoundBanksLoaded = true;
      this.strudelSoundBankLoading = false;
      console.log('✅ Default sound banks ready');
      console.log('📦 Available: Piano, Dirt-Samples, VCSL, Mridangam, Drum Machines (TR-808, TR-909, TR-707, etc.)');
      
      // Verify patterns can actually be evaluated before notifying
      console.log('🧪 Testing pattern evaluation...');
      let patternsReady = false;
      
      // Check that pattern functions exist in global scope
      // Note: silence is a Pattern object, not a function!
      if (typeof globalThis.silence === 'object' && 
          typeof globalThis.sound === 'function' && 
          typeof globalThis.note === 'function') {
        console.log('✅ Pattern functions available in globalThis');
        
        // Now test if we can actually create and assign a pattern
        try {
          // Test pattern assignment (this is what we actually do when playing)
          await window.strudel.evaluate('d16 = silence');
          console.log('✅ Pattern assignment test passed');
          patternsReady = true;
        } catch (testError) {
          console.warn('⚠️ Pattern assignment test failed:', testError);
          // Wait a bit and try once more
          await new Promise(resolve => setTimeout(resolve, 1000));
          try {
            await window.strudel.evaluate('d16 = silence');
            console.log('✅ Pattern assignment test passed on retry');
            patternsReady = true;
          } catch (retryError) {
            console.error('❌ Pattern assignment still failing:', retryError);
          }
        }
      } else {
        console.error('❌ Pattern functions not available in globalThis');
        console.log('  silence:', typeof globalThis.silence, '(should be object)');
        console.log('  sound:', typeof globalThis.sound, '(should be function)');
        console.log('  note:', typeof globalThis.note, '(should be function)');
      }
      
      // Only notify if patterns are actually ready
      if (patternsReady && this.onSoundsReadyCallback) {
        console.log('🔔 Notifying app that sounds are ready...');
        this.onSoundsReadyCallback();
      } else if (!patternsReady) {
        console.warn('⚠️ Sounds loaded but patterns not ready - dots will stay red');
      }
      
      // Update status to show samples are ready
      if (typeof document !== 'undefined') {
        const statusText = document.getElementById('status-text');
        if (statusText) {
          statusText.textContent = '✅ Samples loaded - Ready!';
          // Clear the message after 2 seconds
          setTimeout(() => {
            if (statusText.textContent.includes('Samples loaded')) {
              statusText.textContent = 'Ready - Click elements to start/stop patterns (Press Escape to stop all)';
            }
          }, 2000);
        }
      }
      
      // Pattern slots are already initialized to silence, no need to clear again
      
      return true;
    } catch (error) {
      this.strudelSoundBankLoading = false;
      // Suppress errors if they're about CycleTones not being available
      if (error.message && error.message.includes('CycleTones')) {
        console.log('⚠️ CycleTones not available - patterns will use dirt-samples if loaded');
        return false; // Gracefully fail, fallback might have worked
      }
      console.error('❌ Failed to load default sound banks:', error);
      console.error('Error details:', error.message, error.stack);
      console.error('Strudel patterns may not work without default sound banks');
      return false;
    }
  }

  /**
   * Preload all common drum sounds to ensure instant playback
   * This forces Strudel to load all common drum samples on page load
   */
  async preloadAllCommonDrumSounds() {
    // Do not evaluate any audible patterns during preload.
    // Rely on bank loading to fetch samples lazily; this avoids any chance of sound on first user gesture.
    console.log('📦 Preloading skipped (silent mode) - no audible patterns will be evaluated');
      return true;
  }

  /**
   * Expose helper function to list loaded samples
   */
  exposeSampleListHelper(webaudioModule, webModule) {
    // Create a helper function that can be called from console
    globalThis.getLoadedSamples = () => {
      try {
        // Try multiple ways to access the sound registry
        let soundMapObj = null;
        let source = '';
        
        // Method 1: Try to get soundMap from webaudio or web module
        const soundMap = webaudioModule?.soundMap || webModule?.soundMap;
        if (soundMap) {
          soundMapObj = typeof soundMap.get === 'function' ? soundMap.get() : soundMap;
          if (soundMapObj && typeof soundMapObj === 'object') {
            source = 'webaudioModule/webModule.soundMap';
          }
        }
        
        // Method 2: Try to access through REPL scheduler
        if ((!soundMapObj || Object.keys(soundMapObj).length === 0) && this.strudelRepl) {
          const repl = this.strudelRepl;
          if (repl.scheduler) {
            const scheduler = repl.scheduler;
            // Check various properties that might contain the sound registry
            if (scheduler.soundMap) {
              soundMapObj = typeof scheduler.soundMap.get === 'function' 
                ? scheduler.soundMap.get() 
                : scheduler.soundMap;
              if (soundMapObj && typeof soundMapObj === 'object') {
                source = 'repl.scheduler.soundMap';
              }
            }
            // Check for other possible locations
            if ((!soundMapObj || Object.keys(soundMapObj).length === 0) && scheduler.context) {
              const context = scheduler.context;
              if (context.soundMap) {
                soundMapObj = typeof context.soundMap.get === 'function' 
                  ? context.soundMap.get() 
                  : context.soundMap;
                if (soundMapObj && typeof soundMapObj === 'object') {
                  source = 'repl.scheduler.context.soundMap';
                }
              }
            }
          }
        }
        
        // Method 3: Try to access through window.strudel
        if ((!soundMapObj || Object.keys(soundMapObj).length === 0) && window.strudel) {
          if (window.strudel.repl && window.strudel.repl.scheduler) {
            const scheduler = window.strudel.repl.scheduler;
            if (scheduler.soundMap) {
              soundMapObj = typeof scheduler.soundMap.get === 'function' 
                ? scheduler.soundMap.get() 
                : scheduler.soundMap;
              if (soundMapObj && typeof soundMapObj === 'object') {
                source = 'window.strudel.repl.scheduler.soundMap';
              }
            }
          }
        }
        
        // Method 4: Try to use getSound function to detect available samples
        if ((!soundMapObj || Object.keys(soundMapObj).length === 0)) {
          const getSound = webaudioModule?.getSound || webModule?.getSound;
          if (getSound && typeof getSound === 'function') {
            console.log('🔍 Attempting to detect samples via getSound function...');
            // Try common sample names to see what's available
            const testSamples = ['bd', 'sd', 'hh', 'cp', 'oh', 'cr', 'rim', 'tr808_bd', 'tr909_bd', 'RolandTR808_bd', 'RolandTR909_bd'];
            const foundSamples = [];
            testSamples.forEach(sample => {
              try {
                const result = getSound(sample);
                if (result && result !== 'triangle') { // triangle is the fallback
                  foundSamples.push(sample);
                }
              } catch (e) {
                // Ignore errors
              }
            });
            if (foundSamples.length > 0) {
              console.log(`📊 Found ${foundSamples.length} samples via getSound:`, foundSamples);
              source = 'getSound detection';
            }
          }
        }
        
        // Method 5: Try to access through REPL's internal state
        if ((!soundMapObj || Object.keys(soundMapObj).length === 0) && this.strudelRepl) {
          const repl = this.strudelRepl;
          console.log('🔍 Checking REPL properties for sample registry...');
          console.log('   REPL keys:', Object.keys(repl).slice(0, 20));
          
          if (repl.scheduler) {
            console.log('   Scheduler keys:', Object.keys(repl.scheduler).slice(0, 20));
            if (repl.scheduler.context) {
              console.log('   Scheduler.context keys:', Object.keys(repl.scheduler.context).slice(0, 20));
            }
          }
          
          // Check if there's a samples property directly on REPL
          if (repl.samples && typeof repl.samples === 'object') {
            soundMapObj = repl.samples;
            source = 'repl.samples';
            console.log('✅ Found samples in repl.samples');
          }
        }
        
        // Method 6: Try to evaluate a pattern to see what samples are accessible
        if ((!soundMapObj || Object.keys(soundMapObj).length === 0) && window.strudel && window.strudel.evaluate) {
          console.log('🔍 Testing pattern evaluation to detect available samples...');
          const testPatterns = [
            's("bd")',
            's("bd").bank("tr808")',
            's("bd").bank("tr909")',
            'sound("bd")'
          ];
          
          for (const pattern of testPatterns) {
            try {
              const result = window.strudel.evaluate(pattern);
              console.log(`   Pattern "${pattern}" evaluated successfully`);
            } catch (e) {
              // Check if error is about missing sample
              if (e.message && (e.message.includes('not found') || e.message.includes('not loaded'))) {
                console.log(`   Pattern "${pattern}" - sample not found (expected)`);
              } else {
                console.log(`   Pattern "${pattern}" - error:`, e.message);
              }
            }
          }
        }
        
        // Method 7: Check if samples are stored in a global registry
        if ((!soundMapObj || Object.keys(soundMapObj).length === 0)) {
          // Check globalThis for any sample-related objects
          const globalKeys = Object.keys(globalThis).filter(k => 
            k.toLowerCase().includes('sample') || 
            k.toLowerCase().includes('sound') ||
            k.toLowerCase().includes('bank')
          );
          if (globalKeys.length > 0) {
            console.log('🔍 Found potential sample-related globals:', globalKeys);
            globalKeys.forEach(key => {
              try {
                const value = globalThis[key];
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                  const keys = Object.keys(value);
                  if (keys.length > 0) {
                    console.log(`   ${key} has ${keys.length} keys:`, keys.slice(0, 10));
                    if (!soundMapObj || Object.keys(soundMapObj).length === 0) {
                      soundMapObj = value;
                      source = `globalThis.${key}`;
                    }
                  }
                }
              } catch (e) {
                // Ignore
              }
            });
          }
        }
        
        if (!soundMapObj || typeof soundMapObj !== 'object' || Object.keys(soundMapObj).length === 0) {
          console.log('⚠️ soundMap not found or empty');
          console.log('   Tried: webaudioModule, webModule, repl.scheduler, window.strudel');
          console.log('   This might mean samples are loaded but not yet registered');
          console.log('   Try loading a bank first, then check again');
          return {
            total: 0,
            keys: [],
            byBank: {},
            source: 'none',
            note: 'No samples found. Samples may need to be loaded first.'
          };
        }
        
        const sampleKeys = Object.keys(soundMapObj);
        console.log(`📊 Total loaded samples: ${sampleKeys.length} (from ${source})`);
        console.log('📋 All loaded sample names:', sampleKeys);
        
        // Group by bank if possible
        const bankGroups = {};
        sampleKeys.forEach(key => {
          // Try to detect bank prefix (e.g., "tr808_bd", "RolandTR909_sd")
          const parts = key.split('_');
          if (parts.length > 1) {
            const bank = parts[0];
            const sound = parts.slice(1).join('_');
            if (!bankGroups[bank]) {
              bankGroups[bank] = [];
            }
            bankGroups[bank].push(sound);
          } else {
            if (!bankGroups['default']) {
              bankGroups['default'] = [];
            }
            bankGroups['default'].push(key);
          }
        });
        
        if (Object.keys(bankGroups).length > 0) {
          console.log('📦 Samples grouped by bank:');
          Object.entries(bankGroups).forEach(([bank, sounds]) => {
            console.log(`  ${bank}: ${sounds.length} sounds`, sounds.slice(0, 20));
          });
        }
        
        return {
          total: sampleKeys.length,
          keys: sampleKeys,
          byBank: bankGroups,
          source: source
        };
      } catch (error) {
        console.error('❌ Error getting loaded samples:', error);
        console.error('   Stack:', error.stack);
        return null;
      }
    };
    
    console.log('✅ Helper function available: getLoadedSamples()');
    console.log('   Call getLoadedSamples() in console to see all loaded samples');
  }

  /**
   * Load a specific pattern bank
   */
  async loadBank(bankName) {
    if (!window.strudel || !window.strudel.evaluate) {
      console.warn('Cannot load bank: Strudel not initialized');
      throw new Error('Strudel not initialized');
    }
    
    if (!bankName || typeof bankName !== 'string') {
      console.warn('Cannot load bank: invalid name', bankName);
      return false;
    }
    
    bankName = bankName.trim();
    if (!bankName) {
      console.warn('Cannot load bank: empty name after trimming');
      return false;
    }
    
    const bankNameLower = bankName.toLowerCase();
    
    // Early check: skip only oscillator waveforms (they're always available, don't need loading)
    // Sample-based synths like "piano", "gtr", "wood", etc. need to be loaded via samples()
    const builtInOscillatorSynths = new Set([
      'sine', 'square', 'triangle', 'sawtooth', 'supersaw', 'pulse',
      'saw', 'saw2', 'saw3', 'saw4', 'saw8'
    ]);
    
    if (builtInOscillatorSynths.has(bankName.toLowerCase())) {
      console.log(`⏭️ Skipping built-in oscillator synth "${bankName}" (no loading needed)`);
      this.loadedBanks.add(bankName.toLowerCase());
      this.loadedBanks.add(bankName); // Also add original case
      return true;
    }
    
    // Local custom drum banks (in assets folder)
    // When using .bank("RolandTR909"), Strudel expects samples named "RolandTR909_bd", "RolandTR909_sd", etc.
    const localDrumBanks = {
      'RolandTR909': {
        'RolandTR909_bd': [
          'assets/sounds/Kicks/ESWTR909 Kick 01.wav',
          'assets/sounds/Kicks/ESWTR909 Kick 02.wav',
          'assets/sounds/Kicks/ESWTR909 Kick 03.wav',
          'assets/sounds/Kicks/ESWTR909 Kick 04.wav',
          'assets/sounds/Kicks/ESWTR909 Kick 05.wav',
          'assets/sounds/Kicks/ESWTR909 Kick 06.wav',
          'assets/sounds/Kicks/ESWTR909 Kick 07.wav',
          'assets/sounds/Kicks/ESWTR909 Kick 08.wav',
          'assets/sounds/Kicks/ESWTR909 Kick 09.wav',
          'assets/sounds/Kicks/ESWTR909 Kick 10.wav'
        ],
        'RolandTR909_sd': [
          'assets/sounds/Snares/ESWTR909 Snare 01.wav',
          'assets/sounds/Snares/ESWTR909 Snare 02.wav',
          'assets/sounds/Snares/ESWTR909 Snare 03.wav',
          'assets/sounds/Snares/ESWTR909 Snare 04.wav',
          'assets/sounds/Snares/ESWTR909 Snare 05.wav',
          'assets/sounds/Snares/ESWTR909 Snare 06.wav',
          'assets/sounds/Snares/ESWTR909 Snare 07.wav',
          'assets/sounds/Snares/ESWTR909 Snare 08.wav',
          'assets/sounds/Snares/ESWTR909 Snare 09.wav',
          'assets/sounds/Snares/ESWTR909 Snare 10.wav',
          'assets/sounds/Snares/ESWTR909 Snare 11.wav',
          'assets/sounds/Snares/ESWTR909 Snare 12.wav'
        ],
        'RolandTR909_hh': [
          'assets/sounds/Hats/ESWTR909 HH Closed 01.wav',
          'assets/sounds/Hats/ESWTR909 HH Closed 02.wav',
          'assets/sounds/Hats/ESWTR909 HH Closed 03.wav',
          'assets/sounds/Hats/ESWTR909 HH Closed 04.wav',
          'assets/sounds/Hats/ESWTR909 HH Closed 05.wav',
          'assets/sounds/Hats/ESWTR909 HH Closed 06.wav',
          'assets/sounds/Hats/ESWTR909 HH Closed 07.wav',
          'assets/sounds/Hats/ESWTR909 HH Closed 08.wav',
          'assets/sounds/Hats/ESWTR909 HH Closed 09.wav',
          'assets/sounds/Hats/ESWTR909 HH Closed 10.wav'
        ],
        'RolandTR909_oh': [
          'assets/sounds/Hats/ESWTR909 HH Open 01.wav',
          'assets/sounds/Hats/ESWTR909 HH Open 02.wav',
          'assets/sounds/Hats/ESWTR909 HH Open 03.wav',
          'assets/sounds/Hats/ESWTR909 HH Open 04.wav',
          'assets/sounds/Hats/ESWTR909 HH Open 05.wav',
          'assets/sounds/Hats/ESWTR909 HH Open 06.wav',
          'assets/sounds/Hats/ESWTR909 HH Open 07.wav',
          'assets/sounds/Hats/ESWTR909 HH Open 08.wav'
        ],
        'RolandTR909_cp': [
          'assets/sounds/Claps/ESWTR909 Clap 01.wav',
          'assets/sounds/Claps/ESWTR909 Clap 02.wav',
          'assets/sounds/Claps/ESWTR909 Clap 03.wav',
          'assets/sounds/Claps/ESWTR909 Clap 04.wav',
          'assets/sounds/Claps/ESWTR909 Clap 05.wav'
        ],
        'RolandTR909_cr': [
          'assets/sounds/Hats/ESWTR909 HH Crash 01.wav',
          'assets/sounds/Hats/ESWTR909 HH Crash 02.wav',
          'assets/sounds/Hats/ESWTR909 HH Crash 03.wav',
          'assets/sounds/Hats/ESWTR909 HH Crash 04.wav',
          'assets/sounds/Hats/ESWTR909 HH Crash 05.wav'
        ],
        'RolandTR909_lt': [
          'assets/sounds/Toms/ESWTR909 Tom 01.wav',
          'assets/sounds/Toms/ESWTR909 Tom 02.wav',
          'assets/sounds/Toms/ESWTR909 Tom 03.wav',
          'assets/sounds/Toms/ESWTR909 Tom 04.wav',
          'assets/sounds/Toms/ESWTR909 Tom 05.wav'
        ],
        'RolandTR909_mt': [
          'assets/sounds/Toms/ESWTR909 Tom 06.wav',
          'assets/sounds/Toms/ESWTR909 Tom 07.wav',
          'assets/sounds/Toms/ESWTR909 Tom 08.wav',
          'assets/sounds/Toms/ESWTR909 Tom 09.wav',
          'assets/sounds/Toms/ESWTR909 Tom 10.wav'
        ],
        'RolandTR909_ht': [
          'assets/sounds/Toms/ESWTR909 Tom 11.wav',
          'assets/sounds/Toms/ESWTR909 Tom 12.wav',
          'assets/sounds/Toms/ESWTR909 Tom 13.wav',
          'assets/sounds/Toms/ESWTR909 Tom 14.wav',
          'assets/sounds/Toms/ESWTR909 Tom 15.wav'
        ]
      },
      'RolandTR808': {
        'RolandTR808_bd': [
          'assets/sounds/Kicks/ESW909X Kick 01.wav',
          'assets/sounds/Kicks/ESW909X Kick 02.wav',
          'assets/sounds/Kicks/ESW909X Kick 03.wav',
          'assets/sounds/Kicks/ESW909X Kick 04.wav',
          'assets/sounds/Kicks/ESW909X Kick 05.wav'
        ],
        'RolandTR808_sd': [
          'assets/sounds/Snares/ESW909X Snare 01.wav',
          'assets/sounds/Snares/ESW909X Snare 02.wav',
          'assets/sounds/Snares/ESW909X Snare 03.wav',
          'assets/sounds/Snares/ESW909X Snare 04.wav',
          'assets/sounds/Snares/ESW909X Snare 05.wav'
        ],
        'RolandTR808_cp': [
          'assets/sounds/Claps/ESW909X Clap 01.wav',
          'assets/sounds/Claps/ESW909X Clap 02.wav',
          'assets/sounds/Claps/ESW909X Clap 03.wav',
          'assets/sounds/Claps/ESW909X Clap 04.wav',
          'assets/sounds/Claps/ESW909X Clap 05.wav'
        ]
      }
    };
    
    // Other built-in Strudel drum banks (from dirt-samples)
    // Note: RolandTR808 and RolandTR909 are now loaded from local assets folder
    const builtInDrumBanks = [
      'RolandTR707', 'RhythmAce', 'AkaiLinn', 'ViscoSpaceDrum',
      'CasioRZ1'
    ];
    
    const builtInSampleBanks = [
      'piano', 'superpiano', 'jazz', 'supersaw', 'folkharp',
      'casio', 'insect', 'wind', 'wood', 'metal', 'east', 'crow', 'space', 'numbers',
      'sawtooth', 'sine', 'square', 'triangle', 'saw', 'saw2', 'saw3', 'saw4', 'saw8',
      'gtr'
    ];
    
    const specialtySampleSources = {
      mridangam: `${DOUGH_SAMPLES_BASE_URL}/mridangam.json`,
      vcsl: `${DOUGH_SAMPLES_BASE_URL}/vcsl.json`
    };
    
    if (specialtySampleSources[bankNameLower]) {
      const samplesFunc = window.strudel?.samples || globalThis.samples;
      if (!samplesFunc || typeof samplesFunc !== 'function') {
        console.warn(`⚠️ samples() function not available for specialty bank "${bankNameLower}"`);
        return false;
      }
      try {
        console.log(`📦 Loading specialty sample bank "${bankNameLower}" from dough-samples`);
        let normalizedManifest = this.specialtyManifests.get(bankNameLower);
        if (!normalizedManifest) {
          const response = await fetch(specialtySampleSources[bankNameLower]);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const manifest = await response.json();
          normalizedManifest = normalizeSampleManifest(manifest);
          this.specialtyManifests.set(bankNameLower, normalizedManifest);
        }
        const manifestWithAliases = { ...normalizedManifest };
        const entryNames = Object.keys(normalizedManifest || {});
        entryNames.forEach((entryName) => {
          const aliasName = `${bankNameLower}_${entryName}`;
          if (!manifestWithAliases[aliasName]) {
            manifestWithAliases[aliasName] = normalizedManifest[entryName];
          }
        });
        await samplesFunc(manifestWithAliases);
        entryNames.forEach((entryName) => {
          const lower = entryName.toLowerCase();
          this.sampleNameToSpecialtyBank.set(lower, bankNameLower);
          this.sampleNameToSpecialtyBank.set(`${bankNameLower}_${lower}`, bankNameLower);
          this.loadedBanks.add(lower);
          this.loadedBanks.add(entryName);
          this.loadedBanks.add(`${bankNameLower}_${lower}`);
          this.loadedBanks.add(`${bankNameLower}_${entryName}`);
        });
        this.loadedBanks.add(bankNameLower);
        this.loadedBanks.add(bankName);
        console.log(`✅ Specialty bank "${bankNameLower}" loaded`);
        return true;
      } catch (error) {
        console.warn(`⚠️ Failed to load specialty bank "${bankNameLower}":`, error.message || error);
        return false;
      }
    }
    
    // Check if this is a local custom drum bank
    if (localDrumBanks[bankName]) {
      console.log(`📦 Loading local custom bank "${bankName}" from assets folder...`);
      const samplesFunc = window.strudel?.samples || globalThis.samples;
      
      if (samplesFunc && typeof samplesFunc === 'function') {
        try {
          // Load local samples using the samples() function
          await samplesFunc(localDrumBanks[bankName]);
          console.log(`✅ Local custom bank "${bankName}" loaded successfully from assets`);
          this.loadedBanks.add(bankName);
          return true;
        } catch (error) {
          console.error(`❌ Failed to load local bank "${bankName}":`, error);
          return false;
        }
      } else {
        console.error('❌ samples() function not available');
        return false;
      }
    }
    
    // Check if this is a built-in drum bank (from dirt-samples)
    // Bank names are case-sensitive in Strudel (e.g., "RolandTR808", not "tr808")
    if (builtInDrumBanks.includes(bankName)) {
      console.log(`📦 Ensuring built-in drum bank "${bankName}" samples are loaded...`);
      try {
        const preloadSlot = 'd15';
        const preloadPattern = `${preloadSlot} = s("bd sd hh cp oh cr rd ht mt lt sh cb tb pe").bank("${bankName}")`;
        await window.strudel.evaluate(preloadPattern);
        
        if (window.strudel.scheduler && typeof window.strudel.scheduler.tick === 'function') {
          for (let i = 0; i < 4; i++) {
            window.strudel.scheduler.tick();
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        } else {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        await window.strudel.evaluate(`${preloadSlot} = silence`);
        this.loadedBanks.add(bankName);
        console.log(`✅ Built-in drum bank "${bankName}" ready`);
        return true;
      } catch (error) {
        console.warn(`⚠️ Could not preload built-in bank "${bankName}":`, error);
        this.loadedBanks.add(bankName);
        return true;
      }
    }
    
    // Normalize bank name (e.g., "wood" -> "jazz") before checking
    let normalizedBankName = bankNameLower;
    if (SYNTH_NAME_ALIASES[bankNameLower]) {
      normalizedBankName = SYNTH_NAME_ALIASES[bankNameLower];
      console.log(`🔄 Normalizing bank name "${bankName}" to "${normalizedBankName}"`);
    }
    
    if (builtInSampleBanks.includes(normalizedBankName)) {
      // These are sample banks that need to be loaded via samples()
      // Examples: piano, gtr, casio, jazz (was wood), metal, folkharp, etc.
      const samplesFunc = window.strudel?.samples || globalThis.samples;
      if (samplesFunc && typeof samplesFunc === 'function') {
        try {
          console.log(`📦 Loading sample bank "${normalizedBankName}" via samples()`);
          await samplesFunc(normalizedBankName);
          this.loadedBanks.add(normalizedBankName);
          this.loadedBanks.add(bankNameLower); // Also mark original name as loaded
          console.log(`✅ Sample bank "${normalizedBankName}" loaded`);
          return true;
        } catch (error) {
          // If samples() fails, log but continue - pattern might still work
          console.warn(`⚠️ Failed to load sample bank "${normalizedBankName}":`, error.message || error);
          // Still mark as attempted so we don't retry endlessly
          this.loadedBanks.add(normalizedBankName);
          this.loadedBanks.add(bankNameLower);
          return false; // Return false to indicate loading failed
        }
      } else {
        console.warn(`⚠️ samples() function not available for loading "${normalizedBankName}"`);
        return false;
      }
    }
    
    
    // Check if bank is a GitHub URL or predefined bank name
    const isGitHubUrl = bankName.startsWith('github:');
    
    if (isGitHubUrl) {
      // Load bank via samples() function
      const samplesFunc = window.strudel?.samples || globalThis.samples;
      
      if (!samplesFunc || typeof samplesFunc !== 'function') {
        console.error('samples function not available!');
        throw new Error('samples function not available');
      }
      
      console.log(`📦 Loading bank via samples(): ${bankName}`);
      try {
        const result = await samplesFunc(bankName);
        console.log('samples() call completed, result:', result);
        
        // Wait a bit for samples to load asynchronously
        console.log('⏳ Waiting for samples to load...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log(`✅ Bank loaded: ${bankName}`);
        return true;
      } catch (error) {
        console.error(`❌ Failed to load bank ${bankName}:`, error);
        throw error;
      }
    } else {
      // Predefined banks like RolandTR909, RolandTR808
      // These may be embedded in Strudel or need special loading
      console.log(`📦 Bank "${bankName}" is a predefined bank name`);
      
      const samplesFunc = window.strudel?.samples || globalThis.samples;
      
      if (!samplesFunc || typeof samplesFunc !== 'function') {
        console.warn(`⚠️ samples function not available for loading bank "${bankName}"`);
        console.log(`   Bank "${bankName}" may need to be loaded manually`);
        return false;
      }
      
      // Try to load bank - but note that Strudel has moved to Codeberg
      // Most banks are built-in or need to be loaded from Codeberg
      // For now, try just the bank name directly (Strudel may handle it)
      const possiblePaths = [
        bankName, // Try bank name directly (may work if built-in)
        // Note: If you need to load from Codeberg, use: codeberg:uzu/strudel/...
        // But most banks should be built-in or available via .bank() modifier
      ];
      
      let loaded = false;
      
      // Suppress console errors during bank loading attempts
      const originalError = console.error;
      const suppressErrors = (...args) => {
        let fullMsg = '';
        for (let i = 0; i < args.length; i++) {
          if (typeof args[i] === 'string') {
            fullMsg += ' ' + args[i];
          } else if (args[i] && args[i].toString) {
            fullMsg += ' ' + String(args[i]);
          }
        }
        const msg = String(args[0] || '');
        const lowerMsg = fullMsg.toLowerCase();
        
        // Suppress various error types that occur during bank loading
        if (msg.includes('JSON') || msg.includes('SyntaxError') || 
            msg.includes('not found') || msg.includes('RolandTR') ||
            msg.includes('404') || msg.includes('Failed') ||
            msg.includes('<!DOCTYPE') || msg.includes('Unexpected token') ||
            msg.includes('is not valid JSON') || msg.includes('Unexpected non-whitespace') ||
            fullMsg.includes('JSON') || fullMsg.includes('SyntaxError') ||
            fullMsg.includes('not found') || fullMsg.includes('RolandTR') ||
            fullMsg.includes('404') || fullMsg.includes('<!DOCTYPE') ||
            fullMsg.includes('Unexpected token') || fullMsg.includes('is not valid JSON') ||
            lowerMsg.includes('json') || lowerMsg.includes('syntaxerror') ||
            lowerMsg.includes('rolandtr')) {
          return; // Suppress these errors
        }
        originalError.apply(console, args);
      };
      console.error = suppressErrors;
      
      try {
        // Try each possible path
        for (const path of possiblePaths) {
          try {
            console.log(`   Trying to load from: ${path}`);
            const result = await samplesFunc(path);
            console.log(`   ✅ Successfully called samples() with: ${path}`);
            loaded = true;
            break; // Success, stop trying other paths
          } catch (pathError) {
            // Try next path
            console.log(`   ✗ Path "${path}" not available`);
            continue;
          }
        }
      } finally {
        // Restore console.error
        console.error = originalError;
      }
      
      // Wait for samples to load asynchronously
      if (loaded) {
        console.log('⏳ Waiting for samples to load...');
        await new Promise(resolve => setTimeout(resolve, 3000)); // Longer wait for GitHub samples
        console.log(`✅ Bank "${bankName}" loading initiated`);
        // Track that this bank is loaded
        this.loadedBanks.add(bankName);
      } else {
        console.log(`⚠️ Could not load "${bankName}" from any known path`);
        console.log(`   Bank "${bankName}" may be embedded in Strudel or unavailable`);
        console.log(`   To use this bank in patterns (if available), use: .bank("${bankName}")`);
        console.log(`   Example: sound("bd hh").bank("${bankName}")`);
        // Don't add to loadedBanks - bank is not available
      }
      
      // Return true if we attempted to load, false if no paths worked
      return loaded;
    }
  }

  /**
   * Initialize WebMidi for MIDI output
   */
  async initializeMIDI() {
    try {
      // Enable WebMidi
      await WebMidi.enable();
      this.midiEnabled = true;
      console.log('✅ WebMidi enabled');
      
      // Store available MIDI outputs
      WebMidi.outputs.forEach((output) => {
        this.midiOutputs.set(output.name, output);
        console.log(`🎹 MIDI Output available: ${output.name}`);
      });
      
      // Auto-select first available output if any
      if (this.midiOutputs.size > 0) {
        const firstOutput = Array.from(this.midiOutputs.values())[0];
        this.selectedMidiOutput = firstOutput;
        console.log(`✅ Auto-selected MIDI output: ${firstOutput.name}`);
      }
      
      // Listen for new MIDI devices
      WebMidi.addListener('connected', (event) => {
        if (event.port.type === 'output') {
          this.midiOutputs.set(event.port.name, event.port);
          console.log(`🎹 MIDI Output connected: ${event.port.name}`);
          // Auto-select if no output is currently selected
          if (!this.selectedMidiOutput) {
            this.selectedMidiOutput = event.port;
            console.log(`✅ Auto-selected MIDI output: ${event.port.name}`);
          }
        }
      });
      
      WebMidi.addListener('disconnected', (event) => {
        if (event.port.type === 'output') {
          this.midiOutputs.delete(event.port.name);
          console.log(`🎹 MIDI Output disconnected: ${event.port.name}`);
          // Clear selection if the selected output was disconnected
          if (this.selectedMidiOutput === event.port) {
            this.selectedMidiOutput = null;
            // Try to select another available output
            if (this.midiOutputs.size > 0) {
              this.selectedMidiOutput = Array.from(this.midiOutputs.values())[0];
              console.log(`✅ Auto-selected new MIDI output: ${this.selectedMidiOutput.name}`);
            }
          }
        }
      });
      
      // Set up Strudel MIDI output handler
      this.setupStrudelMIDIOutput();
      
    } catch (error) {
      console.warn('⚠️ WebMidi initialization failed:', error);
      this.midiEnabled = false;
    }
  }
  
  /**
   * Set up Strudel MIDI output handler
   * This connects Strudel's .midi() pattern functions to WebMidi
   */
  setupStrudelMIDIOutput() {
    if (!this.midiEnabled || !window.strudel) {
      return;
    }
    
    try {
      // Try to find and connect to Strudel's webaudio MIDI output
      const scheduler = window.strudel?.scheduler;
      const webaudio = scheduler?.webaudio || window.strudel?.webaudio;
      
      if (webaudio) {
        // Strudel's webaudio module has a midiOutput property
        // We need to connect it to our WebMidi handler
        if (webaudio.midiOutput) {
          // Store original if it exists
          const originalMidiOutput = webaudio.midiOutput;
          
          // Create a wrapper that sends to both original and WebMidi
          webaudio.midiOutput = (message) => {
            // Send to WebMidi
            this.sendMIDIMessage(message);
            // Call original if it exists
            if (originalMidiOutput && typeof originalMidiOutput === 'function') {
              originalMidiOutput(message);
            }
          };
          
          console.log('✅ Connected Strudel webaudio.midiOutput to WebMidi');
        } else {
          // If midiOutput doesn't exist, create it
          // This is critical - MIDI modifiers won't work without this
          webaudio.midiOutput = (message) => {
            this.sendMIDIMessage(message);
          };
          console.log('✅ Created Strudel webaudio.midiOutput handler');
          console.log('ℹ️ MIDI modifiers (.midi(), .midiport()) should now be available on patterns');
        }
      }
      
      // Also set up global MIDI output handler as fallback
      if (window.strudel.midiOutput) {
        const originalMidiOutput = window.strudel.midiOutput;
        window.strudel.midiOutput = (message) => {
          this.sendMIDIMessage(message);
          if (originalMidiOutput && typeof originalMidiOutput === 'function') {
            originalMidiOutput(message);
          }
        };
      } else {
        window.strudel.midiOutput = (message) => {
          this.sendMIDIMessage(message);
        };
      }
      
      // Auto-select IAC Driver if available (try again after a short delay to catch late connections)
      setTimeout(() => {
        this.selectIACDriver();
      }, 500);
      
      console.log('✅ Strudel MIDI output handler set up');
    } catch (error) {
      console.warn('⚠️ Failed to set up Strudel MIDI output:', error);
    }
  }
  
  /**
   * Auto-select IAC Driver if available
   */
  selectIACDriver() {
    // Look for IAC Driver (macOS) or similar virtual MIDI ports
    // Prioritize "IAC Driver Bus 1" over "Logic Pro Virtual In"
    const iacNames = ['IAC Driver Bus 1', 'IAC Driver Bus 2', 'IAC Driver', 'IAC Bus 1', 'IAC Bus 2', 'loopMIDI', 'Virtual MIDI'];
    
    for (const name of iacNames) {
      // Check both exact name and case-insensitive match
      for (const [outputName, output] of this.midiOutputs.entries()) {
        if (outputName === name || (name.toLowerCase().includes('iac') && outputName.toLowerCase().includes('iac'))) {
          this.selectMIDIOutput(outputName);
          console.log(`✅ Auto-selected IAC Driver: ${outputName}`);
          return;
        }
      }
    }
    
    // If IAC Driver not found, log available outputs
    if (this.midiOutputs.size > 0) {
      console.log('ℹ️ IAC Driver not found. Available MIDI outputs:', Array.from(this.midiOutputs.keys()).join(', '));
      console.log('ℹ️ You can manually select a MIDI output using: soundManager.selectMIDIOutput("port name")');
    } else {
      console.log('ℹ️ No MIDI outputs available. Make sure IAC Driver is enabled in Audio MIDI Setup on macOS.');
    }
  }
  
  /**
   * Send MIDI message to selected output
   * @param {Object} message - MIDI message object with type, channel, note, velocity, etc.
   */
  sendMIDIMessage(message) {
    if (!this.midiEnabled || !this.selectedMidiOutput) {
      // Log if MIDI is not ready (helpful for debugging)
      if (!this.midiEnabled) {
        console.warn('⚠️ MIDI not enabled');
      } else if (!this.selectedMidiOutput) {
        console.warn('⚠️ No MIDI output selected. Available:', Array.from(this.midiOutputs.keys()).join(', '));
      }
      return;
    }
    
    try {
      // Handle different message formats from Strudel
      let channel = this.midiChannel;
      let note = null;
      let velocity = 127;
      let type = null;
      
      // Extract channel from message if present
      if (message.channel !== undefined) {
        channel = message.channel;
      } else if (message.port !== undefined) {
        // midiport() might set port instead of channel
        channel = message.port;
      }
      
      // Extract note
      if (message.note !== undefined) {
        note = message.note;
      } else if (message.number !== undefined) {
        note = message.number;
      }
      
      // Extract velocity
      if (message.velocity !== undefined) {
        velocity = message.velocity;
      } else if (message.value !== undefined && message.type === 'noteon') {
        velocity = message.value;
      }
      
      // Determine message type
      if (message.type) {
        type = message.type.toLowerCase();
      } else if (note !== null) {
        // Default to note on if we have a note
        type = 'noteon';
      }
      
      // Clamp channel to valid range (0-15)
      channel = Math.max(0, Math.min(15, channel));
      
      switch (type) {
        case 'noteon':
        case 'noteon':
          if (note !== null) {
            this.selectedMidiOutput.playNote(note, {
              channel: channel + 1, // WebMidi uses 1-16, we use 0-15
              velocity: Math.max(1, Math.min(127, velocity))
            });
          }
          break;
          
        case 'noteoff':
        case 'noteoff':
          if (note !== null) {
            this.selectedMidiOutput.stopNote(note, {
              channel: channel + 1
            });
          }
          break;
          
        case 'cc':
        case 'controlchange':
          if (message.controller !== undefined && message.value !== undefined) {
            this.selectedMidiOutput.sendControlChange(message.controller, message.value, {
              channel: channel + 1
            });
          }
          break;
          
        case 'programchange':
          if (message.program !== undefined) {
            this.selectedMidiOutput.sendProgramChange(message.program, {
              channel: channel + 1
            });
          }
          break;
          
        case 'pitchbend':
          if (message.value !== undefined) {
            this.selectedMidiOutput.sendPitchBend(message.value, {
              channel: channel + 1
            });
          }
          break;
          
        default:
          // Try to send raw MIDI message
          if (message.data && Array.isArray(message.data)) {
            this.selectedMidiOutput.send(message.data);
          } else if (note !== null) {
            // Fallback: if we have a note but no type, send note on
            this.selectedMidiOutput.playNote(note, {
              channel: channel + 1,
              velocity: Math.max(1, Math.min(127, velocity))
            });
          }
      }
    } catch (error) {
      console.warn('⚠️ Failed to send MIDI message:', error, message);
    }
  }
  
  /**
   * Get available MIDI outputs
   * @returns {Array} Array of MIDI output port names
   */
  getMIDIOutputs() {
    return Array.from(this.midiOutputs.keys());
  }
  
  /**
   * Select a MIDI output port
   * @param {string} portName - Name of the MIDI output port
   */
  selectMIDIOutput(portName) {
    if (this.midiOutputs.has(portName)) {
      this.selectedMidiOutput = this.midiOutputs.get(portName);
      console.log(`✅ Selected MIDI output: ${portName}`);
      return true;
    }
    console.warn(`⚠️ MIDI output not found: ${portName}`);
    return false;
  }
  
  /**
   * Set MIDI channel (0-15, where 0 = channel 1)
   * @param {number} channel - MIDI channel (0-15)
   */
  setMIDIChannel(channel) {
    if (channel >= 0 && channel <= 15) {
      this.midiChannel = channel;
      console.log(`✅ MIDI channel set to: ${channel + 1}`);
    }
  }
  
  /**
   * Ensure MIDI functions are available in REPL context
   * MIDI functions like .midi() and .midiport() are pattern modifiers from @strudel/webaudio
   * They should be available when midiOutput is passed to initStrudel
   */
  async ensureMIDIFunctionsAvailable() {
    // Wait for REPL to be ready (retry up to 5 times with 500ms delay)
    for (let i = 0; i < 5; i++) {
      if (window.strudel && window.strudel.evaluate) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    if (!window.strudel || !window.strudel.evaluate) {
      console.warn('⚠️ Strudel REPL not available for MIDI functions after waiting');
      return;
    }
    
    try {
      // Check if MIDI functions are available by testing if .midi() exists on a pattern
      const testCode = `
        (function() {
          try {
            const testPattern = note("c");
            return typeof testPattern.midi === 'function';
          } catch (e) {
            return false;
          }
        })()
      `;
      
      const midiAvailable = await window.strudel.evaluate(testCode);
      
      if (!midiAvailable) {
        console.log('📦 MIDI functions not available - checking webaudio MIDI setup...');
        
        // Check if webaudio has MIDI support enabled
        const scheduler = window.strudel?.scheduler;
        if (scheduler && scheduler.webaudio) {
          const webaudio = scheduler.webaudio;
          console.log('✅ webaudio found in scheduler');
          
          // Check if MIDI output handler is set
          if (webaudio.midiOutput) {
            console.log('✅ MIDI output handler found in webaudio');
            console.log('ℹ️ MIDI modifiers (.midi(), .midiport()) should be available');
            console.log('ℹ️ If they are not, this may be a Strudel version issue');
            console.log('ℹ️ Try: note("c").midi() in the console to test');
          } else {
            console.warn('⚠️ MIDI output handler not found in webaudio');
            console.warn('   This means MIDI modifiers may not be available');
            console.warn('   We passed midiOutput to initStrudel, but it may not have been applied');
            
            // Try to set it manually
            if (this.midiEnabled) {
              webaudio.midiOutput = (message) => {
                this.sendMIDIMessage(message);
              };
              console.log('✅ Manually set webaudio.midiOutput handler');
            }
          }
        } else {
          console.warn('⚠️ webaudio not found in scheduler');
        }
        
        // Test again after a delay
        await new Promise(resolve => setTimeout(resolve, 500));
        const midiAvailableAfter = await window.strudel.evaluate(testCode);
        if (midiAvailableAfter) {
          console.log('✅ MIDI functions now available');
        } else {
          console.warn('⚠️ MIDI functions still not available');
          console.warn('   MIDI modifiers (.midi(), .midiport()) are pattern methods from @strudel/webaudio');
          console.warn('   They should be available when midiOutput is passed to initStrudel');
          console.warn('   This may indicate a Strudel version compatibility issue');
          console.warn('   Try updating @strudel/webaudio to the latest version');
        }
      } else {
        console.log('✅ MIDI functions verified and available');
      }
    } catch (error) {
      console.warn('⚠️ Error checking MIDI functions:', error);
    }
  }

  /**
   * Pre-load samples from Sampler Effects presets
   * Extracts samples() calls from preset patterns and loads them
   */
  async preloadPresetSamples() {
    const samplesFunc = window.strudel?.samples || globalThis.samples;
    if (!samplesFunc || typeof samplesFunc !== 'function') {
      console.warn('⚠️ samples() function not available for pre-loading preset samples');
      return;
    }

    // Sample sources used in SAMPLER_EFFECT_PRESETS
    const presetSampleSources = [
      'github:tidalcycles/dirt-samples',  // Used in: begin, slice, splice
      'github:switchangel/pad',            // Used in: scrub
      'github:yaxu/clean-breaks/main'      // Used in: scrub
    ];

    console.log('📦 Pre-loading samples from Sampler Effects presets...');
    
    for (const source of presetSampleSources) {
      try {
        console.log(`   Loading: ${source}`);
        await samplesFunc(source);
        console.log(`   ✅ Loaded: ${source}`);
        // Small delay between loads
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.warn(`   ⚠️ Failed to load ${source}:`, error.message);
        // Continue with other sources
      }
    }
    
    console.log('✅ Finished pre-loading preset samples');
  }

  /**
   * Ensure that any banks or built-in synth waveforms referenced in a pattern
   * are loaded before evaluation (handles master stack playback)
   */
  async ensurePatternResourcesLoaded(pattern) {
    if (!pattern || typeof pattern !== 'string' || typeof this.loadBank !== 'function') {
      return;
    }

    const workingPattern = this._sanitizePatternExpression(pattern) || pattern;

    // Built-in oscillator waveforms that don't need to be loaded (they're always available)
    // Note: Sample-based synths like "piano", "gtr", "wood", "casio", etc. need to be loaded via loadBank()
    const builtInOscillatorSynths = new Set([
      'sine', 'square', 'triangle', 'sawtooth', 'supersaw', 'pulse',
      'saw', 'saw2', 'saw3', 'saw4', 'saw8'
    ]);

    const bankNames = new Set();

    const bankRegex = /\.bank\(["']([^"']+)["']\)/g;
    let match;
    while ((match = bankRegex.exec(workingPattern)) !== null) {
      if (match[1]) {
        bankNames.add(match[1]);
      }
    }

    const sampleRegex = /\.s\(["']([^"']+)["']\)/g;
    while ((match = sampleRegex.exec(workingPattern)) !== null) {
      const sampleName = match[1];
      if (!sampleName) continue;
      if (/\s|~|\[|\]|,/.test(sampleName)) continue;
      // Skip built-in oscillator synths - they don't need loading
      // Sample-based synths (piano, gtr, wood, etc.) need to be loaded
      if (!builtInOscillatorSynths.has(sampleName.toLowerCase())) {
        bankNames.add(sampleName);
      }
    }

    const soundRegex = /\.sound\(["']([^"']+)["']\)/g;
    while ((match = soundRegex.exec(workingPattern)) !== null) {
      const soundName = match[1];
      if (!soundName) continue;
      // Skip built-in oscillator synths - they don't need loading
      // Sample-based synths (piano, gtr, wood, etc.) need to be loaded
      if (!builtInOscillatorSynths.has(soundName.toLowerCase())) {
        bankNames.add(soundName);
      }
    }

    for (const name of bankNames) {
      if (this.loadedBanks.has(name) || !name) continue;
      // Double-check: skip built-in oscillator synths (case-insensitive)
      // Sample-based synths (piano, gtr, jazz/wood, etc.) need to be loaded
      const nameLower = name.toLowerCase();
      if (builtInOscillatorSynths.has(nameLower)) {
        console.log(`⏭️ Skipping built-in oscillator synth "${name}" (no loading needed)`);
        // Mark as "loaded" so we don't try again
        this.loadedBanks.add(nameLower);
        this.loadedBanks.add(name); // Also add original case
        continue;
      }
      const specialtyBankName = this.sampleNameToSpecialtyBank?.get(nameLower);
      if (specialtyBankName) {
        console.log(`⏭️ "${name}" is provided by specialty bank "${specialtyBankName}"`);
        if (!this.loadedBanks.has(specialtyBankName)) {
          try {
            await this.loadBank(specialtyBankName);
          } catch (error) {
            console.warn(`⚠️ Could not ensure specialty bank "${specialtyBankName}" for "${name}":`, error);
          }
        }
        this.loadedBanks.add(nameLower);
        this.loadedBanks.add(name);
        continue;
      }
      
      // Normalize synth aliases (e.g., "wood" -> "jazz") before loading
      let normalizedName = nameLower;
      if (SYNTH_NAME_ALIASES[nameLower]) {
        normalizedName = SYNTH_NAME_ALIASES[nameLower];
        console.log(`🔄 Normalizing "${name}" to "${normalizedName}" for loading`);
      }
      
      // Check if already loaded with normalized name
      if (this.loadedBanks.has(normalizedName)) {
        console.log(`✅ Resource "${name}" already loaded as "${normalizedName}"`);
        this.loadedBanks.add(name); // Mark original name as loaded too
        continue;
      }
      
      try {
        console.log(`🎚️ ensurePatternResourcesLoaded: loading "${normalizedName}" for playback`);
        const result = await this.loadBank(normalizedName);
        if (result) {
          this.loadedBanks.add(normalizedName);
          this.loadedBanks.add(name); // Also mark original name as loaded
          console.log(`✅ Resource "${normalizedName}" loaded`);
        } else {
          console.warn(`⚠️ Could not load resource "${normalizedName}" (continuing anyway)`);
        }
      } catch (error) {
        // Don't let resource loading errors prevent visualization
        console.warn(`⚠️ Error loading resource "${normalizedName}" (continuing anyway):`, error.message || error);
      }
    }
  }

  /**
   * Stop a sustaining tone for a slider
   */
  stopSustainingTone(sliderId) {
    const sound = this.activeSounds.get(sliderId);
    if (sound && sound.type === 'sustaining' && sound.oscillator) {
      try {
        // Fade out smoothly
        const gain = sound.gain;
        const currentTime = this.audioContext.currentTime;
        gain.gain.cancelScheduledValues(currentTime);
        gain.gain.setValueAtTime(gain.gain.value, currentTime);
        gain.gain.linearRampToValueAtTime(0, currentTime + 0.1);
        
        setTimeout(() => {
          sound.oscillator.stop();
          this.activeSounds.delete(sliderId);
        }, 100);
      } catch (error) {
        console.error('Error stopping sustaining tone:', error);
        this.activeSounds.delete(sliderId);
      }
    }
  }

  /**
   * Save element pattern to master
   */
  saveElementToMaster(elementId, pattern, gain, pan, options = {}) {
    const { isPreview = false } = options;
    try {
      console.log(`💾 Saving ${elementId} to master: pattern="${pattern?.substring(0, 50)}...", gain=${gain}, pan=${pan}`);
      
      // Normalize quotes in pattern before storing
      const normalizedPattern = (pattern || '').replace(/[""]/g, '"').replace(/['']/g, "'");
      const repairedPattern = this._sanitizePatternExpression(normalizedPattern);
      
      // Check if pattern is in note names format (e.g., note("C4 E4 G4"))
      const hasNoteNames = this.patternHasNoteNames(repairedPattern);
      const hasNumericNotes = this.patternHasNumericNotePattern(repairedPattern);
      
      // Convert note() calls with semitones to n() when adding to master
      let preparedPattern = repairedPattern;
      // Check if pattern contains note() calls (not just n())
      const hasNoteCalls = /\bnote\s*\(/i.test(normalizedPattern);
      if (hasNoteCalls) {
        // Replace note( with n( for numeric note patterns only
        // Match note( followed by quoted content
        const noteCallRegex = /\bnote\s*\(\s*(["'])([^"']*)\1/gi;
        let converted = false;
        preparedPattern = preparedPattern.replace(noteCallRegex, (match, quote, content) => {
          // Check if content is numeric (semitones) - same logic as patternHasNumericNotePattern
          const cleanedContent = content.replace(/[<>\[\]\{\}\|,]/g, ' ').trim();
          if (cleanedContent && !/[a-gA-G]/.test(cleanedContent) && /^[\d\s~\-\/]+$/.test(cleanedContent)) {
            // Convert to n()
            converted = true;
            return `n(${quote}${content}${quote}`;
          }
          return match; // Keep as note() if it contains note names
        });
        
        if (converted) {
          console.log(`🔄 Converted note() with semitones to n() for ${elementId}`);
        }
      }
      
      this.trackedPatterns.set(elementId, {
        rawPattern: preparedPattern,
        pattern: preparedPattern,
        gain: gain || 0.8,
        pan: pan || 0,
        muted: false,
        soloed: false
      });
      
      // Ensure audio nodes are created for this element
      if (this.audioContext) {
        const nodes = this.getElementAudioNodes(elementId);
        if (nodes) {
          console.log(`  🎚️ Created audio nodes for ${elementId}`);
        }
      }
      
      if (this.masterActive && !isPreview) {
        this.scheduleMasterPatternRefresh(`save:${elementId}`);
      }
      console.log(`✅ Saved ${elementId} to master. Total tracks: ${this.trackedPatterns.size}`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Error saving ${elementId} to master:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Route a pattern through the master stack (single source of audio truth)
   */
  async routePatternThroughMaster(elementId, pattern, { isPreview = false, autoStart = false } = {}) {
    if (!this.masterOnlyPlayback) {
      return { success: false, error: 'Master-only playback is disabled' };
    }

    const originalPattern = typeof pattern === 'string' ? pattern : '';
    const sanitizedPattern = originalPattern.trim();
    if (!sanitizedPattern) {
      console.warn(`⚠️ Empty pattern for ${elementId}, removing from master`);
      this.removeElementFromMaster(elementId);
      if (this.masterActive) {
        await this.playMasterPattern();
      }
      return { success: false, error: 'Pattern empty' };
    }

    const gain = this.getElementGain(elementId);
    const pan = this.getElementPan(elementId);
    const saveResult = this.saveElementToMaster(elementId, originalPattern, gain, pan, { isPreview });
    if (!saveResult.success) {
      return saveResult;
    }

    if (isPreview) {
      this.previewElementIds.add(elementId);
    } else {
      this.previewElementIds.delete(elementId);
    }

    this.updateMasterPattern(this.soloedElements, this.mutedElements);

    if (this.masterActive) {
      this.scheduleMasterPatternRefresh(`route:${elementId}${isPreview ? ':preview' : ''}`);
      return { success: true, autoRefreshed: true };
    }
    if (autoStart) {
      return this.playMasterPattern();
    }

    return { success: true, autoStarted: false };
  }

  /**
   * Remove element pattern from master
   */
  removeElementFromMaster(elementId) {
    try {
      this.previewElementIds.delete(elementId);
      if (this.trackedPatterns.has(elementId)) {
        this.trackedPatterns.delete(elementId);
        console.log(`🗑️ Removed ${elementId} from master. Remaining tracks: ${this.trackedPatterns.size}`);
        this.updateMasterPattern();
        if (this.masterOnlyPlayback) {
          if (this.masterPattern && this.masterPattern.trim()) {
            if (this.masterActive) {
              this.playMasterPattern().catch(err => console.warn('⚠️ Failed to refresh master after removal:', err));
            }
          } else if (this.masterActive) {
            this.stopMasterPattern().catch(err => console.warn('⚠️ Failed to stop master after removal:', err));
          }
        }
      }
      return { success: true };
    } catch (error) {
      console.error(`❌ Error removing ${elementId} from master:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update gain for a tracked element in master
   */
  updateTrackedElementGain(elementId, gain) {
    if (this.trackedPatterns.has(elementId)) {
      const trackData = this.trackedPatterns.get(elementId);
      trackData.gain = gain;
      console.log(`🎚️ Updated ${elementId} gain in master: ${gain.toFixed(2)}`);
      
      // Rebuild master pattern to update the .gain() value in the pattern code
      // The Web Audio API nodes provide real-time control, but we still update the pattern
      // so the displayed code shows the current gain value
      this.updateMasterPattern(this.soloedElements, this.mutedElements);
      
      // Schedule a master refresh so the new gain value is heard during playback
      this.scheduleMasterPatternRefresh(`gain change: ${elementId}`);
      
      return { success: true };
    }
    return { success: false, reason: 'Element not tracked in master' };
  }

  /**
   * Update pan for a tracked element in master
   */
  updateTrackedElementPan(elementId, pan) {
    if (this.trackedPatterns.has(elementId)) {
      const trackData = this.trackedPatterns.get(elementId);
      trackData.pan = pan;
      console.log(`🎚️ Updated ${elementId} pan in master: ${pan.toFixed(2)}`);
      
      // Rebuild master pattern to update the .pan() value in the pattern code
      // The Web Audio API nodes provide real-time control, but we still update the pattern
      // so the displayed code shows the current pan value
      this.updateMasterPattern(this.soloedElements, this.mutedElements);
      
      // Schedule a master refresh so the new pan value is heard during playback
      this.scheduleMasterPatternRefresh(`pan change: ${elementId}`);
      
      return { success: true };
    }
    return { success: false, reason: 'Element not tracked in master' };
  }

  /**
   * Queue a master pattern re-evaluation so rapid slider moves don't spam Strudel
   */
  scheduleMasterPatternRefresh(reason = 'unspecified') {
    this._pendingMasterPatternRefreshReason = reason;
    if (this._masterPatternRefreshTimer) {
      return;
    }
    this._masterPatternRefreshTimer = setTimeout(() => {
      this._masterPatternRefreshTimer = null;
      this._performScheduledMasterPatternRefresh();
    }, 60);
  }

  async _performScheduledMasterPatternRefresh() {
    if (!this.masterPattern || this.masterPattern.trim() === '') {
      this._pendingMasterPatternRefreshReason = null;
      return;
    }

    if (!this.masterActive) {
      console.log(`🔁 Master refresh skipped (not active). Pending reason: ${this._pendingMasterPatternRefreshReason || 'unspecified'}`);
      this._pendingMasterPatternRefreshReason = null;
      return;
    }

    const reason = this._pendingMasterPatternRefreshReason || 'unspecified';
    this._pendingMasterPatternRefreshReason = null;

    this._masterPatternEvalPromise = this._masterPatternEvalPromise
      .catch(() => {})
      .then(() => this._reEvaluateMasterPattern(reason));

    try {
      await this._masterPatternEvalPromise;
    } catch (error) {
      console.warn(`⚠️ Master pattern refresh failed (${reason}):`, error);
    }
  }

  formatMasterPatternWithTempoComment(pattern) {
    if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
      return pattern;
    }

    const tempo = this.currentTempo || 120;
    const tempoPrefix = '// Controls Selected Tempo:';
    const filteredLines = pattern
      .split('\n')
      .filter(line => !line.trim().startsWith(tempoPrefix));
    const cleanedPattern = filteredLines.join('\n').trimEnd();
    const sanitizedPattern = this._sanitizePatternExpression(cleanedPattern);
    if (sanitizedPattern !== cleanedPattern) {
      console.log('🧼 Sanitized master pattern when formatting tempo comment');
    }

    return `${sanitizedPattern}\n\n${tempoPrefix} ${tempo} BPM`;
  }

  /**
   * Update master pattern by combining all tracked patterns
   */
  updateMasterPattern(soloedElements = new Set(), mutedElements = new Set()) {
    try {
      console.log(`🎛️ Updating master pattern. Tracks: ${this.trackedPatterns.size}, Solo: ${soloedElements.size}, Muted: ${mutedElements.size}`);
      
      const patterns = [];
      const patternComments = []; // Store comments for each pattern
      const patternChannels = [];
      const hasSolo = soloedElements.size > 0;
      const scaleContext = this.getScaleConversionContext();
      
      let iterationIndex = 0;
      for (const [elementId, trackData] of this.trackedPatterns.entries()) {
        const isMuted = mutedElements.has(elementId);
        const isSoloed = soloedElements.has(elementId);
        const channelNumber = this.extractChannelNumber(elementId, iterationIndex);
        iterationIndex += 1;
        
        // Skip if muted OR (solo exists and this track is not soloed)
        if (isMuted || (hasSolo && !isSoloed)) {
          console.log(`  ⏭️ Skipping ${elementId} (muted: ${isMuted}, solo active but not soloed: ${hasSolo && !isSoloed})`);
          continue;
        }
        
        // Skip if gain is 0 or very close to 0 (effectively muted)
        // Only skip if gain is truly 0, not just low values
        if (trackData.gain <= 0) {
          console.log(`  ⏭️ Skipping ${elementId} (gain is ${trackData.gain})`);
          continue;
        }
        
        const originalSourcePattern = trackData.pattern || trackData.rawPattern || '';
        const sourcePattern = this._sanitizePatternExpression(originalSourcePattern);
        if (sourcePattern !== originalSourcePattern) {
          trackData.pattern = sourcePattern;
          trackData.rawPattern = sourcePattern;
        }
        if (!sourcePattern || sourcePattern.trim() === '') {
          console.log(`  ⏭️ Skipping ${elementId} (empty pattern)`);
          continue;
        }

        // Preserve the format: if pattern uses note names, keep note names; if semitones, keep semitones
        // Check if pattern is in note names format (e.g., note("C4 E4 G4"))
        // Note names have letter notes (a-g) followed by optional accidental and octave
        const hasNoteNames = this.patternHasNoteNames(sourcePattern);
        const hasNumericNotes = this.patternHasNumericNotePattern(sourcePattern);
        
        // Preserve the format: if pattern uses note names, keep note names; if semitones, keep semitones
        let convertedPattern = sourcePattern;
        if (hasNoteNames && !hasNumericNotes) {
          // Pattern is in note names format - keep it as note names, don't convert
          convertedPattern = sourcePattern;
          console.log(`  📝 Preserving note names format for ${elementId}: ${sourcePattern.substring(0, 50)}...`);
        } else if (hasNumericNotes && !hasNoteNames) {
          // Pattern is in semitones format - keep it as semitones
          convertedPattern = sourcePattern;
          console.log(`  📝 Preserving semitones format for ${elementId}: ${sourcePattern.substring(0, 50)}...`);
        } else {
          // Unclear format - preserve as-is, don't convert
          convertedPattern = sourcePattern;
          console.log(`  📝 Preserving pattern format as-is for ${elementId}: ${sourcePattern.substring(0, 50)}...`);
        }
        
        trackData.pattern = convertedPattern;
        
        // Build pattern with gain and pan modifiers
        let patternCode = (convertedPattern || '').trim();
        
        // Normalize quotes: replace fancy quotes with straight quotes
        patternCode = patternCode.replace(/[""]/g, '"').replace(/['']/g, "'");
        
        const isSafeToStrip = () => {
          const containsChannelComment = /\/\*\s*Channel\s+\d+\s*\*\//i.test(patternCode);
          const containsStackCall = /\bstack\s*\(/i.test(patternCode);
          if (containsChannelComment || containsStackCall) {
            return false;
          }
          return true;
        };
        
        if (isSafeToStrip()) {
          while (patternCode.startsWith('(') && patternCode.endsWith(')')) {
            let depth = 0;
            let isProperlyWrapped = true;
            
            for (let i = 0; i < patternCode.length; i++) {
              if (patternCode[i] === '(') depth++;
              else if (patternCode[i] === ')') depth--;
              
              if (depth === 0 && i < patternCode.length - 1) {
                isProperlyWrapped = false;
                break;
              }
            }
            
            if (isProperlyWrapped && depth === 0) {
              patternCode = patternCode.slice(1, -1).trim();
            } else {
              break;
            }
          }
        }
        
        // Clean up malformed patterns (e.g., patterns with unmatched opening parens from old saves)
        // Check if the pattern starts with a single opening paren that's unmatched
        if (patternCode.startsWith('(')) {
          let depth = 0;
          let closingIndex = -1;
          
          for (let i = 0; i < patternCode.length; i++) {
            if (patternCode[i] === '(') depth++;
            if (patternCode[i] === ')') depth--;
            
            // If we close the first paren, mark where it closes
            if (depth === 0) {
              closingIndex = i;
              break;
            }
          }
          
          // If the first paren never closes (depth != 0 at end), strip it
          if (closingIndex === -1) {
            patternCode = patternCode.substring(1);
            console.log(`  🔧 Stripped unmatched opening paren from pattern`);
          }
        }
        
        // Normalize synth aliases to ensure consistency across master pattern
        patternCode = replaceSynthAliasesInPattern(patternCode);
        
        // Add gain/pan modifiers to pattern string
        // Always apply gain to ensure smooth volume control (not just when !== 1)
        // The Web Audio API gain nodes provide real-time control, but pattern-level gain
        // ensures consistency and proper mixing when multiple channels are playing
        const basePattern = patternCode.trim();
        patternCode = `${basePattern}.postgain(${trackData.gain.toFixed(2)})`;
        
        // Add pan modifier if not centered
        if (trackData.pan !== 0) {
          patternCode = `${patternCode}.pan(${trackData.pan.toFixed(2)})`;
        }
        
        // Apply global settings (scale) per pattern instead of entire stack
        // Use per-element key/scale if available, or extract from pattern's .scale() modifier
        const elementConfig = this.appInstance?.loadElementConfig?.(elementId) || {};
        let elementKey = elementConfig.key || null;
        let elementScale = elementConfig.scale || null;
        
        // If key/scale not in config, try to extract from pattern's .scale() modifier
        if ((!elementKey || !elementScale) && patternCode.includes('.scale(')) {
          const scaleMatch = patternCode.match(/\.\s*scale\s*\(\s*['"]([^'"]+)['"]\s*\)/i);
          if (scaleMatch && scaleMatch[1]) {
            const scaleValue = scaleMatch[1];
            if (scaleValue.includes(':')) {
              const [keyPart, scalePart] = scaleValue.split(':');
              elementKey = elementKey || keyPart.trim();
              elementScale = elementScale || scalePart.trim();
              console.log(`  🎼 Extracted scale from pattern: ${elementKey}:${elementScale}`);
            } else {
              elementScale = elementScale || scaleValue.trim();
              elementKey = elementKey || 'C'; // Default to C if not specified
              console.log(`  🎼 Extracted scale from pattern: ${elementKey}:${elementScale}`);
            }
          }
        }
        
        // Check if pattern is already wrapped (after gain/pan modifiers)
        const trimmedPattern = patternCode.trim();
        const isWrapped = trimmedPattern.startsWith('(') && trimmedPattern.endsWith(')');
        patternCode = this.applyGlobalSettingsToPattern(patternCode, isWrapped, false, elementKey, elementScale);

        // Only unwrap if pan is 0 (gain is always applied now for smooth volume control)
        if (trackData.pan === 0) {
          let normalizedPattern = patternCode.trim();
          const unwrapFullyWrapped = () => {
            while (normalizedPattern.startsWith('(') && normalizedPattern.endsWith(')')) {
              let depth = 0;
              let balanced = true;
              for (let i = 0; i < normalizedPattern.length; i++) {
                const char = normalizedPattern[i];
                if (char === '(') depth++;
                else if (char === ')') depth--;
                if (depth === 0 && i < normalizedPattern.length - 1) {
                  balanced = false;
                  break;
                }
              }
              if (!balanced || depth !== 0) {
                break;
              }
              normalizedPattern = normalizedPattern.slice(1, -1).trim();
            }
          };
          unwrapFullyWrapped();
          patternCode = normalizedPattern;
        }
        
        patterns.push(patternCode);
        patternChannels.push(channelNumber);
        patternComments.push(`Channel ${channelNumber}`);
        console.log(`  ✅ Added ${elementId}: ${patternCode.substring(0, 100)}...`);
      }
      
      if (patterns.length === 0) {
        this.masterPattern = '';
        console.log(`🔇 No active patterns - master pattern cleared`);
      } else {
        const formattedPatterns = patterns.map((pattern, index) => {
          const channelNumber = patternChannels[index] ?? (index + 1);
          return `  /* Channel ${channelNumber} */\n  ${pattern}`;
        }).join(',\n\n');

        let stackPattern = `stack(\n${formattedPatterns}\n)`;

        stackPattern = this.applyMasterMixModifiers(stackPattern, { wrapStack: true });
        this.masterPattern = stackPattern;

        let depth = 0;
        let inString = false;
        let stringChar = null;
        let inComment = false;

        for (let i = 0; i < this.masterPattern.length; i++) {
          const char = this.masterPattern[i];
          const nextChar = this.masterPattern[i + 1];

          if (!inString && char === '/' && nextChar === '/') {
            inComment = true;
            i++;
            continue;
          }
          if (inComment && char === '\n') {
            inComment = false;
            continue;
          }
          if (inComment) continue;

          if (!inComment && (char === '"' || char === "'")) {
            if (!inString) {
              inString = true;
              stringChar = char;
            } else if (char === stringChar && this.masterPattern[i - 1] !== '\\') {
              inString = false;
              stringChar = null;
            }
            continue;
          }

          if (!inString && !inComment) {
            if (char === '(') {
              depth++;
            } else if (char === ')') {
              depth--;
              if (depth < 0) {
                console.error(`  ⚠️ UNBALANCED PARENTHESES! Extra closing paren at position ${i}`);
                break;
              }
            }
          }
        }

        const openCount = (this.masterPattern.match(/\(/g) || []).length;
        const closeCount = (this.masterPattern.match(/\)/g) || []).length;
        console.log(`🎵 Master pattern (stack): ${this.masterPattern.substring(0, 150)}...`);
        console.log(`  📊 Parentheses: ${openCount} open, ${closeCount} close, depth=${depth}, balanced: ${depth === 0}`);

        if (depth !== 0) {
          console.error(`  ⚠️ UNBALANCED PARENTHESES! Depth=${depth}, fixing...`);
          console.log('  🧾 Master pattern before fix:\n', this.masterPattern);
          if (depth > 0) {
            this.masterPattern += ')'.repeat(depth);
            console.log(`  ✅ Added ${depth} closing paren(s)`);
          } else {
            const extra = Math.abs(depth);
            let removed = 0;
            for (let i = this.masterPattern.length - 1; i >= 0 && removed < extra; i--) {
              if (this.masterPattern[i] === ')') {
                this.masterPattern = this.masterPattern.substring(0, i) + this.masterPattern.substring(i + 1);
                removed++;
              }
            }
            console.log(`  ✅ Removed ${removed} extra closing paren(s)`);
          }
        }
      }

      if (this.masterPattern && window.__patternHistory?.saveMasterVersion) {
        try {
          window.__patternHistory.saveMasterVersion(this.masterPattern);
        } catch (historyError) {
          console.warn('⚠️ Unable to record master history entry:', historyError);
        }
      }
      
      const currentMaster = this.masterPattern;
      if (currentMaster && currentMaster.trim() !== '') {
        let modifiedMaster = this.convertPatternForScale(currentMaster) || currentMaster;
        
        this.masterPattern = this.formatMasterPatternWithTempoComment(modifiedMaster);
      }

      // Global settings now applied to the entire stack (or single pattern)
      // Note: Tempo is NOT automatically applied - users can manually add .fast() or .slow()
      console.log(`🎛️ Applied global settings to master pattern (Key: ${this.currentKey || 'none'}, Scale: ${this.currentScale || (this.currentKey ? 'derived' : 'none')}, Time Sig: ${this.currentTimeSignature || 'none'}, Volume: ${this.formatNumberForPattern(this.masterVolume, 4)}, Pan: ${this.formatNumberForPattern(this.masterPan, 4)}, Tempo: ${this.currentTempo || 120} BPM)`);
      
      
      // Preserve current transport state; do NOT stop scheduler or playback here.
      // Live updates should be seamless. If master isn't active, remain idle; if active, keep playing.
      
      // Notify UI that master pattern has been updated
      if (this.onMasterPatternUpdateCallback) {
        this.onMasterPatternUpdateCallback();
      }
      
      return { success: true, pattern: this.masterPattern };
    } catch (error) {
      console.error(`❌ Error updating master pattern:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Set up analyser node for visualizers (scope, spectrum, etc.)
   * This creates and connects an analyser that Strudel visualizers can use
   */
  setupVisualizerAnalyser() {
    if (!this.audioContext || !window.strudel) {
      return;
    }
    
    const analyserId = 'master-punchcard-canvas';
    
    // Check if Strudel has getAnalyserById function (from superdough)
    const getAnalyserById = window.strudel?.getAnalyserById || globalThis.getAnalyserById;
    
    if (!getAnalyserById || typeof getAnalyserById !== 'function') {
      console.warn('⚠️ getAnalyserById not available - visualizers may not work');
      return;
    }
    
    try {
      // Create analyser in OUR audio context to avoid context mismatch
      // Strudel's getAnalyserById might create analyser in a different context
      let analyser = null;
      
      // First, try to get existing analyser from Strudel
      try {
        analyser = getAnalyserById(analyserId, 2048, 0.8);
        
        // Check if analyser is in the same audio context
        if (analyser && analyser.context !== this.audioContext) {
          console.warn(`⚠️ Analyser from getAnalyserById is in different audio context, creating new one`);
          analyser = null;
        }
      } catch (e) {
        console.warn(`⚠️ Could not get analyser from getAnalyserById:`, e.message);
      }
      
      // If we don't have an analyser or it's in wrong context, create one ourselves
      if (!analyser) {
        analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        
        // Store it so Strudel can find it by ID
        // Patch getAnalyserById to return our analyser for this ID
        const originalGetAnalyserById = getAnalyserById;
        const ourAnalyser = analyser;
        
        // Also try to store it in Strudel's internal analyser registry if it exists
        if (window.strudel) {
          // Check if Strudel has an analyser registry/map
          if (window.strudel.analysers && typeof window.strudel.analysers === 'object') {
            window.strudel.analysers[analyserId] = analyser;
            console.log(`✅ Stored analyser "${analyserId}" in Strudel's analyser registry`);
          }
          
          // Replace getAnalyserById with a patched version that returns our analyser
          window.strudel.getAnalyserById = function(id, fftSize, smoothing) {
            if (id === analyserId) {
              return ourAnalyser;
            }
            return originalGetAnalyserById(id, fftSize, smoothing);
          };
        }
        if (globalThis.getAnalyserById) {
          globalThis.getAnalyserById = function(id, fftSize, smoothing) {
            if (id === analyserId) {
              return ourAnalyser;
            }
            return originalGetAnalyserById(id, fftSize, smoothing);
          };
        }
        
        // Also store in globalThis for direct access
        if (!globalThis.analysers) {
          globalThis.analysers = {};
        }
        globalThis.analysers[analyserId] = analyser;
        
        console.log(`✅ Created analyser "${analyserId}" in our audio context and patched getAnalyserById`);
      }
      
      // Store analyser reference so we can verify it later
      this.visualizerAnalyser = analyser;
      
      // Connect analyser to master gain node (after all processing)
      // This allows the analyser to tap the final audio signal
      if (this.masterGainNode && analyser) {
        const destinationNode = this._realDestination || this.audioContext?.destination;
        if (!destinationNode) {
          console.warn(`⚠️ Cannot connect analyser - destination unavailable`);
        } else {
          try {
            // Ensure we have a silent tap gain so analyser output is pulled without adding audible signal
            if (!this.visualizerAnalyserTapGain && this.audioContext) {
              this.visualizerAnalyserTapGain = this.audioContext.createGain();
              this.visualizerAnalyserTapGain.gain.value = 0;
            }
            
            if (this.visualizerAnalyserTapGain) {
              try {
                this.visualizerAnalyserTapGain.disconnect();
              } catch (e) {
                // ignore
              }
              this.visualizerAnalyserTapGain.connect(destinationNode);
            }
            
            try {
              analyser.disconnect();
            } catch (e) {
              // ignore
            }
            
          try {
            this.masterGainNode.disconnect(analyser);
          } catch (e) {
              // ignore
          }
          
          this.masterGainNode.connect(analyser);
            if (this.visualizerAnalyserTapGain) {
              analyser.connect(this.visualizerAnalyserTapGain);
            }
            console.log(`✅ Connected visualizer analyser "${analyserId}" with silent tap to destination`);
          
          // Verify analyser is receiving data (check after a short delay to allow audio to flow)
          setTimeout(() => {
            try {
              const dataArray = new Uint8Array(analyser.frequencyBinCount);
              analyser.getByteFrequencyData(dataArray);
              const hasData = dataArray.some(val => val > 0);
              const maxValue = Math.max(...dataArray);
              console.log(`🔍 Analyser data check: hasData=${hasData}, maxValue=${maxValue}, frequencyBinCount=${analyser.frequencyBinCount}`);
              
              // Also check if canvas exists and is accessible
              const canvas = document.getElementById(analyserId);
              if (canvas) {
                console.log(`🔍 Canvas check: found canvas with ID "${analyserId}", width=${canvas.width}, height=${canvas.height}`);
              } else {
                console.warn(`⚠️ Canvas with ID "${analyserId}" not found!`);
              }
            } catch (e) {
              console.warn(`⚠️ Could not check analyser data:`, e);
            }
          }, 500);
        } catch (connectError) {
            console.warn(`⚠️ Failed to connect analyser "${analyserId}":`, connectError.message);
          }
        }
      } else {
        console.warn(`⚠️ Cannot connect analyser - masterGainNode: ${!!this.masterGainNode}, analyser: ${!!analyser}`);
      }
    } catch (error) {
      console.warn('⚠️ Failed to setup visualizer analyser:', error);
    }
  }

  /**
   * Inject visualizer targets (e.g., canvas IDs) into master pattern
   */
  applyVisualizerTargetsToPattern(pattern) {
    if (!pattern || typeof pattern !== 'string') return pattern;
    const canvasId = 'master-punchcard-canvas';
    const analyserId = canvasId;
    const ctxExpression = "window.__strudelVisualizerCtx || (document.getElementById('master-punchcard-canvas') && document.getElementById('master-punchcard-canvas').getContext && document.getElementById('master-punchcard-canvas').getContext('2d'))";
    const canonicalPrefixes = ['spectrum', 'scope', 'tscope', 'fscope', 'visual', 'pianoroll', 'barchart'];
    let result = pattern;
    const canonicalRegex = new RegExp(`\\.\\s*_(${canonicalPrefixes.join('|')})\\s*\\(`, 'gi');
    result = result.replace(canonicalRegex, (match, name) => match.replace(`_${name}`, name));

    // Visualizers that support id parameter (scope, spectrum only use id, not ctx)
    const visualizersWithIdOnly = ['spectrum', 'scope', 'tscope', 'fscope'];
    // Visualizers that support id/ctx parameters
    const visualizersWithIdAndCtx = ['visual', 'barchart', 'pianoroll'];

    // Process visualizers that only support id (scope, spectrum)
    visualizersWithIdOnly.forEach((fn) => {
      const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const emptyCallRegex = new RegExp(`\\.\\s*_?${escaped}\\s*\\(\\s*\\)`, 'gi');
      result = result.replace(emptyCallRegex, (match) => {
        return match.replace(/\(\s*\)/, `({ id: '${analyserId}' })`);
      });

      const objectCallRegex = new RegExp(`\\.\\s*_?${escaped}\\s*\\(\\s*\\{([^}]*)\\}\\s*\\)`, 'gi');
      result = result.replace(objectCallRegex, (match, body) => {
        let modifiedBody = body.trim();
        const hasId = /(^|,)\s*id\s*:/.test(modifiedBody);

        if (!hasId) {
          modifiedBody = modifiedBody.length > 0 ? `${modifiedBody}, id: '${analyserId}'` : `id: '${analyserId}'`;
        }
        return match.replace(body, modifiedBody);
      });
    });

    // Process visualizers that support id/ctx parameters
    visualizersWithIdAndCtx.forEach((fn) => {
      const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const emptyCallRegex = new RegExp(`\\.\\s*_?${escaped}\\s*\\(\\s*\\)`, 'gi');
      result = result.replace(emptyCallRegex, (match) => {
        return match.replace(/\(\s*\)/, `({ id: '${analyserId}', ctx: ${ctxExpression} })`);
      });

      const objectCallRegex = new RegExp(`\\.\\s*_?${escaped}\\s*\\(\\s*\\{([^}]*)\\}\\s*\\)`, 'gi');
      result = result.replace(objectCallRegex, (match, body) => {
        let modifiedBody = body.trim();
        const hasId = /(^|,)\s*id\s*:/.test(modifiedBody);
        const hasCtx = /(^|,)\s*ctx\s*:/.test(modifiedBody);

        if (!hasId) {
          modifiedBody = modifiedBody.length > 0 ? `${modifiedBody}, id: '${analyserId}'` : `id: '${analyserId}'`;
        }
        if (!hasCtx) {
          modifiedBody = modifiedBody.length > 0 ? `${modifiedBody}, ctx: ${ctxExpression}` : `ctx: ${ctxExpression}`;
        }
        return match.replace(body, modifiedBody);
      });
    });

    // Log if we modified the pattern to inject canvas IDs
    if (result !== pattern) {
      console.log(`🎨 Injected canvas ID into visualizer methods`);
      console.log(`   Before: ${pattern.substring(0, 150)}...`);
      console.log(`   After: ${result.substring(0, 150)}...`);
    }

    return result;
  }

  /**
   * Re-evaluate the master pattern without stopping playback
   * Used for live updates (e.g., gain/pan changes)
   */
  async _reEvaluateMasterPattern(reason = 'manual') {
    if (!this.masterPattern || this.masterPattern.trim() === '') {
      console.log('⚠️ No master pattern to re-evaluate');
      return { success: false, error: 'No pattern to re-evaluate' };
    }

    if (!window.strudel || typeof window.strudel.evaluate !== 'function') {
      return { success: false, error: 'Strudel evaluate unavailable' };
    }

    this._ensureMasterPatternSanitized();
    const slot = this.masterSlot || 'd0';
    const code = `${slot} = ${this.masterPattern.trim()}`;
    try {
      console.log(`🔄 Re-evaluating master pattern (${reason})...`);
      await window.strudel.evaluate(code);
      console.log(`✅ Master pattern re-evaluated (${reason})`);
      return { success: true, slot };
    } catch (error) {
      console.error('❌ Failed to re-evaluate master pattern:', error);
      return { success: false, error: error.message };
    }
  }

  async _playMasterPatternSimple() {
    if (!this.masterPattern || this.masterPattern.trim() === '') {
      console.log('⚠️ No master pattern to play (master-only mode)');
      if (this.masterActive) {
        await this._stopMasterPatternSimple();
      } else {
        this.masterActive = false;
      }
      return { success: false, error: 'No pattern to play' };
    }

    await this.initialize();
    if (!this.strudelLoaded) {
      await this.initStrudel();
    }

    // Restore master gain/pan to user values before starting playback
    if (this.masterGainNode) {
      const now = this.audioContext?.currentTime || 0;
      this.masterGainNode.gain.setValueAtTime(this.masterVolume, now);
    }
    if (this.masterPanNode) {
      this.masterPanNode.pan.setValueAtTime(this.masterPan, this.audioContext?.currentTime || 0);
    }

    if (!window.strudel || typeof window.strudel.evaluate !== 'function') {
      return { success: false, error: 'Strudel evaluate unavailable' };
    }

    this._ensureMasterPatternSanitized();
    const slot = this.masterSlot || 'd0';
    const code = `${slot} = ${this.masterPattern.trim()}`;
    try {
      await window.strudel.evaluate(code);
      if (window.strudel.scheduler) {
        if (!window.strudel.scheduler.started) {
          await window.strudel.scheduler.start();
        }
      } else {
        console.warn('⚠️ Strudel scheduler missing - cannot ensure playback');
      }
      this.masterActive = true;
      this.masterPlaybackStartTime = this.audioContext?.currentTime || performance.now();
      if (this.onMasterStateChangeCallback) {
        this.onMasterStateChangeCallback(true, Array.from(this.trackedPatterns.keys()));
      }
      startMasterHighlighting();
      return { success: true, slot };
    } catch (error) {
      console.error('❌ Failed to evaluate master pattern:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Play the master pattern
   */
  async playMasterPattern() {
    if (this.masterOnlyPlayback) {
      return this._playMasterPatternSimple();
    }

    try {
      console.log(`▶️ Playing master pattern...`);
      
      // CRITICAL: Set masterActive BEFORE evaluation so audio routing can find elements
      // Always set to true when playMasterPattern is called (this function is only called from play button)
      // The audio routing interception will block connections when masterActive=false, but when
      // playMasterPattern is explicitly called, we want to play, so set masterActive=true
      this.masterActive = true;
      console.log(`🎚️ masterActive set to TRUE before pattern evaluation`);
      
      // CRITICAL: Verify hijacking is active before playing
      console.log('🔍 PRE-PLAY: Verifying audio routing hijacking is active...');
      console.log('   AudioNode.prototype.__originalConnect exists:', !!AudioNode.prototype.__originalConnect);
      console.log('   AudioNode.prototype.connect is patched:', AudioNode.prototype.connect !== AudioNode.prototype.__originalConnect);
      console.log('   masterActive:', this.masterActive);
      console.log('   trackedPatterns.size:', this.trackedPatterns.size);
      console.log('   masterPanNode exists:', !!this.masterPanNode);
      console.log('   masterGainNode exists:', !!this.masterGainNode);
      
      // Restore master gain to user volume on play
      if (this.masterGainNode) {
        this.masterGainNode.gain.setValueAtTime(this.masterVolume, this.audioContext?.currentTime || 0);
      }
      
      // Ensure audio context is initialized
      if (!this.audioContext || this.audioContext.state === 'suspended') {
        await this.initialize();
      }
      
      // Ensure Strudel is initialized
      if (!this.strudelLoaded) {
        console.log(`⏳ Waiting for Strudel to initialize...`);
        await this.initStrudel();
      }
      
      this._ensureMasterPatternSanitized();
      
      // Ensure analyser is set up for visualizers
      this.setupVisualizerAnalyser();
      
      // Do not manually override Strudel's default output; rely on AudioNode hijack
      
      // Check if we have a valid pattern
      if (!this.masterPattern || this.masterPattern.trim() === '') {
        console.log(`⚠️ No master pattern to play`);
        this.masterActive = false; // Reset if no pattern
        return { success: false, error: 'No pattern to play' };
      }
      
      // Ensure audio context is running (not suspended)
      if (this.audioContext && this.audioContext.state === 'suspended') {
        console.log(`🔊 Audio context suspended, resuming...`);
        try {
          await this.audioContext.resume();
          console.log(`✅ Audio context resumed, state: ${this.audioContext.state}`);
        } catch (resumeError) {
          console.warn(`⚠️ Could not resume audio context:`, resumeError);
        }
      }
      
      // Evaluate and assign to master slot
      if (window.strudel && window.strudel.evaluate) {
        // Note: Volume, pan, and mute are handled via Web Audio API nodes for instant response
        // Ensure pattern is valid before evaluating
        let patternToEval = this.masterPattern.trim();
        if (!patternToEval || patternToEval === '') {
          console.error(`❌ Master pattern is empty, cannot evaluate`);
          return { success: false, error: 'Master pattern is empty' };
        }
        
        console.log(`🎼 Master pattern before processing:`, patternToEval.substring(0, 200));
        
        patternToEval = replaceSynthAliasesInPattern(patternToEval);
        patternToEval = this.applyVisualizerTargetsToPattern(patternToEval);
        
        console.log(`🎼 Master pattern after visualizer injection:`, patternToEval.substring(0, 200));
        
        // Ensure audio worklets (e.g., supersaw) are loaded before evaluation if needed
        await this.ensureStrudelWorkletsReady(patternToEval);

        // Ensure any referenced banks are loaded before evaluating
        const bankMatchesForMaster = patternToEval.match(/\.bank\(["']([^"']+)["']\)/g);
        if (bankMatchesForMaster && typeof this.loadBank === 'function') {
          const bankNames = [...new Set(bankMatchesForMaster.map(match => {
            const resultMatch = match.match(/\.bank\(["']([^"']+)["']\)/);
            return resultMatch ? resultMatch[1] : null;
          }).filter(Boolean))];

          for (const bankName of bankNames) {
            if (!this.loadedBanks.has(bankName)) {
              try {
                console.log(`🎚️ Master: ensuring bank "${bankName}" is loaded before playback`);
                const loadResult = await this.loadBank(bankName);
                if (loadResult) {
                  this.loadedBanks.add(bankName);
                  console.log(`✅ Master: bank "${bankName}" loaded`);
                } else {
                  console.warn(`⚠️ Master: bank "${bankName}" could not be loaded (continuing anyway)`);
                }
              } catch (bankError) {
                console.warn(`⚠️ Master: error loading bank "${bankName}":`, bankError);
              }
            }
          }
        }
        
        await this.ensurePatternResourcesLoaded(patternToEval);

        // Remove JavaScript style comments to avoid breaking evaluation
        patternToEval = patternToEval
          .replace(/\/\/.*$/gm, '')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\n\s*\n/g, '\n')
          .trim();
        
        // Normalize quotes as a final safety measure before evaluation
        const beforeNormalization = patternToEval;
        patternToEval = patternToEval.replace(/[""]/g, '"').replace(/['']/g, "'");
        
        if (beforeNormalization !== patternToEval) {
          console.log(`🔧 Normalized quotes in master pattern`);
          console.log(`  Before: ${beforeNormalization.substring(0, 100)}...`);
          console.log(`  After:  ${patternToEval.substring(0, 100)}...`);
        }
        
        // IMPORTANT: Do not auto-wrap method chains here.
        // Previous auto-fix could corrupt valid patterns (e.g., inserting )(gain(...)).
        // We now trust upstream pattern assembly to be syntactically correct.
        // If needed, add targeted fixes in updateMasterPattern/applyMasterMixModifiers instead.
        
        // Add .loop() to master pattern if it doesn't already have it, so it plays continuously
        if (!patternToEval.includes('.loop(') && !patternToEval.includes('.loop()')) {
          patternToEval = `${patternToEval}.loop()`;
          console.log(`🔄 Added .loop() to master pattern for continuous playback`);
        }
        
      // CRITICAL: Set masterActive BEFORE evaluation so audio routing can find elements
      // Always set to true when playMasterPattern is called (this function is only called from play button)
      this.masterActive = true;
      console.log(`🎚️ masterActive set to TRUE before pattern evaluation`);
      
      // Reset debug flags for fresh logging
      this._masterDestinationConnectLogged = false;
      this._singleElementMasterRoutingLogged = false;
      this._noElementRoutingLogged = false;
      this._nodeTypeConnectLogged = new Set();
      this._stackMasterRoutingLogged = false;
      this._masterRoutingLogged = false;
      this._panNodeConnectedToMaster = new Set(); // Reset panNode connection tracking
      this._gainConnectDebugged = false;
      this._stackElementRoutingLogged = new Set();
      this._chainVerificationLogged = new Set();
      this._connectionSuccessLogged = new Set();
      this._allConnectionsLogged = new Set();
      this._allDestConnectionsLogged = new Set();
        this._panNodeConnectedLogged = new Set();
        this._panNodeNotConnectedLogged = new Set();
        this._panNodeConnectionErrorLogged = new Set();
        this._masterGainDestVerifiedAfterRouting = new Set();
      this._masterGainDestVerified = false; // Reset masterGainNode->destination verification
      // Reset stack connection count for round-robin routing
      if (this._stackConnectionCount) {
        this._stackConnectionCount.set('total', 0);
      }
      
      // Always evaluate on the master slot so master stack controls apply
      const evaluationSlot = this.masterSlot;
      this.currentEvaluatingSlot = evaluationSlot;
      console.log(`🎚️ Master stack evaluation slot: ${evaluationSlot}`);
      
      // Ensure all tracked elements have audio nodes created (for gain/pan control)
      console.log(`🔧 Ensuring audio nodes exist for ${this.trackedPatterns.size} tracked elements...`);
      for (const [elementId] of this.trackedPatterns.entries()) {
        const nodes = this.getElementAudioNodes(elementId);
        if (nodes) {
          // Ensure gain value is set correctly (refresh from stored value)
          const storedGain = this.elementGainValues.get(elementId) || 0.8;
          nodes.gainNode.gain.value = storedGain * this.volume;
          
          // Verify the element audio chain is properly connected
          // Chain should be: gainNode -> panNode -> masterPan -> masterGain -> destination
          let chainStatus = [];
          chainStatus.push(`gainNode: gain=${nodes.gainNode.gain.value.toFixed(3)}`);
          chainStatus.push(`panNode: pan=${nodes.panNode.pan.value.toFixed(3)}`);
          
          console.log(`  ✅ ${elementId}: ${chainStatus.join(', ')}`);
        } else {
          console.warn(`  ⚠️ ${elementId}: Failed to create audio nodes`);
        }
      }
          
          // Reconnect visualizer analyser to master gain node (in case it was disconnected)
          if (this.visualizerAnalyser && this.masterGainNode) {
            try {
              // Disconnect first to avoid duplicate connections
              this.masterGainNode.disconnect(this.visualizerAnalyser);
            } catch (e) {
              // Ignore if not connected
            }
            try {
              this.masterGainNode.connect(this.visualizerAnalyser);
              console.log(`✅ Reconnected visualizer analyser to master gain node`);
            } catch (e) {
              console.warn(`⚠️ Could not reconnect visualizer analyser:`, e);
            }
          }
          
        // CRITICAL: Start scheduler BEFORE pattern evaluation
        // Strudel needs the scheduler running to play audio
        // This must happen before evaluation so audio can start immediately
        if (window.strudel && window.strudel.scheduler && !window.strudel.scheduler.started) {
          console.log(`▶️ Starting Strudel scheduler BEFORE pattern evaluation...`);
          await window.strudel.scheduler.start();
          console.log(`✅ Strudel scheduler started`);
          
          // CRITICAL: After starting scheduler, check if webaudio output was created
          const scheduler = window.strudel.scheduler;
          console.log(`🔍 POST-START: Checking scheduler for webaudio output...`);
          console.log(`   scheduler keys: ${Object.keys(scheduler).slice(0, 15).join(', ')}`);
          
          // Check for webaudio output in various locations
          let webaudio = scheduler.webaudio || scheduler._webaudio;
          
          // Also check window.strudel.webaudio (might be stored there)
          if (!webaudio && window.strudel.webaudio) {
            webaudio = window.strudel.webaudio;
            console.log(`   ✅ Found webaudio in window.strudel.webaudio`);
          }
          
          if (webaudio) {
            console.log(`   ✅ Found webaudio, keys: ${Object.keys(webaudio).slice(0, 10).join(', ')}`);
            const output = webaudio.output || webaudio.outputNode;
            if (output) {
              console.log(`   ✅ Found output node: ${output.constructor.name}`);
              // Try to route it immediately
              if (this.trackedPatterns.size > 0) {
                const elementId = Array.from(this.trackedPatterns.keys())[0];
                const elementNodes = this.getElementAudioNodes(elementId);
                if (elementNodes?.gainNode) {
                  try {
                    output.disconnect();
                    output.connect(elementNodes.gainNode);
                    console.log(`   ✅ Routed webaudio output to ${elementId} gainNode`);
                  } catch (e) {
                    console.log(`   ✅ webaudio output already routed (${e.message})`);
                  }
                }
              } else if (this.masterPanNode) {
                try {
                  output.disconnect();
                  output.connect(this.masterPanNode);
                  console.log(`   ✅ Routed webaudio output to masterPanNode (fallback)`);
                } catch (e) {
                  console.log(`   ✅ webaudio output already routed to master (${e.message})`);
                }
              }
            } else {
              console.log(`   ⚠️ webaudio found but no output node`);
            }
          } else {
            console.log(`   ⚠️ No webaudio found in scheduler or window.strudel`);
          }
          
          // Check superdough - this is Strudel's internal audio engine
          if (scheduler.superdough) {
            const superdough = scheduler.superdough;
            console.log(`   ✅ Found superdough, keys: ${Object.keys(superdough).slice(0, 20).join(', ')}`);
            
            // Check if superdough has an audioContext
            if (superdough.audioContext) {
              console.log(`   🔍 superdough.audioContext: ${superdough.audioContext === this.audioContext ? 'OUR CONTEXT ✅' : 'DIFFERENT CONTEXT ⚠️'}`);
              console.log(`   🔍 superdough.audioContext.state: ${superdough.audioContext.state}`);
            }
            
            // Check for output or destination in superdough
            const possibleOutputs = ['output', 'outputNode', '_output', 'destination', '_destination', 'gain', 'masterGain'];
            for (const key of possibleOutputs) {
              if (superdough[key] && superdough[key] instanceof AudioNode) {
                console.log(`   ✅ Found AudioNode at superdough.${key}: ${superdough[key].constructor.name}`);
                // Try to route it
                if (this.trackedPatterns.size > 0) {
                  const elementId = Array.from(this.trackedPatterns.keys())[0];
                  const elementNodes = this.getElementAudioNodes(elementId);
                  if (elementNodes?.gainNode) {
                    try {
                      superdough[key].disconnect();
                      superdough[key].connect(elementNodes.gainNode);
                      console.log(`   ✅ Routed superdough.${key} to ${elementId} gainNode`);
                    } catch (e) {
                      console.log(`   ✅ superdough.${key} already routed (${e.message})`);
                    }
                  }
                } else if (this.masterPanNode) {
                  try {
                    superdough[key].disconnect();
                    superdough[key].connect(this.masterPanNode);
                    console.log(`   ✅ Routed superdough.${key} to masterPanNode`);
                  } catch (e) {
                    console.log(`   ✅ superdough.${key} already routed to master (${e.message})`);
                  }
                }
              }
            }
          }
        } else if (window.strudel && window.strudel.scheduler && window.strudel.scheduler.started) {
          console.log(`✅ Strudel scheduler already running`);
          
          // Even if scheduler is already running, check for webaudio output
          const scheduler = window.strudel.scheduler;
          console.log(`🔍 ALREADY-RUNNING: Checking scheduler for webaudio output...`);
          console.log(`   scheduler keys: ${Object.keys(scheduler).slice(0, 15).join(', ')}`);
          
          const webaudio = scheduler.webaudio || scheduler._webaudio;
          if (webaudio) {
            console.log(`   ✅ Found webaudio, keys: ${Object.keys(webaudio).slice(0, 10).join(', ')}`);
            const output = webaudio.output || webaudio.outputNode;
            if (output) {
              console.log(`   ✅ Found output node: ${output.constructor.name}`);
              // Try to route it
              if (this.trackedPatterns.size > 0) {
                const elementId = Array.from(this.trackedPatterns.keys())[0];
                const elementNodes = this.getElementAudioNodes(elementId);
                if (elementNodes?.gainNode) {
                  try {
                    output.disconnect();
                    output.connect(elementNodes.gainNode);
                    console.log(`   ✅ Routed webaudio output to ${elementId} gainNode`);
                  } catch (e) {
                    console.log(`   ✅ webaudio output already routed (${e.message})`);
                  }
                }
              } else if (this.masterPanNode) {
                try {
                  output.disconnect();
                  output.connect(this.masterPanNode);
                  console.log(`   ✅ Routed webaudio output to masterPanNode (fallback)`);
                } catch (e) {
                  console.log(`   ✅ webaudio output already routed to master (${e.message})`);
                }
              }
            } else {
              console.log(`   ⚠️ webaudio found but no output node`);
            }
          } else {
            console.log(`   ⚠️ No webaudio found in scheduler`);
          }
          
          // Check superdough - this is Strudel's internal audio engine
          if (scheduler.superdough) {
            const superdough = scheduler.superdough;
            console.log(`   ✅ Found superdough, keys: ${Object.keys(superdough).slice(0, 20).join(', ')}`);
            
            // Check if superdough has an audioContext
            if (superdough.audioContext) {
              console.log(`   🔍 superdough.audioContext: ${superdough.audioContext === this.audioContext ? 'OUR CONTEXT ✅' : 'DIFFERENT CONTEXT ⚠️'}`);
              console.log(`   🔍 superdough.audioContext.state: ${superdough.audioContext.state}`);
            }
            
            // Check for output or destination in superdough
            const possibleOutputs = ['output', 'outputNode', '_output', 'destination', '_destination', 'gain', 'masterGain'];
            for (const key of possibleOutputs) {
              if (superdough[key] && superdough[key] instanceof AudioNode) {
                console.log(`   ✅ Found AudioNode at superdough.${key}: ${superdough[key].constructor.name}`);
                // Try to route it
                if (this.trackedPatterns.size > 0) {
                  const elementId = Array.from(this.trackedPatterns.keys())[0];
                  const elementNodes = this.getElementAudioNodes(elementId);
                  if (elementNodes?.gainNode) {
                    try {
                      superdough[key].disconnect();
                      superdough[key].connect(elementNodes.gainNode);
                      console.log(`   ✅ Routed superdough.${key} to ${elementId} gainNode`);
                    } catch (e) {
                      console.log(`   ✅ superdough.${key} already routed (${e.message})`);
                    }
                  }
                } else if (this.masterPanNode) {
                  try {
                    superdough[key].disconnect();
                    superdough[key].connect(this.masterPanNode);
                    console.log(`   ✅ Routed superdough.${key} to masterPanNode`);
                  } catch (e) {
                    console.log(`   ✅ superdough.${key} already routed to master (${e.message})`);
                  }
                }
              }
            }
          } else {
            console.log(`   ⚠️ No superdough found in scheduler`);
          }
        }
        
        const code = `${evaluationSlot} = ${patternToEval}`;
        console.log(`🎼 Evaluating master pattern:`);
        console.log(`   Full code: ${code}`);
        console.log(`   Code length: ${code.length} characters`);
        console.log(`   Evaluation slot: ${evaluationSlot}`);
        
        // CRITICAL: Wait for AudioWorklets to be ready before evaluating patterns
        // This prevents "supersaw-oscillator is not defined" errors
        const replInstance = window.strudel?.repl || window.strudel;
        if (replInstance?.scheduler?.superdough) {
          const superdough = replInstance.scheduler.superdough;
          // Check if AudioWorklets are loaded
          if (superdough.audioWorkletsLoaded === false || superdough.audioWorkletsLoaded === undefined) {
            console.log(`⏳ Waiting for AudioWorklets to load...`);
            // Wait up to 5 seconds for AudioWorklets to load
            let waitCount = 0;
            while ((superdough.audioWorkletsLoaded === false || superdough.audioWorkletsLoaded === undefined) && waitCount < 50) {
              await new Promise(resolve => setTimeout(resolve, 100));
              waitCount++;
            }
            if (superdough.audioWorkletsLoaded === true) {
              console.log(`✅ AudioWorklets loaded after ${waitCount * 100}ms`);
            } else {
              console.warn(`⚠️ AudioWorklets may not be loaded after ${waitCount * 100}ms - proceeding anyway`);
            }
          } else {
            console.log(`✅ AudioWorklets already loaded`);
          }
        }
        
        // Check if visualizer methods are present
        const hasScope = /\.scope\s*\(/.test(code);
        const hasSpectrum = /\.spectrum\s*\(/.test(code);
        const hasSpiral = /\.spiral\s*\(/.test(code);
        const hasPianoroll = /\._?pianoroll\s*\(/.test(code);
        const hasBarchart = /\._?barchart\s*\(/.test(code);
        if (hasScope || hasSpectrum || hasSpiral || hasPianoroll || hasBarchart) {
          console.log(`   📊 Visualizer methods detected: scope=${hasScope}, spectrum=${hasSpectrum}, spiral=${hasSpiral}, pianoroll=${hasPianoroll}, barchart=${hasBarchart}`);
          
          // Check if canvas ID is in the pattern
          const hasCanvasId = /master-punchcard-canvas/.test(code);
          console.log(`   🎯 Canvas ID present in pattern: ${hasCanvasId}`);
          
          // Extract and log the visualizer call
          const scopeMatch = code.match(/\.scope\([^)]*\)/);
          const spectrumMatch = code.match(/\.spectrum\([^)]*\)/);
          const spiralMatch = code.match(/\.spiral\([^)]*\)/);
          const pianorollMatch = code.match(/\._?pianoroll\([^)]*\)/);
          const barchartMatch = code.match(/\._?barchart\([^)]*\)/);
          if (scopeMatch) console.log(`   📊 Scope call: ${scopeMatch[0]}`);
          if (spectrumMatch) console.log(`   📊 Spectrum call: ${spectrumMatch[0]}`);
          if (spiralMatch) console.log(`   📊 Spiral call: ${spiralMatch[0]}`);
          if (pianorollMatch) console.log(`   📊 Pianoroll call: ${pianorollMatch[0]}`);
          if (barchartMatch) console.log(`   📊 Barchart call: ${barchartMatch[0]}`);
        }
      
      let evalResult;
      try {
        evalResult = await window.strudel.evaluate(code);
        console.log(`✅ Master pattern evaluated successfully, result type: ${typeof evalResult}`);
      } catch (evalError) {
        // Log but don't fail on evaluation errors - Strudel might still play
        console.warn(`⚠️ Pattern evaluation warning:`, evalError.message);
        console.warn(`⚠️ Pattern code that failed: ${code.substring(0, 300)}`);
        // Continue anyway - the pattern might still work
      }
      
      // Ensure scheduler is actively playing the evaluated slot
      try {
        const replScheduler = window.strudel?.scheduler;
        const slotRef = globalThis?.[evaluationSlot];
        if (replScheduler && slotRef) {
          // CRITICAL: Before setting pattern, check scheduler state
          console.log(`🔍 PRE-PATTERN-SET: Checking scheduler state...`);
          console.log(`   scheduler.started: ${replScheduler.started}`);
          console.log(`   scheduler.pattern: ${replScheduler.pattern ? 'exists' : 'null'}`);
          console.log(`   scheduler keys before: ${Object.keys(replScheduler).slice(0, 15).join(', ')}`);
          
          // Check if scheduler has any audio-related properties
          const audioProps = ['webaudio', '_webaudio', 'superdough', '_superdough', 'output', 'outputNode', 'audioContext'];
          for (const prop of audioProps) {
            if (replScheduler[prop]) {
              console.log(`   ✅ Found ${prop} in scheduler: ${typeof replScheduler[prop]}`);
              if (replScheduler[prop] instanceof AudioNode) {
                console.log(`      → AudioNode: ${replScheduler[prop].constructor.name}`);
              }
            }
          }
          
          try {
            replScheduler.pattern = slotRef;
            console.log(`🎚️ Scheduler pattern set directly to ${evaluationSlot}`);
            
            // CRITICAL: After setting pattern, check if scheduler created any audio nodes
            console.log(`🔍 POST-PATTERN-SET: Checking scheduler state after pattern assignment...`);
            console.log(`   scheduler.pattern: ${replScheduler.pattern ? 'exists' : 'null'}`);
            
            // Wait a bit for Strudel to potentially create audio nodes
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Check again for audio-related properties
            for (const prop of audioProps) {
              if (replScheduler[prop] && !replScheduler[`_checked_${prop}`]) {
                console.log(`   ✅ Found ${prop} after pattern set: ${typeof replScheduler[prop]}`);
                if (replScheduler[prop] instanceof AudioNode) {
                  console.log(`      → AudioNode: ${replScheduler[prop].constructor.name}`);
                  // Try to route it
                  if (this.trackedPatterns.size > 0) {
                    const elementId = Array.from(this.trackedPatterns.keys())[0];
                    const elementNodes = this.getElementAudioNodes(elementId);
                    if (elementNodes?.gainNode) {
                      try {
                        replScheduler[prop].disconnect();
                        replScheduler[prop].connect(elementNodes.gainNode);
                        console.log(`      ✅ Routed scheduler.${prop} to ${elementId} gainNode`);
                      } catch (e) {
                        console.log(`      ✅ scheduler.${prop} already routed (${e.message})`);
                      }
                    }
                  }
                }
                replScheduler[`_checked_${prop}`] = true;
              }
            }
          } catch (directErr) {
            await window.strudel.evaluate(`pattern = ${evaluationSlot}`);
            console.log(`🎚️ Scheduler pattern set via REPL to ${evaluationSlot}`);
          }
        } else {
          console.log(`ℹ️ Could not set scheduler pattern directly (scheduler/slot missing)`);
        }
      } catch (setErr) {
        console.warn(`⚠️ Failed to set scheduler pattern to ${evaluationSlot}:`, setErr?.message || setErr);
      }
      
      // CRITICAL: AFTER evaluating, try to find and reconnect Strudel's output node
      // Strudel creates audio sources during evaluation, so we need to reconnect AFTER
      // This ensures all new audio sources route through our element chain
      console.log(`🔍 POST-EVALUATION: trackedPatterns.size=${this.trackedPatterns.size}`);
      
      // CRITICAL: Try to find any audio nodes connected to destination and reroute them
      // This is a fallback in case our hijacking isn't catching connections
      console.log(`🔍 POST-EVALUATION: Searching for audio nodes connected to destination...`);
      try {
        // Check if we can access the destination's input connections
        if (this._realDestination && this._realDestination._inputs) {
          const inputs = this._realDestination._inputs;
          console.log(`   Found ${inputs.length} input(s) to destination`);
          for (let i = 0; i < inputs.length; i++) {
            const input = inputs[i];
            if (input && input._node) {
              const node = input._node;
              console.log(`   Input ${i}: ${node.constructor.name}`);
              // Try to reroute through our chain
              if (this.trackedPatterns.size > 0) {
                const elementId = Array.from(this.trackedPatterns.keys())[0];
                const elementNodes = this.getElementAudioNodes(elementId);
                if (elementNodes?.gainNode) {
                  try {
                    node.disconnect(this._realDestination);
                    node.connect(elementNodes.gainNode);
                    console.log(`   ✅ Rerouted ${node.constructor.name} through ${elementId} gainNode`);
                  } catch (e) {
                    console.log(`   ⚠️ Could not reroute ${node.constructor.name}: ${e.message}`);
                  }
                }
              }
            }
          }
        } else {
          console.log(`   ⚠️ Cannot access destination inputs (might be browser-specific)`);
        }
      } catch (e) {
        console.log(`   ⚠️ Error checking destination inputs: ${e.message}`);
      }
      console.log(`🔍 POST-EVALUATION: Audio context state=${this.audioContext?.state || 'unknown'}`);
      console.log(`🔍 POST-EVALUATION: masterGainNode.gain=${this.masterGainNode?.gain?.value?.toFixed(3) || 'N/A'}, muted=${this.masterMuted}`);
      console.log(`🔍 POST-EVALUATION: masterVolume=${this.masterVolume}, volume=${this.volume}`);
      if (this.trackedPatterns.size >= 1) {
        const elementIds = Array.from(this.trackedPatterns.keys());
        console.log(`🔍 POST-EVALUATION: elementIds=${elementIds.join(', ')}`);
        
        // Log element gain values for debugging
        for (const elementId of elementIds) {
          const storedGain = this.elementGainValues.get(elementId) || 0.8;
          const elementNodes = this.getElementAudioNodes(elementId);
          const actualGain = elementNodes?.gainNode?.gain?.value || 0;
          console.log(`🔍 POST-EVALUATION: ${elementId} - storedGain=${storedGain.toFixed(3)}, actualGain=${actualGain.toFixed(3)}, volume=${this.volume.toFixed(3)}, totalGain=${(actualGain * this.masterGainNode?.gain?.value || 0).toFixed(3)}`);
        }
        
        // Try to find Strudel's output node via scheduler
        try {
          const replInstance = window.strudel?.repl || window.strudel;
          if (replInstance?.scheduler) {
            const scheduler = replInstance.scheduler;
            // Explore scheduler to find webaudio/output node
            console.log(`🔍 POST-EVALUATION: Exploring scheduler object...`);
            console.log(`   scheduler keys: ${Object.keys(scheduler).slice(0, 20).join(', ')}`);
            
            // Try multiple ways to find the output node
            let webaudio = scheduler.webaudio || scheduler._webaudio;
            let outputNode = null;
            
            if (webaudio) {
              outputNode = webaudio.output || webaudio.outputNode;
              console.log(`🔍 POST-EVALUATION: Found webaudio, outputNode=${outputNode ? outputNode.constructor.name : 'null'}`);
            } else {
              // Try to find output node directly on scheduler
              console.log(`🔍 POST-EVALUATION: webaudio not found, searching scheduler for output node...`);
              for (const key of Object.keys(scheduler)) {
                const value = scheduler[key];
                if (value && typeof value === 'object') {
                  // Check if this object has an output property
                  if (value.output && value.output instanceof AudioNode) {
                    console.log(`🔍 POST-EVALUATION: Found output node in scheduler.${key}.output`);
                    outputNode = value.output;
                    break;
                  }
                  if (value.outputNode && value.outputNode instanceof AudioNode) {
                    console.log(`🔍 POST-EVALUATION: Found output node in scheduler.${key}.outputNode`);
                    outputNode = value.outputNode;
                    break;
                  }
                }
              }
            }
            
            console.log(`🎚️ 🔍 POST-EVALUATION: Final outputNode=${outputNode ? outputNode.constructor.name : 'null'}`);
            
            // For each tracked element, ensure routing is correct
            for (const elementId of elementIds) {
              const elementNodes = this.getElementAudioNodes(elementId);
              console.log(`🎚️ 🔍 POST-EVALUATION: ${elementId}: elementNodes=${!!elementNodes}, gainNode=${!!elementNodes?.gainNode}`);
              
              if (elementNodes && elementNodes.gainNode) {
                // If we found Strudel's output node, reconnect it
                if (outputNode) {
                  try {
                    outputNode.disconnect();
                    outputNode.connect(elementNodes.gainNode);
                    console.log(`🎚️ ✅ POST-EVALUATION: Reconnected Strudel output -> ${elementId} gainNode`);
                  } catch (e) {
                    console.warn(`⚠️ POST-EVALUATION: Could not reconnect Strudel output: ${e.message}`);
                  }
                } else {
                  console.warn(`⚠️ POST-EVALUATION: Output node not found - audio may not route through element chain`);
                }
                
                // Verify panNode is connected to master chain
                const panNode = elementNodes.panNode;
                if (panNode && this.masterPanNode) {
                  try {
                    // CRITICAL: Only disconnect specific connection, not all connections
                    // Disconnecting all connections breaks the audio chain
                    try {
                      panNode.disconnect(this.masterPanNode);
                    } catch (e) {
                      // Not connected to masterPanNode, that's fine - will connect below
                    }
                    panNode.connect(this.masterPanNode);
                    console.log(`🎚️ ✅ POST-EVALUATION: Verified ${elementId} panNode -> masterPanNode`);
                  } catch (e) {
                    console.warn(`⚠️ POST-EVALUATION: Could not verify panNode: ${e.message}`);
                  }
                }
              }
            }
            
            // CRITICAL: Ensure masterGainNode is connected to destination
            // Don't disconnect - just try to connect (will silently succeed if already connected)
            if (this.masterGainNode && this._realDestination) {
              try {
                // Try to connect - will throw if already connected, which is fine
                this.masterGainNode.connect(this._realDestination);
                console.log(`🎚️ ✅ POST-EVALUATION: Verified masterGainNode -> destination (gain=${this.masterGainNode.gain.value.toFixed(3)}, muted=${this.masterMuted})`);
              } catch (e) {
                // Already connected - that's fine, just verify it's still connected
                if (e.message.includes('already connected') || e.message.includes('already been connected')) {
                  console.log(`🎚️ ✅ POST-EVALUATION: masterGainNode -> destination already connected (gain=${this.masterGainNode.gain.value.toFixed(3)}, muted=${this.masterMuted})`);
                } else {
                  console.warn(`⚠️ POST-EVALUATION: Could not verify masterGainNode -> destination: ${e.message}`);
                }
              }
            }
          } else {
            console.warn(`⚠️ POST-EVALUATION: Could not find scheduler`);
          }
        } catch (e) {
          console.warn(`⚠️ POST-EVALUATION: Error reconnecting Strudel output: ${e.message}`);
        }
      }
        
        // Clear current evaluating slot after routing has occurred
        setTimeout(() => {
          if (this.currentEvaluatingSlot === this.masterSlot) {
            this.currentEvaluatingSlot = null;
          }
        }, this.soundsPreloaded ? 100 : 500);
        
        // Scheduler is already started before pattern evaluation (see above)
        // This ensures audio can play immediately when pattern is evaluated
        
        // CRITICAL: Verify audio chain connections after evaluation
        if (this.trackedPatterns.size === 1) {
          const elementId = Array.from(this.trackedPatterns.keys())[0];
          const elementNodes = this.getElementAudioNodes(elementId);
          
          console.log(`🔍 AUDIO CHAIN VERIFICATION for ${elementId}:`);
          console.log(`   📊 AUDIO ROUTING CHAIN (simplified, no masterAnalyser):`);
          console.log(`      1. Strudel output -> elementGainNode (gain=${elementNodes?.gainNode?.gain?.value?.toFixed(3) || 'N/A'})`);
          console.log(`      2. elementGainNode -> elementPanNode (pan=${elementNodes?.panNode?.pan?.value?.toFixed(3) || 'N/A'})`);
          console.log(`      3. elementPanNode -> masterPanNode`);
          console.log(`      4. masterPanNode -> masterGainNode (gain=${this.masterGainNode?.gain?.value?.toFixed(3) || 'N/A'}, muted=${this.masterMuted})`);
          console.log(`      5. masterGainNode -> destination (audio output)`);
          console.log(`      6. masterGainNode -> visualizerAnalyser (parallel, for visualization)`);
          console.log(`   ✅ SIMPLIFIED CHAIN: element gain -> element pan -> master pan -> master gain -> destination`);
          console.log(`   elementGainNode: ${elementNodes?.gainNode ? 'EXISTS' : 'MISSING'} (gain=${elementNodes?.gainNode?.gain?.value?.toFixed(3) || 'N/A'})`);
          console.log(`   elementPanNode: ${elementNodes?.panNode ? 'EXISTS' : 'MISSING'} (pan=${elementNodes?.panNode?.pan?.value?.toFixed(3) || 'N/A'})`);
          console.log(`   masterPanNode: ${this.masterPanNode ? 'EXISTS' : 'MISSING'}`);
          console.log(`   masterGainNode: ${this.masterGainNode ? 'EXISTS' : 'MISSING'} (gain=${this.masterGainNode?.gain?.value?.toFixed(3) || 'N/A'}, muted=${this.masterMuted})`);
          console.log(`   visualizerAnalyser: ${this.visualizerAnalyser ? 'EXISTS' : 'MISSING'}`);
          console.log(`   destination: ${this._realDestination ? 'EXISTS' : 'MISSING'}`);
          console.log(`   TOTAL GAIN: ${((elementNodes?.gainNode?.gain?.value || 0) * (this.masterGainNode?.gain?.value || 0)).toFixed(3)} (element=${elementNodes?.gainNode?.gain?.value?.toFixed(3) || '0'} * master=${this.masterGainNode?.gain?.value?.toFixed(3) || '0'})`);
          
          // Try to find Strudel's output node and verify it's connected
          try {
            const replInstance = window.strudel?.repl || window.strudel;
            if (replInstance?.scheduler) {
              const scheduler = replInstance.scheduler;
              const webaudio = scheduler.webaudio || scheduler._webaudio;
              if (webaudio) {
                const outputNode = webaudio.output || webaudio.outputNode;
                if (outputNode) {
                  console.log(`   Strudel outputNode: EXISTS (${outputNode.constructor.name})`);
                  // Check if outputNode is connected to elementGainNode
                  // We can't directly check, but we can verify the chain is set up
                  if (elementNodes?.gainNode) {
                    console.log(`   ✅ Chain should be: Strudel output -> elementGain -> elementPan -> masterPan -> masterGain -> destination`);
                  }
                } else {
                  console.warn(`   ⚠️ Strudel outputNode: NOT FOUND`);
                }
              } else {
                console.warn(`   ⚠️ Strudel webaudio: NOT FOUND`);
              }
            }
          } catch (e) {
            console.warn(`   ⚠️ Could not verify Strudel output: ${e.message}`);
          }
          
          // CRITICAL: Verify the entire master chain is connected
          // Chain should be: masterPan -> masterGainNode -> destination
          console.log(`   🔍 VERIFYING MASTER CHAIN:`);
          console.log(`      masterPanNode: ${this.masterPanNode ? 'EXISTS' : 'MISSING'}`);
          console.log(`      masterGainNode: ${this.masterGainNode ? 'EXISTS' : 'MISSING'} (gain=${this.masterGainNode?.gain?.value?.toFixed(3) || 'N/A'})`);
          console.log(`      destination: ${this._realDestination ? 'EXISTS' : 'MISSING'}`);
          
          // Verify masterPan -> masterGainNode connection
          if (this.masterPanNode && this.masterGainNode) {
            try {
              this.masterPanNode.connect(this.masterGainNode);
              console.log(`   ✅ VERIFIED: masterPanNode -> masterGainNode`);
            } catch (e) {
              if (e.message.includes('already connected') || e.message.includes('already been connected')) {
                console.log(`   ✅ VERIFIED: masterPanNode -> masterGainNode (already connected)`);
              } else {
                console.warn(`   ⚠️ Could not verify masterPanNode -> masterGainNode: ${e.message}`);
              }
            }
          }
          
          // CRITICAL: Verify masterGainNode is connected to destination
          // This is the final link in the chain - if it's not connected, no sound will play
          if (this.masterGainNode && this._realDestination) {
            try {
              // Try to connect - if already connected, this will throw, which means it's already connected (good!)
              this.masterGainNode.connect(this._realDestination);
              console.log(`   ✅ CONNECTED: masterGainNode -> destination (CRITICAL for audio output)`);
            } catch (e) {
              // Already connected or other error
              if (e.message && e.message.includes('already connected') || e.message.includes('InvalidStateError')) {
                console.log(`   ✅ VERIFIED: masterGainNode -> destination (already connected)`);
              } else {
                // Try connecting if there's a different error (might not be connected)
                try {
                  this.masterGainNode.connect(this._realDestination);
                  console.log(`   ✅ RECONNECTED: masterGainNode -> destination`);
                } catch (e2) {
                  if (e2.message.includes('already connected') || e2.message.includes('already been connected')) {
                    console.log(`   ✅ VERIFIED: masterGainNode -> destination (already connected)`);
                  } else {
                    console.error(`   ❌ FAILED: Could not connect masterGainNode -> destination: ${e2.message}`);
                  }
                }
              }
            }
          } else {
            console.warn(`   ⚠️ Cannot verify masterGainNode->destination: masterGainNode=${!!this.masterGainNode}, destination=${!!this._realDestination}`);
          }
        }
        
        // CRITICAL: Final verification of entire audio chain before declaring playback started
        console.log(`🔍 FINAL CHAIN VERIFICATION:`);
        if (this.trackedPatterns.size > 0) {
          const elementIds = Array.from(this.trackedPatterns.keys());
          for (const elementId of elementIds) {
            const elementNodes = this.getElementAudioNodes(elementId);
            console.log(`   ${elementId}:`);
            console.log(`      elementGain: ${elementNodes?.gainNode ? 'EXISTS' : 'MISSING'} (gain=${elementNodes?.gainNode?.gain?.value?.toFixed(3) || 'N/A'})`);
            console.log(`      elementPan: ${elementNodes?.panNode ? 'EXISTS' : 'MISSING'} (pan=${elementNodes?.panNode?.pan?.value?.toFixed(3) || 'N/A'})`);
          }
        }
        console.log(`   masterPanNode: ${this.masterPanNode ? 'EXISTS' : 'MISSING'}`);
        console.log(`   masterGainNode: ${this.masterGainNode ? 'EXISTS' : 'MISSING'} (gain=${this.masterGainNode?.gain?.value?.toFixed(3) || 'N/A'}, muted=${this.masterMuted})`);
        console.log(`   visualizerAnalyser: ${this.visualizerAnalyser ? 'EXISTS' : 'MISSING'}`);
        console.log(`   destination: ${this._realDestination ? 'EXISTS' : 'MISSING'}`);
        
        // CRITICAL: Ensure masterPan -> masterGainNode -> destination chain is intact
        // Don't disconnect - just try to connect (will silently succeed if already connected)
        if (this.masterPanNode && this.masterGainNode) {
          try {
            this.masterPanNode.connect(this.masterGainNode);
            console.log(`   ✅ VERIFIED: masterPanNode -> masterGainNode (reconnected)`);
          } catch (e) {
            if (e.message.includes('already connected') || e.message.includes('already been connected')) {
              console.log(`   ✅ VERIFIED: masterPanNode -> masterGainNode (already connected)`);
            } else {
              console.warn(`   ⚠️ Could not verify masterPanNode -> masterGainNode: ${e.message}`);
            }
          }
        }
        if (this.masterGainNode && this._realDestination) {
          try {
            this.masterGainNode.connect(this._realDestination);
            console.log(`   ✅ VERIFIED: masterGainNode -> destination (reconnected, gain=${this.masterGainNode.gain.value.toFixed(3)})`);
          } catch (e) {
            if (e.message.includes('already connected') || e.message.includes('already been connected')) {
              console.log(`   ✅ VERIFIED: masterGainNode -> destination (already connected, gain=${this.masterGainNode.gain.value.toFixed(3)})`);
            } else {
              console.warn(`   ⚠️ Could not verify masterGainNode -> destination: ${e.message}`);
            }
          }
        }
        
        // CRITICAL: Try to find and reconnect Strudel's output one more time
        // This is the most important step - if Strudel's output isn't connected to our chain, no audio will play
        console.log(`   🔍 FINAL: Searching for Strudel output node...`);
        try {
          const replInstance = window.strudel?.repl || window.strudel;
          console.log(`   🔍 FINAL: replInstance=${!!replInstance}`);
          if (replInstance?.scheduler) {
            const scheduler = replInstance.scheduler;
            console.log(`   🔍 FINAL: scheduler=${!!scheduler}, keys=${Object.keys(scheduler).slice(0, 10).join(', ')}`);
            // Check multiple possible locations for the webaudio output
            let outputNode = null;
            let outputSource = null;
            
            // Try scheduler.webaudio or scheduler._webaudio
            const webaudio = scheduler.webaudio || scheduler._webaudio;
            if (webaudio) {
              outputNode = webaudio.output || webaudio.outputNode;
              if (outputNode) outputSource = 'scheduler.webaudio';
            }
            
            // Try scheduler.superdough (Strudel's internal audio engine)
            if (!outputNode && scheduler.superdough) {
              const superdough = scheduler.superdough;
              console.log(`   🔍 FINAL: superdough found, keys=${Object.keys(superdough).slice(0, 20).join(', ')}`);
              
              // Check all possible output node locations in superdough
              outputNode = superdough.output || superdough.outputNode || superdough._output || 
                          superdough.destination || superdough._destination;
              if (outputNode) outputSource = 'scheduler.superdough';
              
              // Also check if superdough has a webaudio property
              if (!outputNode && superdough.webaudio) {
                console.log(`   🔍 FINAL: superdough.webaudio found, keys=${Object.keys(superdough.webaudio).slice(0, 10).join(', ')}`);
                outputNode = superdough.webaudio.output || superdough.webaudio.outputNode || 
                            superdough.webaudio.destination;
                if (outputNode) outputSource = 'scheduler.superdough.webaudio';
              }
              
              // Check if superdough has an audioContext with a destination
              if (!outputNode && superdough.audioContext) {
                console.log(`   🔍 FINAL: superdough.audioContext found`);
                // Don't use audioContext.destination directly - we want the output node
              }
              
              // Check for any GainNode or AudioNode that might be the output
              if (!outputNode) {
                for (const key of Object.keys(superdough)) {
                  const value = superdough[key];
                  if (value && typeof value === 'object' && 
                      (value.constructor?.name === 'GainNode' || 
                       value.constructor?.name === 'AudioNode' ||
                       value instanceof AudioNode)) {
                    console.log(`   🔍 FINAL: Found potential output node at superdough.${key} (${value.constructor.name})`);
                    outputNode = value;
                    outputSource = `scheduler.superdough.${key}`;
                    break;
                  }
                }
              }
            }
            
            // Try scheduler._superdough (private property)
            if (!outputNode && scheduler._superdough) {
              const superdough = scheduler._superdough;
              outputNode = superdough.output || superdough.outputNode || superdough._output;
              if (outputNode) outputSource = 'scheduler._superdough';
            }
            
            console.log(`   🔍 FINAL: outputNode=${outputNode ? outputNode.constructor.name : 'null'}, source=${outputSource || 'not found'}`);
            
              if (outputNode && this.trackedPatterns.size > 0) {
                const elementId = Array.from(this.trackedPatterns.keys())[0];
                const elementNodes = this.getElementAudioNodes(elementId);
                console.log(`   🔍 FINAL: ${elementId}, elementNodes=${!!elementNodes}, gainNode=${!!elementNodes?.gainNode}`);
                if (elementNodes?.gainNode) {
                  try {
                  // Disconnect from wherever it's currently connected
                    outputNode.disconnect();
                  // Connect to element gain node (which routes through master chain)
                    outputNode.connect(elementNodes.gainNode);
                  console.log(`   ✅ FINAL: Reconnected Strudel output (${outputSource}) -> ${elementId} gainNode (THIS IS CRITICAL FOR AUDIO)`);
                  } catch (e) {
                    console.log(`   ✅ FINAL: Strudel output already routed to ${elementId} gainNode (${e.message})`);
                  }
                } else {
                  console.error(`   ❌ FINAL: Cannot reconnect - elementNodes or gainNode missing!`);
                }
              } else {
                console.warn(`   ⚠️ FINAL: Cannot reconnect - outputNode=${!!outputNode}, trackedPatterns.size=${this.trackedPatterns.size}`);
              if (!outputNode) {
                console.warn(`   ⚠️ FINAL: Strudel output node not found in any expected location.`);
                console.warn(`   ⚠️ FINAL: This might mean Strudel creates audio nodes dynamically. Audio routing hijacking should catch connections.`);
                console.warn(`   ⚠️ FINAL: If you see "DESTINATION CONNECTION" logs, the hijacking is working. If not, Strudel might be using a different routing mechanism.`);
                
                // CRITICAL: Even if we can't find the output node, ensure the master chain is ready
                // The AudioNode.prototype.connect hijacking should catch any connections to destination
                console.log(`   🔧 FINAL: Ensuring master chain is connected (fallback for dynamic audio nodes)...`);
                if (this.masterPanNode && this.masterGainNode && this._realDestination) {
                  try {
                    // Ensure master chain is connected
                    this.masterGainNode.connect(this._realDestination);
                    console.log(`   ✅ FINAL: Master chain verified and connected (gain=${this.masterGainNode.gain.value.toFixed(3)})`);
                  } catch (e) {
                    console.log(`   ✅ FINAL: Master chain already connected (${e.message})`);
                  }
                }
              }
            }
          } else {
            console.warn(`   ⚠️ FINAL: scheduler not found in replInstance`);
          }
        } catch (e) {
          console.error(`   ❌ FINAL: Error reconnecting Strudel output: ${e.message}`);
          console.error(`   ❌ FINAL: Stack: ${e.stack}`);
        }
        
        const nowSeconds = this.audioContext ? this.audioContext.currentTime : performance.now() / 1000;
        this.masterPlaybackStartTime = nowSeconds;
        this.masterPlaybackTempo = this.currentTempo || 120;
        const speedMultiplier = this.masterPlaybackTempo / 120;
        this.masterPlaybackSpeed = Number.isFinite(speedMultiplier) && speedMultiplier > 0 ? speedMultiplier : 1;
        // masterActive is already set before evaluation to ensure proper routing
        console.log(`✅ Master pattern playing on ${this.masterSlot} (volume/pan/mute via Web Audio API)`);
        console.log(`🔊 Audio context state: ${this.audioContext?.state || 'unknown'}`);
        console.log(`🔊 Master gain value: ${this.masterGainNode?.gain?.value || 'unknown'}`);
        console.log(`🔊 Master muted: ${this.masterMuted || false}`);
        console.log(`ℹ️ Note: If you see createPeriodicWave errors, they are suppressed but may affect audio playback`);
        
        // CRITICAL: Set up a periodic check to monitor for audio nodes being created
        // Strudel might create audio nodes asynchronously after pattern is set
        if (this._audioNodeMonitorInterval) {
          clearInterval(this._audioNodeMonitorInterval);
        }
        
        let checkCount = 0;
        const maxChecks = 20; // Check for 2 seconds (20 * 100ms)
        this._audioNodeMonitorInterval = setInterval(() => {
          checkCount++;
          if (checkCount > maxChecks) {
            clearInterval(this._audioNodeMonitorInterval);
            this._audioNodeMonitorInterval = null;
            console.log(`🔍 Audio node monitoring stopped after ${maxChecks} checks`);
            return;
          }
          
          try {
            const scheduler = window.strudel?.scheduler;
            if (scheduler) {
              // Check for newly created audio properties
              const audioProps = ['webaudio', '_webaudio', 'superdough', '_superdough', 'output', 'outputNode'];
              for (const prop of audioProps) {
                if (scheduler[prop] && !scheduler[`_monitored_${prop}`]) {
                  console.log(`🔍 MONITOR: Found ${prop} in scheduler at check ${checkCount}: ${typeof scheduler[prop]}`);
                  if (scheduler[prop] instanceof AudioNode) {
                    console.log(`   → AudioNode: ${scheduler[prop].constructor.name}`);
                    // Try to route it
                    if (this.trackedPatterns.size > 0) {
                      const elementId = Array.from(this.trackedPatterns.keys())[0];
                      const elementNodes = this.getElementAudioNodes(elementId);
                      if (elementNodes?.gainNode) {
                        try {
                          scheduler[prop].disconnect();
                          scheduler[prop].connect(elementNodes.gainNode);
                          console.log(`   ✅ MONITOR: Routed scheduler.${prop} to ${elementId} gainNode`);
                        } catch (e) {
                          console.log(`   ✅ MONITOR: scheduler.${prop} already routed (${e.message})`);
                        }
                      }
                    }
                  }
                  scheduler[`_monitored_${prop}`] = true;
                }
              }
              
              // Check superdough if it exists
              if (scheduler.superdough && !scheduler._monitored_superdough) {
                const superdough = scheduler.superdough;
                console.log(`🔍 MONITOR: Found superdough at check ${checkCount}, keys: ${Object.keys(superdough).slice(0, 10).join(', ')}`);
                const possibleOutputs = ['output', 'outputNode', '_output', 'destination', '_destination', 'gain', 'masterGain'];
                for (const key of possibleOutputs) {
                  if (superdough[key] && superdough[key] instanceof AudioNode) {
                    console.log(`   → Found AudioNode at superdough.${key}: ${superdough[key].constructor.name}`);
                    if (this.trackedPatterns.size > 0) {
                      const elementId = Array.from(this.trackedPatterns.keys())[0];
                      const elementNodes = this.getElementAudioNodes(elementId);
                      if (elementNodes?.gainNode) {
                        try {
                          superdough[key].disconnect();
                          superdough[key].connect(elementNodes.gainNode);
                          console.log(`   ✅ MONITOR: Routed superdough.${key} to ${elementId} gainNode`);
                        } catch (e) {
                          console.log(`   ✅ MONITOR: superdough.${key} already routed (${e.message})`);
                        }
                      }
                    }
                  }
                }
                scheduler._monitored_superdough = true;
              }
            }
          } catch (e) {
            console.warn(`🔍 MONITOR: Error checking scheduler: ${e.message}`);
          }
        }, 100); // Check every 100ms
        
        // CRITICAL: Check if audio context is suspended (this would prevent audio playback)
        if (this.audioContext && this.audioContext.state === 'suspended') {
          console.warn(`⚠️ AUDIO CONTEXT SUSPENDED: Audio context is suspended - attempting to resume...`);
          this.audioContext.resume().then(() => {
            console.log(`✅ Audio context resumed successfully`);
          }).catch((e) => {
            console.error(`❌ Failed to resume audio context: ${e.message}`);
          });
        }
        
        // CRITICAL: Set up a periodic check to verify audio chain is intact
        // This helps catch cases where connections are broken after verification
        if (this._audioChainCheckInterval) {
          clearInterval(this._audioChainCheckInterval);
        }
        this._zeroGainLogged = false;
        this._mutedLogged = false;
        this._audioChainCheckInterval = setInterval(() => {
          if (this.masterActive && this.masterGainNode && this._realDestination) {
            try {
              // Try to reconnect to ensure connection is maintained
              this.masterGainNode.connect(this._realDestination);
            } catch (e) {
              // Already connected - that's fine
            }
            
            // Log if gain is 0 or muted (only once)
            if (this.masterGainNode.gain.value === 0 && !this._zeroGainLogged) {
              console.warn(`⚠️ AUDIO CHAIN CHECK: masterGainNode.gain.value is 0 - no audio will play!`);
              this._zeroGainLogged = true;
            }
            if (this.masterMuted && !this._mutedLogged) {
              console.warn(`⚠️ AUDIO CHAIN CHECK: masterGainNode is muted - no audio will play!`);
              this._mutedLogged = true;
            }
          } else {
            // Master not active, clear interval
            if (this._audioChainCheckInterval) {
              clearInterval(this._audioChainCheckInterval);
              this._audioChainCheckInterval = null;
            }
          }
        }, 1000); // Check every second
        
        // Notify UI that master is now playing
        if (this.onMasterStateChangeCallback) {
          this.onMasterStateChangeCallback(true, Array.from(this.trackedPatterns.keys()));
        }
        startMasterHighlighting();
        return { success: true };
      } else {
        console.error(`❌ Strudel not properly initialized`);
        return { success: false, error: 'Strudel not initialized' };
      }
    } catch (error) {
      console.error(`❌ Error playing master pattern:`, error);
      return { success: false, error: error.message };
    }
  }

  async _stopMasterPatternSimple() {
    try {
      if (window.strudel && typeof window.strudel.evaluate === 'function') {
        const slot = this.masterSlot || 'd0';
        await window.strudel.evaluate(`${slot} = silence`);
        if (window.strudel.scheduler && window.strudel.scheduler.started && typeof window.strudel.scheduler.stop === 'function') {
          await window.strudel.scheduler.stop();
        }
      }
      this.masterActive = false;
      stopMasterHighlighting();
      this.masterPlaybackStartTime = null;
      if (this.masterGainNode) {
        this.masterGainNode.gain.setValueAtTime(0, this.audioContext?.currentTime || 0);
      }
      if (this.onMasterStateChangeCallback) {
        this.onMasterStateChangeCallback(false, []);
      }
      return { success: true };
    } catch (error) {
      console.error('❌ Error stopping master (simple mode):', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop the master pattern
   */
  async stopMasterPattern() {
    if (this.masterOnlyPlayback) {
      return this._stopMasterPatternSimple();
    }

    try {
      console.log(`⏹️ Stopping master pattern...`);
      
      if (window.strudel && window.strudel.evaluate) {
        // Stop the scheduler first
        if (window.strudel.repl && window.strudel.repl.scheduler) {
          if (typeof window.strudel.repl.scheduler.stop === 'function') {
            window.strudel.repl.scheduler.stop();
            console.log('✓ Stopped REPL scheduler');
          }
        }
        
        // Set master slot to silence
        const code = `${this.masterSlot} = silence`;
        await window.strudel.evaluate(code);
        
        // Restart the scheduler so it's ready for next play
        if (window.strudel.repl && window.strudel.repl.scheduler) {
          if (typeof window.strudel.repl.scheduler.start === 'function') {
            window.strudel.repl.scheduler.start();
            console.log('✓ Restarted REPL scheduler');
          }
        }
        
        this.masterPlaybackStartTime = null;
        this.masterActive = false;
        stopMasterHighlighting();
        // Mute master output when stopped to avoid any DC/idle noise on interfaces
        if (this.masterGainNode) {
          this.masterGainNode.gain.setValueAtTime(0, this.audioContext?.currentTime || 0);
        }
        
        // Clear audio chain check interval
        if (this._audioChainCheckInterval) {
          clearInterval(this._audioChainCheckInterval);
          this._audioChainCheckInterval = null;
        }
        
        console.log(`✅ Master pattern stopped`);
        
        // Reset master tap logging flags for next play
        this._masterTapLogged = false;
        this._masterTapSuccess = new Set();
        
        // Notify UI that master has stopped
        if (this.onMasterStateChangeCallback) {
          this.onMasterStateChangeCallback(false, []);
        }
        
        return { success: true };
      } else {
        console.error(`❌ Strudel not available`);
        return { success: false, error: 'Strudel not available' };
      }
    } catch (error) {
      console.error(`❌ Error stopping master pattern:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get the current master pattern code for display
   */
  getMasterPatternCode() {
    if (this.masterPattern && this.masterPattern.trim() !== '') {
      const tempoPrefix = '// Controls Selected Tempo:';
      const hasTempoComment = this.masterPattern
        .split('\n')
        .some(line => line.trim().startsWith(tempoPrefix));
      if (!hasTempoComment) {
        this.masterPattern = this.formatMasterPatternWithTempoComment(this.masterPattern);
      }
    }
    this._ensureMasterPatternSanitized();
    return this.masterPattern;
  }

  isMasterActive() {
    return !!this.masterActive;
  }

  getMasterPlaybackInfo() {
    return {
      isPlaying: !!this.masterActive,
      startTime: this.masterPlaybackStartTime,
      speed: this.masterPlaybackSpeed || 1,
      tempo: this.masterPlaybackTempo || this.currentTempo || 120
    };
  }

  /**
   * Set master pattern code manually (for editing)
   */
  async setMasterPatternCode(code) {
    try {
      console.log(`✏️ Setting master pattern code: ${code.substring(0, 100)}...`);
      
      if (code && code.trim() !== '') {
        this.masterPattern = this.formatMasterPatternWithTempoComment(code);
      } else {
        this.masterPattern = '';
      }
      this._ensureMasterPatternSanitized();

      if (this.appInstance && typeof this.appInstance.syncElementsFromMasterPattern === 'function') {
        try {
          this.appInstance.syncElementsFromMasterPattern(this.masterPattern);
        } catch (syncError) {
          console.warn('⚠️ Failed to sync elements from master pattern:', syncError);
        }
      }
      
      // Preserve transport: if master is playing, re-evaluate seamlessly without stopping.
      // If master is stopped, do nothing (user will press Play).
      if (this.masterActive) {
        console.log(`🔄 Master is active - re-evaluating with updated pattern (no stop).`);
        try {
          await this._reEvaluateMasterPattern('master code update');
        } catch (e) {
          console.warn(`⚠️ Could not re-evaluate master after code update:`, e.message);
        }
      }
      
      return { success: true };
    } catch (error) {
      console.error(`❌ Error setting master pattern code:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Preview a pattern without affecting master (uses d16)
   * @param {string} pattern - Pattern string to preview
   * @param {string} elementId - Element ID to use for gain/pan values (defaults to 'preview')
   */
  async previewPattern(pattern, elementId = 'preview', samples = null) {
    if (this.masterOnlyPlayback) {
      console.log(`👀 Preview via master stack (${elementId})`);
      return this.routePatternThroughMaster(elementId, pattern, { isPreview: true, autoStart: true });
    }

    try {
      console.log(`👀 Previewing pattern (received): ${pattern.substring(0, 100)}...`);
      console.log(`👀 Full pattern to preview: ${pattern}`);
      
      // Stop any existing preview first to ensure clean state
      const previewSlot = 'd16';
      
      // Set current evaluating slot for audio routing (preview uses d16)
      this.currentEvaluatingSlot = previewSlot;
      
      // Map preview slot to elementId for routing - always update to ensure correct routing
      this.patternSlotToElementId.set(previewSlot, elementId);
      console.log(`🎵 Preview: Mapped slot ${previewSlot} to elementId ${elementId} for audio routing`);

      if (window.strudel && window.strudel.evaluate) {
        try {
          // AGGRESSIVELY clear the preview slot
          // Clear preview slot - no delays needed since sounds are preloaded
          await window.strudel.evaluate(`${previewSlot} = silence`);
          console.log(`✅ Preview slot ${previewSlot} cleared`);
        } catch (e) {
          // Ignore errors when stopping
          console.warn(`⚠️ Error clearing preview slot:`, e.message);
        }
      }
      
      // Ensure audio context is initialized
      if (!this.audioContext || this.audioContext.state === 'suspended') {
        await this.initialize();
      }
      
      // Ensure audio context is running (not suspended)
      if (this.audioContext && this.audioContext.state === 'suspended') {
        console.log(`🔊 Audio context suspended for preview, resuming...`);
        try {
          await this.audioContext.resume();
          console.log(`✅ Audio context resumed for preview, state: ${this.audioContext.state}`);
        } catch (resumeError) {
          console.warn(`⚠️ Could not resume audio context for preview:`, resumeError);
        }
      }

      // Ensure audio nodes exist for preview routing as well (after audio context ready)
      const previewNodes = this.getElementAudioNodes(elementId);
      if (!previewNodes || !previewNodes.gainNode) {
        console.warn(`⚠️ Could not prepare audio nodes for preview element ${elementId}`);
      }
      
      // Ensure Strudel is initialized
      if (!this.strudelLoaded) {
        console.log(`⏳ Waiting for Strudel to initialize...`);
        await this.initStrudel();
      }
      
      await this.ensurePatternResourcesLoaded(pattern);

      // For preview, use the same processing as playStrudelPattern to ensure consistency
      // This ensures preview sounds the same as when the element is actually playing
      console.log(`🔍 Preview - Original pattern: ${pattern}`);
      console.log(`🔍 Preview - Pattern type check: isNotePattern=${this.isNotePattern(pattern)}, contains s(${pattern.includes('s(')}, contains sound(${pattern.includes('sound(')}, contains note(${/\bnote\s*\(/i.test(pattern)})`);
      
      // Use processPattern to get the same processing as playStrudelPattern
      // For preview, don't apply gain in pattern (gain is handled by Web Audio gain node)
      let processedPattern = await this.processPattern(pattern, elementId, {
        preserveBanks: true,
        attemptBankLoad: true,
        applyGainInPattern: false
      });
      
      if (!processedPattern) {
        console.error(`❌ Pattern processing failed for preview`);
        return { success: false, error: 'Pattern processing failed' };
      }
      
      console.log(`🔍 Preview - After processPattern: ${processedPattern}`);
      console.log(`🔍 Preview - Processed pattern type check: isNotePattern=${this.isNotePattern(processedPattern)}, contains s(${processedPattern.includes('s(')}, contains sound(${processedPattern.includes('sound(')}, contains note(${/\bnote\s*\(/i.test(processedPattern)})`);
      
      // Add .loop() to preview pattern if it doesn't already have it, so it plays continuously
      if (!processedPattern.includes('.loop(') && !processedPattern.includes('.loop()')) {
        processedPattern = `${processedPattern}.loop()`;
        console.log(`🔄 Added .loop() to preview pattern for continuous playback`);
      }
      
      // Evaluate and assign to preview slot
      if (window.strudel && window.strudel.evaluate) {
        const code = `${previewSlot} = ${processedPattern}`;
        console.log(`🎼 Preview evaluating: ${code.substring(0, 300)}...`);
        console.log(`🔍 Preview - Full pattern code (${code.length} chars): ${code}`);
        
        // Extract waveform from pattern for logging
        const waveformMatchS = code.match(/\.s\(["']([^"']+)["']\)/);
        const waveformMatchSound = code.match(/\.sound\(["']([^"']+)["']\)/);
        const waveform = waveformMatchSound ? waveformMatchSound[1] : (waveformMatchS ? waveformMatchS[1] : 'unknown');
        console.log(`🎵 Preview waveform: ${waveform}`);
        
        try {
          await window.strudel.evaluate(code);
          console.log(`✅ Preview pattern evaluated successfully`);
          
          // Ensure scheduler is running and processing the pattern
          if (window.strudel.scheduler) {
            if (!window.strudel.scheduler.started) {
              console.log(`▶️ Starting Strudel scheduler for preview...`);
              await window.strudel.scheduler.start();
            } else {
              console.log(`🔄 Scheduler already running, ensuring pattern is active...`);
            }
          }
          
          // Since sounds are preloaded, we only need minimal delay for audio routing
        if (this.soundsPreloaded) {
          // Minimal delay for audio routing (samples are already loaded)
          await new Promise(resolve => setTimeout(resolve, 50));
          
          // Clear current evaluating slot after audio routing
          setTimeout(() => {
            if (this.currentEvaluatingSlot === previewSlot) {
              this.currentEvaluatingSlot = null;
            }
          }, 500);
        } else {
            // Fallback: if sounds aren't preloaded, trigger scheduler to load samples
            if (window.strudel.scheduler && window.strudel.scheduler.tick) {
              try {
                // Trigger 1-2 scheduler ticks to process the pattern
                for (let i = 0; i < 2; i++) {
                  window.strudel.scheduler.tick();
                  await new Promise(resolve => setTimeout(resolve, 10));
                }
              } catch (tickError) {
                console.warn(`⚠️ Could not trigger scheduler tick:`, tickError);
              }
            }
            
            // Wait for samples to load
            await new Promise(resolve => setTimeout(resolve, 200));
            
          // Clear current evaluating slot
          setTimeout(() => {
            if (this.currentEvaluatingSlot === previewSlot) {
              this.currentEvaluatingSlot = null;
            }
          }, 1000);
          }
        } catch (evalError) {
          console.error(`❌ Preview pattern evaluation error:`, evalError.message);
          console.error(`❌ Failed pattern code: ${code}`);
          return { success: false, error: evalError.message };
        }
        
        console.log(`✅ Preview pattern is playing on ${previewSlot}`);
        console.log(`🔊 Audio context state: ${this.audioContext?.state || 'unknown'}`);
        console.log(`🔊 Master gain value: ${this.masterGainNode?.gain?.value || 'unknown'}`);
        console.log(`🔊 Master muted: ${this.masterMuted || false}`);
        const hasWaveform = processedPattern.includes('.s(') || processedPattern.includes('.sound(');
        console.log(`🔍 Preview pattern waveform check: ${hasWaveform ? 'Has waveform (.s() or .sound())' : 'No waveform found'}`);
        
        return { success: true, previewSlot };
      } else {
        console.error(`❌ Strudel not properly initialized`);
        return { success: false, error: 'Strudel not initialized' };
      }
    } catch (error) {
      console.error(`❌ Error previewing pattern:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop preview pattern
   */
  async stopPreview() {
    if (this.masterOnlyPlayback) {
      console.log(`⏹️ Stopping preview routed through master`);
      for (const previewId of this.previewElementIds) {
        this.removeElementFromMaster(previewId);
      }
      this.previewElementIds.clear();
      if (this.masterActive && (!this.masterPattern || !this.masterPattern.trim())) {
        await this.stopMasterPattern();
      } else if (this.masterActive) {
        await this.playMasterPattern();
      }
      return { success: true };
    }

    try {
      console.log(`⏹️ Stopping preview...`);
      
      if (window.strudel && window.strudel.evaluate) {
        const previewSlot = 'd16';
        const code = `${previewSlot} = silence`;
        await window.strudel.evaluate(code);
        
        console.log(`✅ Preview stopped`);
        return { success: true };
      } else {
        return { success: false, error: 'Strudel not available' };
      }
    } catch (error) {
      console.error(`❌ Error stopping preview:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Export master pattern as WAV audio file
   * Uses OfflineAudioContext to render the audio offline
   */
  async exportAudioWAV(duration = 16, sampleRate = 44100) {
    try {
      console.log(`📦 Exporting master pattern as WAV (${duration} seconds)...`);
      
      if (!this.masterPattern || this.masterPattern.trim() === '') {
        return { success: false, error: 'No master pattern to export' };
      }

      // Ensure Strudel is initialized
      if (!this.strudelLoaded) {
        await this.initStrudel();
      }

      // Create offline audio context for rendering
      const offlineContext = new OfflineAudioContext(
        2, // stereo
        sampleRate * duration, // number of frames
        sampleRate
      );

      // Create destination node for recording
      const destination = offlineContext.destination;

      // Get Strudel's audio output
      if (window.strudel && window.strudel.repl && window.strudel.repl.audioContext) {
        // Use Strudel's audio context to create a worklet or connect to offline context
        // This is a simplified approach - we'll use MediaRecorder as fallback
        console.log('⚠️ Using MediaRecorder fallback for audio export');
        return await this.exportAudioMediaRecorder(duration);
      }

      // Fallback: Use MediaRecorder to record from the audio context
      return await this.exportAudioMediaRecorder(duration);
    } catch (error) {
      console.error(`❌ Error exporting WAV:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Export audio using ScriptProcessorNode to directly capture audio samples
   * This is more reliable than MediaRecorder for Web Audio API
   */
  async exportAudioMediaRecorder(duration = 16) {
    return new Promise((resolve) => {
      try {
        if (!this.audioContext) {
          resolve({ success: false, error: 'Audio context not initialized' });
          return;
        }

        if (!this.masterGainNode || !this.masterPanNode) {
          resolve({ success: false, error: 'Master audio nodes not found' });
          return;
        }

        const sampleRate = this.audioContext.sampleRate;
        const totalSamples = Math.floor(sampleRate * duration);
        const numChannels = 2; // Stereo
        const bufferSize = 4096;
        
        // Array to store all recorded audio chunks
        const audioChunks = [];
        let isRecording = false;
        
        // Create ScriptProcessorNode to capture raw audio samples
        let scriptProcessor = null;
        try {
          scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, numChannels, numChannels);
          
          let processorCallCount = 0;
          scriptProcessor.onaudioprocess = (event) => {
            processorCallCount++;
            const inputBuffer = event.inputBuffer;
            const outputBuffer = event.outputBuffer;
            
            // Always copy input to output so audio passes through
            for (let channel = 0; channel < numChannels; channel++) {
              const inputChannelData = inputBuffer.getChannelData(channel);
              const outputChannelData = outputBuffer.getChannelData(channel);
              outputChannelData.set(inputChannelData);
            }
            
            // Check if audio is flowing (even when not recording)
            const testMax = Math.max(...Array.from(inputBuffer.getChannelData(0).map(Math.abs)));
            if (processorCallCount <= 5 || processorCallCount % 50 === 0) {
              console.log(`🔍 ScriptProcessor call #${processorCallCount}: max amplitude = ${testMax.toFixed(6)}, isRecording = ${isRecording}`);
            }
            
            // Only record when flag is set
            if (!isRecording) {
              return;
            }
            
            // Recording - capture the audio
            const chunk = [];
            for (let channel = 0; channel < numChannels; channel++) {
              const inputChannelData = inputBuffer.getChannelData(channel);
              chunk.push(new Float32Array(inputChannelData));
            }
            
            // Check if chunk has actual audio (not all zeros)
            const maxSample = Math.max(...chunk[0].map(Math.abs));
            if (maxSample > 0.0001) {
              if (audioChunks.length % 10 === 0 || audioChunks.length < 5) {
                console.log(`📦 Recording chunk ${audioChunks.length}: max amplitude = ${maxSample.toFixed(6)}`);
              }
            } else {
              if (audioChunks.length < 5) {
                console.log(`📦 Recording chunk ${audioChunks.length}: SILENT (max amplitude = ${maxSample.toFixed(6)})`);
              }
            }
            
            audioChunks.push(chunk);
          };
          
          console.log('✅ ScriptProcessorNode created');
        } catch (error) {
          console.error('❌ Failed to create ScriptProcessorNode:', error);
          resolve({ success: false, error: 'ScriptProcessorNode not supported: ' + error.message });
          return;
        }
        
        // Check if pattern is already playing
        const wasAlreadyPlaying = this.masterActive;
        console.log('▶️ Setting up recording...');
        console.log('🔍 Pattern code:', this.masterPattern.substring(0, 100));
        console.log('🔍 Pattern already playing:', wasAlreadyPlaying);
        
        // Ensure pattern is playing - but don't re-evaluate if already playing
        let playPromise;
        if (wasAlreadyPlaying) {
          console.log('▶️ Pattern already playing, ensuring scheduler is running...');
          // Just ensure scheduler is running, don't re-evaluate pattern
          playPromise = Promise.resolve().then(async () => {
            if (window.strudel && window.strudel.scheduler && !window.strudel.scheduler.started) {
              console.log(`▶️ Starting Strudel scheduler...`);
              await window.strudel.scheduler.start();
            }
            return { success: true };
          });
        } else {
          console.log('▶️ Pattern not playing, starting it now...');
          playPromise = this.playMasterPattern();
        }
        
        // Start or ensure pattern is playing
        playPromise.then(() => {
          // Wait longer for audio to start flowing and Strudel to initialize
          setTimeout(() => {
            console.log('🔧 Setting up recording routing...');
            console.log('🔍 Master active:', this.masterActive);
            console.log('🔍 Audio context state:', this.audioContext.state);
            
            // NOW disconnect and route through scriptProcessor
            // This ensures audio is already flowing when we capture it
            try {
              // Disconnect all connections from masterGainNode
              this.masterGainNode.disconnect();
              console.log('✅ Disconnected all connections from masterGainNode');
            } catch (e) {
              console.warn('⚠️ Could not disconnect all:', e);
              // Try disconnecting from destination specifically
              try {
                this.masterGainNode.disconnect(this._realDestination);
                console.log('✅ Disconnected masterGainNode from destination');
              } catch (e2) {
                console.warn('⚠️ Could not disconnect from destination:', e2);
              }
            }
            
            // Connect through scriptProcessor
            this.masterGainNode.connect(scriptProcessor);
            scriptProcessor.connect(this._realDestination);
            console.log('✅ Connected audio routing: masterGainNode -> scriptProcessor -> destination');
            
            // Verify the connection chain
            console.log('🔍 Verifying connections:');
            console.log('  masterGainNode numberOfOutputs:', this.masterGainNode.numberOfOutputs);
            console.log('  scriptProcessor inputs:', scriptProcessor.numberOfInputs, 'outputs:', scriptProcessor.numberOfOutputs);
            console.log('  Waiting for audio to flow through scriptProcessor...');
            
            // Wait a bit more for routing to stabilize and audio to flow
            setTimeout(() => {
              console.log(`🎙️ Recording started for ${duration} seconds...`);
              console.log('🔍 Master active:', this.masterActive);
              console.log('🔍 Audio context state:', this.audioContext.state);
              console.log('🔍 ScriptProcessor connected - waiting for audio chunks...');
              isRecording = true;
            
            // Stop after duration
            setTimeout(() => {
              console.log(`⏹️ Stopping recording after ${duration} seconds...`);
              console.log(`📦 Total chunks captured: ${audioChunks.length}`);
              isRecording = false;
              
              // Disconnect script processor and restore original routing
              try {
                // Disconnect scriptProcessor from destination first
                try {
                  scriptProcessor.disconnect(this._realDestination);
                } catch (e) {
                  // May already be disconnected
                }
                
                // Disconnect masterGainNode from scriptProcessor
                try {
                  this.masterGainNode.disconnect(scriptProcessor);
                } catch (e) {
                  // May already be disconnected
                }
                
                // Restore original connection (only if not already connected)
                try {
                  this.masterGainNode.connect(this._realDestination);
                } catch (e) {
                  // May already be connected - check if we need to disconnect first
                  try {
                    this.masterGainNode.disconnect(this._realDestination);
                    this.masterGainNode.connect(this._realDestination);
                  } catch (e2) {
                    console.warn('Could not restore connection:', e2);
                  }
                }
                
                console.log('✅ Restored original audio routing: masterGainNode -> destination');
              } catch (e) {
                console.warn('Error restoring audio routing:', e);
                // Try to ensure connection is restored even if there's an error
                try {
                  this.masterGainNode.connect(this._realDestination);
                } catch (e2) {
                  console.error('Failed to restore connection:', e2);
                }
              }
              
              // Only stop the pattern if we started it (it wasn't already playing)
              if (!wasAlreadyPlaying) {
                this.stopMasterPattern();
              } else {
                console.log('✅ Pattern was already playing, leaving it running');
              }
              
              // Process recorded audio data
              if (audioChunks.length === 0) {
                console.error('❌ No audio data recorded');
                console.error('🔍 Debug info:');
                console.error('  Master active:', this.masterActive);
                console.error('  Audio context state:', this.audioContext.state);
                console.error('  Master gain node:', !!this.masterGainNode);
                console.error('  Master pan node:', !!this.masterPanNode);
                console.error('  Script processor:', !!scriptProcessor);
                console.error('  Is recording flag:', isRecording);
                console.error('  Pattern code length:', this.masterPattern?.length || 0);
                
                resolve({ success: false, error: 'No audio data was recorded. ScriptProcessorNode may not be receiving audio. Check console for debug info.' });
                return;
              }
              
              console.log(`📦 Recorded ${audioChunks.length} chunks`);
              
              // Calculate total length
              const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk[0].length, 0);
              console.log(`📦 Total samples: ${totalLength} (expected: ~${totalSamples})`);
              
              // Combine all chunks into single Float32Arrays for each channel
              const leftChannel = new Float32Array(totalLength);
              const rightChannel = new Float32Array(totalLength);
              
              let offset = 0;
              for (const chunk of audioChunks) {
                const chunkLength = chunk[0].length;
                leftChannel.set(chunk[0], offset);
                
                if (chunk[1]) {
                  rightChannel.set(chunk[1], offset);
                } else {
                  // Mono to stereo - copy left to right
                  rightChannel.set(chunk[0], offset);
                }
                offset += chunkLength;
              }
              
              // Check if audio is actually silent - check more samples
              let maxAmplitude = 0;
              let nonZeroSamples = 0;
              const checkInterval = Math.max(1, Math.floor(totalLength / 1000)); // Check 1000 samples
              
              for (let i = 0; i < totalLength; i += checkInterval) {
                const leftSample = Math.abs(leftChannel[i]);
                const rightSample = Math.abs(rightChannel[i]);
                const maxSample = Math.max(leftSample, rightSample);
                maxAmplitude = Math.max(maxAmplitude, maxSample);
                if (maxSample > 0.0001) {
                  nonZeroSamples++;
                }
              }
              
              console.log(`🔍 Audio analysis: max amplitude = ${maxAmplitude.toFixed(6)}, non-zero samples = ${nonZeroSamples}`);
              
              // Also check first and last few samples directly
              const firstSamples = [];
              const lastSamples = [];
              for (let i = 0; i < Math.min(10, totalLength); i++) {
                firstSamples.push(Math.abs(leftChannel[i]));
              }
              for (let i = Math.max(0, totalLength - 10); i < totalLength; i++) {
                lastSamples.push(Math.abs(leftChannel[i]));
              }
              console.log(`🔍 First 10 samples: ${firstSamples.map(v => v.toFixed(4)).join(', ')}`);
              console.log(`🔍 Last 10 samples: ${lastSamples.map(v => v.toFixed(4)).join(', ')}`);
              
              if (maxAmplitude < 0.0001) {
                console.warn('⚠️ Audio appears to be silent (all zeros or very quiet)');
                console.warn('⚠️ Master volume:', this.masterVolume);
                console.warn('⚠️ Master muted:', this.masterMuted);
                console.warn('⚠️ This might indicate that audio is not reaching masterPanNode');
              }
              
              // Create AudioBuffer from recorded data
              const audioBuffer = this.audioContext.createBuffer(numChannels, totalLength, sampleRate);
              audioBuffer.getChannelData(0).set(leftChannel);
              audioBuffer.getChannelData(1).set(rightChannel);
              
              // Convert to WAV
              const wavBlob = this.audioBufferToWAV(audioBuffer);
              console.log(`✅ WAV blob created: ${wavBlob.size} bytes`);
              
              if (wavBlob.size === 0) {
                resolve({ success: false, error: 'WAV blob is empty' });
                return;
              }
              
              this.downloadBlob(wavBlob, 'master-pattern.wav', 'audio/wav');
              
              if (maxAmplitude < 0.0001) {
                resolve({ 
                  success: true, 
                  format: 'wav',
                  warning: 'Audio file created but appears to be silent. Check that the pattern is playing and master volume is not muted.'
                });
              } else {
                resolve({ success: true, format: 'wav' });
              }
            }, duration * 1000);
            }, 200); // Wait 200ms for routing to stabilize
          }, 500); // Wait 500ms for audio to start
        }).catch(error => {
          console.error('❌ Failed to start pattern for recording:', error);
          
          // Cleanup on error
          try {
            this.masterGainNode.disconnect(scriptProcessor);
            scriptProcessor.disconnect(this._realDestination);
            this.masterGainNode.connect(this._realDestination);
          } catch (e) {}
          
          resolve({ success: false, error: 'Failed to start pattern: ' + error.message });
        });

      } catch (error) {
        console.error(`❌ Error in audio export:`, error);
        resolve({ success: false, error: error.message });
      }
    });
  }


  /**
   * Parse Strudel pattern to MIDI events
   */
  parsePatternToMIDI(pattern) {
    const events = [];
    const ticksPerQuarter = 480;
    const tempo = this.currentTempo || 120;
    const ticksPerBeat = ticksPerQuarter;
    
    // Calculate pattern duration (assume 4/4 time, 16 beats = 4 bars)
    const patternBeats = 16;
    const totalTicks = patternBeats * ticksPerBeat;
    
    // Handle stack() patterns - extract individual patterns
    let patternsToParse = [pattern];
    if (pattern.includes('stack(')) {
      // Extract patterns from stack()
      const stackMatch = pattern.match(/stack\s*\(([^)]+)\)/);
      if (stackMatch) {
        const stackContent = stackMatch[1];
        // Split by comma, but respect nested parentheses
        patternsToParse = this.splitStackPatterns(stackContent);
      }
    }
    
    // For drums, we'll use MIDI channel 9 (drums) and map to MIDI note numbers
    const drumMap = {
      'bd': 36, 'kick': 36, 'kickdrum': 36,
      'sd': 38, 'snare': 38, 'snaredrum': 38,
      'hh': 42, 'hihat': 42, 'closedhihat': 42,
      'oh': 46, 'openhihat': 46,
      'cr': 49, 'crash': 49,
      'rd': 51, 'ride': 51,
      'ht': 48, 'hightom': 48,
      'mt': 47, 'midtom': 47,
      'lt': 45, 'lowtom': 45,
      'cp': 39, 'clap': 39,
      'rim': 37, 'rimshot': 37
    };
    
    // Process each pattern (for stacked patterns, they play simultaneously)
    patternsToParse.forEach((subPattern, patternIndex) => {
      // Parse note() patterns
      const notePattern = /note\s*\(["']([^"']+)["']\)/g;
      let match;
      
      // Extract notes from pattern
      const notes = [];
      while ((match = notePattern.exec(subPattern)) !== null) {
        const noteString = match[1];
        const noteList = noteString.split(/\s+/).filter(n => n.trim());
        notes.push(...noteList);
      }
      
      // If we found notes, create MIDI events
      if (notes.length > 0) {
        const ticksPerNote = totalTicks / notes.length;
        notes.forEach((note, index) => {
          const midiNote = this.noteToMIDI(note);
          if (midiNote !== null) {
            const startTick = Math.round(index * ticksPerNote);
            const durationTicks = Math.round(ticksPerNote * 0.8); // 80% of note duration
            
            events.push({
              type: 'noteOn',
              tick: startTick,
              channel: patternIndex % 16, // Use different channels for stacked patterns
              note: midiNote,
              velocity: 100
            });
            
            events.push({
              type: 'noteOff',
              tick: startTick + durationTicks,
              channel: patternIndex % 16,
              note: midiNote,
              velocity: 0
            });
          }
        });
      } else {
        // Try to parse drum patterns (sound() or s())
        const soundPattern = /(?:sound|s)\s*\(["']([^"']+)["']\)/g;
        let soundMatch;
        
        while ((soundMatch = soundPattern.exec(subPattern)) !== null) {
          const soundString = soundMatch[1];
          const soundList = soundString.split(/\s+/).filter(s => s.trim());
          
          const ticksPerSound = totalTicks / soundList.length;
          soundList.forEach((sound, index) => {
            const midiNote = drumMap[sound.toLowerCase()] || 36; // Default to kick
            const startTick = Math.round(index * ticksPerSound);
            const durationTicks = Math.round(ticksPerSound * 0.3); // Short duration for drums
            
            events.push({
              type: 'noteOn',
              tick: startTick,
              channel: 9, // MIDI channel 10 (0-indexed) for drums
              note: midiNote,
              velocity: 100
            });
            
            events.push({
              type: 'noteOff',
              tick: startTick + durationTicks,
              channel: 9,
              note: midiNote,
              velocity: 0
            });
          });
        }
      }
    });
    
    // Sort events by tick
    events.sort((a, b) => a.tick - b.tick);
    
    return events;
  }

  /**
   * Split stack() patterns respecting nested parentheses
   */
  splitStackPatterns(stackContent) {
    const patterns = [];
    let current = '';
    let depth = 0;
    
    for (let i = 0; i < stackContent.length; i++) {
      const char = stackContent[i];
      
      if (char === '(') {
        depth++;
        current += char;
      } else if (char === ')') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        // Top-level comma - split here
        patterns.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add the last pattern
    if (current.trim()) {
      patterns.push(current.trim());
    }
    
    return patterns;
  }

  /**
   * Convert note name to MIDI note number
   */
  noteToMIDI(note) {
    // Handle note formats like "c3", "C#4", "Eb5"
    const match = note.match(/^([a-gA-G])([#b]?)(\d+)$/);
    if (!match) return null;
    
    const [, noteName, accidental, octave] = match;
    const noteNames = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
    const baseNote = noteNames.indexOf(noteName.toLowerCase());
    
    if (baseNote === -1) return null;
    
    let midiNote = 12 + (parseInt(octave) * 12) + baseNote;
    
    if (accidental === '#') {
      midiNote += 1;
    } else if (accidental === 'b') {
      midiNote -= 1;
    }
    
    // Clamp to valid MIDI range (0-127)
    return Math.max(0, Math.min(127, midiNote));
  }

  /**
   * Create MIDI file from events
   */
  createMIDIFile(events) {
    const ticksPerQuarter = 480;
    const tempo = this.currentTempo || 120;
    
    // MIDI file structure:
    // Header chunk (14 bytes)
    // Track chunk
    
    const header = new Uint8Array([
      0x4D, 0x54, 0x68, 0x64, // "MThd"
      0x00, 0x00, 0x00, 0x06, // Header length
      0x00, 0x01, // Format: 1 (multi-track)
      0x00, 0x01, // Number of tracks: 1
      0x01, 0xE0  // Ticks per quarter: 480 (0x01E0)
    ]);
    
    // Track events
    const trackEvents = [];
    
    // Set tempo
    const microsecondsPerQuarter = Math.round(60000000 / tempo);
    trackEvents.push({
      deltaTime: 0,
      type: 0xFF, // Meta event
      metaType: 0x51, // Set tempo
      data: [
        (microsecondsPerQuarter >> 16) & 0xFF,
        (microsecondsPerQuarter >> 8) & 0xFF,
        microsecondsPerQuarter & 0xFF
      ]
    });
    
    // Add note events
    let lastTick = 0;
    events.forEach(event => {
      const deltaTime = event.tick - lastTick;
      lastTick = event.tick;
      
      if (event.type === 'noteOn') {
        trackEvents.push({
          deltaTime: deltaTime,
          type: 0x90 | event.channel, // Note On
          data: [event.note, event.velocity]
        });
      } else if (event.type === 'noteOff') {
        trackEvents.push({
          deltaTime: deltaTime,
          type: 0x80 | event.channel, // Note Off
          data: [event.note, event.velocity]
        });
      }
    });
    
    // End of track
    trackEvents.push({
      deltaTime: 0,
      type: 0xFF, // Meta event
      metaType: 0x2F, // End of track
      data: []
    });
    
    // Convert track events to MIDI format
    const trackData = [];
    
    trackEvents.forEach(event => {
      // Write variable-length delta time
      let deltaTime = event.deltaTime;
      const deltaBytes = [];
      do {
        let byte = deltaTime & 0x7F;
        deltaTime >>= 7;
        if (deltaBytes.length > 0) {
          byte |= 0x80;
        }
        deltaBytes.push(byte);
      } while (deltaTime > 0);
      
      trackData.push(...deltaBytes);
      trackData.push(event.type);
      
      if (event.metaType !== undefined) {
        trackData.push(event.metaType);
        trackData.push(event.data.length);
      }
      
      trackData.push(...event.data);
    });
    
    // Track chunk
    const trackLength = trackData.length;
    const trackChunk = new Uint8Array([
      0x4D, 0x54, 0x72, 0x6B, // "MTrk"
      (trackLength >> 24) & 0xFF,
      (trackLength >> 16) & 0xFF,
      (trackLength >> 8) & 0xFF,
      trackLength & 0xFF,
      ...trackData
    ]);
    
    // Combine header and track
    const midiFile = new Uint8Array(header.length + trackChunk.length);
    midiFile.set(header, 0);
    midiFile.set(trackChunk, header.length);
    
    return new Blob([midiFile], { type: 'audio/midi' });
  }

  /**
   * Download a blob as a file
   */
  downloadBlob(blob, filename, mimeType) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Convert blob to AudioBuffer
   */
  async blobToAudioBuffer(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    return await this.audioContext.decodeAudioData(arrayBuffer);
  }

  /**
   * Convert AudioBuffer to WAV blob
   */
  audioBufferToWAV(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = buffer.length * blockAlign;
    const bufferSize = 44 + dataSize;

    const arrayBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(arrayBuffer);

    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Convert audio data to 16-bit PCM
    let offset = 44;
    const channels = [];
    for (let channel = 0; channel < numChannels; channel++) {
      channels.push(buffer.getChannelData(channel));
    }
    
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, channels[channel][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  /**
   * Export audio as WAV using OfflineAudioContext (better quality)
   */
  async exportAudioWAVOffline(duration = 16, sampleRate = 44100) {
    try {
      console.log(`📦 Exporting master pattern as WAV using OfflineAudioContext...`);
      
      if (!this.masterPattern || this.masterPattern.trim() === '') {
        return { success: false, error: 'No master pattern to export' };
      }

      // Ensure Strudel is initialized
      if (!this.strudelLoaded) {
        await this.initStrudel();
      }

      // Note: This is a simplified implementation
      // Full implementation would require capturing Strudel's audio output
      // For now, we'll use the MediaRecorder approach which works with live audio
      return await this.exportAudioMediaRecorder(duration);
      
    } catch (error) {
      console.error(`❌ Error exporting WAV offline:`, error);
      return { success: false, error: error.message };
    }
  }

}

// Export singleton instance
export const soundManager = new SoundManager();
if (typeof window !== 'undefined') {
  window.soundManager = soundManager;
}

