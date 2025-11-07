/**
 * Main entry point - Wires together all components
 */

import { soundManager } from './soundManager.js';
import { uiController } from './ui.js';
import { soundConfig } from './config.js';
import { initStrudelReplEditors, getStrudelEditorValue, setStrudelEditorValue } from './strudelReplEditor.js';

// Drum abbreviation mapping
const DRUM_ABBREVIATIONS = {
  'bd': 'Bass drum, Kick drum',
  'sd': 'Snare drum',
  'rim': 'Rimshot',
  'cp': 'Clap',
  'hh': 'Closed hi-hat',
  'oh': 'Open hi-hat',
  'cr': 'Crash',
  'rd': 'Ride',
  'ht': 'High tom',
  'mt': 'Medium tom',
  'lt': 'Low tom',
  'sh': 'Shakers',
  'cb': 'Cowbell',
  'tb': 'Tambourine',
  'perc': 'Other percussions',
  'misc': 'Miscellaneous samples',
  'fx': 'Effects'
};

/**
 * Convert Strudel pattern to drum abbreviations display
 */
function patternToDrumDisplay(pattern) {
  if (!pattern || typeof pattern !== 'string') return '';
  
  // Don't convert patterns that have .bank() or .s() modifiers - keep them in Strudel format
  if (pattern.includes('.bank(') || pattern.includes('.s(') || pattern.includes('.synth(')) {
    return pattern;
  }
  
  // Check if it's a drum pattern (contains sound() with drum abbreviations)
  const soundMatch = pattern.match(/sound\(["']([^"']+)["']\)|s\(["']([^"']+)["']\)/);
  if (!soundMatch) return pattern; // Not a drum pattern, return as-is
  
  const sounds = soundMatch[1] || soundMatch[2];
  if (!sounds) return pattern; // No sounds found, return as-is
  
  const soundList = sounds.split(/\s+/).filter(s => s.trim());
  
  // Check if any sounds are drum abbreviations
  const hasDrums = soundList.some(s => DRUM_ABBREVIATIONS.hasOwnProperty(s.toLowerCase()));
  if (!hasDrums) return pattern; // Not a drum pattern
  
  // Convert abbreviations to display names
  const displayNames = soundList.map(abbr => {
    const name = DRUM_ABBREVIATIONS[abbr.toLowerCase()];
    return name ? `${abbr} (${name})` : abbr;
  });
  
  // Extract modifiers (everything after sound())
  const modifiersMatch = pattern.match(/sound\(["'][^"']+["']\)(.*)|s\(["'][^"']+["']\)(.*)/);
  const modifiers = (modifiersMatch ? (modifiersMatch[1] || modifiersMatch[2] || '') : '').trim();
  
  // Build display string
  let display = displayNames.join(' ');
  if (modifiers) {
    display += ` ${modifiers}`;
  }
  
  return display;
}

/**
 * Convert drum abbreviations display back to Strudel pattern
 */
function drumDisplayToPattern(display) {
  if (!display || typeof display !== 'string') return '';
  
  const trimmed = display.trim();
  if (!trimmed) return '';
  
  // Check if it's already in Strudel format (contains sound() or s() or note())
  if (trimmed.includes('sound(') || trimmed.includes('s(') || trimmed.includes('note(')) {
    return trimmed; // Already in Strudel format
  }
  
  // Extract sound abbreviations and modifiers
  const parts = trimmed.split(/\s+/).filter(p => p.trim());
  const sounds = [];
  const modifiers = [];
  
  for (const part of parts) {
    if (!part) continue;
    
    // Check if it's a modifier (starts with .)
    if (part.startsWith('.')) {
      modifiers.push(part);
    } else {
      // Extract abbreviation (before parentheses if present)
      const abbr = part.split('(')[0].trim();
      if (abbr) {
        // Check if it's a known drum abbreviation or just keep it
        if (DRUM_ABBREVIATIONS.hasOwnProperty(abbr.toLowerCase()) || abbr.length > 0) {
          sounds.push(abbr);
        }
      }
    }
  }
  
  if (sounds.length === 0) return trimmed; // No valid sounds found, return original
  
  // Build Strudel pattern
  let pattern = `sound("${sounds.join(' ')}")`;
  if (modifiers.length > 0) {
    pattern += modifiers.join('');
  }
  
  return pattern;
}

class InteractiveSoundApp {
  constructor() {
    this.activeElements = new Set();
    this.initialized = false;
    this.currentEditingElementId = null;
    this.mutedElements = new Set(); // Track muted elements
    this.soloedElements = new Set(); // Track soloed elements
    this.elementCounter = 4; // Start from 5 for new elements (4 default elements)
    
    // Master pattern system
    this.masterActive = false;
    this.masterPatternField = null;
    
    // Effects, Filters, and Synthesis storage
    this.elementEffects = {}; // Store effects for each element
    this.elementFilters = {}; // Store filters for each element
    this.elementSynthesis = {}; // Store synthesis (ADSR) for each element
  }

  /**
   * Initialize the application
   */
  async init() {
    // Set app instance reference in soundManager for effects access
    soundManager.appInstance = this;
    
    // Register UI control callbacks
    // Volume removed - use master volume instead
    
    uiController.onUpdate('tempo', (bpm) => {
      soundManager.setTempo(bpm);
    });

    uiController.onUpdate('key', (key) => {
      soundManager.setKey(key);
      console.log(`🎹 Key changed to: ${key}`);
    });

    uiController.onUpdate('timeSignature', (timeSignature) => {
      soundManager.setTimeSignature(timeSignature);
      console.log(`🎵 Time signature changed to: ${timeSignature}`);
    });

    // Set up control sound trigger
    uiController.setSoundTrigger((controlId, config) => {
      // Only trigger if audio is ready
      if (soundManager.isAudioReady()) {
        if (config.type === 'synthesized') {
          soundManager.playSynthesizedSound(controlId, config.pattern).catch(error => {
            console.error(`Error triggering control sound for ${controlId}:`, error);
          });
        } else if (config.type === 'strudel') {
          soundManager.playStrudelPattern(controlId, config.pattern).catch(error => {
            console.error(`Error triggering control sound for ${controlId}:`, error);
          });
        }
      }
    });

    // Register all interactive elements
    this.registerElements();

    // Wire up element-specific controls
    this.setupElementControls();

    // Set up callback for when sounds are ready
    soundManager.onSoundsReady(() => {
      console.log('🎉 Sounds are ready - activating green dots');
      this.setAllElementsLoaded();
      uiController.updateStatus('Ready - Click elements to start/stop patterns (Press Escape to stop all)');
    });

    // Set up callback for when master pattern is updated
    soundManager.onMasterPatternUpdate(() => {
      console.log('🔄 Master pattern updated - refreshing display');
      this.updateMasterPatternDisplay();
    });

    // Set up callback for when master state changes (playing/stopped)
    soundManager.onMasterStateChange((isPlaying, elementIds) => {
      console.log(`🎚️ Master state changed: ${isPlaying ? 'playing' : 'stopped'}, elements: ${elementIds.join(', ')}`);
      // Update all tracked element circles and status dots
      elementIds.forEach(elementId => {
        this.updateStatusDots(elementId, true, isPlaying);
      });
      // If master stopped, ensure all circles are turned off
      if (!isPlaying) {
        document.querySelectorAll('.element-circle').forEach(circle => {
          circle.classList.remove('playing');
        });
      }
    });

    // Initialize audio on first user interaction
    this.setupAudioInitialization();

    // Initialize master channel
    this.setupMasterChannel();

    // Add emergency stop keyboard shortcut (Escape key)
    const handleEscape = (e) => {
      console.log('Key pressed:', e.key); // Debug: log all keys
      if (e.key === 'Escape' || e.keyCode === 27) {
        console.log('🛑 Emergency stop activated (Escape key pressed)');
        e.preventDefault();
        e.stopPropagation();
        soundManager.stopAllSounds();
        uiController.updateStatus('🛑 All sounds stopped');
        
        // Also deactivate all elements
        this.activeElements.clear();
        this.updateActiveElementsDisplay();
        
        // Mark as loaded but not playing (red off, green on but not pulsing)
        soundConfig.elements.forEach(config => {
          const hasPattern = this.elementHasPattern(config.id);
          this.updateStatusDots(config.id, hasPattern, false);
        });
      }
    };
    
    document.addEventListener('keydown', handleEscape, true); // Use capture phase
    window.addEventListener('keydown', handleEscape, true); // Also on window
    console.log('✅ Escape key handler registered');

    // Add stop all button handler
    const stopAllBtn = document.getElementById('stop-all-btn');
    if (stopAllBtn) {
      stopAllBtn.addEventListener('click', () => {
        console.log('🛑 Stop All button clicked');
        soundManager.stopAllSounds();
        uiController.updateStatus('🛑 All sounds stopped');
        
        // Also deactivate all elements
        this.activeElements.clear();
        this.updateActiveElementsDisplay();
        
        // Mark as loaded but not playing (red off, green on but not pulsing)
        soundConfig.elements.forEach(config => {
          const hasPattern = this.elementHasPattern(config.id);
          this.updateStatusDots(config.id, hasPattern, false);
        });
      });
      console.log('✅ Stop All button handler registered');
    } else {
      console.warn('⚠️ Stop All button not found in DOM');
    }

    this.initialized = true;
    
    // Initialize all elements as NOT loaded (red dots on)
    this.setAllElementsNotLoaded();
    
    // Migrate localStorage to fix fancy quotes (one-time fix)
    this.migrateLocalStorageQuotes();
    
    // Load saved element configs from localStorage
    this.loadAllElementConfigs();
    
    // Setup modal functionality
    this.setupModal();
    
    // Setup add element button
    this.setupAddElementButton();
    
    // Visualizations removed - no longer needed
    
    uiController.updateStatus('Ready - Click anywhere to enable audio (Press Escape to stop all sounds)');
    
    // Initialize Strudel REPL editors on all textareas
    // Wait a bit for DOM to be fully ready
    setTimeout(() => {
      try {
        initStrudelReplEditors();
      } catch (error) {
        console.warn('⚠️ Strudel REPL editor initialization failed (non-critical):', error.message);
        console.log('💡 Pattern editing will use plain textareas instead');
      }
    }, 100);
    
    console.log('Interactive Sound App initialized');
    console.log('💡 Tip: Press Escape key or click Stop All button to silence everything');
  }

  /**
   * Initialize visualizations for all elements with existing patterns, or a specific element
   * REMOVED: Visualizations no longer used
   */
  initializeElementVisualizations(element = null, elementId = null) {
    // Visualizations removed - function kept for compatibility but does nothing
    const elementsToProcess = element ? [element] : document.querySelectorAll('.sound-element');
    
    elementsToProcess.forEach(el => {
      const id = elementId || el.dataset.soundId;
      if (!id) return;
      
      const configButton = el.querySelector('.config-button');
      
      // Check if element has a saved pattern
      const saved = this.loadElementConfig(id);
      const hasValidPattern = saved && saved.pattern && saved.pattern.trim() !== '';
      
      if (hasValidPattern) {
        // Show/hide synthesis section based on pattern type
        this.updateSynthesisSectionVisibility(id, saved.pattern);
        
        // Update config button text to show title (only if pattern exists)
        if (configButton) {
          const titleEl = el.querySelector('.element-title');
          const displayTitle = titleEl ? titleEl.textContent : id;
          // Only use title if it's not a default "Element X" name
          if (displayTitle && !displayTitle.match(/^Element \d+$/)) {
            configButton.textContent = displayTitle || 'Configure Sound';
          } else {
            configButton.textContent = 'Configure Sound';
          }
        }
      } else if (configButton) {
        // No pattern saved, always show "Configure Sound"
        configButton.textContent = 'Configure Sound';
      }
    });
  }

  /**
   * Setup master channel controls
   */
  setupMasterChannel() {
    const masterVolumeSlider = document.getElementById('master-volume');
    const masterPanSlider = document.getElementById('master-pan');
    const masterMuteBtn = document.getElementById('master-mute-btn');
    const masterVolumeValue = document.getElementById('master-volume-value');
    const masterPanValue = document.getElementById('master-pan-value');

    // Setup master volume slider
    if (masterVolumeSlider) {
      const initialVolume = parseFloat(masterVolumeSlider.value);
      // Initialize master volume - will be set when audio context is ready
      soundManager.masterVolume = initialVolume / 100; // Store value for later
      console.log(`🎚️ Master volume slider initialized: ${initialVolume}% (${soundManager.masterVolume})`);

      masterVolumeSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        console.log(`🎚️ Master volume slider changed: ${value}%`);
        soundManager.setMasterVolume(value / 100); // Convert 0-100 to 0-1
        if (masterVolumeValue) {
          masterVolumeValue.textContent = Math.round(value);
        }
      });
      
