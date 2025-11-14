/**
 * Sound Manager - Coordinates Strudel patterns and Web Audio API
 */

import { soundConfig } from './config.js';
import { Note, Scale } from '@tonaljs/tonal';

// Import Strudel modules statically at top level to avoid duplicate bundling
// Use dynamic imports but cache them to ensure single instance
let strudelModulesPromise = null;
let coreModule = null;
let webaudioModule = null;
let webModule = null;
let tonalModule = null;
let samplerModule = null;

async function getStrudelModules() {
  // Create promise only once - this ensures all calls use the same module instances
  // Vite will pre-bundle these, and we cache them to prevent duplicate imports
  if (!strudelModulesPromise) {
    strudelModulesPromise = Promise.all([
      import('@strudel/core'),
      import('@strudel/web'),
      import('@strudel/webaudio'),
      import('@strudel/tonal')
    ]).then(modules => {
      coreModule = modules[0];
      webModule = modules[1];
      webaudioModule = modules[2];
      tonalModule = modules[3];
      // Note: @strudel/sampler has broken package.json exports, can't be imported
      // Drum samples come from @strudel/webaudio via samples() function
      samplerModule = null;
      
      return { coreModule, webModule, webaudioModule, tonalModule, samplerModule };
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
  pentatonicMinor: 'minor pentatonic'
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
suppressAudioContextWarnings();

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
    this.elementAnalysers = new Map(); // elementId -> analyserNode (for VU meters)
    this.vuMeterAnimationId = null; // Animation frame ID for VU meter updates
    this.vuMeterWarnedNoAnalysers = false; // Avoid spamming logs when meters not yet registered
    this.masterAnalyser = null; // Fallback analyser on master bus
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
    this.masterPanNode = null; // Master pan node
    this.masterVolume = 0.7; // Master volume (0-1)
    this.masterPan = 0; // Master pan (-1 to 1)
    this.masterMuted = false; // Master mute state
    this.masterVolumeBeforeMute = 0.7; // Store volume before mute
    
    // Master pattern system
    this.masterPattern = ''; // Combined pattern code
    this.masterSlot = 'd0'; // Dedicated slot for master output
    this.trackedPatterns = new Map(); // elementId -> {pattern, gain, pan, muted, soloed}
    this.masterActive = false; // Is master pattern playing
    this.masterPlaybackStartTime = null;
    this.masterPlaybackSpeed = 1;
    this.masterPlaybackTempo = this.currentTempo;

    // Cache for scale conversion context
    this._cachedScaleContext = null;
    this._cachedScaleKey = '';
    
    // Audio export state
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
  }
  
  /**
   * Get the pattern slot for an element (assigns one if not already assigned)
   */
  getPatternSlot(elementId) {
    if (!this.strudelPatternSlots.has(elementId)) {
      const slotName = `d${this.nextPatternSlot}`;
      this.strudelPatternSlots.set(elementId, slotName);
      this.patternSlotToElementId.set(slotName, elementId); // Create reverse map
      console.log(`🎵 Assigned ${elementId} to pattern slot ${slotName}`);
      this.nextPatternSlot++;
      // Wrap around after d16 (Strudel typically supports d1-d16)
      if (this.nextPatternSlot > 16) {
        this.nextPatternSlot = 1;
      }
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
          console.log('🎚️ AudioContext constructor hijacked - returning our shared context');
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
        
        // NOW load Strudel - it will use our hijacked AudioContext
        // CRITICAL: Load Strudel AFTER hijacking AudioContext
        // This ensures createReverb and other effect methods are available AND use our context
        if (!this.strudelLoaded) {
          console.log('🎚️ Loading Strudel after hijacking AudioContext to ensure it uses our shared context...');
          await this.loadStrudelFromCDN();
        }
        
        // Create master channel nodes
        this.masterPanNode = this.audioContext.createStereoPanner();
        this.masterGainNode = this.audioContext.createGain();
        
        // Store the real destination BEFORE overriding
        this._realDestination = this.audioContext.destination;
        
        // Insert analyser between master pan and gain for fallback metering
        this.masterAnalyser = this.audioContext.createAnalyser();
        this.masterAnalyser.fftSize = 256;
        this.masterAnalyser.smoothingTimeConstant = 0.8;

        // Connect: masterPan -> masterAnalyser -> masterGain -> REAL destination
        this.masterPanNode.connect(this.masterAnalyser);
        this.masterAnalyser.connect(this.masterGainNode);
        this.masterGainNode.connect(this._realDestination);
        
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
            // Skip AnalyserNodes - they're passive readers, not sources
            const isAnalyserNode = this.constructor.name === 'AnalyserNode';
            
            // Only intercept connections to destinations, not internal GainNode->GainNode connections
            // Intercepting internal routing causes feedback loops
            // Check if connecting to the master destination OR any AudioContext destination
            const isMasterDestination = (
              destination === realDestination ||
              destination === audioContextInstance.destination ||
              destination === masterPanNode ||
              destination === masterGainNode
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
            
            if ((isMasterDestination || isAnyAudioContextDestination) && soundManagerInstance.masterActive && !isAnalyserNode) {
              // Debug logging for master destination connections
              if (!soundManagerInstance._masterDestinationConnectLogged) {
                console.log(`🎚️ INTERCEPTING connection to destination: ${this.constructor.name} -> ${destination?.constructor?.name}, masterActive=${soundManagerInstance.masterActive}, trackedPatterns=${soundManagerInstance.trackedPatterns.size}`);
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
                console.log(`🎚️ Intercepting ${nodeType} connecting to ${destination?.constructor?.name}`);
                soundManagerInstance._nodeTypeConnectLogged.add(nodeType);
              }
              
              let elementId = null;
              
              // PRIORITY 1: Check trackedPatterns first (for master pattern routing)
              // This is the most reliable way to route master pattern audio
              if (soundManagerInstance.trackedPatterns.size > 0) {
                const trackedElementIds = Array.from(soundManagerInstance.trackedPatterns.keys());
                
                if (trackedElementIds.length === 1) {
                  // Single element master - route through that element's gain node
                  elementId = trackedElementIds[0];
                  if (!soundManagerInstance._singleElementMasterRoutingLogged) {
                    console.log(`🎚️ Single element master detected, routing through ${elementId} (trackedPatterns.size=${soundManagerInstance.trackedPatterns.size})`);
                    soundManagerInstance._singleElementMasterRoutingLogged = true;
                  }
                } else {
                  // Multiple elements - try to match by currentEvaluatingSlot first
                  if (soundManagerInstance.currentEvaluatingSlot) {
                    const slotElementId = soundManagerInstance.patternSlotToElementId.get(soundManagerInstance.currentEvaluatingSlot);
                    if (slotElementId && trackedElementIds.includes(slotElementId)) {
                      elementId = slotElementId;
                      console.log(`🎚️ Multi-element master: routing via currentEvaluatingSlot ${soundManagerInstance.currentEvaluatingSlot} -> ${elementId}`);
                    }
                  }
                  
                  // If no match by slot, check all tracked slots
                  if (!elementId) {
                    for (const [slotName, elemId] of soundManagerInstance.patternSlotToElementId.entries()) {
                      if (trackedElementIds.includes(elemId)) {
                        try {
                          const slotValue = globalThis[slotName];
                          // Check if this slot has an active pattern (not silence) and is tracked
                          if (slotValue && slotValue !== globalThis.silence && 
                              slotValue._Pattern) {
                            // This element is part of the master stack - route through its gain node
                            elementId = elemId;
                            console.log(`🎚️ Found element from tracked slot: ${elementId} (slot: ${slotName})`);
                            break;
                          }
                        } catch (e) {
                          // Ignore errors
                        }
                      }
                    }
                  }
                }
              }
              
              // PRIORITY 2: Check currentEvaluatingSlot (for individual element playback)
              if (!elementId && soundManagerInstance.currentEvaluatingSlot) {
                elementId = soundManagerInstance.patternSlotToElementId.get(soundManagerInstance.currentEvaluatingSlot);
                if (elementId) {
                  console.log(`🎚️ Found element from currentEvaluatingSlot: ${elementId} (slot: ${soundManagerInstance.currentEvaluatingSlot})`);
                }
              }
              
              // PRIORITY 3: Check all active slots (fallback)
              if (!elementId) {
                for (const [slotName, elemId] of soundManagerInstance.patternSlotToElementId.entries()) {
                  try {
                    const slotValue = globalThis[slotName];
                    if (slotValue && slotValue !== globalThis.silence) {
                      elementId = elemId;
                      console.log(`🎚️ Found element from active slot: ${elementId} (slot: ${slotName})`);
                      break;
                    }
                  } catch (e) {
                    // Ignore errors
                  }
                }
              }
              
              // If we found an element, route through its gain node (which includes analyser)
              if (elementId) {
                const elementNodes = soundManagerInstance.getElementAudioNodes(elementId);
                if (elementNodes && elementNodes.gainNode) {
                  // Route audio through element gain node for VU meter
                  // The element gain node is already connected to element analyser -> master
                  // So audio will flow: source -> elementGain -> elementPan -> elementAnalyser -> master
                  console.log(`🎚️ INTERCEPTED: Routing ${elementId} audio through element gain node for VU meter (${this.constructor.name} -> ${elementNodes.gainNode.constructor.name})`);
                  
                  // Connect to element gain node - this routes through the analyser chain
                  // The chain is: source -> elementGain -> elementPan -> analyser -> masterPan -> masterGain -> destination
                  // This ensures audio flows through VU meter analyser AND master chain
                  const connectResult = this.__originalConnect.call(this, elementNodes.gainNode, outputIndex, inputIndex);
                  
                  // Don't connect directly to destination - let the element gain node chain handle routing
                  // The visualizer analyser is connected to master gain node, so it will receive audio
                  // through the master chain: elementGain -> elementPan -> analyser -> masterPan -> masterGain -> visualizerAnalyser -> destination
                  
                  return connectResult;
                } else {
                  console.warn(`⚠️ Element ${elementId} found but no gain node available`);
                }
              } else {
                // For stack() patterns evaluated on d0, element slots aren't active
                // Try to route through element gain nodes first if we can identify the element
                // Otherwise fall back to master chain
                const isStackPattern = soundManagerInstance.masterActive && soundManagerInstance.trackedPatterns.size > 1;
                
                if (isStackPattern) {
                  // For stack patterns, try to route through element gain nodes in round-robin fashion
                  // This ensures each pattern in the stack routes through its corresponding element
                  // We use a simple round-robin based on connection order
                  if (!soundManagerInstance._stackConnectionCount) {
                    soundManagerInstance._stackConnectionCount = new Map();
                  }
                  
                  // Get tracked element IDs in order
                  const trackedElementIds = Array.from(soundManagerInstance.trackedPatterns.keys());
                  
                  // Count connections per element (round-robin)
                  let connectionCount = soundManagerInstance._stackConnectionCount.get('total') || 0;
                  const elementIndex = connectionCount % trackedElementIds.length;
                  const elementId = trackedElementIds[elementIndex];
                  soundManagerInstance._stackConnectionCount.set('total', connectionCount + 1);
                  
                  // Try to route through this element's gain node
                  const elementNodes = soundManagerInstance.getElementAudioNodes(elementId);
                  if (elementNodes && elementNodes.gainNode) {
                    if (!soundManagerInstance._stackElementRoutingLogged) {
                      soundManagerInstance._stackElementRoutingLogged = new Set();
                    }
                    if (!soundManagerInstance._stackElementRoutingLogged.has(elementId)) {
                      console.log(`🎚️ Stack() pattern: Routing ${elementId} audio through element gain node (round-robin, ${trackedElementIds.length} elements)`);
                      soundManagerInstance._stackElementRoutingLogged.add(elementId);
                    }
                    return this.__originalConnect.call(this, elementNodes.gainNode, outputIndex, inputIndex);
                  }
                  
                  // Fallback: route through master chain if element routing fails
                  if (masterPanNode) {
                    if (!soundManagerInstance._stackMasterRoutingLogged) {
                      console.log(`🎚️ Stack() pattern: Routing through master chain (fallback, ${trackedElementIds.length} elements)`);
                      soundManagerInstance._stackMasterRoutingLogged = true;
                    }
                    return this.__originalConnect.call(this, masterPanNode, outputIndex, inputIndex);
                  }
                }
                
                // Log why no element was found (only occasionally to avoid spam)
                if (!soundManagerInstance._noElementRoutingLogged) {
                  console.log(`🎚️ No element found for routing - trackedPatterns.size=${soundManagerInstance.trackedPatterns.size}, currentEvaluatingSlot=${soundManagerInstance.currentEvaluatingSlot}`);
                  soundManagerInstance._noElementRoutingLogged = true;
                }
              }
              
              // Fallback: route through master if no element found
              if (masterPanNode) {
                // Only log once
                if (!soundManagerInstance._masterRoutingLogged) {
                  console.log('🎚️ INTERCEPTED: Routing', this.constructor.name, 'through master channel');
                  soundManagerInstance._masterRoutingLogged = true;
                }
                return this.__originalConnect.call(this, masterPanNode, outputIndex, inputIndex);
              }
            }
            
            // For all other connections, use original connect
            return this.__originalConnect.call(this, destination, outputIndex, inputIndex);
          };
          
          console.log('🎚️ Patched AudioNode.prototype.connect to route through element gain nodes or master channel');
        }
        
        // Store masterPanNode reference on audioContext so the patch can access it
        this.audioContext.__masterPanNode = this.masterPanNode;
        
        console.log('Audio context created with master channel, state:', this.audioContext.state);
        console.log(`🎚️ Master initialized: volume=${(this.masterVolume * 100).toFixed(0)}%, pan=${this.masterPan.toFixed(2)}`);
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
        
        // Load default sound banks (TR-808, TR-909, etc.) after everything is initialized
        // This ensures window.strudel is fully set up and ready
        console.log('📦 Loading default drum samples...');
        this.ensureDefaultSoundBanks().catch(error => {
          console.warn('⚠️ Could not load default sound banks:', error);
        });
        
        // Start VU meter loop
        this.startVUMeterLoop();
        console.log(`🎚️ Master values set: volume=${(this.masterVolume * 100).toFixed(0)}%, pan=${this.masterPan.toFixed(2)}`);
        
        // Initialize Strudel and load sound banks
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
      console.log(`🎚️ Master volume set to ${(this.masterVolume * 100).toFixed(0)}% (gainNode instant via Web Audio API)`);
    } else {
      console.log(`🎚️ Master volume stored as ${(this.masterVolume * 100).toFixed(0)}% (gainNode not ready yet)`);
    }
  }

  /**
   * Set master pan (-1 to 1)
   */
  setMasterPan(value) {
    this.masterPan = Math.max(-1, Math.min(1, value));
    if (this.masterPanNode) {
      this.masterPanNode.pan.value = this.masterPan;
      console.log(`🎚️ Master pan set to ${this.masterPan.toFixed(2)} (panNode instant via Web Audio API)`);
    } else {
      console.log(`🎚️ Master pan stored as ${this.masterPan.toFixed(2)} (panNode not ready yet)`);
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
      const analyser = this.audioContext.createAnalyser();
      
      // Configure analyser for VU meter
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      
      // Set default values
      const gainValue = this.elementGainValues.get(elementId) || 0.8;
      const panValue = this.elementPanValues.get(elementId) || 0;

      // Store nodes before wiring them so intercepted connections don't recurse
      this.elementGainNodes.set(elementId, gainNode);
      this.elementPanNodes.set(elementId, panNode);
      this.elementAnalysers.set(elementId, analyser);
      this.elementGainValues.set(elementId, gainValue);
      this.elementPanValues.set(elementId, panValue);
      
      gainNode.gain.value = gainValue * this.volume;
      panNode.pan.value = panValue;
      
      // Connect: elementGain -> elementPan -> analyser -> masterPan
      // The analyser is in the chain so it receives all audio flowing through the element
      gainNode.connect(panNode);
      panNode.connect(analyser);
      // Connect analyser to master so the chain is complete
      // This ensures audio flows: Strudel -> elementGain -> elementPan -> analyser -> masterPan -> masterGain -> destination
      if (this.masterPanNode) {
        analyser.connect(this.masterPanNode);
      } else if (this.masterGainNode) {
        analyser.connect(this.masterGainNode);
      } else if (this.gainNode) {
        analyser.connect(this.gainNode);
      } else {
        console.warn(`⚠️ No master node available for ${elementId} analyser - audio may not play`);
      }
      
      // Verify the connection chain
      console.log(`🎚️ Element audio chain for ${elementId}:`);
      console.log(`   gainNode (${gainNode.numberOfInputs} inputs, ${gainNode.numberOfOutputs} outputs)`);
      console.log(`   panNode (${panNode.numberOfInputs} inputs, ${panNode.numberOfOutputs} outputs)`);
      console.log(`   analyser (${analyser.numberOfInputs} inputs, ${analyser.numberOfOutputs} outputs)`);
      console.log(`   masterPanNode (${this.masterPanNode ? this.masterPanNode.numberOfInputs : 'N/A'} inputs)`);
      
      console.log(`🎚️ Created element audio chain for ${elementId}: gain -> pan -> analyser -> master (total analysers: ${this.elementAnalysers.size})`);
      console.log(`🎚️ Analyser context: ${analyser.context === this.audioContext ? 'MATCH' : 'MISMATCH'}, fftSize: ${analyser.fftSize}, frequencyBinCount: ${analyser.frequencyBinCount}`);

      // Reset warning flag now that at least one analyser exists
      this.vuMeterWarnedNoAnalysers = false;
    }

    return {
      gainNode: this.elementGainNodes.get(elementId),
      panNode: this.elementPanNodes.get(elementId)
    };
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
  applyElementGainPanToPattern(pattern, elementId) {
    const gain = this.elementGainValues.get(elementId) || 0.8;
    const pan = this.elementPanValues.get(elementId) || 0;
    const tempo = this.currentTempo || 120;
    
    // Apply gain, pan, and tempo modifiers by chaining directly (no parentheses)
    // Note: Strudel's gain is 0-1, pan is -1 to 1 (0 = center)
    // Chain modifiers directly without wrapping in parentheses to avoid evaluation issues
    let modifiedPattern = `${pattern}.gain(${gain})`;
    
    // Only add .pan() if pan value is not 0 (not center)
    if (pan !== 0) {
      modifiedPattern += `.pan(${pan})`;
    }
    
    // Use .fast() or .slow() to adjust tempo based on current tempo vs 120 BPM base
    // First convert BPM to a speed multiplier (120 BPM = 1.0x speed)
    const speedMultiplier = tempo / 120;
    
    // Apply tempo adjustment - use .fast() or .slow() to control tempo
    // This is more reliable than .cpm() which might not exist
    if (speedMultiplier > 1.0) {
      modifiedPattern += `.fast(${speedMultiplier})`;
    } else if (speedMultiplier < 1.0) {
      modifiedPattern += `.slow(${1 / speedMultiplier})`;
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
        const builtInDrumBanks = ['RolandTR808', 'RolandTR909', 'RolandTR707', 'RhythmAce', 'AkaiLinn', 'ViscoSpaceDrum', 'EmuSP1200', 'CasioRZ1'];
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
    patternToEval = this.applyElementGainPanToPattern(patternToEval, elementId);
    
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
      console.log(`🎚️ Updated ${elementId} gain node to ${(gain * this.volume).toFixed(2)}`);
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
      console.log(`🎚️ Updated ${elementId} pan node to ${pan.toFixed(2)}`);
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
      patternToEval = this.applyElementGainPanToPattern(patternToEval, elementId);
      
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
      console.log(`🎚️ Updated tracked pattern for ${elementId} in master: ${newPattern.substring(0, 60)}...`);
      
      // Update the master pattern to reflect the changes
      this.updateMasterPattern(this.soloedElements, this.mutedElements);
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
      patternToEval = this.applyElementGainPanToPattern(patternToEval, elementId);
      
      // Update the pattern slot directly without stopping
      await window.strudel.evaluate(`${patternSlot} = ${patternToEval}`);
      console.log(`✅ Updated ${patternSlot} pattern in place: ${patternToEval.substring(0, 60)}...`);
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
          
          // Get the pattern slot for this element (each element gets its own slot)
          const patternSlot = this.getPatternSlot(elementId);
          console.log(`Assigning pattern to ${patternSlot} for element ${elementId}`);

          // Ensure element-specific audio nodes (including analyser) exist before routing
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
            patternToEval = this.applyElementGainPanToPattern(
              cached.processedPattern.replace(/\.gain\([^)]*\)/g, '').replace(/\.pan\([^)]*\)/g, '').replace(/\.fast\([^)]*\)/g, '').replace(/\.slow\([^)]*\)/g, '').trim(),
              elementId
            );
          } else {
            // No cache or pattern changed - process pattern normally
            console.log(`📝 Processing pattern for ${elementId} (not cached)`);
            patternToEval = await this.processPattern(pattern, elementId);
            
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
          
          // Directly assign the pattern with gain/pan applied
          const assignmentCode = `${patternSlot} = ${patternToEval}`;
          console.log(`🎼 ${elementId} → ${patternSlot}:`);
          console.log(`   Full Pattern: ${patternToEval}`);
          console.log(`   Assignment: ${assignmentCode}`);
          
          try {
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
        ...(webModule || {})
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
      
      // Create a custom webaudioOutput that routes through element gain nodes
      // Strudel's webaudioOutput connects directly to audioContext.destination
      // We wrap it to route through element gain nodes (for VU meters) then master
      const createElementRoutedOutput = (originalOutput) => {
        return (audioContext, options = {}) => {
          console.log('🎚️ createElementRoutedOutput called!');
          console.log('  audioContext provided:', audioContext ? audioContext.constructor.name : 'null');
          console.log('  our audioContext:', this.audioContext ? this.audioContext.constructor.name : 'null');
          console.log('  contexts match:', audioContext === this.audioContext);
          
          // CRITICAL: Force Strudel to use our AudioContext
          // If Strudel passes a different context, use ours instead
          const contextToUse = (audioContext === this.audioContext) ? audioContext : this.audioContext;
          if (audioContext !== this.audioContext) {
            console.warn('⚠️ Strudel passed different AudioContext, forcing use of our shared context');
          }
          
          console.log('  Calling original webaudioOutput with our context');
          
          // Call the original output with OUR context to ensure all nodes are in our context
          const outputNode = originalOutput(contextToUse, options);
          console.log('  Original output returned:', outputNode ? outputNode.constructor.name : 'null');
          console.log('  Output node context:', outputNode?.context === this.audioContext ? 'OUR CONTEXT ✅' : 'DIFFERENT CONTEXT ⚠️');
          
          // Intercept the connect method to route through element gain nodes
          if (outputNode && typeof outputNode.connect === 'function') {
            const originalConnect = outputNode.connect.bind(outputNode);
            
            outputNode.connect = (destination, outputIndex, inputIndex) => {
              console.log(`🎚️ WRAPPER CONNECT CALLED: destination=${destination?.constructor?.name || 'unknown'}, currentEvaluatingSlot=${this.currentEvaluatingSlot}`);
              
              // IMPORTANT: Don't intercept here - let the global patch handle it
              // This wrapper was capturing stale closure values
              return originalConnect(destination, outputIndex, inputIndex);
            };
          }
          
          // Return the output node as normal
          return outputNode;
        };
      };
      
      const elementRoutedOutput = (this.masterPanNode && this.masterGainNode) 
        ? createElementRoutedOutput(webaudioOutput)
        : webaudioOutput;
      
      console.log('🎚️ Element-routed output created:', !!elementRoutedOutput);
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
        console.log('🎚️ Passing elementRoutedOutput to initStrudel:', !!elementRoutedOutput);
        try {
          const initOptions = {
            audioContext: this.audioContext,
            getTime: () => this.audioContext ? this.audioContext.currentTime : 0,
            audioOutput: elementRoutedOutput, // Use element-routed output
            editPattern: () => {}, // Dummy function to prevent editor issues
            setUrl: () => {}, // Dummy function to prevent URL issues
            destination: this.masterPanNode // Try passing destination explicitly
          };
          console.log('🎚️ initStrudel options:', Object.keys(initOptions));
          console.log('🎚️ audioOutput type:', typeof elementRoutedOutput);
          console.log('🎚️ destination:', this.masterPanNode ? this.masterPanNode.constructor.name : 'null');
          const strudelContext = await initStrudel(initOptions);
          
          replInstance = strudelContext.repl || strudelContext;
          console.log('✅ initStrudel completed, replInstance:', !!replInstance);
          console.log('replInstance type:', typeof replInstance);
          console.log('replInstance.evaluate available:', typeof replInstance?.evaluate);
          console.log('strudelContext keys:', Object.keys(strudelContext));
          
          // If replInstance doesn't have evaluate, try to create a proper REPL
          if (!replInstance || typeof replInstance.evaluate !== 'function') {
            console.warn('replInstance.evaluate not available, creating REPL manually...');
            replInstance = repl({
              defaultOutput: elementRoutedOutput,
              audioContext: this.audioContext,
              getTime: () => this.audioContext.currentTime
            });
            console.log('Created manual REPL, evaluate available:', typeof replInstance.evaluate);
          }
        } catch (initError) {
          console.warn('initStrudel failed, falling back to manual REPL:', initError);
          // Fall back to manual creation
          replInstance = repl({
            defaultOutput: elementRoutedOutput,
            audioContext: this.audioContext,
            getTime: () => this.audioContext.currentTime
          });
        }
      } else {
        // Create REPL with minimal config - functions are now in globalThis
        console.log('Creating REPL manually (initStrudel not available)...');
        replInstance = repl({
          defaultOutput: elementRoutedOutput,
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
        
        // NOW we can safely start the scheduler (pattern slots are initialized)
        if (replInstance.scheduler) {
          console.log('▶️ Starting scheduler now that pattern slots are initialized...');
          try {
            if (typeof replInstance.scheduler.start === 'function') {
              replInstance.scheduler.start();
              console.log('✅ REPL scheduler started');
            }
            if (typeof replInstance.scheduler.setActive === 'function') {
              replInstance.scheduler.setActive(true);
              console.log('✅ REPL scheduler set to active');
            }
            
            // Connect scheduler output to master channel
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
          } catch (schedError) {
            console.warn('⚠️ Could not start scheduler:', schedError);
          }
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
              })()
            `);
            // Wait a bit for async import to complete
            await new Promise(resolve => setTimeout(resolve, 300));
            console.log('✅ Draw functions (spiral, pitchwheel) loaded into REPL context');
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
            console.warn('⚠️ Could not patch getAudioContext (module may be read-only):', patchError.message);
            console.log('ℹ️ AudioContext hijacking should still ensure Strudel uses our shared context');
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
          defaultOutput: strudelModule.webaudioOutput,
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
            console.log('✅ Draw functions (spiral, pitchwheel) loaded into REPL context');
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
    const activeSound = this.activeSounds.get(elementId);
    
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
  }

  /**
   * Stop all sounds (useful for cleanup)
   */
  stopAllSounds() {
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
    
    // SECOND: Stop Strudel scheduler FIRST (this stops all scheduled events)
    // Store scheduler for restart later
    let schedulerToRestart = null;
    
    if (window.strudel && window.strudel.repl && window.strudel.repl.scheduler) {
      try {
        schedulerToRestart = window.strudel.repl.scheduler;
        if (typeof window.strudel.repl.scheduler.stop === 'function') {
          window.strudel.repl.scheduler.stop();
          console.log('✓ Stopped REPL scheduler (immediate)');
        }
      } catch (e) {
        // Ignore
      }
    }
    
    // Restart scheduler after stopping (so it's ready for next play)
    setTimeout(() => {
      if (schedulerToRestart && typeof schedulerToRestart.start === 'function') {
        try {
          schedulerToRestart.start();
          console.log('✓ Restarted REPL scheduler (ready for next play)');
        } catch (e) {
          console.log('⚠️ Could not restart scheduler:', e);
        }
      }
    }, 150);
    
    // THIRD: Stop all Strudel patterns IMMEDIATELY (synchronous evaluation)
    if (window.strudel && window.strudel.evaluate) {
      console.log('🔇 Silencing all Strudel pattern slots (d1-d16)...');
      // Use Promise.all to stop all patterns in parallel, but don't wait
      const silencePromises = [];
      for (let i = 1; i <= 16; i++) {
        try {
          // Fire and forget - don't await, just trigger immediately
          const promise = window.strudel.evaluate(`d${i} = silence`).catch(() => {});
          silencePromises.push(promise);
          console.log(`✓ d${i} = silence (triggered)`);
        } catch (e) {
          console.log(`Could not silence d${i}`);
        }
      }
      // Don't await - let them complete in background
      Promise.all(silencePromises).then(() => {
        console.log('✅ All pattern slots silenced');
      }).catch(() => {});
    }
    
    // FOURTH: Suspend audio context (but master gain is already 0, so this is extra safety)
    if (this.audioContext) {
      console.log('🔇 Suspending audio context...');
      if (this.audioContext.state === 'running') {
        this.audioContext.suspend().then(() => {
          console.log('✅ Audio context suspended');
        }).catch(err => {
          console.log('Could not suspend:', err);
        });
      }
    }
    
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
    
    console.log('✅✅✅ EMERGENCY STOP COMPLETE ✅✅✅');
    console.log('Audio context will remain suspended. Click anywhere to resume audio.');
    
    // Resume audio context after 500ms so user can click to enable audio again
    setTimeout(() => {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        console.log('Audio ready to resume on next interaction');
        if (this.gainNode) {
          this.gainNode.gain.value = this.volume;
        }
      }
    }, 500);
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
      if (!trackData || !trackData.rawPattern) continue;
      const normalizedPattern = trackData.rawPattern;
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
    
    // Check if pattern is in note names format - if so, don't convert, preserve as-is
    // Note names have letter notes (a-g) followed by optional accidental and octave
    const hasNoteNames = /\b(note|n)\s*\(\s*["'][a-gA-G][#b]?\d/.test(pattern);
    // Numeric notes are pure numbers/spaces (e.g., n("0 2 4")), NOT note names with octaves
    const hasNumericNotes = /\b(n|note)\s*\(\s*["'][\d\s\-]+["']/.test(pattern) && 
                            !/\b(note|n)\s*\(\s*["'][a-gA-G]/.test(pattern);
    
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
    const hasNoteNames = /\b(note|n)\s*\(\s*["'][a-gA-G][#b]?\d/.test(modifiedPattern) ||
                         (/\b(note|n)\s*\(\s*["'][a-gA-G][#b]/.test(modifiedPattern) && 
                          !/\b(note|n)\s*\(\s*["'][\d\s\-]+["']/.test(modifiedPattern));
    
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
    // Patterns with .chord() modifier should not be treated as numeric patterns for scale application
    // Even if they use numeric note values like n("0 1 2 3").chord("<C Am F G>")
    const isNumericPattern = hasNoteFunction && !hasExplicitNotes && !hasChordModifier;

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
      console.warn('Cannot load sound banks: Strudel not initialized');
      return false;
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
          const ds = "https://raw.githubusercontent.com/felixroos/dough-samples/main/";
          
          // Track which samples loaded successfully
          const loadResults = {
            tidalDrums: false,
            piano: false,
            dirt: false,
            emusp12: false,
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
            
            samplesFunc(`${ds}/EmuSP12.json`).then(() => {
              console.log('  ✅ EmuSP12 samples loaded');
              loadResults.emusp12 = true;
            }).catch(e => console.warn('  ⚠️ Could not load EmuSP12:', e.message)),
            
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
      console.log('📦 Available: Piano, Dirt-Samples, EmuSP12, VCSL, Mridangam, Drum Machines (TR-808, TR-909, TR-707, etc.)');
      
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
    if (!window.strudel || !window.strudel.evaluate) {
      console.warn('Cannot preload drum sounds: Strudel not initialized');
      return false;
    }

    try {
      console.log('📦 Preloading all common drum sounds...');
      
      // All common drum sounds from DRUM_ABBREVIATIONS
      const commonSounds = ['bd', 'sd', 'hh', 'cp', 'oh', 'cr', 'rd', 'ht', 'mt', 'lt', 'sh', 'cb', 'tb', 'perc', 'misc', 'fx', 'rim'];
      
      // Create a pattern with all common sounds to trigger sample loading
      const preloadPattern = `s("${commonSounds.join(' ')}")`;
      
      // Use a temporary slot (d15) for preloading
      const preloadSlot = 'd15';
      
      // Evaluate the pattern to trigger sample loading
      const code = `${preloadSlot} = ${preloadPattern}`;
      console.log('📦 Evaluating preload pattern to trigger sample loading...');
      await window.strudel.evaluate(code);
      
      // Wait a bit for samples to load
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Clear the preload pattern immediately to prevent playback
      await window.strudel.evaluate(`${preloadSlot} = silence`);
      
      // Wait a bit more for all samples to finish loading
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log('✅ All common drum sounds preloaded');
      return true;
    } catch (error) {
      console.warn('⚠️ Error preloading drum sounds:', error);
      return false;
    }
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
      'EmuSP1200', 'CasioRZ1'
    ];
    
    const builtInSampleBanks = [
      'piano', 'superpiano', 'jazz', 'supersaw', 'folkharp',
      'casio', 'insect', 'wind', 'wood', 'metal', 'east', 'crow', 'space', 'numbers',
      'sawtooth', 'sine', 'square', 'triangle', 'saw', 'saw2', 'saw3', 'saw4', 'saw8',
      'gtr'
    ];
    
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
    const bankNameLower = bankName.toLowerCase();
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
   * Ensure that any banks or built-in synth waveforms referenced in a pattern
   * are loaded before evaluation (handles master stack playback)
   */
  async ensurePatternResourcesLoaded(pattern) {
    if (!pattern || typeof pattern !== 'string' || typeof this.loadBank !== 'function') {
      return;
    }

    // Built-in oscillator waveforms that don't need to be loaded (they're always available)
    // Note: Sample-based synths like "piano", "gtr", "wood", "casio", etc. need to be loaded via loadBank()
    const builtInOscillatorSynths = new Set([
      'sine', 'square', 'triangle', 'sawtooth', 'supersaw', 'pulse',
      'saw', 'saw2', 'saw3', 'saw4', 'saw8'
    ]);

    const bankNames = new Set();

    const bankRegex = /\.bank\(["']([^"']+)["']\)/g;
    let match;
    while ((match = bankRegex.exec(pattern)) !== null) {
      if (match[1]) {
        bankNames.add(match[1]);
      }
    }

    const sampleRegex = /\.s\(["']([^"']+)["']\)/g;
    while ((match = sampleRegex.exec(pattern)) !== null) {
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
    while ((match = soundRegex.exec(pattern)) !== null) {
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
  saveElementToMaster(elementId, pattern, gain, pan) {
    try {
      console.log(`💾 Saving ${elementId} to master: pattern="${pattern?.substring(0, 50)}...", gain=${gain}, pan=${pan}`);
      
      // Normalize quotes in pattern before storing
      const normalizedPattern = (pattern || '').replace(/[""]/g, '"').replace(/['']/g, "'");
      
      // Check if pattern is in note names format (e.g., note("C4 E4 G4"))
      const hasNoteNames = /\b(note|n)\s*\(\s*["'][a-gA-G][#b]?\d/.test(normalizedPattern);
      const hasNumericNotes = /\b(n|note)\s*\(\s*["'][\d\s]+["']/.test(normalizedPattern);
      
      // Preserve the original format: store rawPattern as-is (what user wrote)
      // Store pattern as the same format (no conversion) - master will preserve each track's format
      // If pattern uses note names, keep as note names; if semitones, keep as semitones
      const preparedPattern = normalizedPattern;  // Always preserve the original format
      
      this.trackedPatterns.set(elementId, {
        rawPattern: normalizedPattern,  // Original pattern as written
        pattern: preparedPattern,  // Same as rawPattern - preserve format
        gain: gain || 0.8,
        pan: pan || 0,
        muted: false,
        soloed: false
      });
      
      // Ensure audio nodes (including analyser) are created for this element
      // This is needed for VU meters to work
      if (this.audioContext) {
        const nodes = this.getElementAudioNodes(elementId);
        if (nodes) {
          const analyser = this.elementAnalysers.get(elementId);
          console.log(`  🎚️ Created audio nodes for ${elementId}, analyser: ${analyser ? 'yes' : 'no'}`);
        }
      }
      
      console.log(`✅ Saved ${elementId} to master. Total tracks: ${this.trackedPatterns.size}`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Error saving ${elementId} to master:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove element pattern from master
   */
  removeElementFromMaster(elementId) {
    try {
      if (this.trackedPatterns.has(elementId)) {
        this.trackedPatterns.delete(elementId);
        console.log(`🗑️ Removed ${elementId} from master. Remaining tracks: ${this.trackedPatterns.size}`);
        this.updateMasterPattern();
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
      
      return { success: true };
    }
    return { success: false, reason: 'Element not tracked in master' };
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

    return `${cleanedPattern}\n\n${tempoPrefix} ${tempo} BPM`;
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
        if (trackData.gain <= 0.001) {
          console.log(`  ⏭️ Skipping ${elementId} (gain is ${trackData.gain})`);
          continue;
        }
        
        const sourcePattern = trackData.rawPattern || trackData.pattern || '';
        if (!sourcePattern || sourcePattern.trim() === '') {
          console.log(`  ⏭️ Skipping ${elementId} (empty pattern)`);
          continue;
        }

        // Preserve the format: if pattern uses note names, keep note names; if semitones, keep semitones
        // Check if pattern is in note names format (e.g., note("C4 E4 G4"))
        // Note names have letter notes (a-g) followed by optional accidental and octave
        const hasNoteNames = /\b(note|n)\s*\(\s*["'][a-gA-G][#b]?\d/.test(sourcePattern);
        // Numeric notes are pure numbers/spaces (e.g., n("0 2 4")), NOT note names with octaves
        // Match patterns that start with digits/spaces only (no letters a-g)
        const hasNumericNotes = /\b(n|note)\s*\(\s*["'][\d\s\-]+["']/.test(sourcePattern) && 
                                 !/\b(note|n)\s*\(\s*["'][a-gA-G]/.test(sourcePattern);
        
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
        
        // Strip extra wrapping parentheses (e.g., (((pattern))) -> pattern)
        // This prevents double/triple wrapping when adding modifiers
        // Only strip if pattern is fully wrapped with no method chaining after
        while (patternCode.startsWith('(') && patternCode.endsWith(')')) {
          // Check if the outer parentheses are balanced and wrap the entire pattern
          let depth = 0;
          let isProperlyWrapped = true;
          
          for (let i = 0; i < patternCode.length; i++) {
            if (patternCode[i] === '(') depth++;
            else if (patternCode[i] === ')') depth--;
            
            // If depth reaches 0 before the end, the outer parens aren't the only wrapping
            if (depth === 0 && i < patternCode.length - 1) {
              isProperlyWrapped = false;
              break;
            }
          }
          
          // If properly wrapped (depth reaches 0 exactly at the end), strip one layer
          if (isProperlyWrapped && depth === 0) {
            patternCode = patternCode.slice(1, -1).trim();
          } else {
            // Not properly wrapped, stop stripping
            break;
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
        
        // Add gain/pan modifiers to pattern string for display purposes
        // The actual gain/pan control is done via Web Audio API nodes for real-time response
        // But we include them in the pattern code so users can see the current values
        
        // Add gain modifier if not default
        if (trackData.gain !== 1) {
          // Wrap the pattern before adding .gain() if not already wrapped
          const basePattern = patternCode.trim();
          // Check if pattern is wrapped: starts with ( and ends with ) or ))
          // We check if it ends with one or more closing parens
          const isAlreadyWrapped = basePattern.startsWith('(') && /\)+$/.test(basePattern);
          
          if (isAlreadyWrapped) {
            // Pattern is wrapped, append .gain() directly
            patternCode = `${basePattern}.gain(${trackData.gain.toFixed(2)})`;
          } else {
            // Pattern is not wrapped, wrap it before adding .gain()
            patternCode = `(${basePattern}).gain(${trackData.gain.toFixed(2)})`;
          }
        }
        
        // Add pan modifier if not centered
        if (trackData.pan !== 0) {
          // After adding .gain(), the pattern is already wrapped and chained
          // The pattern at this point is either:
          // - (pattern).gain(0.80) - already wrapped and chained
          // - pattern - unwrapped (if gain wasn't added)
          const basePattern = patternCode.trim();
          
          // Check if pattern already has method chaining (contains .methodName(...))
          // This matches patterns like: (pattern).gain(0.80) or pattern.gain(0.80)
          // We look for a closing paren followed by a dot and method name
          const hasMethodChaining = /\)\s*\.\s*\w+\s*\(/.test(basePattern);
          
          if (hasMethodChaining) {
            // Pattern already has method chaining (e.g., .gain()), just append .pan()
            patternCode = `${basePattern}.pan(${trackData.pan.toFixed(2)})`;
          } else {
            // Pattern doesn't have method chaining yet
            // Check if it's wrapped: starts with ( and ends with )
            const isAlreadyWrapped = basePattern.startsWith('(') && basePattern.endsWith(')');
            if (isAlreadyWrapped) {
              // Pattern is wrapped but has no method chaining, append .pan() directly
              patternCode = `${basePattern}.pan(${trackData.pan.toFixed(2)})`;
            } else {
              // Pattern is not wrapped, wrap it before adding .pan()
              patternCode = `(${basePattern}).pan(${trackData.pan.toFixed(2)})`;
            }
          }
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
        
        patterns.push(patternCode);
        patternChannels.push(channelNumber);
        patternComments.push(`Channel ${channelNumber}`);
        console.log(`  ✅ Added ${elementId}: ${patternCode.substring(0, 100)}...`);
      }
      
    if (patterns.length === 0) {
        this.masterPattern = '';
        console.log(`🔇 No active patterns - master pattern cleared`);
      } else if (patterns.length === 1) {
        const channelNumber = patternChannels[0] ?? 1;
        const singlePatternBody = patterns[0];
        this.masterPattern = `/* Channel ${channelNumber} */\n${singlePatternBody}`;
        console.log(`🎵 Master pattern (single): ${this.masterPattern.substring(0, 120)}...`);
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
      
      const currentMaster = this.masterPattern;
      if (currentMaster && currentMaster.trim() !== '') {
        let modifiedMaster = this.convertPatternForScale(currentMaster) || currentMaster;
        
        const isStackPattern = /\bstack\s*\(/.test(modifiedMaster);
        const channelCount = patterns.length;
        
        if (channelCount === 1 && isStackPattern) {
          const innerMatch = modifiedMaster.match(/\bstack\s*\(\s*([\s\S]*?)\s*\)\s*$/);
          if (innerMatch) {
            const innerContent = innerMatch[1].trim();
            const channelCommentMatch = innerContent.match(/\/\*\s*Channel\s*\d+\s*\*\/\s*([\s\S]*)/);
            const channelPattern = channelCommentMatch ? channelCommentMatch[1].trim() : innerContent;
            modifiedMaster = channelCommentMatch ? channelCommentMatch[0] : channelPattern;
            modifiedMaster = modifiedMaster.replace(/\.gain\(\s*([^)]+)\s*\)\s*\)$/g, (match, gainValue) => {
              return `).gain(${gainValue})`;
            });
          }
        }
        
        // Note: Master mix modifiers (gain, pan, cpm) are already applied by applyMasterMixModifiers
        // No need to add them again here
        
        this.masterPattern = this.formatMasterPatternWithTempoComment(modifiedMaster);
      }

      // Global settings now applied to the entire stack (or single pattern)
      // Note: Tempo is NOT automatically applied - users can manually add .fast() or .slow()
      console.log(`🎛️ Applied global settings to master pattern (Key: ${this.currentKey || 'none'}, Scale: ${this.currentScale || (this.currentKey ? 'derived' : 'none')}, Time Sig: ${this.currentTimeSignature || 'none'}, Volume: ${this.formatNumberForPattern(this.masterVolume, 4)}, Pan: ${this.formatNumberForPattern(this.masterPan, 4)}, Tempo: ${this.currentTempo || 120} BPM)`);
      
      
      // Don't auto-play when pattern is updated - wait for user to press play button
      // If master is currently playing, stop it (user needs to press play again to restart)
      if (this.masterActive) {
        console.log(`🔄 Master pattern updated while playing - stopping playback (user must press play to restart)`);
        this.stopMasterPattern();
        this.masterActive = false;
      }
      
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
        try {
          // Disconnect if already connected to avoid errors
          try {
            this.masterGainNode.disconnect(analyser);
          } catch (e) {
            // Ignore if not connected
          }
          
          // Connect analyser in parallel to master gain node
          // masterGainNode can have multiple outputs, so this won't interfere with destination connection
          this.masterGainNode.connect(analyser);
          console.log(`✅ Connected visualizer analyser "${analyserId}" to master gain node`);
          
          // Verify the connection worked
          const connections = this.masterGainNode.numberOfOutputs;
          console.log(`🔍 Master gain node has ${connections} output(s)`);
          
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
          // Check if it's already connected
          if (connectError.message && connectError.message.includes('already connected')) {
            console.log(`ℹ️ Analyser "${analyserId}" already connected`);
          } else {
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
   * Play the master pattern
   */
  async playMasterPattern() {
    try {
      console.log(`▶️ Playing master pattern...`);
      
      // Ensure audio context is initialized
      if (!this.audioContext || this.audioContext.state === 'suspended') {
        await this.initialize();
      }
      
      // Ensure Strudel is initialized
      if (!this.strudelLoaded) {
        console.log(`⏳ Waiting for Strudel to initialize...`);
        await this.initStrudel();
      }
      
      // Ensure analyser is set up for visualizers
      this.setupVisualizerAnalyser();
      
      // Check if we have a valid pattern
      if (!this.masterPattern || this.masterPattern.trim() === '') {
        console.log(`⚠️ No master pattern to play`);
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
        
        // Final safety check: fix any unwrapped method chains before .gain() or .pan()
        // This catches cases where patterns like s("bd").bank("AkaiLinn").gain(0.80) need wrapping
        // BUT: Skip this if there's a visualizer present, as visualizers should come AFTER gain/pan
        const hasVisualizer = /\.(scope|spectrum|spiral|pianoroll|barchart|tscope|fscope|visual)\s*\(/i.test(patternToEval);
        
        if (!hasVisualizer) {
          const fixUnwrappedGainPan = (pattern) => {
            let result = pattern;
            const gainPanRegex = /\.(gain|pan)\s*\(/g;
            const fixes = [];
            let match;
            
            // Find all .gain( and .pan( occurrences
            while ((match = gainPanRegex.exec(result)) !== null) {
              const modifierPos = match.index;
              const modifier = match[1];
              
              // Check if this modifier is followed by a visualizer - if so, skip it
              const afterModifier = result.substring(modifierPos + match[0].length);
              const visualizerMatch = afterModifier.match(/^[^)]*\)\s*\.\s*(scope|spectrum|spiral|pianoroll|barchart|tscope|fscope|visual)\s*\(/i);
              if (visualizerMatch) {
                // This gain/pan is followed by a visualizer - don't wrap it
                continue;
              }
              
              // Work backwards to find where the expression starts
              let startPos = modifierPos - 1;
              let depth = 0;
              let inString = false;
              let stringChar = null;
              let foundStart = false;
              
              // Skip whitespace and the dot
              while (startPos >= 0 && (result[startPos] === ' ' || result[startPos] === '\n' || result[startPos] === '\t' || result[startPos] === '.')) {
                startPos--;
              }
              
              // Work backwards to find the start of the expression
              while (startPos >= 0 && !foundStart) {
                const char = result[startPos];
                
                // Handle strings
                if ((char === '"' || char === "'") && (startPos === 0 || result[startPos - 1] !== '\\')) {
                  if (!inString) {
                    inString = true;
                    stringChar = char;
                  } else if (char === stringChar) {
                    inString = false;
                    stringChar = null;
                  }
                  startPos--;
                  continue;
                }
                
                if (!inString) {
                  if (char === ')') {
                    depth++;
                  } else if (char === '(') {
                    depth--;
                    if (depth < 0) {
                      // Found the start of a function call
                      foundStart = true;
                      startPos++;
                      break;
                    }
                  } else if (depth === 0 && char === '.' && startPos < modifierPos - 1) {
                    // Found a method call boundary
                    foundStart = true;
                    startPos++;
                    break;
                  } else if (depth === 0 && /[a-zA-Z_$0-9]/.test(char)) {
                    // Continue looking
                  } else if (depth === 0 && !/[a-zA-Z_$0-9\s\.]/.test(char)) {
                    // Found a boundary
                    foundStart = true;
                    startPos++;
                    break;
                  }
                }
                
                startPos--;
              }
              
              if (startPos < 0) startPos = 0;
              
              const expression = result.substring(startPos, modifierPos).trim();
              
              // Check if expression is already wrapped
              if (expression && !expression.startsWith('(') && expression.includes('.')) {
                // This looks like an unwrapped method chain
                fixes.push({
                  start: startPos,
                  end: modifierPos,
                  expression: expression,
                  modifier: modifier
                });
              }
            }
            
            // Apply fixes in reverse order to maintain positions
            fixes.reverse().forEach(fix => {
              const before = result.substring(0, fix.start);
              const after = result.substring(fix.end + fix.modifier.length + 1);
              result = before + `(${fix.expression}).${fix.modifier}(` + after;
              console.log(`🔧 Final fix: Wrapped pattern before .${fix.modifier}(): ${fix.expression.substring(0, 60)}...`);
            });
            
            return result;
          };
          
          patternToEval = fixUnwrappedGainPan(patternToEval);
        } else {
          console.log(`⏭️ Skipping gain/pan wrapping fix (visualizer detected)`);
        }
        
        // Add .loop() to master pattern if it doesn't already have it, so it plays continuously
        if (!patternToEval.includes('.loop(') && !patternToEval.includes('.loop()')) {
          patternToEval = `${patternToEval}.loop()`;
          console.log(`🔄 Added .loop() to master pattern for continuous playback`);
        }
        
      // Set masterActive BEFORE evaluation so audio routing can find elements
      // Always set to true when playMasterPattern is called (this function is only called from play button)
      this.masterActive = true;
      
      // Reset debug flags for fresh logging
      this._masterDestinationConnectLogged = false;
      this._singleElementMasterRoutingLogged = false;
      this._noElementRoutingLogged = false;
      this._nodeTypeConnectLogged = new Set();
      this._stackMasterRoutingLogged = false;
      this._masterRoutingLogged = false;
      this._gainConnectDebugged = false;
      this._stackElementRoutingLogged = new Set();
      // Reset stack connection count for round-robin routing
      if (this._stackConnectionCount) {
        this._stackConnectionCount.set('total', 0);
      }
      
      // Determine which slot to evaluate on
      // For single-element masters, evaluate on the element's slot so routing can find it
      // For multi-element masters, evaluate on the master slot
      let evaluationSlot = this.masterSlot;
      if (this.trackedPatterns.size === 1) {
        const singleElementId = Array.from(this.trackedPatterns.keys())[0];
        // Find the slot for this element by searching patternSlotToElementId
        let elementSlot = null;
        for (const [slotName, elemId] of this.patternSlotToElementId.entries()) {
          if (elemId === singleElementId) {
            elementSlot = slotName;
            break;
          }
        }
        if (elementSlot) {
          evaluationSlot = elementSlot;
          this.currentEvaluatingSlot = elementSlot;
          console.log(`🎚️ Single-element master: evaluating on element slot ${elementSlot} (${singleElementId})`);
        } else {
          this.currentEvaluatingSlot = this.masterSlot;
          console.log(`🎚️ Single-element master: element slot not found, using master slot ${this.masterSlot}`);
        }
      } else {
        this.currentEvaluatingSlot = this.masterSlot;
        console.log(`🎚️ Multi-element master: using master slot ${this.masterSlot}`);
      }
      
      // Ensure all tracked elements have audio nodes created (for gain/pan control and VU meters)
      console.log(`🔧 Ensuring audio nodes exist for ${this.trackedPatterns.size} tracked elements...`);
      for (const [elementId] of this.trackedPatterns.entries()) {
        const nodes = this.getElementAudioNodes(elementId);
        if (nodes) {
          const analyser = this.elementAnalysers.get(elementId);
          console.log(`  ✅ ${elementId}: gain=${nodes.gainNode.gain.value.toFixed(2)}, pan=${nodes.panNode.pan.value.toFixed(2)}, analyser=${analyser ? 'created' : 'missing'}`);
              
                  // Ensure element analyser is connected to master pan node
                  if (analyser && this.masterPanNode) {
                    try {
                      // Disconnect first to avoid duplicate connections
                      analyser.disconnect();
                    } catch (e) {
                      // May not be connected yet, that's fine
                    }
                    try {
                      analyser.connect(this.masterPanNode);
                      console.log(`  ✅ Connected ${elementId} analyser to master pan node`);
                    } catch (e2) {
                      console.warn(`  ⚠️ Could not connect ${elementId} analyser to master pan node:`, e2.message);
                      // Try connecting to master gain node as fallback
                      if (this.masterGainNode) {
                        try {
                          analyser.connect(this.masterGainNode);
                          console.log(`  ✅ Connected ${elementId} analyser to master gain node (fallback)`);
                        } catch (e3) {
                          console.error(`  ❌ Could not connect ${elementId} analyser to master gain node:`, e3.message);
                        }
                      }
                    }
                  } else if (analyser && this.masterGainNode) {
                    // Fallback: connect to master gain node if pan node not available
                    try {
                      analyser.disconnect();
                    } catch (e) {
                      // May not be connected yet
                    }
                    try {
                      analyser.connect(this.masterGainNode);
                      console.log(`  ✅ Connected ${elementId} analyser to master gain node`);
                    } catch (e2) {
                      console.warn(`  ⚠️ Could not connect ${elementId} analyser to master gain node:`, e2.message);
                    }
                  }
            } else {
              console.warn(`  ⚠️ ${elementId}: Failed to create audio nodes`);
            }
          }
          
          // Log total analysers for debugging
          console.log(`🎚️ Total analysers registered: ${this.elementAnalysers.size}`);
          
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
          
        const code = `${evaluationSlot} = ${patternToEval}`;
        console.log(`🎼 Evaluating master pattern:`);
        console.log(`   Full code: ${code}`);
        console.log(`   Code length: ${code.length} characters`);
        console.log(`   Evaluation slot: ${evaluationSlot}`);
        
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
      
      try {
        const result = await window.strudel.evaluate(code);
        console.log(`✅ Master pattern evaluated successfully, result type: ${typeof result}`);
      } catch (evalError) {
        // Log but don't fail on evaluation errors - Strudel might still play
        console.warn(`⚠️ Pattern evaluation warning:`, evalError.message);
        console.warn(`⚠️ Pattern code that failed: ${code.substring(0, 300)}`);
        // Continue anyway - the pattern might still work
      }
        
        // Clear current evaluating slot after routing has occurred
        setTimeout(() => {
          if (this.currentEvaluatingSlot === this.masterSlot) {
            this.currentEvaluatingSlot = null;
          }
        }, this.soundsPreloaded ? 100 : 500);
        
        // Start scheduler if not running
        if (window.strudel.scheduler && !window.strudel.scheduler.started) {
          console.log(`▶️ Starting Strudel scheduler...`);
          await window.strudel.scheduler.start();
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
        
        // Notify UI that master is now playing
        if (this.onMasterStateChangeCallback) {
          this.onMasterStateChangeCallback(true, Array.from(this.trackedPatterns.keys()));
        }
        
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

  /**
   * Stop the master pattern
   */
  async stopMasterPattern() {
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
      
      // Don't auto-play when setting pattern code - user must press play button
      // If master is active, just stop it (user must press play to restart)
      if (this.masterActive) {
        console.log(`🔄 Master pattern code updated while playing - stopping playback (user must press play to restart)`);
        await this.stopMasterPattern();
        this.masterActive = false;
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
      let processedPattern = await this.processPattern(pattern, elementId, {
        preserveBanks: true,
        attemptBankLoad: true
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

  /**
   * Update VU meters for all elements
   */
  updateVUMeters() {
    if (!this.audioContext || this.audioContext.state !== 'running') {
      return;
    }

    if (this.elementAnalysers.size === 0) {
      if (!this.vuMeterWarnedNoAnalysers) {
        console.log('🎚️ updateVUMeters: No analysers registered');
        this.vuMeterWarnedNoAnalysers = true;
      }
      return;
    }

    if (this.vuMeterWarnedNoAnalysers) {
      this.vuMeterWarnedNoAnalysers = false;
    }

    this.elementAnalysers.forEach((analyser, elementId) => {
      const element = document.querySelector(`[data-sound-id="${elementId}"]`);
      if (!element) {
        // Only log once per missing element
        if (!this._vuMeterMissingElement) {
          this._vuMeterMissingElement = new Set();
        }
        if (!this._vuMeterMissingElement.has(elementId)) {
          console.warn(`⚠️ VU meter: Element ${elementId} not found in DOM`);
          this._vuMeterMissingElement.add(elementId);
        }
        return;
      }

      const vuBar = element.querySelector('.vu-bar');
      if (!vuBar) {
        // Only log once per missing VU bar
        if (!this._vuMeterMissingBar) {
          this._vuMeterMissingBar = new Set();
        }
        if (!this._vuMeterMissingBar.has(elementId)) {
          console.warn(`⚠️ VU meter: .vu-bar not found for ${elementId}`);
          this._vuMeterMissingBar.add(elementId);
        }
        return;
      }

      // Check if analyser is connected and receiving data
      if (!analyser || analyser.context !== this.audioContext) {
        // Only log once per element
        if (!this._analyserContextMismatchLogged) {
          this._analyserContextMismatchLogged = new Set();
        }
        if (!this._analyserContextMismatchLogged.has(elementId)) {
          console.warn(`⚠️ Analyser for ${elementId} context mismatch or missing`);
          this._analyserContextMismatchLogged.add(elementId);
        }
        return;
      }

      // Get time domain data for VU meter (actual audio level)
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(dataArray);

      // Calculate RMS (Root Mean Square) level for accurate VU meter reading
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128; // Convert to -1 to 1 range
        sum += normalized * normalized; // Square for RMS
      }
      const rms = Math.sqrt(sum / dataArray.length);

      // Convert RMS to dB
      // RMS is 0-1, convert to dB: dB = 20 * log10(rms)
      // Handle very small values to avoid -Infinity
      const minRms = 0.0001; // -80dB
      const rmsForDb = Math.max(rms, minRms);
      const db = 20 * Math.log10(rmsForDb);

      // Map dB to meter percentage with piecewise segments to match design
      // Zone requirements:
      //   - Below -12 dB → green (0-60% of bar, shown as 0-25% of meter height)
      //   - -12 dB to 0 dB → yellow (25-75% of meter height)
      //   - 0 dB to +6 dB → red (75-100% of meter height)
      let level;
      if (db <= -60) {
        level = 0;
      } else if (db < -12) {
        // Map -60 dB → 0%, -12 dB → 25%
        level = ((db + 60) / 48) * 25;
      } else if (db < 0) {
        // Map -12 dB → 25%, 0 dB → 75%
        level = 25 + ((db + 12) / 12) * 50;
      } else {
        // Map 0 dB → 75%, +6 dB → 100%
        level = 75 + (Math.min(db, 6) / 6) * 25;
      }

      level = Math.max(0, Math.min(100, level));
      
      // Ensure minimum visible height when there's signal (at least 1px so it's visible)
      // Convert percentage to pixels: 1px out of 100px container = 1%
      if (level > 0 && level < 1) {
        level = 1;
      }

      // Debug: Check if we're getting any non-zero data
      const hasAnySignal = dataArray.some(val => val !== 128); // 128 is silence in Uint8Array
      
      // Only log when there's actual audio activity (above -60dB) or occasionally for debugging
      if (db > -60) {
        console.log(`🎚️ ${elementId} VU level: ${level.toFixed(1)}% (db=${db.toFixed(1)}, rms=${rms.toFixed(4)})`);
      } else if (!hasAnySignal && Math.random() < 0.01) {
        // Log 1% of silent frames for debugging
        console.log(`🎚️ ${elementId} VU: No signal detected (rms=${rms.toFixed(6)}, sample=${dataArray[0]})`);
      }

      // Update VU meter bar height
      vuBar.style.height = `${level}%`;
      
      // Verify the DOM update actually happened (with tolerance for rounding)
      // DOM values are rounded, so we compare with a small tolerance
      const actualHeight = vuBar.style.height;
      const actualLevel = parseFloat(actualHeight);
      const levelDiff = Math.abs(actualLevel - level);
      // Only warn if difference is significant (more than 0.1%)
      if (levelDiff > 0.1) {
        console.warn(`⚠️ VU meter DOM update failed for ${elementId}: expected ${level.toFixed(4)}%, got ${actualHeight} (diff: ${levelDiff.toFixed(4)}%)`);
      }
      
      // Debug: Log occasionally to verify updates are happening
      if (Math.random() < 0.01) { // Log 1% of updates
        console.log(`🎚️ ${elementId} VU meter updated: height=${level.toFixed(1)}%, db=${db.toFixed(1)}, rms=${rms.toFixed(4)}, DOM=${vuBar.style.height}, computed=${window.getComputedStyle(vuBar).height}`);
      }
    });
  }

  /**
   * Start VU meter animation loop
   */
  startVUMeterLoop() {
    if (this.vuMeterAnimationId) {
      return; // Already running
    }

    const updateLoop = () => {
      this.updateVUMeters();
      this.vuMeterAnimationId = requestAnimationFrame(updateLoop);
    };

    this.vuMeterAnimationId = requestAnimationFrame(updateLoop);
  }

  /**
   * Stop VU meter animation loop
   */
  stopVUMeterLoop() {
    if (this.vuMeterAnimationId) {
      cancelAnimationFrame(this.vuMeterAnimationId);
      this.vuMeterAnimationId = null;
    }
  }
}

// Export singleton instance
export const soundManager = new SoundManager();

