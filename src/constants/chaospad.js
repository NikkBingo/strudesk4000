export const CHAOSPAD_EFFECTS = {
  cutoff: {
    id: 'cutoff',
    label: 'Filter Cutoff (Hz)',
    description: 'Maps the X or Y axis to the master filter cutoff frequency.',
    defaultMin: 80,
    defaultMax: 8000,
    step: 10
  },
  resonance: {
    id: 'resonance',
    label: 'Filter Resonance (Q)',
    description: 'Controls the resonance (Q) of the master filter.',
    defaultMin: 0.1,
    defaultMax: 5,
    step: 0.1
  },
  volume: {
    id: 'volume',
    label: 'Master Volume',
    description: 'Adjusts the global master volume.',
    defaultMin: 0,
    defaultMax: 1,
    step: 0.01
  },
  pan: {
    id: 'pan',
    label: 'Master Pan',
    description: 'Moves the master output left or right.',
    defaultMin: -1,
    defaultMax: 1,
    step: 0.01
  }
};

export const CHAOSPAD_EFFECT_OPTIONS = Object.values(CHAOSPAD_EFFECTS);

export const DEFAULT_CHAOSPAD_AXES = {
  x: {
    effect: 'cutoff',
    min: CHAOSPAD_EFFECTS.cutoff.defaultMin,
    max: CHAOSPAD_EFFECTS.cutoff.defaultMax
  },
  y: {
    effect: 'resonance',
    min: CHAOSPAD_EFFECTS.resonance.defaultMin,
    max: CHAOSPAD_EFFECTS.resonance.defaultMax
  }
};

