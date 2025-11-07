/**
 * Configuration for sound mappings and settings
 */

export const soundConfig = {
  // Element-to-sound mappings
  elements: [
  {
    id: 'element-1',
    selector: '[data-sound-id="element-1"]',
    type: 'strudel',
    pattern: '',
    description: 'No sound assigned'
  },
  {
    id: 'element-2',
    selector: '[data-sound-id="element-2"]',
    type: 'strudel',
    pattern: '',
    description: 'No sound assigned'
  },
  {
    id: 'element-3',
    selector: '[data-sound-id="element-3"]',
    type: 'strudel',
    pattern: '',
    description: 'No sound assigned'
  },
  {
    id: 'element-4',
    selector: '[data-sound-id="element-4"]',
    type: 'strudel',
    pattern: '',
    description: 'No sound assigned'
  },
    {
      id: 'element-5',
      selector: '[data-sound-id="element-5"]',
      type: 'strudel',
      pattern: '',
      description: 'No sound assigned'
    },
  {
    id: 'element-6',
    selector: '[data-sound-id="element-6"]',
    type: 'strudel',
    pattern: '',
    description: 'No sound assigned'
  },
  {
    id: 'element-7',
    selector: '[data-sound-id="element-7"]',
    type: 'strudel',
    pattern: '',
    description: 'No sound assigned'
  },
  {
    id: 'element-8',
    selector: '[data-sound-id="element-8"]',
    type: 'strudel',
    pattern: '',
    description: 'No sound assigned'
  },
  {
    id: 'element-9',
    selector: '[data-sound-id="element-9"]',
    type: 'strudel',
    pattern: '',
    description: 'No sound assigned'
  },
  {
    id: 'element-10',
    selector: '[data-sound-id="element-10"]',
    type: 'strudel',
    pattern: '',
    description: 'No sound assigned'
  }
  ],

  // Default settings
  defaults: {
    proximityThreshold: 100, // pixels
    hoverEnabled: true,
    proximityEnabled: true,
    volume: 0.5, // 0-1
    fadeInTime: 0.1, // seconds
    fadeOutTime: 0.2 // seconds
  },

  // Control sound mappings
  controls: {
    'proximity-threshold': {
      type: 'synthesized',
      pattern: 'sound("cp cp ~ cp")',
      description: 'Threshold tick'
    },
    'volume': {
      type: 'synthesized',
      pattern: 'sound("~ cp cp cp")',
      description: 'Volume tick'
    }
  },

  // Get config for a specific element
  getElementConfig(elementId) {
    return this.elements.find(el => el.id === elementId);
  },

  // Get all synthesized elements
  getSynthesizedElements() {
    return this.elements.filter(el => el.type === 'synthesized');
  },

  // Get all audio file elements
  getAudioElements() {
    return this.elements.filter(el => el.type === 'audio');
  },

  // Get config for a specific control
  getControlConfig(controlName) {
    return this.controls[controlName];
  }
};

