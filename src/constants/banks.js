export const SYNTH_BANK_ALIASES = {
  superpiano: 'piano',
  wood: 'jazz' // Wood is now called Jazz
};

export const OSCILLATOR_SYNTHS = ['sine', 'square', 'triangle', 'sawtooth', 'supersaw', 'pulse'];
export const SAMPLE_SYNTHS = ['piano', 'supersaw', 'gtr', 'casio', 'jazz', 'metal', 'folkharp'];
export const LEGACY_SAMPLE_SYNTHS = Object.keys(SYNTH_BANK_ALIASES);

export const DRUM_BANK_VALUES = new Set([
  'RolandTR808',
  'RolandTR909',
  'RolandTR707',
  'RhythmAce',
  'AkaiLinn',
  'ViscoSpaceDrum',
  'CasioRZ1'
]);


