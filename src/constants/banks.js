export const SYNTH_BANK_ALIASES = {
  superpiano: 'piano',
  wood: 'jazz' // Wood is now called Jazz
};

export const OSCILLATOR_SYNTHS = ['sine', 'square', 'triangle', 'sawtooth', 'supersaw', 'pulse'];
export const SAMPLE_SYNTHS = ['piano', 'supersaw', 'gtr', 'casio', 'jazz', 'metal', 'folkharp'];
export const LEGACY_SAMPLE_SYNTHS = Object.keys(SYNTH_BANK_ALIASES);

export const DRUM_BANKS = [
  { value: 'RolandTR808', label: 'Roland TR-808' },
  { value: 'RolandTR909', label: 'Roland TR-909' },
  { value: 'RolandTR707', label: 'Roland TR-707' },
  { value: 'RhythmAce', label: 'Rhythm Ace' },
  { value: 'AkaiLinn', label: 'Akai Linn' },
  { value: 'ViscoSpaceDrum', label: 'Visco Space Drum' },
  { value: 'CasioRZ1', label: 'Casio RZ-1' }
];

export const DRUM_BANK_VALUES = new Set(DRUM_BANKS.map(bank => bank.value));

export const WAVEFORM_BANKS = [
  { value: 'sine', label: 'Sine' },
  { value: 'square', label: 'Square' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'sawtooth', label: 'Sawtooth' },
  { value: 'supersaw', label: 'Supersaw' },
  { value: 'pulse', label: 'Pulse' }
];

export const SAMPLE_BANKS = [
  { value: 'piano', label: 'Piano' },
  { value: 'supersaw', label: 'Saw Synth' },
  { value: 'gtr', label: 'Guitar' },
  { value: 'casio', label: 'Casio' },
  { value: 'jazz', label: 'Jazz' },
  { value: 'metal', label: 'Metal' },
  { value: 'folkharp', label: 'Folk Harp' }
];

export const DRUM_BANK_DISPLAY_NAMES = DRUM_BANKS.reduce((acc, bank) => {
  acc[bank.value] = bank.label;
  return acc;
}, {});

export const BUILTIN_BANK_OPTIONS = [
  { group: 'Drums', options: DRUM_BANKS },
  { group: 'Basic Waveforms', options: WAVEFORM_BANKS },
  { group: 'Sample-based Synths', options: SAMPLE_BANKS }
];

export const BUILTIN_BANK_VALUES = new Set(
  BUILTIN_BANK_OPTIONS.flatMap((group) => group.options).map((option) => option.value)
);

export const VCSL_OPTION_PREFIX = 'vcsl:';

export const parseBankSelectionValue = (rawValue) => {
  if (!rawValue || typeof rawValue !== 'string') {
    return { rawValue: '', bankValue: '', isVcslInstrument: false, vcslInstrument: '' };
  }
  if (rawValue.startsWith(VCSL_OPTION_PREFIX)) {
    const instrument = rawValue.slice(VCSL_OPTION_PREFIX.length);
    return {
      rawValue,
      bankValue: 'vcsl',
      isVcslInstrument: true,
      vcslInstrument: instrument
    };
  }
  return { rawValue, bankValue: rawValue, isVcslInstrument: false, vcslInstrument: '' };
};

export const formatBankLabel = (value) => {
  if (!value) return 'Default';
  if (DRUM_BANK_DISPLAY_NAMES[value]) {
    return DRUM_BANK_DISPLAY_NAMES[value];
  }
  const waveform = WAVEFORM_BANKS.find(bank => bank.value === value);
  if (waveform) {
    return waveform.label;
  }
  const sample = SAMPLE_BANKS.find(bank => bank.value === value);
  if (sample) {
    return sample.label;
  }
  if (SYNTH_BANK_ALIASES[value]) {
    return formatBankLabel(SYNTH_BANK_ALIASES[value]);
  }
  if (value.startsWith('github:')) {
    const [, repo] = value.split(':');
    return repo?.split('/').pop() || value;
  }
  if (value.startsWith(VCSL_OPTION_PREFIX)) {
    return `VCSL · ${value.slice(VCSL_OPTION_PREFIX.length)}`;
  }
  return value;
};

export const isBuiltinBankValue = (value) => BUILTIN_BANK_VALUES.has(value);