      // Try to set initial value if audio is already initialized
      if (soundManager.isAudioReady() && soundManager.masterGainNode) {
        console.log(`🎚️ Audio already ready, setting master volume to ${initialVolume}%`);
        soundManager.setMasterVolume(initialVolume / 100);
      } else {
        console.log(`🎚️ Audio not ready yet, master volume will be set on initialization`);
      }
    } else {
      console.warn('⚠️ Master volume slider not found in DOM');
    }

    // Setup master pan slider
    if (masterPanSlider) {
      const initialPan = parseFloat(masterPanSlider.value);
      // Initialize master pan - will be set when audio context is ready
      soundManager.masterPan = initialPan; // Store value for later
      console.log(`🎚️ Master pan slider initialized: ${initialPan}`);

      masterPanSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        console.log(`🎚️ Master pan slider changed: ${value}`);
        soundManager.setMasterPan(value);
        if (masterPanValue) {
          masterPanValue.textContent = value.toFixed(2);
        }
      });
      
      // Try to set initial value if audio is already initialized
      if (soundManager.isAudioReady() && soundManager.masterPanNode) {
        console.log(`🎚️ Audio already ready, setting master pan to ${initialPan}`);
        soundManager.setMasterPan(initialPan);
      } else {
        console.log(`🎚️ Audio not ready yet, master pan will be set on initialization`);
      }
    } else {
      console.warn('⚠️ Master pan slider not found in DOM');
    }

    // Setup master mute button
    if (masterMuteBtn) {
      masterMuteBtn.addEventListener('click', () => {
        console.log('🎚️ Master mute button clicked');
        const isMuted = soundManager.toggleMasterMute();
        masterMuteBtn.textContent = isMuted ? '🔇' : '🔊';
        masterMuteBtn.title = isMuted ? 'Unmute Master' : 'Mute Master';
        console.log(`🎚️ Master mute toggled: ${isMuted ? 'MUTED' : 'UNMUTED'}`);
      });
    } else {
      console.warn('⚠️ Master mute button not found in DOM');
    }
    
    // Setup master pattern controls
    this.setupMasterPatternControls();
    
    console.log('✅ Master channel controls setup complete');
  }

  /**
   * Setup master pattern controls
   */
  setupMasterPatternControls() {
    this.masterPatternField = document.getElementById('master-pattern');
    const playMasterBtn = document.getElementById('play-master-btn');
    const stopMasterBtn = document.getElementById('stop-master-btn');
    const updateMasterBtn = document.getElementById('update-master-btn');
    const masterActiveDot = document.querySelector('.master-active-dot');

    if (!this.masterPatternField) {
      console.warn('⚠️ Master pattern field not found in DOM');
      return;
    }

    // Play/Pause Master button
    if (playMasterBtn) {
      playMasterBtn.addEventListener('click', async () => {
        if (this.masterActive) {
          // Currently playing - pause/stop
          console.log('⏸️ Pause Master button clicked');
          
          const result = await soundManager.stopMasterPattern();
          
          if (result.success) {
            this.masterActive = false;
            playMasterBtn.textContent = '▶ Play Master';
            playMasterBtn.classList.remove('active');
            if (masterActiveDot) masterActiveDot.classList.remove('active');
            console.log('✅ Master playback paused');
          }
        } else {
          // Currently stopped - play
          console.log('▶️ Play Master button clicked');
          
          // Update master pattern before playing (in case it was manually edited)
          // Use CodeMirror editor value if available, otherwise fall back to textarea
          const currentCode = getStrudelEditorValue('master-pattern').trim();
          if (currentCode && currentCode !== soundManager.getMasterPatternCode()) {
            await soundManager.setMasterPatternCode(currentCode);
          }
          
          const result = await soundManager.playMasterPattern();
          
          if (result.success) {
            this.masterActive = true;
            playMasterBtn.textContent = '⏸️ Pause';
            playMasterBtn.classList.add('active');
            if (masterActiveDot) masterActiveDot.classList.add('active');
            console.log('✅ Master playback started');
          } else {
            console.error('❌ Failed to play master:', result.error);
            alert(`Failed to play master: ${result.error}`);
          }
        }
      });
    }

    // Stop Master button
    if (stopMasterBtn) {
      stopMasterBtn.addEventListener('click', async () => {
        console.log('⏹️ Stop Master button clicked');
        
        const result = await soundManager.stopMasterPattern();
        
        if (result.success) {
          this.masterActive = false;
          if (playMasterBtn) {
            playMasterBtn.textContent = '▶ Play Master';
            playMasterBtn.classList.remove('active');
          }
          if (masterActiveDot) masterActiveDot.classList.remove('active');
          console.log('✅ Master playback stopped');
        } else {
          console.error('❌ Failed to stop master:', result.error);
        }
      });
    }

    // Export Audio button
    const exportAudioBtn = document.getElementById('export-audio-btn');
    if (exportAudioBtn) {
      exportAudioBtn.addEventListener('click', async () => {
        console.log('🎵 Export Audio button clicked');
        
        if (!soundManager.getMasterPatternCode() || soundManager.getMasterPatternCode().trim() === '') {
          alert('No master pattern to export. Please create a pattern first.');
          return;
        }

        // Ask for duration
        const duration = prompt('Enter export duration in seconds (default: 16):', '16');
        if (duration === null) return; // User cancelled
        
        const durationSeconds = parseInt(duration) || 16;
        
        // Disable button during export
        exportAudioBtn.disabled = true;
        exportAudioBtn.textContent = '⏳ Exporting...';
        
        try {
          const result = await soundManager.exportAudioWAV(durationSeconds);
          
          if (result.success) {
            if (result.warning) {
              alert(`⚠️ Audio exported as ${result.format.toUpperCase()}!\n\n${result.warning}`);
            } else {
              alert(`✅ Audio exported successfully as ${result.format.toUpperCase()}!`);
            }
            console.log('✅ Audio export complete');
          } else {
            alert(`❌ Export failed: ${result.error}`);
            console.error('❌ Audio export failed:', result.error);
          }
        } catch (error) {
          alert(`❌ Export error: ${error.message}`);
          console.error('❌ Audio export error:', error);
        } finally {
          exportAudioBtn.disabled = false;
          exportAudioBtn.textContent = '🎵 Export Audio';
        }
      });
    }


    // Update Master button (apply manual edits)
    if (updateMasterBtn) {
      updateMasterBtn.addEventListener('click', async () => {
        console.log('💾 Update Master button clicked');
        
        // Use CodeMirror editor value if available, otherwise fall back to textarea
        const code = getStrudelEditorValue('master-pattern').trim();
        if (!code) {
          alert('Master pattern is empty');
          return;
        }
        
        const result = await soundManager.setMasterPatternCode(code);
        
        if (result.success) {
          console.log('✅ Master pattern code updated');
          alert('Master pattern updated successfully!');
        } else {
          console.error('❌ Failed to update master:', result.error);
          alert(`Failed to update master: ${result.error}`);
        }
      });
    }

    // Copy Code button
    const copyCodeBtn = document.getElementById('copy-code-btn');
    if (copyCodeBtn) {
      copyCodeBtn.addEventListener('click', async () => {
        const code = this.masterPatternField.value.trim();
        if (!code) {
          alert('Master pattern is empty');
          return;
        }
        
        try {
          await navigator.clipboard.writeText(code);
          // Temporarily change button text to show success
          const originalText = copyCodeBtn.textContent;
          copyCodeBtn.textContent = '✓ Copied!';
          setTimeout(() => {
            copyCodeBtn.textContent = originalText;
          }, 2000);
          console.log('✅ Master pattern code copied to clipboard');
        } catch (err) {
          console.error('❌ Failed to copy code:', err);
          alert('Failed to copy code to clipboard');
        }
      });
    }

    // Reset All button
    const resetMasterBtn = document.getElementById('reset-master-btn');
    if (resetMasterBtn) {
      resetMasterBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset all? This will clear the master pattern and all element configurations.')) {
          console.log('🔄 Reset All button clicked');
          this.resetAll();
        }
      });
    }

    console.log('✅ Master pattern controls setup complete');
  }

  /**
   * Update master pattern display field
   */
  updateMasterPatternDisplay() {
    if (!this.masterPatternField) return;
    
    const pattern = soundManager.getMasterPatternCode();
    if (pattern && pattern.trim() !== '') {
      setStrudelEditorValue('master-pattern', pattern);
      this.masterPatternField.placeholder = '';
      console.log(`📝 Updated master pattern display: ${pattern.substring(0, 100)}...`);
    } else {
      // Pattern is empty - show placeholder
      setStrudelEditorValue('master-pattern', '');
      this.masterPatternField.placeholder = 'Combined pattern will appear here...';
    }
  }

  /**
   * Update "Active in Master" indicators for all elements
   */
  updateMasterIndicators() {
    soundConfig.elements.forEach(config => {
      const elementId = config.id;
      const element = document.querySelector(`[data-sound-id="${elementId}"]`);
      if (element) {
        const indicator = element.querySelector('.master-status-indicator');
        if (indicator) {
          if (soundManager.trackedPatterns.has(elementId)) {
            indicator.classList.add('active');
          } else {
            indicator.classList.remove('active');
          }
        }
      }
    });
  }

  /**
   * Register all elements from config, or specific elements if provided
   */
  registerElements(elementsToRegister = null) {
    const elementsToProcess = elementsToRegister || soundConfig.elements.map(config => {
      const element = document.querySelector(config.selector);
      return element ? { element, elementId: config.id } : null;
    }).filter(item => item !== null);
    
    elementsToProcess.forEach(({ element, elementId }) => {
      if (!element) return;
      
      const actualElementId = element.getAttribute('data-sound-id') || elementId;
      
      // Add click handler to toggle activation
        element.addEventListener('click', (e) => {
          // Don't activate if clicking on buttons or sliders
          if (e.target.classList.contains('config-button') ||
              e.target.classList.contains('pause-button') ||
            e.target.classList.contains('solo-button') ||
            e.target.classList.contains('mute-button') ||
              e.target.classList.contains('gain-slider') ||
              e.target.classList.contains('pan-slider') ||
            e.target.classList.contains('collapsible-toggle') ||
            e.target.classList.contains('collapsible-content') ||
            e.target.classList.contains('effect-slider') ||
            e.target.classList.contains('filter-slider') ||
            e.target.closest('.collapsible-section')) {
            return;
          }
          
          const elementId = element.getAttribute('data-sound-id');
          console.log(`🖱️ Click triggered for ${elementId}`);
          
          // Toggle activation on click
          if (this.activeElements.has(elementId)) {
            this.deactivateElement(elementId, element, 'click');
          } else {
            this.activateElement(elementId, element, 'click');
          }
        });
    });
  }

  /**
   * Setup gain and pan controls for all elements
   */
  setupElementControls() {
    soundConfig.elements.forEach(elementConfig => {
      const element = document.querySelector(elementConfig.selector);
      
      if (!element) return;
      
      const elementId = elementConfig.id;
      const gainSlider = element.querySelector('.gain-slider');
      const panSlider = element.querySelector('.pan-slider');
      
      // Setup gain slider
      if (gainSlider) {
        // Initialize soundManager with default value
        const initialGain = parseFloat(gainSlider.value);
        soundManager.setElementGain(elementId, initialGain);
        
        // Handle gain changes
        gainSlider.addEventListener('input', (e) => {
          e.stopPropagation();
          const value = parseFloat(e.target.value);
          soundManager.setElementGain(elementId, value);
          
          // Update master pattern if this element is tracked
          soundManager.updateTrackedElementGain(elementId, value);
          this.updateMasterPatternDisplay();
        });
      }
      
      // Setup pan slider
      if (panSlider) {
        // Initialize soundManager with default value
        const initialPan = parseFloat(panSlider.value);
        soundManager.setElementPan(elementId, initialPan);
        
        // Handle pan changes
        panSlider.addEventListener('input', (e) => {
          e.stopPropagation();
          const value = parseFloat(e.target.value);
          soundManager.setElementPan(elementId, value);
          
          // Update master pattern if this element is tracked
          soundManager.updateTrackedElementPan(elementId, value);
          this.updateMasterPatternDisplay();
        });
      }
      
      // Setup pause button
      const pauseButton = element.querySelector('.pause-button');
      if (pauseButton) {
        pauseButton.addEventListener('click', async (e) => {
          e.stopPropagation();
          await this.handlePauseButton(elementId);
        });
      }
      
      // Setup solo button
      const soloButton = element.querySelector('.solo-button');
      if (soloButton) {
        soloButton.addEventListener('click', (e) => {
          e.stopPropagation();
          this.handleSoloButton(elementId, soloButton);
        });
      }
      
      // Setup mute button
      const muteButton = element.querySelector('.mute-button');
      if (muteButton) {
        muteButton.addEventListener('click', (e) => {
          e.stopPropagation();
          this.handleMuteButton(elementId, muteButton);
        });
      }
      
      // Setup collapsible sections (Effects & Filters)
      this.setupCollapsibleSections(element, elementId);
    });
  }
  
  /**
   * Setup collapsible sections for effects and filters
   */
  setupCollapsibleSections(element, elementId) {
    if (!element || !elementId) {
      console.warn(`⚠️ setupCollapsibleSections: Invalid element or elementId`, { element, elementId });
      return;
    }
    
    const toggleButtons = element.querySelectorAll('.collapsible-toggle');
    console.log(`🎛️ Setting up collapsible sections for ${elementId}: ${toggleButtons.length} toggle buttons found`);
    
    toggleButtons.forEach(toggleBtn => {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Toggle active state
        toggleBtn.classList.toggle('active');
        
        // Toggle content visibility
        const content = toggleBtn.nextElementSibling;
        if (content && content.classList.contains('collapsible-content')) {
          content.classList.toggle('active');
        }
      });
    });
    
    // Setup effect sliders
    const effectSliders = element.querySelectorAll('.effect-slider');
    console.log(`🎛️ Setting up ${effectSliders.length} effect sliders for ${elementId}`);
    
    effectSliders.forEach(slider => {
      // Check if this slider already has a listener (avoid duplicates)
      if (slider.dataset.hasListener === 'true') {
        console.log(`⚠️ Slider ${elementId} already has listener, skipping`);
        return;
      }
      
      const valueDisplay = slider.nextElementSibling;
      slider.dataset.hasListener = 'true'; // Mark as having listener
      
      // Update display value on input
      slider.addEventListener('input', async (e) => {
        e.stopPropagation();
        const value = parseFloat(e.target.value);
        const display = e.target.nextElementSibling;
        if (display && display.classList.contains('slider-value')) {
          display.textContent = value.toFixed(2);
        }
        
        // Update the pattern with effects
        await this.updateElementEffects(elementId);
      });
    });
    
    // Synth type selector is now only in the modal, not in elements
    
    // Setup filter sliders
    const filterSliders = element.querySelectorAll('.filter-slider');
    console.log(`🎛️ Setting up ${filterSliders.length} filter sliders for ${elementId}`);
    
    filterSliders.forEach(slider => {
      // Check if this slider already has a listener (avoid duplicates)
      if (slider.dataset.hasListener === 'true') {
        console.log(`⚠️ Slider ${elementId} already has listener, skipping`);
        return;
      }
      
      const valueDisplay = slider.nextElementSibling;
      slider.dataset.hasListener = 'true'; // Mark as having listener
      
      // Update display value on input
      slider.addEventListener('input', async (e) => {
        e.stopPropagation();
        const value = parseFloat(e.target.value);
        const display = e.target.nextElementSibling;
        if (display && display.classList.contains('slider-value')) {
          // Format based on slider type
          if (e.target.classList.contains('lpf-slider') || e.target.classList.contains('hpf-slider')) {
            display.textContent = Math.round(value);
          } else {
            display.textContent = value.toFixed(1);
          }
        }
        
        // Update the pattern with filters
        await this.updateElementFilters(elementId);
      });
    });
    
    // Setup synth sliders
    const synthSliders = element.querySelectorAll('.synth-slider');
    console.log(`🎛️ Setting up ${synthSliders.length} synth sliders for ${elementId}`);
    
    synthSliders.forEach(slider => {
      // Check if this slider already has a listener (avoid duplicates)
      if (slider.dataset.hasListener === 'true') {
        console.log(`⚠️ Slider ${elementId} already has listener, skipping`);
        return;
      }
      
      const valueDisplay = slider.nextElementSibling;
      slider.dataset.hasListener = 'true'; // Mark as having listener
      
      // Update display value on input
      slider.addEventListener('input', async (e) => {
        e.stopPropagation();
        const value = parseFloat(e.target.value);
        const display = e.target.nextElementSibling;
        if (display && display.classList.contains('slider-value')) {
          display.textContent = value.toFixed(2);
        }
        
        // Update the pattern with synthesis parameters
        await this.updateElementSynthesis(elementId);
      });
    });
  }
  
  /**
   * Update element effects in the pattern
   */
  async updateElementEffects(elementId) {
    const element = document.querySelector(`[data-sound-id="${elementId}"]`);
    if (!element) return;
    
    // Get effect values
    const reverbSlider = element.querySelector('.reverb-slider');
    const delaySlider = element.querySelector('.delay-slider');
    const distortionSlider = element.querySelector('.distortion-slider');
    
    const reverb = reverbSlider ? parseFloat(reverbSlider.value) : 0;
    const delay = delaySlider ? parseFloat(delaySlider.value) : 0;
    const distortion = distortionSlider ? parseFloat(distortionSlider.value) : 0;
    
    // Store effect values for later use when updating patterns
    if (!this.elementEffects) {
      this.elementEffects = {};
    }
    
    this.elementEffects[elementId] = {
      reverb,
      delay,
      distortion
    };
    
    console.log(`🎛️ Effects updated for ${elementId}:`, this.elementEffects[elementId]);
    
    // Apply effects to the pattern (works for both master and individual playback)
    await this.applyEffectsAndFiltersToPattern(elementId);
  }
  
  /**
   * Update element filters in the pattern
   */
  async updateElementFilters(elementId) {
    const element = document.querySelector(`[data-sound-id="${elementId}"]`);
    if (!element) return;
    
    // Get filter values
    const lpfSlider = element.querySelector('.lpf-slider');
    const hpfSlider = element.querySelector('.hpf-slider');
    const resonanceSlider = element.querySelector('.resonance-slider');
    
    const lpf = lpfSlider ? parseFloat(lpfSlider.value) : 20000;
    const hpf = hpfSlider ? parseFloat(hpfSlider.value) : 20;
    const resonance = resonanceSlider ? parseFloat(resonanceSlider.value) : 0;
    
    // Store filter values for later use when updating patterns
    if (!this.elementFilters) {
      this.elementFilters = {};
    }
    
    this.elementFilters[elementId] = {
      lpf,
      hpf,
      resonance
    };
    
    console.log(`🔊 Filters updated for ${elementId}:`, this.elementFilters[elementId]);
    
    // Apply filters to the pattern (works for both master and individual playback)
    await this.applyEffectsAndFiltersToPattern(elementId);
  }
  
  /**
   * Update element synthesis parameters (ADSR envelope)
   */
  async updateElementSynthesis(elementId) {
    const element = document.querySelector(`[data-sound-id="${elementId}"]`);
    if (!element) return;
    
    // Get synthesis parameter values
    const attackSlider = element.querySelector('.attack-slider');
    const decaySlider = element.querySelector('.decay-slider');
    const sustainSlider = element.querySelector('.sustain-slider');
    const releaseSlider = element.querySelector('.release-slider');
    
    const attack = attackSlider ? parseFloat(attackSlider.value) : 0.01;
    const decay = decaySlider ? parseFloat(decaySlider.value) : 0.1;
    const sustain = sustainSlider ? parseFloat(sustainSlider.value) : 0.5;
    const release = releaseSlider ? parseFloat(releaseSlider.value) : 0.1;
    
    // Store synthesis values for later use when updating patterns
    if (!this.elementSynthesis) {
      this.elementSynthesis = {};
    }
    
    this.elementSynthesis[elementId] = {
      attack,
      decay,
      sustain,
      release
    };
    
    console.log(`🎹 Synthesis updated for ${elementId}:`, this.elementSynthesis[elementId]);
    
    // Apply synthesis to the pattern (works for both master and individual playback)
    await this.applyEffectsAndFiltersToPattern(elementId);
  }
  
  /**
   * Get pattern with effects, filters, and synthesis applied
   * Returns the modified pattern string (does not save or trigger playback)
   */
  getPatternWithEffects(elementId, basePattern) {
    if (!basePattern) return basePattern;
    
    // Get effects, filters, and synthesis
    const effects = this.elementEffects?.[elementId] || {};
    const filters = this.elementFilters?.[elementId] || {};
    const synthesis = this.elementSynthesis?.[elementId] || {};
    
    // Build modifiers string
    let modifiers = [];
    
    // Add effects
    if (effects.reverb > 0) {
      modifiers.push(`.room(${effects.reverb.toFixed(2)})`);
    }
    if (effects.delay > 0) {
      modifiers.push(`.delay(${effects.delay.toFixed(2)})`);
    }
    if (effects.distortion > 0) {
      modifiers.push(`.distort(${effects.distortion.toFixed(1)})`);
    }
    
    // Add filters
    if (filters.lpf < 20000) {
      modifiers.push(`.lpf(${Math.round(filters.lpf)})`);
    }
    if (filters.hpf > 20) {
      modifiers.push(`.hpf(${Math.round(filters.hpf)})`);
    }
    if (filters.resonance > 0) {
      modifiers.push(`.resonance(${filters.resonance.toFixed(1)})`);
    }
    
    // Add synthesis (ADSR envelope) - only if values differ from defaults
    if (synthesis.attack !== undefined && synthesis.attack !== 0.01) {
      modifiers.push(`.attack(${synthesis.attack.toFixed(2)})`);
    }
    if (synthesis.decay !== undefined && synthesis.decay !== 0.1) {
      modifiers.push(`.decay(${synthesis.decay.toFixed(2)})`);
    }
    if (synthesis.sustain !== undefined && synthesis.sustain !== 0.5) {
      modifiers.push(`.sustain(${synthesis.sustain.toFixed(2)})`);
    }
    if (synthesis.release !== undefined && synthesis.release !== 0.1) {
      modifiers.push(`.release(${synthesis.release.toFixed(2)})`);
    }
    
    // Return pattern with modifiers
    return modifiers.length > 0 ? basePattern + modifiers.join('') : basePattern;
  }
  
  /**
   * Apply effects, filters, and synthesis to the current pattern
   */
  async applyEffectsAndFiltersToPattern(elementId) {
    // Get the base pattern
    const savedConfig = this.loadElementConfig(elementId);
    if (!savedConfig || !savedConfig.pattern) return;
    
    const pattern = savedConfig.pattern;
    const finalPattern = this.getPatternWithEffects(elementId, pattern);
    
    if (finalPattern !== pattern) {
      console.log(`🎚️ Applying effects/filters/synthesis to ${elementId}: ${finalPattern}`);
    }
    
    // Check if element is tracked in master
    const isInMaster = soundManager.trackedPatterns && soundManager.trackedPatterns.has(elementId);
    
    if (isInMaster) {
      // Update the pattern in place for master
      await soundManager.updatePatternInPlace(elementId, finalPattern);
      this.updateMasterPatternDisplay();
    } else {
      // For individual playback, check if element is currently playing
      const isPlaying = soundManager.isPlaying(elementId);
      
      if (isPlaying) {
        // Stop and restart with new effects
        console.log(`   Restarting ${elementId} with updated effects...`);
        await soundManager.stopSound(elementId);
        
        // Ensure Strudel is loaded before playing with effects
        if (!soundManager.strudelLoaded) {
          console.log(`   Waiting for Strudel to load before applying effects...`);
          await soundManager.loadStrudelFromCDN();
        }
        
        await soundManager.playStrudelPattern(elementId, finalPattern);
      }
    }
  }
  
  /**
   * Update synthesis section visibility based on pattern type
   */
  updateSynthesisSectionVisibility(elementId, pattern) {
    const element = document.querySelector(`[data-sound-id="${elementId}"]`);
    if (!element) return;
    
    const synthesisSection = element.querySelector('.synthesis-section');
    if (!synthesisSection) return;
    
    // Check if pattern uses a synth sound
    // Common synth names in Strudel: sine, square, sawtooth, triangle, etc.
    const isSynthPattern = pattern && (
      /\.s\(["']?(sine|square|sawtooth|triangle|pulse)/i.test(pattern) ||
      /\.synth\(/i.test(pattern) ||
      /note\([^)]*\)\.s\(["']?(sine|square|sawtooth|triangle)/i.test(pattern)
    );
    
    // Show or hide the synthesis section
    if (isSynthPattern) {
      synthesisSection.style.display = 'block';
      console.log(`🎹 Showing synthesis section for ${elementId} (synth pattern detected)`);
    } else {
      synthesisSection.style.display = 'none';
      console.log(`🎹 Hiding synthesis section for ${elementId} (not a synth pattern)`);
    }
  }

  /**
   * Handle pause button click
   */
  async handlePauseButton(elementId) {
    const element = document.querySelector(`[data-sound-id="${elementId}"]`);
    if (!element) return;
    
    const indicator = element.querySelector('.element-indicator');
    const pauseButton = element.querySelector('.pause-button');
    
    // Check if currently paused
    const isPaused = pauseButton?.classList.contains('paused');
    
    if (isPaused) {
      // Resume: remove paused class and red indicator
      pauseButton?.classList.remove('paused');
      indicator?.classList.remove('paused');
      
      // Resume the sound if it has a pattern
      if (this.elementHasPattern(elementId)) {
        await soundManager.triggerSound(elementId);
      }
      console.log(`▶️ Resumed ${elementId}`);
    } else {
      // Pause: add paused class and red indicator
      pauseButton?.classList.add('paused');
      indicator?.classList.add('paused');
      indicator?.classList.remove('looped'); // Remove loop if active
      
      // Pause the sound
      soundManager.pauseSound(elementId);
      console.log(`⏸️ Paused ${elementId}`);
    }
  }

  /**
   * Handle solo button click
   */
  handleSoloButton(elementId, button) {
    const isSoloed = this.soloedElements.has(elementId);
    
    if (isSoloed) {
      // Unsolo this element
      this.soloedElements.delete(elementId);
      button.classList.remove('active');
      console.log(`🎵 Unsolo: ${elementId}`);
    } else {
      // Solo this element
      this.soloedElements.add(elementId);
      button.classList.add('active');
      console.log(`🎵 Solo: ${elementId}`);
    }
    
    // Update all element gains based on solo/mute state
    this.updateElementAudioStates();
  }
  
  /**
   * Handle mute button click
   */
  handleMuteButton(elementId, button) {
    const isMuted = this.mutedElements.has(elementId);
    
    if (isMuted) {
      // Unmute this element
      this.mutedElements.delete(elementId);
      button.classList.remove('active');
      console.log(`🔊 Unmute: ${elementId}`);
    } else {
      // Mute this element
      this.mutedElements.add(elementId);
      button.classList.add('active');
      console.log(`🔇 Mute: ${elementId}`);
    }
    
    // Update all element gains based on solo/mute state
    this.updateElementAudioStates();
  }
  
  /**
   * Update audio states for all elements based on solo/mute
   */
  updateElementAudioStates() {
    const hasSolo = this.soloedElements.size > 0;
    
    soundConfig.elements.forEach(config => {
      const elementId = config.id;
      const isMuted = this.mutedElements.has(elementId);
      const isSoloed = this.soloedElements.has(elementId);
      
      let effectiveGain;
      
      if (isMuted) {
        // Muted elements are always silent
        effectiveGain = 0;
      } else if (hasSolo) {
        // If any element is soloed, non-soloed elements are muted
        effectiveGain = isSoloed ? 1 : 0;
    } else {
        // No solo, not muted - use normal gain
        effectiveGain = 1;
      }
      
      // Get the current gain slider value
      const element = document.querySelector(`[data-sound-id="${elementId}"]`);
      if (element) {
        const gainSlider = element.querySelector('.gain-slider');
        const baseGain = gainSlider ? parseFloat(gainSlider.value) : 0.8;
        
        // Apply effective gain multiplier
        soundManager.setElementGain(elementId, baseGain * effectiveGain);
      }
    });
    
    // Update master pattern with new solo/mute states
    soundManager.updateMasterPattern(this.soloedElements, this.mutedElements);
    
    // Update master pattern display
    this.updateMasterPatternDisplay();
  }

  /**
   * Activate an element (trigger sound)
   */
  activateElement(elementId, element, triggerType) {
    console.log(`🎵 Activating ${elementId} via ${triggerType}`);
    
    // Check if master is currently playing and this element is tracked in master
    if (this.masterActive && soundManager.trackedPatterns.has(elementId)) {
      console.log(`   ⚠️ Master is playing and ${elementId} is tracked - ignoring individual activation`);
      uiController.updateStatus(`Cannot play ${elementId} individually while master is active. Stop master first.`);
      return;
    }
    
    // If element is already active, just update visual state
    // Don't try to reactivate - the sound might still be starting
    if (this.activeElements.has(elementId)) {
      console.log(`   Already active, just updating visual state`);
      uiController.setElementState(element, triggerType);
      return;
    }

    // Element not active yet - activate it and trigger sound
    this.activeElements.add(elementId);
    
    // Trigger sound
    console.log(`   Triggering sound for ${elementId}...`);
    soundManager.triggerSound(elementId).catch(error => {
      console.error(`Error triggering sound for ${elementId}:`, error);
    });
    
    // Check if element has a pattern configured to determine loaded status
    const hasPattern = this.elementHasPattern(elementId);
    
    // Update status dots - only set playing to true, keep loaded status based on pattern
    this.updateStatusDots(elementId, hasPattern, true);
    
    // Update UI
    uiController.setElementState(element, 'click');
    this.updateActiveElementsDisplay();
    
    // Update status message to show all active elements
    const activeCount = this.activeElements.size;
    if (activeCount > 1) {
      const activeList = Array.from(this.activeElements).join(', ');
      uiController.updateStatus(`Playing: ${activeCount} elements (${activeList})`);
    } else {
      uiController.updateStatus(`Playing: ${soundConfig.getElementConfig(elementId)?.description || elementId}`);
    }
  }

  /**
   * Deactivate an element (stop sound)
   */
  deactivateElement(elementId, element, triggerType) {
    console.log(`🔇 Deactivating ${elementId} (was triggered by ${triggerType})`);

    if (this.activeElements.has(elementId)) {
      // Proceed with deactivation
      this.activeElements.delete(elementId);
      
      // Stop sound
      console.log(`   Stopping sound for ${elementId}`);
      soundManager.stopSound(elementId);
      
      // Check if element has a pattern configured to determine loaded status
      const hasPattern = this.elementHasPattern(elementId);
      
      // Update status dots - keep loaded status based on pattern, set playing false
      this.updateStatusDots(elementId, hasPattern, false);
      
      // Update UI
      uiController.setElementState(element, null);
      this.updateActiveElementsDisplay();
      
      if (this.activeElements.size === 0) {
        uiController.updateStatus('Ready');
      }
    }
  }


  /**
   * Update active elements display
   */
  updateActiveElementsDisplay() {
    const activeList = Array.from(this.activeElements).map(id => {
      const config = soundConfig.getElementConfig(id);
      return config?.description || id;
    });
    uiController.updateActiveElements(activeList);
    
    // Also update pattern slots display with patterns
    const slotsInfo = document.getElementById('slots-info');
    if (slotsInfo) {
      if (this.activeElements.size === 0) {
        slotsInfo.textContent = 'None active';
      } else {
        const slotsData = Array.from(this.activeElements).map(id => {
          const slot = soundManager.strudelPatternSlots?.get(id);
          // Get pattern from saved config or default config
          let pattern = '';
          try {
            const saved = localStorage.getItem(`element-config-${id}`);
            if (saved) {
              const config = JSON.parse(saved);
              pattern = config.pattern || '';
            }
          } catch (e) {
            // Ignore
          }
          if (!pattern) {
            const elementConfig = soundConfig.getElementConfig(id);
            pattern = elementConfig?.pattern || '';
          }
          
          // Format display: element-id→slot: pattern (truncate if too long)
          const slotDisplay = slot ? `${id}→${slot}` : id;
          if (pattern && pattern.trim()) {
            const patternDisplay = pattern.length > 80 ? pattern.substring(0, 80) + '...' : pattern;
            return `${slotDisplay}: ${patternDisplay}`;
          } else {
            return slotDisplay;
          }
        });
        slotsInfo.textContent = slotsData.join(' | ');
      }
    }
  }

  /**
   * Check if an element has a pattern configured
   */
  elementHasPattern(elementId) {
    // Check default config
    const elementConfig = soundConfig.getElementConfig(elementId);
    if (elementConfig?.pattern && elementConfig.pattern.trim() !== '') {
      return true;
    }
    
    // Check localStorage for custom config
    try {
      const saved = localStorage.getItem(`element-config-${elementId}`);
      if (saved) {
        const customConfig = JSON.parse(saved);
        if (customConfig.pattern && customConfig.pattern.trim() !== '') {
          return true;
        }
      }
    } catch (error) {
      // Ignore
    }
    
    return false;
  }

  /**
   * Update status dots for an element
   */
  updateStatusDots(elementId, isLoaded, isPlaying) {
    const element = document.querySelector(`[data-sound-id="${elementId}"]`);
    if (!element) return;
    
    const loadedDot = element.querySelector('.loaded-dot');
    const playingDot = element.querySelector('.playing-dot');
    const elementCircle = element.querySelector('.element-circle');
    
    // RED DOT: bright when NOT loaded (warning), dim when loaded
    if (loadedDot) {
      if (!isLoaded) {
        loadedDot.classList.add('active'); // Red = not ready
      } else {
        loadedDot.classList.remove('active');
      }
    }
    
    // GREEN DOT: bright when sound is configured (pattern exists), pulse only when playing
    if (playingDot) {
      // Check if sound is configured by checking if pattern exists
      const saved = this.loadElementConfig(elementId);
      const hasPattern = saved && saved.pattern && saved.pattern.trim() !== '';
      
      if (hasPattern) {
        playingDot.classList.add('active'); // Green = sound configured
        
        // Add pulsing animation only when actually playing
        if (isPlaying) {
          playingDot.classList.add('is-playing');
        } else {
          playingDot.classList.remove('is-playing');
        }
      } else {
        playingDot.classList.remove('active');
        playingDot.classList.remove('is-playing');
      }
    }
    
    // GREY CIRCLE: turn green when drum sound is playing
    if (elementCircle) {
      // Turn green when actively playing (all patterns)
      if (isPlaying) {
        elementCircle.classList.add('playing');
        console.log(`🟢 Circle turned green for ${elementId} (playing)`);
      } else {
        elementCircle.classList.remove('playing');
      }
    }
  }
  
  /**
   * Check if a pattern is a drum pattern
   */
  isDrumPattern(pattern) {
    if (!pattern || typeof pattern !== 'string') return false;
    
    // Check if it contains sound() with drum abbreviations
    const soundMatch = pattern.match(/sound\(["']([^"']+)["']\)|s\(["']([^"']+)["']\)/);
    if (!soundMatch) return false; // Not a drum pattern
    
    const sounds = soundMatch[1] || soundMatch[2];
    if (!sounds) return false;
    
    const soundList = sounds.split(/\s+/).filter(s => s.trim());
    
    // Check if any sounds are drum abbreviations
    const hasDrums = soundList.some(s => DRUM_ABBREVIATIONS.hasOwnProperty(s.toLowerCase()));
    return hasDrums;
  }

  /**
   * Reset all elements and master pattern
   */
  resetAll() {
    console.log('🔄 Resetting all elements and master pattern...');
    
    // Stop all sounds first
    soundManager.stopAllSounds();
    
    // Clear master pattern by clearing all tracked patterns
    soundManager.trackedPatterns.clear();
    soundManager.updateMasterPattern();
    if (this.masterPatternField) {
      setStrudelEditorValue('master-pattern', '');
      // Restore initial placeholder text
      this.masterPatternField.placeholder = 'Combined pattern will appear here...';
    }
    
    // Clear all element configs from localStorage
    const allElements = document.querySelectorAll('.sound-element');
    allElements.forEach(element => {
      const elementId = element.dataset.soundId;
      if (elementId) {
        // Remove from localStorage
        localStorage.removeItem(`element-config-${elementId}`);
        
        // Clear element config in memory
        const elementConfig = soundConfig.getElementConfig(elementId);
        if (elementConfig) {
          elementConfig.pattern = '';
          elementConfig.description = 'No sound assigned';
        }
        
        // Remove from master
        soundManager.removeElementFromMaster(elementId);
        
        // Reset UI
        const titleEl = element.querySelector('.element-title');
        const configButton = element.querySelector('.config-button');
        if (titleEl) {
          titleEl.textContent = elementId;
        }
        if (configButton) {
          configButton.textContent = 'Configure Sound';
        }
        
        // Reset status dots
        this.updateStatusDots(elementId, false, false);
        
        // Visualizations removed - no longer needed
        
        // Reset element circle
        const elementCircle = element.querySelector('.element-circle');
        if (elementCircle) {
          elementCircle.classList.remove('playing');
        }
        
        // Clear master status indicator
        const masterIndicator = element.querySelector('.master-status-indicator');
        if (masterIndicator) {
          masterIndicator.classList.remove('active');
        }
      }
    });
    
    // Clear active elements
    this.activeElements.clear();
    this.mutedElements.clear();
    this.soloedElements.clear();
    
    // Clear element effects, filters, and synthesis
    this.elementEffects = {};
    this.elementFilters = {};
    this.elementSynthesis = {};
    
    // Update UI
    this.updateActiveElementsDisplay();
    this.updateMasterPatternDisplay();
    this.updateMasterIndicators();
    uiController.updateStatus('🔄 All elements and master pattern reset');
    
    console.log('✅ Reset complete');
  }

  /**
   * Set all elements as NOT loaded initially (red dots on)
   */
  setAllElementsNotLoaded() {
    soundConfig.elements.forEach(config => {
      this.updateStatusDots(config.id, false, false);
    });
    console.log('🔴 All element status dots marked as NOT loaded (red)');
  }

  /**
   * Set all elements as loaded (called after Strudel initialization)
   * Only mark elements as loaded if they have a pattern configured
   */
  setAllElementsLoaded() {
    soundConfig.elements.forEach(config => {
      // Check if element has a pattern configured
      let hasPattern = false;
      
      // Check default config
      if (config.pattern && config.pattern.trim() !== '') {
        hasPattern = true;
      }
      
      // Check localStorage for custom config
      if (!hasPattern) {
        try {
          const saved = localStorage.getItem(`element-config-${config.id}`);
          if (saved) {
            const customConfig = JSON.parse(saved);
            if (customConfig.pattern && customConfig.pattern.trim() !== '') {
              hasPattern = true;
            }
          }
        } catch (error) {
          // Ignore
        }
      }
      
      // Only mark as loaded if element has a pattern
      this.updateStatusDots(config.id, hasPattern, false);
    });
    console.log('✅ Element status dots updated based on configured patterns');
  }

  /**
   * Setup audio initialization on user interaction
   */
  setupAudioInitialization() {
    const initAudio = async (event) => {
      // Only initialize if audio isn't ready yet
      if (!soundManager.isAudioReady()) {
        const success = await soundManager.initialize();
        
        if (success) {
          uiController.updateStatus('Audio enabled - Loading sounds...');
          
          // Don't mark as loaded yet - wait for sounds to actually load
          // The callback will be triggered when sounds are ready
          
          // Remove event listeners after successful initialization
          document.removeEventListener('click', initAudio);
          document.removeEventListener('touchstart', initAudio);
          document.removeEventListener('keydown', initAudio);
          document.removeEventListener('mousedown', initAudio);
        } else {
          uiController.updateStatus('Click to enable audio (required for sound playback)');
        }
      }
    };

    // Initialize on any user interaction - use multiple event types for better compatibility
    // Don't use capture:true to avoid interfering with form controls
    document.addEventListener('click', initAudio, { once: false });
    document.addEventListener('touchstart', initAudio, { once: false });
    document.addEventListener('keydown', initAudio, { once: false });
    document.addEventListener('mousedown', initAudio, { once: false });
  }

  /**
   * Load all element configs from localStorage and update UI
   */
  loadAllElementConfigs() {
    soundConfig.elements.forEach(elementConfig => {
      const savedConfig = this.loadElementConfig(elementConfig.id);
      if (savedConfig) {
        // Update element title in DOM - show bank name if title is blank
        const element = document.querySelector(`[data-sound-id="${elementConfig.id}"]`);
        if (element) {
          const titleEl = element.querySelector('.element-title');
          if (titleEl) {
            if (savedConfig.title && savedConfig.title.trim()) {
              titleEl.textContent = savedConfig.title;
            } else if (savedConfig.bank && savedConfig.bank.trim()) {
              // Show bank name if title is blank
              const bankDisplayName = savedConfig.bank.startsWith('github:') 
                ? savedConfig.bank.replace('github:tidalcycles/', '') 
                : savedConfig.bank;
              titleEl.textContent = bankDisplayName;
            } else {
              titleEl.textContent = elementConfig.id;
            }
          }
        }
        
        // Update config array (but keep original as fallback)
        if (savedConfig.pattern !== undefined) {
          elementConfig.pattern = savedConfig.pattern;
        }
        if (savedConfig.title !== undefined) {
          elementConfig.description = savedConfig.title;
        }
      } else {
        // Set default title from elementConfig
        const element = document.querySelector(`[data-sound-id="${elementConfig.id}"]`);
        if (element) {
          const titleEl = element.querySelector('.element-title');
          if (titleEl) {
            titleEl.textContent = elementConfig.description || elementConfig.id;
          }
        }
      }
    });
  }

  /**
   * Migrate localStorage to fix fancy quotes in all saved patterns
   * This runs once on app startup to fix any existing saved patterns
   */
  migrateLocalStorageQuotes() {
    try {
      console.log('🔧 Migrating localStorage to fix fancy quotes...');
      let migratedCount = 0;
      
      // Check all localStorage keys for element configs
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('element-config-')) {
          try {
            const saved = localStorage.getItem(key);
            if (saved) {
              const config = JSON.parse(saved);
              if (config && config.pattern) {
                const originalPattern = config.pattern;
                const normalizedPattern = originalPattern.replace(/[""]/g, '"').replace(/['']/g, "'");
                
                if (originalPattern !== normalizedPattern) {
                  config.pattern = normalizedPattern;
                  localStorage.setItem(key, JSON.stringify(config));
                  migratedCount++;
                  console.log(`  ✅ Fixed quotes in ${key}`);
                }
              }
            }
          } catch (error) {
            console.warn(`  ⚠️ Could not migrate ${key}:`, error);
          }
        }
      }
      
      if (migratedCount > 0) {
        console.log(`✅ Migrated ${migratedCount} patterns with fancy quotes`);
      } else {
        console.log('✅ No patterns needed migration');
      }
    } catch (error) {
      console.error('Error during localStorage migration:', error);
    }
  }

  /**
   * Load element config from localStorage
   */
  loadElementConfig(elementId) {
    try {
      const saved = localStorage.getItem(`element-config-${elementId}`);
      if (saved) {
        const config = JSON.parse(saved);
        // Normalize quotes in pattern if it exists (but don't save back to avoid infinite loop)
        if (config && config.pattern) {
          config.pattern = config.pattern.replace(/[""]/g, '"').replace(/['']/g, "'");
        }
        return config;
      }
    } catch (error) {
      console.error(`Error loading config for ${elementId}:`, error);
    }
    return null;
  }

  /**
   * Save element config to localStorage
   */
  saveElementConfig(elementId, config) {
    try {
      localStorage.setItem(`element-config-${elementId}`, JSON.stringify(config));
      
      // Update elementConfig array
      const elementConfig = soundConfig.getElementConfig(elementId);
      if (elementConfig) {
        if (config.pattern !== undefined) {
          elementConfig.pattern = config.pattern;
        }
        if (config.title !== undefined) {
          elementConfig.description = config.title;
        }
      }
      
      // Update title in DOM - show bank name if title is blank
      const element = document.querySelector(`[data-sound-id="${elementId}"]`);
      if (element) {
        const titleEl = element.querySelector('.element-title');
        const configButton = element.querySelector('.config-button');
        
        let displayTitle = '';
        
        if (titleEl) {
          if (config.title && config.title.trim()) {
            displayTitle = config.title;
            titleEl.textContent = config.title;
          } else if (config.bank && config.bank.trim()) {
            // Show bank name if title is blank
            const bankDisplayName = config.bank.startsWith('github:') 
              ? config.bank.replace('github:tidalcycles/', '') 
              : config.bank;
            displayTitle = bankDisplayName;
            titleEl.textContent = bankDisplayName;
          } else {
            // Fallback to element ID
            displayTitle = elementId;
            titleEl.textContent = elementId;
          }
        }
        
        // Update config button text to show title if pattern is configured
        if (configButton && config.pattern && config.pattern.trim() !== '') {
          configButton.textContent = displayTitle || 'Configure Sound';
        } else if (configButton) {
          configButton.textContent = 'Configure Sound';
        }
        
        // Show Synthesis section if this is a synth pattern
        const synthSounds = ['sine', 'square', 'triangle', 'sawtooth', 'superpiano', 'supersaw', 'gtr', 'bass', 'casio', 'jazz', 'metal'];
        const isSynthPattern = config.pattern && (
          config.pattern.includes('note(') || 
          config.pattern.includes('n(') ||
          synthSounds.some(synth => config.pattern.includes(`.s("${synth}"`))
        );
        
        const synthesisSection = element.querySelector('.synthesis-section');
        if (synthesisSection && isSynthPattern) {
          synthesisSection.style.display = 'block';
          console.log(`✅ ${elementId}: Synthesis section shown for synth pattern`);
        }
      }
      
      // Update status dots - check if pattern exists and if element is currently playing
      const hasPattern = config.pattern && config.pattern.trim() !== '';
      const isPlaying = this.activeElements.has(elementId);
      // Don't show circle as playing when just saving - only when actually playing
      this.updateStatusDots(elementId, hasPattern, false);
      
      // Show/hide synthesis section based on whether it's a synth pattern
      this.updateSynthesisSectionVisibility(elementId, config.pattern);
      
      // Invalidate pattern cache and pre-evaluate new pattern
      if (config.pattern !== undefined) {
        soundManager.invalidatePatternCache(elementId);
        // Pre-evaluate the new pattern in background
        soundManager.preEvaluatePattern(elementId, config.pattern).catch(err => {
          console.log(`⚠️ Failed to pre-evaluate pattern for ${elementId}:`, err);
        });
      }
      
      // Save pattern to master
      if (config.pattern !== undefined && config.pattern.trim() !== '') {
        // Get current gain and pan values for this element
        const element = document.querySelector(`[data-sound-id="${elementId}"]`);
        let gain = 0.8;
        let pan = 0;
        
        if (element) {
          const gainSlider = element.querySelector('.gain-slider');
          const panSlider = element.querySelector('.pan-slider');
          if (gainSlider) gain = parseFloat(gainSlider.value);
          if (panSlider) pan = parseFloat(panSlider.value);
        }
        
        // Save to master
        const saveResult = soundManager.saveElementToMaster(elementId, config.pattern, gain, pan);
        
        if (saveResult.success) {
          // Update master pattern with current solo/mute states
          soundManager.updateMasterPattern(this.soloedElements, this.mutedElements);
          
          // Update master pattern display
          this.updateMasterPatternDisplay();
          
          // Update master indicator
          this.updateMasterIndicators();
          
          console.log(`✅ Pattern saved to master for ${elementId}`);
        } else {
          console.error(`❌ Failed to save pattern to master for ${elementId}:`, saveResult.error);
        }
      }
      
      // Visualizations removed - no longer needed
      
      console.log(`✅ Saved config for ${elementId}:`, config);
    } catch (error) {
      console.error(`Error saving config for ${elementId}:`, error);
    }
  }

  // Spiral visualization removed - no longer needed

  /**
   * Setup modal functionality
   */
  setupModal() {
    const modal = document.getElementById('config-modal');
    if (!modal) return;

    const closeModal = () => {
      // Preview removed - no longer needed
      modal.style.display = 'none';
      this.currentEditingElementId = null;
    };

    const openModal = (elementId) => {
      const elementConfig = soundConfig.getElementConfig(elementId);
      const savedConfig = this.loadElementConfig(elementId);
      
      // Populate modal with current values
      // Extract channel number from elementId (e.g., "element-1" -> "1")
      const channelNumber = elementId.replace('element-', '');
      document.getElementById('modal-element-id').textContent = `(${channelNumber})`;
      // Don't use "No sound assigned" as a title - it's just a placeholder
      const savedTitle = savedConfig?.title || '';
      const fallbackTitle = (elementConfig?.description && elementConfig.description !== 'No sound assigned') 
        ? elementConfig.description 
        : '';
      document.getElementById('modal-title').value = savedTitle || fallbackTitle;
      const rawPattern = savedConfig?.pattern || elementConfig?.pattern || '';
      
      // Ensure Strudel REPL editor is initialized for modal-pattern
      // Initialize if not already done (but don't block modal opening if it fails)
      try {
        const modalPatternTextarea = document.getElementById('modal-pattern');
        if (modalPatternTextarea && !modalPatternTextarea.dataset.strudelReplInitialized) {
          initStrudelReplEditors();
        }
      } catch (error) {
        console.warn('⚠️ Could not initialize Strudel REPL editor for modal, continuing with textarea:', error);
      }
      // Convert Strudel pattern to drum display if it's a drum pattern
      // Only set value if there's a user-added pattern (not auto-generated default), otherwise leave empty to show placeholder
      const patternField = document.getElementById('modal-pattern');
      const bankSelect = document.getElementById('modal-pattern-bank');
      bankSelect.value = savedConfig?.bank || '';
      
      // Check if pattern is just an auto-generated default (not user-edited)
      const isAutoGeneratedDefault = rawPattern && (
        rawPattern.match(/^s\(["']bd["']\)\.bank\(["'][^"']+["']\)$/) || // s("bd").bank("bankname")
        rawPattern.match(/^note\(["']c3["']\)\.s\(["'][^"']+["']\)$/) || // note("c3").s("waveform")
        rawPattern.match(/^sound\(["']bd hh["']\)$/) // sound("bd hh") - old default
      );
      
      if (rawPattern && rawPattern.trim() !== '' && !isAutoGeneratedDefault) {
        // User has manually edited the pattern - show it and clear placeholder
        // Always keep patterns in Strudel format - don't convert to display format
        // Only show Strudel syntax (s("bd"), sound("bd hh"), note("c3"), etc.)
        setStrudelEditorValue('modal-pattern', rawPattern);
        if (patternField) patternField.placeholder = '';
      } else {
        // No user-added pattern or just auto-generated default - leave empty and show placeholder if bank is selected
        setStrudelEditorValue('modal-pattern', '');
        if (bankSelect.value && bankSelect.value !== '') {
          patternField.placeholder = 'Drums and Percussion: s("bd sd rim cp hh oh cr rd ht mt lt sh cb tb perc misc fx"), Synths: note("c3 d3 [e3 f3]")';
        } else {
          patternField.placeholder = '';
        }
      }
      
      document.getElementById('modal-sample-url').value = savedConfig?.sampleUrl || '';
      document.getElementById('modal-sample-file').value = '';
      
      this.currentEditingElementId = elementId;
      modal.style.display = 'flex';
    };

    // Close button
    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }

    // Bank dropdown - load bank when changed
    const bankSelect = document.getElementById('modal-pattern-bank');
    if (bankSelect) {
      bankSelect.addEventListener('change', async (e) => {
        const bankValue = e.target.value;
        const elementId = this.currentEditingElementId;
        
        if (!elementId) return;
        
        const statusText = document.getElementById('status-text');
        const patternTextarea = document.getElementById('modal-pattern');
        
        // Show placeholder only when a bank is selected and pattern is empty
        const currentValue = getStrudelEditorValue('modal-pattern');
        if (bankValue && bankValue !== '' && (!currentValue || currentValue.trim() === '')) {
          if (patternTextarea) patternTextarea.placeholder = 'Drums and Percussion: s("bd sd rim cp hh oh cr rd ht mt lt sh cb tb perc misc fx"), Synths: note("c3 d3 [e3 f3]")';
        }
        
        // Handle "Default" (empty value) - no bank, no .bank() modifier
        if (!bankValue || bankValue === '') {
          console.log(`📦 Using Default (no bank)`);
          // Clear placeholder when no bank is selected
          patternTextarea.placeholder = '';
          if (statusText) {
            statusText.textContent = `📦 Using Default samples`;
          }
          
          // Always update title to "Default" when Default bank is selected
          const titleInput = document.getElementById('modal-title');
          titleInput.value = 'Default';
          
          // Update title in DOM immediately
          const element = document.querySelector(`[data-sound-id="${elementId}"]`);
          if (element) {
            const titleEl = element.querySelector('.element-title');
            if (titleEl) {
              titleEl.textContent = 'Default';
            }
          }
          console.log(`📝 Updated title to: Default`);
          
          // Remove any existing .bank() modifier and create pattern without .bank()
          let currentPattern = getStrudelEditorValue('modal-pattern').trim();
          // Convert display to Strudel format for processing
          let strudelPattern = drumDisplayToPattern(currentPattern);
          
          if (strudelPattern) {
            // Remove any existing .bank() modifier
            strudelPattern = strudelPattern.replace(/\.bank\(["'][^"']*["']\)/g, '');
            strudelPattern = strudelPattern.replace(/\.+$/, '').trim();
            // Keep in Strudel format (don't convert to drum display)
            setStrudelEditorValue('modal-pattern', strudelPattern);
            patternTextarea.placeholder = '';
            console.log(`📝 Removed .bank() modifier for Default`);
          } else {
            // If no pattern, create a basic one without .bank() using s() format
            strudelPattern = `s("bd")`;
            // Keep in Strudel format
            setStrudelEditorValue('modal-pattern', strudelPattern);
            patternTextarea.placeholder = '';
            console.log(`📝 Created default pattern without .bank()`);
          }
        } else {
          // Check if this is a synth sound (not a drum bank)
          const synthSounds = ['sine', 'square', 'triangle', 'sawtooth', 'superpiano', 'supersaw', 'gtr', 'bass', 'casio', 'jazz', 'metal'];
          const isSynthSound = synthSounds.includes(bankValue);
          
          if (isSynthSound) {
            // Handle synth sound - no bank loading needed
            console.log(`🎹 Using synth sound: ${bankValue}`);
            if (statusText) {
              statusText.textContent = `🎹 Using ${bankValue} synth sound`;
            }
            
            // Update title with better display names
            const titleInput = document.getElementById('modal-title');
            const displayNames = {
              'superpiano': 'Piano',
              'supersaw': 'Saw Synth',
              'gtr': 'Guitar',
              'bass': 'Bass',
              'casio': 'Casio',
              'jazz': 'Jazz',
              'metal': 'Metal'
            };
            const displayName = displayNames[bankValue] || bankValue.charAt(0).toUpperCase() + bankValue.slice(1);
            titleInput.value = displayName;
            
            // Update title in DOM immediately
            const element = document.querySelector(`[data-sound-id="${elementId}"]`);
            if (element) {
              const titleEl = element.querySelector('.element-title');
              if (titleEl) {
                titleEl.textContent = displayName;
              }
            }
            console.log(`📝 Updated title to: ${displayName}`);
            
            // Update pattern to use synth waveform
            let currentPattern = getStrudelEditorValue('modal-pattern').trim();
            // Convert display to Strudel format for processing
            let strudelPattern = drumDisplayToPattern(currentPattern);
            
            // Remove any existing .bank(), .s(), or .sound() modifiers
            strudelPattern = strudelPattern.replace(/\.bank\(["'][^"']*["']\)/g, '');
            strudelPattern = strudelPattern.replace(/\.s\(["'][^"']*["']\)/g, '');
            strudelPattern = strudelPattern.replace(/\.sound\(["'][^"']*["']\)/g, '');
            strudelPattern = strudelPattern.replace(/\.+$/, '').trim();
            
            // Simple approach: always use note().s() format for ALL sounds
            if (strudelPattern && strudelPattern.trim() !== '') {
              console.log(`🎹 BANK CHANGE: Processing existing pattern: ${strudelPattern}`);
              
              // Extract notes from existing pattern
              let notes = 'c3 d3 e3 f3'; // default
              const noteMatch = strudelPattern.match(/(?:note|n)\s*\(\s*["']([^"']+)["']\s*\)/);
              if (noteMatch && noteMatch[1]) {
                notes = noteMatch[1];
                console.log(`🎹 BANK CHANGE: Extracted notes: ${notes}`);
              }
              
              // Always use note().s() format
              strudelPattern = `note("${notes}").s("${bankValue}")`;
              console.log(`🎹 BANK CHANGE: Created note("${notes}").s("${bankValue}")`);
            } else {
              // Create default pattern when empty
              strudelPattern = `note("c3 d3 e3 f3").s("${bankValue}")`;
              console.log(`🎹 BANK CHANGE: Created default pattern with ${bankValue}`);
            }
            
            console.log(`🎹 BANK CHANGE: Setting textarea to: ${strudelPattern}`);
            // Keep in Strudel format (don't convert to drum display)
            setStrudelEditorValue('modal-pattern', strudelPattern);
            // Clear placeholder when pattern is set
            patternTextarea.placeholder = '';
            
            // Verify it was set
            const verifyPattern = getStrudelEditorValue('modal-pattern');
            console.log(`🎹 BANK CHANGE: Verified textarea contains: ${verifyPattern}`);
          } else {
            // Handle bank selection (non-empty value)
            console.log(`📦 Loading bank: ${bankValue}`);
            if (statusText) {
              statusText.textContent = `📦 Loading bank: ${bankValue}...`;
            }
            
            // Check if this is a local custom or built-in Strudel bank or synth waveform
            // All drum banks are loaded from dough-samples CDN
            // TR-808 and TR-909 have local fallback in assets folder
            const builtInDrumBanks = [
              'RolandTR808', 'RolandTR909', 'RolandTR707', 'RhythmAce', 
              'AkaiLinn', 'ViscoSpaceDrum', 'EmuSP1200', 'CasioRZ1'
            ];
            const builtInSynthSounds = [
              'sine', 'square', 'triangle', 'sawtooth',
              'superpiano', 'supersaw', 'gtr', 'bass',
              'casio', 'insect', 'wind', 'jazz', 'metal', 'east', 'crow', 'space', 'numbers'
            ];
            const isBuiltInBank = builtInDrumBanks.includes(bankValue) || builtInSynthSounds.includes(bankValue.toLowerCase());
            
            let bankLoaded = false;
            // Built-in banks are embedded and work directly - just mark as loaded
            // Non-built-in banks need to be loaded via loadBank()
            if (isBuiltInBank) {
              bankLoaded = true;
              console.log(`✅ Built-in bank/waveform: ${bankValue} (no loading required)`);
              if (statusText) {
                statusText.textContent = `✅ Built-in: ${bankValue}`;
              }
            } else {
              try {
                bankLoaded = await soundManager.loadBank(bankValue);
              
              if (bankLoaded) {
                console.log(`✅ Bank loaded: ${bankValue}`);
                if (statusText) {
                  statusText.textContent = `✅ Bank loaded: ${bankValue}`;
                }
              } else {
                console.log(`⚠️ Bank "${bankValue}" may not be fully loaded, but continuing...`);
                if (statusText) {
                  statusText.textContent = `⚠️ Bank "${bankValue}" may not be available`;
                  }
                }
              } catch (error) {
                console.error(`Error loading bank ${bankValue}:`, error);
                bankLoaded = false;
                if (statusText) {
                  statusText.textContent = `⚠️ Error loading bank: ${bankValue}`;
                }
              }
            }
              
            try {
              // Always update title and pattern regardless of load success
              const titleInput = document.getElementById('modal-title');
              const bankDisplayName = bankValue.startsWith('github:') 
                ? bankValue.replace('github:tidalcycles/', '') 
                : bankValue;
              
              // Always update title when bank is selected
              titleInput.value = bankDisplayName;
              
              // Update title in DOM immediately
              const element = document.querySelector(`[data-sound-id="${elementId}"]`);
              if (element) {
                const titleEl = element.querySelector('.element-title');
                if (titleEl) {
                  titleEl.textContent = bankDisplayName;
                }
              }
              console.log(`📝 Updated title to: ${bankDisplayName}`);
              
              // Always update pattern to use the new bank or synth
              let currentPattern = getStrudelEditorValue('modal-pattern').trim();
              
              // Check if this is a synth (sawtooth, square, triangle, sine, etc.)
              const isSynth = ['sawtooth', 'square', 'triangle', 'sine'].includes(bankValue);
              
              if (isSynth) {
                // Handle synths - use .synth() or synth() function
                console.log(`📝 Handling synth: ${bankValue}`);
                
                // Convert display to Strudel format for processing
                let currentDisplay = getStrudelEditorValue('modal-pattern').trim();
                let strudelPattern = drumDisplayToPattern(currentDisplay);
                
                // Remove any existing .bank() or .synth() modifiers
                strudelPattern = strudelPattern.replace(/\.bank\(["'][^"']*["']\)/g, '');
                strudelPattern = strudelPattern.replace(/\.synth\(["'][^"']*["']\)/g, '');
                strudelPattern = strudelPattern.replace(/\.s\(["'][^"']*["']\)/g, '');
                strudelPattern = strudelPattern.replace(/\.+$/, '').trim();
                
                if (strudelPattern && strudelPattern.trim() !== '') {
                  // Check if current pattern is a drum pattern (sound() or s() or has .bank())
                  const isDrumPattern = strudelPattern.includes('sound(') || strudelPattern.includes('s(') || strudelPattern.match(/\.bank\(["'][^"']+["']\)/);
                  
                  if (isDrumPattern) {
                    // Converting from drum to synth - replace entirely with synth pattern
                    strudelPattern = `note("c3").s("${bankValue}")`;
                    console.log(`📝 Converted from drum to synth pattern with waveform: ${bankValue}`);
                  }
                  // If pattern uses note(), add .s() modifier  
                  else if (strudelPattern.includes('note(')) {
                    // Remove any existing .s() or .synth() modifiers first
                    strudelPattern = strudelPattern.replace(/\.s\(["'][^"']*["']\)/g, '');
                    strudelPattern = strudelPattern.replace(/\.synth\(["'][^"']*["']\)/g, '');
                    strudelPattern = strudelPattern.replace(/\.+$/, '').trim();
                    strudelPattern = `${strudelPattern}.s("${bankValue}")`;
                    console.log(`📝 Added .s("${bankValue}") to note() pattern`);
                  }
                  // If pattern doesn't use sound() or note(), create a note() pattern with synth
                  else {
                    strudelPattern = `note("c3").s("${bankValue}")`;
                    console.log(`📝 Created note() pattern with synth: ${bankValue}`);
                  }
                  } else {
                  // If no pattern, create a basic synth pattern
                  strudelPattern = `note("c3").s("${bankValue}")`;
                  console.log(`📝 Created default synth pattern: ${bankValue}`);
                }
                // Keep pattern in Strudel format (don't convert to drum display for synth patterns)
                setStrudelEditorValue('modal-pattern', strudelPattern);
                patternTextarea.placeholder = '';
                console.log(`   Pattern: ${strudelPattern.substring(0, 80)}...`);
              }
              else if (bankValue && !bankValue.startsWith('github:')) {
                // Predefined drum banks need .bank() modifier
                // Built-in banks (TR-808, TR-909) don't need to be loaded - they're embedded in Strudel
                // Only check bankLoaded for non-built-in banks
                if (isBuiltInBank || bankLoaded) {
                  // Built-in banks are always available, or bank loaded successfully - add .bank() modifier
                  if (isBuiltInBank) {
                    console.log(`📝 Using built-in bank: ${bankValue} (no load required)`);
                  }
                  let currentDisplay = patternTextarea.value.trim();
                  
                  // Check if the current pattern is in display format (contains parentheses with descriptions)
                  const isDisplayFormat = currentDisplay.includes('(') && currentDisplay.includes(')') && 
                                         (currentDisplay.match(/\([^)]+\)/g) || []).some(match => 
                                           match.includes('drum') || match.includes('Kick') || match.includes('hi-hat')
                                         );
                  
                  // Check if this is just an auto-generated default pattern (not user-edited)
                  const isAutoDefault = currentDisplay && (
                    currentDisplay.match(/^s\(["']bd["']\)\.bank\(["'][^"']+["']\)$/) ||
                    currentDisplay.match(/^note\(["']c3["']\)\.s\(["'][^"']+["']\)$/)
                  );
                  
                  let strudelPattern;
                  
                  // Strudel bank names are case-sensitive: use "RolandTR808", "RolandTR909", etc.
                  // Keep them as-is, don't convert to lowercase
                  const strudelBankName = bankValue;
                  
                  // If pattern is empty or auto-generated default, create a clean default
                  if (!currentDisplay || currentDisplay === '' || isAutoDefault) {
                    strudelPattern = `s("bd").bank("${strudelBankName}")`;
                    console.log(`📝 Created default pattern with bank: ${strudelBankName} (from ${bankValue})`);
                  } else {
                    // Convert display format to Strudel format if needed
                    if (isDisplayFormat) {
                      strudelPattern = drumDisplayToPattern(currentDisplay);
                    } else {
                      // Already in Strudel format (might have modifiers)
                      strudelPattern = currentDisplay;
                    }
                    
                    // Check if current pattern is a synth pattern (note() or has .s() or .synth())
                    const isSynthPattern = strudelPattern.includes('note(') || strudelPattern.includes('n(') || 
                                         strudelPattern.includes('.s(') || strudelPattern.includes('.synth(');
                    
                    if (isSynthPattern) {
                      // Converting from synth to drum - replace entirely with drum pattern
                      strudelPattern = `s("bd").bank("${strudelBankName}")`;
                      console.log(`📝 Converted from synth to drum pattern with bank: ${strudelBankName} (from ${bankValue})`);
                    } else {
                      // Already a drum pattern - clean it up and add bank
                      // Remove any existing .bank() modifier
                      strudelPattern = strudelPattern.replace(/\.bank\(["'][^"']*["']\)/g, '');
                      strudelPattern = strudelPattern.replace(/\.synth\(["'][^"']*["']\)/g, '');
                      strudelPattern = strudelPattern.replace(/\.s\(["'][^"']*["']\)/g, '');
                      
                      // Remove any trailing dots or whitespace
                      strudelPattern = strudelPattern.replace(/\.+$/, '').trim();
                      
                      // Extract just the sound() or s() part (before any modifiers like .gain())
                      // Match s("...") or sound("...")
                      const soundMatch = strudelPattern.match(/(s|sound)\(["'][^"']+["']\)/);
                      if (soundMatch) {
                        // Use just the sound part with bank (using lowercase Strudel bank name)
                        strudelPattern = `${soundMatch[0]}.bank("${strudelBankName}")`;
                      } else {
                        // Fallback: create default
                        strudelPattern = `s("bd").bank("${strudelBankName}")`;
                      }
                      console.log(`📝 Updated pattern to use bank: ${strudelBankName} (from ${bankValue})`);
                    }
                  }
                  
                  // Keep pattern in Strudel format (don't convert to drum display)
                  setStrudelEditorValue('modal-pattern', strudelPattern);
                  patternTextarea.placeholder = '';
                  console.log(`   Pattern: ${strudelPattern.substring(0, 80)}...`);
                } else {
                  // Bank didn't load - don't use .bank(), use default samples instead
                  console.warn(`⚠️ Bank "${bankValue}" not loaded - using default samples (no .bank() modifier)`);
                  if (statusText) {
                    statusText.textContent = `⚠️ Bank "${bankValue}" not available - using default samples`;
                  }
                  
                  let currentDisplay = patternTextarea.value.trim();
                  let strudelPattern = drumDisplayToPattern(currentDisplay);
                  
                  if (strudelPattern) {
                    // Remove any existing .bank() or .synth() modifiers
                    strudelPattern = strudelPattern.replace(/\.bank\(["'][^"']*["']\)/g, '');
                    strudelPattern = strudelPattern.replace(/\.synth\(["']*["']\)/g, '');
                    strudelPattern = strudelPattern.replace(/\.+$/, '').trim();
                  } else {
                    // Create basic pattern without .bank()
                    strudelPattern = `sound("bd hh")`;
                  }
                  // Keep in Strudel format (don't convert to drum display)
                  setStrudelEditorValue('modal-pattern', strudelPattern);
                  patternTextarea.placeholder = '';
                  console.log(`📝 Updated pattern to use default samples (bank unavailable)`);
                  console.log(`   Pattern: ${strudelPattern.substring(0, 80)}...`);
                }
              } else if (bankValue && bankValue.startsWith('github:')) {
                // GitHub banks might not need .bank() - they load as default samples
                // But if pattern has .bank() or .synth(), remove them since GitHub banks are default
                let currentDisplay = patternTextarea.value.trim();
                let strudelPattern = drumDisplayToPattern(currentDisplay);
                
                if (strudelPattern) {
                  strudelPattern = strudelPattern.replace(/\.bank\(["'][^"']*["']\)/g, '');
                  strudelPattern = strudelPattern.replace(/\.synth\(["'][^"']*["']\)/g, '');
                  strudelPattern = strudelPattern.replace(/\.+$/, '').trim();
                  // Keep in Strudel format (don't convert to drum display)
                  setStrudelEditorValue('modal-pattern', strudelPattern);
                  patternTextarea.placeholder = '';
                  console.log(`📝 Updated pattern for GitHub bank (removed .bank()/.synth() if present)`);
                } else {
                  // If no pattern and GitHub bank, create a basic one without .bank()
                  strudelPattern = `s("bd")`;
                  // Keep in Strudel format
                  setStrudelEditorValue('modal-pattern', strudelPattern);
                  patternTextarea.placeholder = '';
                  console.log(`📝 Created default pattern for GitHub bank`);
                }
              }
            } catch (error) {
              console.error('Error loading bank:', error);
            }
          }
        }
        
        // Save the updated pattern and bank to config immediately
        const titleInput = document.getElementById('modal-title');
        const currentTitle = titleInput ? titleInput.value.trim() : '';
        const displayPattern = patternTextarea ? patternTextarea.value.trim() : '';
        // Pattern is already in Strudel format - only convert if it's in display format
        let finalPattern;
        if (displayPattern && (displayPattern.includes('(') && displayPattern.includes(')') && 
            (displayPattern.match(/\([^)]+\)/g) || []).some(match => 
              match.includes('drum') || match.includes('Kick') || match.includes('hi-hat')
            ))) {
          // Pattern is in display format - convert it
          finalPattern = drumDisplayToPattern(displayPattern);
        } else {
          // Pattern is already in Strudel format or empty
          finalPattern = displayPattern;
        }
        
        // Save config with updated bank and pattern
        this.saveElementConfig(elementId, {
          title: currentTitle || bankDisplayName,
          pattern: finalPattern,
          bank: bankValue || undefined
        });
        console.log(`💾 Saved config with bank: ${bankValue}`);
        
        // Invalidate and pre-evaluate pattern cache for instant triggering
        soundManager.invalidatePatternCache(elementId);
        if (finalPattern) {
          await soundManager.preEvaluatePattern(elementId, finalPattern);
          console.log(`📦 Pre-evaluated pattern for ${elementId}`);
        }
        
        // Always restart sound if element is currently playing, using updated pattern
        if (this.activeElements.has(elementId) && patternTextarea) {
          console.log(`🔄 Restarting sound for ${elementId} with new bank...`);
          soundManager.stopSound(elementId);
          
          // Get the final pattern from the textarea (convert display to Strudel format)
          const displayPattern = patternTextarea.value.trim();
          const updatedPattern = drumDisplayToPattern(displayPattern);
          
          // Small delay to ensure stop completes and old pattern evaluations finish
          setTimeout(async () => {
            try {
              if (updatedPattern) {
                console.log(`🎵 Playing updated pattern: ${updatedPattern.substring(0, 60)}...`);
                await soundManager.playStrudelPattern(elementId, updatedPattern);
                console.log(`✅ Restarted sound with new bank`);
              } else {
                // Fallback to triggerSound if no pattern in textarea
                console.log(`⚠️ No pattern to play, using saved config`);
                await soundManager.triggerSound(elementId);
              }
            } catch (err) {
              console.error(`Error restarting sound for ${elementId}:`, err);
            }
          }, 300); // Increased delay to ensure old pattern stops completely
        }
      });
    }

    // Cancel button
    const cancelBtn = modal.querySelector('.btn-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        // Preview removed - no longer needed
        closeModal();
      });
    }

    // Preview button removed - no longer needed

    // Save button
    const saveBtn = modal.querySelector('.btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        if (!this.currentEditingElementId) return;
        
        let title = document.getElementById('modal-title').value.trim();
        // Treat "No sound assigned" as empty title (it's just a placeholder)
        if (title === 'No sound assigned') {
          title = '';
        }
        const displayPattern = getStrudelEditorValue('modal-pattern').trim();
        // If pattern is already in Strudel format (has .bank(), .s(), or .synth()), use it directly
        // Otherwise, convert drum display back to Strudel pattern
        let pattern;
        if (displayPattern.includes('.bank(') || displayPattern.includes('.s(') || displayPattern.includes('.synth(') || 
            displayPattern.includes('note(') || displayPattern.includes('sound(') || displayPattern.includes('s(')) {
          // Already in Strudel format
          pattern = displayPattern;
        } else {
          // Convert from drum display format
          pattern = drumDisplayToPattern(displayPattern);
        }
        const sampleUrl = document.getElementById('modal-sample-url').value.trim();
        const fileInput = document.getElementById('modal-sample-file');
        
        let finalSampleUrl = sampleUrl;
        
        // Handle file selection
        if (fileInput.files && fileInput.files.length > 0) {
          const file = fileInput.files[0];
          const reader = new FileReader();
          const bankValue = document.getElementById('modal-pattern-bank').value;
          reader.onload = (e) => {
            // Store as data URL
            finalSampleUrl = e.target.result;
            this.saveElementConfig(this.currentEditingElementId, {
              title: title || this.currentEditingElementId,
              pattern: pattern,
              sampleUrl: finalSampleUrl,
              fileName: file.name,
              bank: bankValue || undefined
            });
            
            // If element is currently playing, restart with new pattern
            if (this.activeElements.has(this.currentEditingElementId)) {
              soundManager.stopSound(this.currentEditingElementId);
              soundManager.triggerSound(this.currentEditingElementId);
            }
            
            closeModal();
          };
          reader.readAsDataURL(file);
        } else {
          // Save without file
          const bankValue = document.getElementById('modal-pattern-bank').value;
          this.saveElementConfig(this.currentEditingElementId, {
            title: title || this.currentEditingElementId,
            pattern: pattern,
            sampleUrl: finalSampleUrl,
            bank: bankValue || undefined
          });
          
          // If element is currently playing, restart with new pattern
          if (this.activeElements.has(this.currentEditingElementId)) {
            soundManager.stopSound(this.currentEditingElementId);
            soundManager.triggerSound(this.currentEditingElementId);
          }
          
          closeModal();
        }
      });
    }

    // Close on overlay click (but not on modal-content click)
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display !== 'none') {
        closeModal();
      }
    });

    // Wire up config buttons
    document.querySelectorAll('.config-button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const element = btn.closest('.sound-element');
        if (element) {
          const elementId = element.getAttribute('data-sound-id');
          if (elementId) {
            openModal(elementId);
          }
        }
      });
    });

    this.openConfigModal = openModal;
  }

  /**
   * Check if two rectangles overlap
   */
  isOverlapping(rect1, rect2) {
    return !(
      rect1.x + rect1.width < rect2.x ||
      rect2.x + rect2.width < rect1.x ||
      rect1.y + rect1.height < rect2.y ||
      rect2.y + rect2.height < rect1.y
    );
  }

  /**
   * Setup add element button
   */
  setupAddElementButton() {
    const addBtn = document.getElementById('add-element-btn');
    if (!addBtn) return;

    addBtn.addEventListener('click', () => {
      this.createNewElement();
    });
  }

  /**
   * Create a new element
   */
  createNewElement() {
    this.elementCounter++;
    const newElementId = `element-${this.elementCounter}`;
    const newElementNumber = this.elementCounter;

    console.log(`➕ Creating new element: ${newElementId}`);

    const container = document.querySelector('.elements-container');
    const addBtn = document.getElementById('add-element-btn');
    if (!container || !addBtn) return;

    // Create new element HTML
    const newElementHTML = `
      <div class="sound-element" data-sound-id="${newElementId}">
        <input type="range" class="gain-slider" min="0" max="1" step="0.01" value="0.8" orient="vertical" />
        <div class="volume-label">Gain</div>
        <div class="channel-label">Channel ${newElementNumber}</div>
        <input type="range" class="pan-slider" min="-1" max="1" step="0.01" value="0" orient="horizontal" />
        <div class="pan-label">Pan</div>
        <div class="status-dots">
          <div class="status-dot loaded-dot" title="Sound Loaded"></div>
          <div class="status-dot playing-dot" title="Playing"></div>
        </div>
        <div class="vu-meter-container">
          <div class="vu-meter">
            <div class="vu-bar"></div>
          </div>
        </div>
        <div class="master-status-indicator" title="Pattern saved to Master">M</div>
        <div class="element-title">Element ${newElementNumber}</div>
        <div class="element-indicator"></div>
        <div class="element-circle"></div>
        <div class="spiral-visualization-container" style="display: none;"></div>
        <div class="element-controls">
          <button class="solo-button" title="Solo">S</button>
          <button class="mute-button" title="Mute">M</button>
        </div>
        
        <!-- Synthesis Section (ADSR Envelope) - Only for synth sounds -->
        <div class="collapsible-section synthesis-section" style="display: none;">
          <button class="collapsible-toggle" data-target="synthesis">
            <span class="toggle-icon">▶</span> Synthesis
          </button>
          <div class="collapsible-content synthesis-content">
            <div class="slider-row">
              <label>Attack</label>
              <input type="range" class="synth-slider attack-slider" min="0" max="2" step="0.01" value="0.01" />
              <span class="slider-value">0.01</span>
            </div>
            <div class="slider-row">
              <label>Decay</label>
              <input type="range" class="synth-slider decay-slider" min="0" max="2" step="0.01" value="0.1" />
              <span class="slider-value">0.1</span>
            </div>
            <div class="slider-row">
              <label>Sustain</label>
              <input type="range" class="synth-slider sustain-slider" min="0" max="1" step="0.01" value="0.5" />
              <span class="slider-value">0.5</span>
            </div>
            <div class="slider-row">
              <label>Release</label>
              <input type="range" class="synth-slider release-slider" min="0" max="5" step="0.01" value="0.1" />
              <span class="slider-value">0.1</span>
            </div>
          </div>
        </div>
        
        <!-- Filters Section -->
        <div class="collapsible-section">
          <button class="collapsible-toggle" data-target="filters">
            <span class="toggle-icon">▶</span> Filters
          </button>
          <div class="collapsible-content filters-content">
            <div class="slider-row">
              <label>Low-pass</label>
              <input type="range" class="filter-slider lpf-slider" min="20" max="20000" step="10" value="20000" />
              <span class="slider-value">20000</span>
              <div class="slider-endpoints">
                <span>20 Hz</span>
                <span>20 kHz</span>
              </div>
            </div>
            <div class="slider-row">
              <label>High-pass</label>
              <input type="range" class="filter-slider hpf-slider" min="20" max="20000" step="10" value="20" />
              <span class="slider-value">20</span>
              <div class="slider-endpoints">
                <span>20 Hz</span>
                <span>20 kHz</span>
              </div>
            </div>
            <div class="slider-row">
              <label>Resonance</label>
              <input type="range" class="filter-slider resonance-slider" min="0" max="20" step="0.1" value="0" />
              <span class="slider-value">0</span>
            </div>
          </div>
        </div>
        
        <!-- Effects Section -->
        <div class="collapsible-section">
          <button class="collapsible-toggle" data-target="effects">
            <span class="toggle-icon">▶</span> Effects
          </button>
          <div class="collapsible-content effects-content">
            <div class="slider-row">
              <label>Reverb</label>
              <input type="range" class="effect-slider reverb-slider" min="0" max="1" step="0.01" value="0" />
              <span class="slider-value">0</span>
            </div>
            <div class="slider-row">
              <label>Delay</label>
              <input type="range" class="effect-slider delay-slider" min="0" max="1" step="0.01" value="0" />
              <span class="slider-value">0</span>
            </div>
            <div class="slider-row">
              <label>Distortion</label>
              <input type="range" class="effect-slider distortion-slider" min="0" max="10" step="0.1" value="0" />
              <span class="slider-value">0</span>
            </div>
          </div>
        </div>
        
        <button class="config-button">Configure Sound</button>
      </div>
    `;

    // Insert before the add button
    addBtn.insertAdjacentHTML('beforebegin', newElementHTML);

    // Register the new element
    const newElement = document.querySelector(`[data-sound-id="${newElementId}"]`);
    if (newElement) {
      // Add to soundConfig.elements
      soundConfig.elements.push({
        id: newElementId,
        selector: `[data-sound-id="${newElementId}"]`,
        type: 'strudel',
        pattern: '',
        description: 'No sound assigned'
      });
      
      // Register click handler
      this.registerElements([{ element: newElement, elementId: newElementId }]);
      
      // Setup all controls for the new element
      this.setupElementControlsForElement(newElement, newElementId);
      
      // Setup config button
      const configButton = newElement.querySelector('.config-button');
      if (configButton && this.openConfigModal) {
        configButton.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openConfigModal(newElementId);
        });
      }
      
      // Ensure config button shows "Configure Sound" for new elements (before initialization)
      const configBtn = newElement.querySelector('.config-button');
      if (configBtn) {
        configBtn.textContent = 'Configure Sound';
      }
      
      // Initialize visualizations (this may update button text if pattern exists)
      this.initializeElementVisualizations(newElement, newElementId);
      
      // Ensure config button shows "Configure Sound" if no pattern is saved
      if (configBtn) {
        const saved = this.loadElementConfig(newElementId);
        if (!saved || !saved.pattern || saved.pattern.trim() === '') {
          configBtn.textContent = 'Configure Sound';
        }
      }
      
      console.log(`✅ Element ${newElementId} created and fully initialized`);
    }
  }
  
  /**
   * Setup controls for a single element (used for dynamically created elements)
   */
  setupElementControlsForElement(element, elementId) {
    if (!element || !elementId) return;
    
    const gainSlider = element.querySelector('.gain-slider');
    const panSlider = element.querySelector('.pan-slider');
    
    // Setup gain slider
    if (gainSlider) {
      // Initialize soundManager with default value
      const initialGain = parseFloat(gainSlider.value);
      soundManager.setElementGain(elementId, initialGain);
      
      // Handle gain changes
      gainSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const value = parseFloat(e.target.value);
        soundManager.setElementGain(elementId, value);
        
        // Update master pattern if this element is tracked
        soundManager.updateTrackedElementGain(elementId, value);
        this.updateMasterPatternDisplay();
      });
    }
    
    // Setup pan slider
    if (panSlider) {
      // Initialize soundManager with default value
      const initialPan = parseFloat(panSlider.value);
      soundManager.setElementPan(elementId, initialPan);
      
      // Handle pan changes
      panSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const value = parseFloat(e.target.value);
        soundManager.setElementPan(elementId, value);
        
        // Update master pattern if this element is tracked
        soundManager.updateTrackedElementPan(elementId, value);
        this.updateMasterPatternDisplay();
      });
    }
    
    // Setup solo button
    const soloButton = element.querySelector('.solo-button');
    if (soloButton) {
      soloButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleSoloButton(elementId, soloButton);
      });
    }
    
    // Setup mute button
    const muteButton = element.querySelector('.mute-button');
    if (muteButton) {
      muteButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleMuteButton(elementId, muteButton);
      });
    }
    
    // Setup collapsible sections (Effects & Filters)
    this.setupCollapsibleSections(element, elementId);
  }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const app = new InteractiveSoundApp();
    app.init();
  });
} else {
  const app = new InteractiveSoundApp();
  app.init();
}

