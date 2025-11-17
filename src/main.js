/**
 * Main entry point - Wires together all components
 */

import { soundManager } from './soundManager.js';
import { uiController } from './ui.js';
import { soundConfig } from './config.js';
import { initStrudelReplEditors, getStrudelEditor, getStrudelEditorValue, setStrudelEditorValue, setStrudelEditorEditable, insertStrudelEditorSnippet, setStrudelEditorHighlights } from './strudelReplEditor.js';
import { getDrawContext } from '@strudel/draw';
import { transpiler as strudelTranspiler } from '@strudel/transpiler';
import { evaluate as strudelCoreEvaluate } from '@strudel/core';
import { Scale, Note } from '@tonaljs/tonal';

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

const DRUM_BANK_VALUES = new Set([
  'RolandTR808',
  'RolandTR909',
  'RolandTR707',
  'RhythmAce',
  'AkaiLinn',
  'ViscoSpaceDrum',
  'EmuSP1200',
  'CasioRZ1'
]);

const DRUM_BANK_DISPLAY_NAMES = {
  RolandTR808: 'Roland TR-808',
  RolandTR909: 'Roland TR-909',
  RolandTR707: 'Roland TR-707',
  RhythmAce: 'Rhythm Ace',
  AkaiLinn: 'Akai Linn',
  ViscoSpaceDrum: 'Visco Space Drum',
  EmuSP1200: 'Emu SP-1200',
  CasioRZ1: 'Casio RZ-1'
};

const NOTE_CALL_REGEX = /\b(note|n)\s*\(/i;
const NUMERIC_NOTE_REGEX = /\bn\(\s*["'][^"']*["']\s*\)/i;

const containsNoteCall = (value) => {
  if (!value || typeof value !== 'string') {
    return false;
  }
  NOTE_CALL_REGEX.lastIndex = 0;
  return NOTE_CALL_REGEX.test(value);
};

const containsNumericNotePattern = (value) => {
  if (!value || typeof value !== 'string') {
    return false;
  }
  NUMERIC_NOTE_REGEX.lastIndex = 0;
  return NUMERIC_NOTE_REGEX.test(value);
};

const getDrumBankDisplayName = (bank) => {
  if (!bank) return '';
  if (Object.prototype.hasOwnProperty.call(DRUM_BANK_DISPLAY_NAMES, bank)) {
    return DRUM_BANK_DISPLAY_NAMES[bank];
  }
  return bank
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d+)/g, '$1 $2')
    .trim();
};

// Define instruments available in each drum bank
const DRUM_BANK_INSTRUMENTS = {
  'RolandTR808': [
    { key: 'bd', label: 'BD', sample: 'bd' },
    { key: 'sd', label: 'SD', sample: 'sd' },
    { key: 'cp', label: 'CP', sample: 'cp' },
    { key: 'hh', label: 'HH', sample: 'hh' },
    { key: 'oh', label: 'OH', sample: 'oh' },
    { key: 'cr', label: 'CR', sample: 'cr' },
    { key: 'rd', label: 'RD', sample: 'rd' },
    { key: 'lt', label: 'LT', sample: 'lt' },
    { key: 'mt', label: 'MT', sample: 'mt' },
    { key: 'ht', label: 'HT', sample: 'ht' },
    { key: 'cb', label: 'CB', sample: 'cb' },
    { key: 'sh', label: 'SH', sample: 'sh' }
  ],
  'RolandTR909': [
    { key: 'bd', label: 'BD', sample: 'bd' },
    { key: 'sd', label: 'SD', sample: 'sd' },
    { key: 'cp', label: 'CP', sample: 'cp' },
    { key: 'hh', label: 'HH', sample: 'hh' },
    { key: 'oh', label: 'OH', sample: 'oh' },
    { key: 'cr', label: 'CR', sample: 'cr' },
    { key: 'rd', label: 'RD', sample: 'rd' },
    { key: 'lt', label: 'LT', sample: 'lt' },
    { key: 'mt', label: 'MT', sample: 'mt' },
    { key: 'ht', label: 'HT', sample: 'ht' }
  ],
  'RolandTR707': [
    { key: 'bd', label: 'BD', sample: 'bd' },
    { key: 'sd', label: 'SD', sample: 'sd' },
    { key: 'hh', label: 'HH', sample: 'hh' },
    { key: 'oh', label: 'OH', sample: 'oh' },
    { key: 'cr', label: 'CR', sample: 'cr' },
    { key: 'rd', label: 'RD', sample: 'rd' },
    { key: 'lt', label: 'LT', sample: 'lt' },
    { key: 'mt', label: 'MT', sample: 'mt' },
    { key: 'ht', label: 'HT', sample: 'ht' }
  ],
  'RhythmAce': [
    { key: 'bd', label: 'BD', sample: 'bd' },
    { key: 'sd', label: 'SD', sample: 'sd' },
    { key: 'hh', label: 'HH', sample: 'hh' },
    { key: 'oh', label: 'OH', sample: 'oh' },
    { key: 'cr', label: 'CR', sample: 'cr' },
    { key: 'rd', label: 'RD', sample: 'rd' },
    { key: 'lt', label: 'LT', sample: 'lt' },
    { key: 'mt', label: 'MT', sample: 'mt' },
    { key: 'ht', label: 'HT', sample: 'ht' }
  ],
  'AkaiLinn': [
    { key: 'bd', label: 'BD', sample: 'bd' },
    { key: 'sd', label: 'SD', sample: 'sd' },
    { key: 'hh', label: 'HH', sample: 'hh' },
    { key: 'oh', label: 'OH', sample: 'oh' },
    { key: 'cr', label: 'CR', sample: 'cr' },
    { key: 'rd', label: 'RD', sample: 'rd' },
    { key: 'lt', label: 'LT', sample: 'lt' },
    { key: 'mt', label: 'MT', sample: 'mt' },
    { key: 'ht', label: 'HT', sample: 'ht' }
  ],
  'ViscoSpaceDrum': [
    { key: 'bd', label: 'BD', sample: 'bd' },
    { key: 'sd', label: 'SD', sample: 'sd' },
    { key: 'hh', label: 'HH', sample: 'hh' },
    { key: 'oh', label: 'OH', sample: 'oh' },
    { key: 'cr', label: 'CR', sample: 'cr' },
    { key: 'rd', label: 'RD', sample: 'rd' },
    { key: 'lt', label: 'LT', sample: 'lt' },
    { key: 'mt', label: 'MT', sample: 'mt' },
    { key: 'ht', label: 'HT', sample: 'ht' }
  ],
  'EmuSP1200': [
    { key: 'bd', label: 'BD', sample: 'bd' },
    { key: 'sd', label: 'SD', sample: 'sd' },
    { key: 'hh', label: 'HH', sample: 'hh' },
    { key: 'oh', label: 'OH', sample: 'oh' },
    { key: 'cr', label: 'CR', sample: 'cr' },
    { key: 'rd', label: 'RD', sample: 'rd' },
    { key: 'lt', label: 'LT', sample: 'lt' },
    { key: 'mt', label: 'MT', sample: 'mt' },
    { key: 'ht', label: 'HT', sample: 'ht' }
  ],
  'CasioRZ1': [
    { key: 'bd', label: 'BD', sample: 'bd' },
    { key: 'sd', label: 'SD', sample: 'sd' },
    { key: 'hh', label: 'HH', sample: 'hh' },
    { key: 'oh', label: 'OH', sample: 'oh' },
    { key: 'cr', label: 'CR', sample: 'cr' },
    { key: 'rd', label: 'RD', sample: 'rd' },
    { key: 'lt', label: 'LT', sample: 'lt' },
    { key: 'mt', label: 'MT', sample: 'mt' },
    { key: 'ht', label: 'HT', sample: 'ht' }
  ]
};

// Default drum grid rows (fallback)
const DRUM_GRID_ROWS = [
  { key: 'bd', label: 'BD', sample: 'bd' },
  { key: 'sn', label: 'SN', sample: 'sd' },
  { key: 'hh', label: 'HH', sample: 'hh' }
];

const DRUM_SAMPLE_TO_ROW = new Map([
  ['bd', 'bd'],
  ['kick', 'bd'],
  ['sn', 'sn'],
  ['sd', 'sn'],
  ['snare', 'sn'],
  ['hh', 'hh'],
  ['ch', 'hh'],
  ['oh', 'oh'],
  ['hihat', 'hh'],
  ['cp', 'cp'],
  ['clap', 'cp'],
  ['cr', 'cr'],
  ['crash', 'cr'],
  ['rd', 'rd'],
  ['ride', 'rd'],
  ['lt', 'lt'],
  ['lowtom', 'lt'],
  ['mt', 'mt'],
  ['midtom', 'mt'],
  ['ht', 'ht'],
  ['hightom', 'ht'],
  ['cb', 'cb'],
  ['cowbell', 'cb'],
  ['sh', 'sh'],
  ['shaker', 'sh']
]);

const SYNTH_BANK_ALIASES = {
  superpiano: 'piano',
  wood: 'jazz'  // Wood is now called Jazz
};

const OSCILLATOR_SYNTHS = ['sine', 'square', 'triangle', 'sawtooth', 'supersaw', 'pulse'];
const SAMPLE_SYNTHS = ['piano', 'supersaw', 'gtr', 'casio', 'jazz', 'metal', 'folkharp']; // 'wood' aliased to 'jazz'
const LEGACY_SAMPLE_SYNTHS = Object.keys(SYNTH_BANK_ALIASES);
const SYNTH_NAME_MATCHERS = new Set([
  ...OSCILLATOR_SYNTHS,
  ...SAMPLE_SYNTHS,
  ...LEGACY_SAMPLE_SYNTHS
]);

const normalizeSnippetLabel = (tag) => (tag || '').replace(/^[^a-z0-9]+/i, '').toLowerCase();

const BASE_PATTERN_SNIPPETS = [
  'note()',
  'sound()',
  'bank()',
  'beat()',
  'vowel()',
  'chord()',
  'voicing()',
  'addVoicings()',
  'gain()',
  'adsr()',
  'scale()',
  'pan()',
  'speed()',
  'slow()',
  'fast()',
  'early()',
  'late()',
  'legato()',
  'euclid()',
  'euclidRot()',
  'euclidLegato()',
  'rev()',
  'palindrome()',
  'iter()',
  'iterBack()',
  'ply()',
  'range()',
  'rangex()',
  'range2()',
  'lpf()',
  'lpa()',
  'lpd()',
  'lps()',
  'lpq()',
  'lpattack()',
  'lpdecay()',
  'lpsustain()',
  'lprelease()',
  'orbit()',
  'postgain()',
  'irand()',
  'seg()',
  'hpf()',
  'hpq()',
  'bpf()',
  'bpg()',
  'bpq()',
  'fancor()',
  'lpenv()',
  'ftype()',
  'attack()',
  'decay()',
  'sustain()',
  'release()',
  'tremolo()',
  'resonance()',
  'cutoff()',
  'noise()',
  'tremolosync()',
  'tremoloskew()',
  'tremolodepth()',
  'tremolophase()',
  'tremoloshape()',
  'sometimes()',
  'stack()',
  'clip()',
  'sub()',
  'mul()',
  'div()',
  'floor()',
  'ceil()',
  'ratio()',
  'as()',
  'saw()',
  'sine()',
  'cosine()',
  'tri()',
  'square()',
  'rand()',
  'saw2()',
  'sine2()',
  'cosine2()',
  'tri2()',
  'square2()',
  'rand2()',
  'perlin()',
  'brand()',
  'brandBy()',
  'mouseX()',
  'mouseY()',
  'choose()',
  'wchoose()',
  'chooseCycles()',
  'wchooseCycles()',
  'degradeBy()',
  'degrade()',
  'undegradeBy()',
  'undegrade()',
  'sometimesBy()',
  'sometimes()',
  'someCyclesBy()',
  'someCycles()',
  'often()',
  'rarely()',
  'almostNever()',
  'almostAlways()',
  'never()',
  'always()',
  'lastOf()',
  'firstOf()',
  'when()',
  'chunk()',
  'chunkBack()',
  'fastChunk()',
  'arp()',
  'arpWith()',
  'struct()',
  'mask()',
  'reset()',
  'restart()',
  'hush()',
  'invert()',
  'pick()',
  'pickmod()',
  'pickF()',
  'pickmodF()',
  'pickRestart()',
  'pickmodRestart()',
  'pickReset()',
  'pickmodReset()',
  'inhabit()',
  'inhabitmod()',
  'squeeze()',
  'superimpose()',
  'layer()',
  'off()',
  'echo()',
  'echoWith()',
  'transpose()',
  'scaleTranspose()',
  'rootNotes()',
  'pace()',
  'stepcat()',
  'stepalt()',
  'expand()',
  'contract()',
  'extend()',
  'take()',
  'drop()',
  'polymeter()',
  'shrink()',
  'grow()',
  'tour()',
  'zip()',
  'vib()',
  'vibmod()',
  'add()',
  'anchor()',
  'dict()',
  'penv()',
  'segment()',
  'compress()',
  'zoom()',
  'linger()',
  'fastGap()',
  'inside()',
  'outside()',
  'cpm()',
  'ribbon()',
  'swingBy()',
  'swing()',
  'patt()',
  'dec()',
  'mode()',
  'set()',
  'struct()',
  'pick()',
  'pattack()',
  'pdecay()',
  'prelease()',
  'pcurve()',
  'panchor()',
  'velocity()',
  'fm()',
  'fmh()',
  'fmattack()',
  'fmdecay()',
  'fmsustain()',
  'fmenv()',
  'zrand()',
  'curve()',
  'slide()',
  'deltaSlide()',
  'zmod()',
  'zcrush()',
  'zdelay()',
  'pitchJump()',
  'pitchJumpTime()',
  'lfo()',
  'compressor()',
  'control()',
  'ccn()',
  'ccv()',
  'midimap()',
  'midimaps()',
  'defaultmidimap()',
  'midi()',
  'midiport()',
  'midicmd()',
  'midibend()',
  'miditouch()',
  'progNum()',
  'sysex()',
  'sysexid()',
  'sysexdata()',
  'osc()',
  'mqtt()',
  'xfade()',
  'jux()',
  'juxBy()',
  'coarse()',
  'crush()',
  'distort()',
  'delay()',
  'delaytime()',
  'delayfeedback()',
  'room()',
  'roomsize()',
  'roomfade()',
  'roomlp()',
  'roomdim()',
  'iresponse()',
  'phaser()',
  'phaserdepth()',
  'phasercenter()',
  'phasersweep()',
  'duckorbit()',
  'duckattack()',
  'duckdepth()'
];

const PINNED_PATTERN_SNIPPETS = ['stack()', 'vowel()', 'beat()', 'bank()', 'sound()', 'chord()', 'note()'];

const SYNTH_VARIANT_SNIPPETS = [
  'sound("sawtooth")',
  'sound("square")',
  'sound("triangle")',
  'sound("sine")',
  'sound("white")',
  'sound("pink")',
  'sound("brown")'
];

const CORE_STYLE_KEYWORDS = ['beat', 'chord', 'note', 'sound', 'stack'];
const SOUND_COLOR_CLASS_MAP = new Map([
  ['sound("brown")', 'pattern-snippet-tag-sound-brown'],
  ['sound("pink")', 'pattern-snippet-tag-sound-pink'],
  ['sound("white")', 'pattern-snippet-tag-sound-white']
]);

const DEFAULT_OPEN_SNIPPET_GROUP_IDS = new Set(['core']);
const FILTER_GROUP_IDS = new Set(['filters-lp', 'filters-hp', 'filters-bp']);
// Open filter groups by default when showing only filters
const DEFAULT_OPEN_FILTER_GROUP_IDS = new Set(['filters-lp', 'filters-hp', 'filters-bp']);
const snippetGroupOpenState = new Map();

// Mapping of tags with numeric parameters to their min/max/default values
const NUMERIC_TAG_PARAMS = {
  // Filters
  'lpf': { min: 20, max: 20000, step: 10, default: 20000, unit: 'Hz' },
  'hpf': { min: 20, max: 20000, step: 10, default: 20, unit: 'Hz' },
  'bpf': { min: 20, max: 20000, step: 10, default: 1000, unit: 'Hz' },
  'lpq': { min: 0, max: 20, step: 0.1, default: 0, unit: '' },
  'hpq': { min: 0, max: 20, step: 0.1, default: 0, unit: '' },
  'bpq': { min: 0, max: 20, step: 0.1, default: 0, unit: '' },
  'bpg': { min: -20, max: 20, step: 0.1, default: 0, unit: 'dB' },
  // Envelope
  'attack': { min: 0, max: 2, step: 0.01, default: 0.01, unit: 's' },
  'decay': { min: 0, max: 2, step: 0.01, default: 0.1, unit: 's' },
  'sustain': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  'release': { min: 0, max: 5, step: 0.01, default: 0.1, unit: 's' },
  'lpattack': { min: 0, max: 2, step: 0.01, default: 0.01, unit: 's' },
  'lpdecay': { min: 0, max: 2, step: 0.01, default: 0.1, unit: 's' },
  'lpsustain': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  'lprelease': { min: 0, max: 5, step: 0.01, default: 0.1, unit: 's' },
  'hpattack': { min: 0, max: 2, step: 0.01, default: 0.01, unit: 's' },
  'hpdecay': { min: 0, max: 2, step: 0.01, default: 0.1, unit: 's' },
  'hpsustain': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  'hprelease': { min: 0, max: 5, step: 0.01, default: 0.1, unit: 's' },
  'bpattack': { min: 0, max: 2, step: 0.01, default: 0.01, unit: 's' },
  'bpdecay': { min: 0, max: 2, step: 0.01, default: 0.1, unit: 's' },
  'bpsustain': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  'bprelease': { min: 0, max: 5, step: 0.01, default: 0.1, unit: 's' },
  'bpenv': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  'hpenv': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  'pattack': { min: 0, max: 2, step: 0.01, default: 0.01, unit: 's' },
  'pdecay': { min: 0, max: 2, step: 0.01, default: 0.1, unit: 's' },
  'prelease': { min: 0, max: 5, step: 0.01, default: 0.1, unit: 's' },
  // Dynamics
  'gain': { min: 0, max: 2, step: 0.01, default: 0.8, unit: '' },
  'postgain': { min: 0, max: 2, step: 0.01, default: 1, unit: '' },
  'velocity': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  // Panning
  'pan': { min: -1, max: 1, step: 0.01, default: 0, unit: '' },
  // Time
  'slow': { min: 0.1, max: 10, step: 0.1, default: 2, unit: 'x' },
  'fast': { min: 0.1, max: 10, step: 0.1, default: 2, unit: 'x' },
  'early': { min: 0, max: 1, step: 0.01, default: 0.25, unit: '' },
  'late': { min: 0, max: 1, step: 0.01, default: 0.25, unit: '' },
  // Effects
  'delay': { min: 0, max: 1, step: 0.01, default: 0, unit: '' },
  'delaytime': { min: 0, max: 1, step: 0.01, default: 0.25, unit: 's' },
  'delayfeedback': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  'room': { min: 0, max: 1, step: 0.01, default: 0, unit: '' },
  'roomsize': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  'roomfade': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  'roomlp': { min: 20, max: 20000, step: 10, default: 20000, unit: 'Hz' },
  'phaser': { min: 0, max: 1, step: 0.01, default: 0, unit: '' },
  'phaserdepth': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  'phasercenter': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  'phasersweep': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  'duckattack': { min: 0, max: 2, step: 0.01, default: 0.01, unit: 's' },
  'duckdepth': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  // Modulation
  'tremolo': { min: 0, max: 1, step: 0.01, default: 0, unit: '' },
  'tremolodepth': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  'tremoloskew': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  'tremolophase': { min: 0, max: 1, step: 0.01, default: 0, unit: '' },
  'resonance': { min: 0, max: 20, step: 0.1, default: 0, unit: '' },
  'cutoff': { min: 20, max: 20000, step: 10, default: 20000, unit: 'Hz' },
  // Other
  'speed': { min: 0.1, max: 10, step: 0.1, default: 1, unit: 'x' },
  'legato': { min: 0, max: 1, step: 0.01, default: 0, unit: '' },
  'cpm': { min: 60, max: 300, step: 1, default: 120, unit: 'BPM' }
};

const PATTERN_SNIPPET_GROUPS = [
  {
    id: 'core',
    order: 0,
    label: 'Core',
    heading: 'Core',
    matcher: (key) => ['stack', 'beat', 'bank', 'sound', 'chord', 'note'].includes(key),
    className: 'snippet-group-core'
  },
  {
    id: 'amplitude-modulation',
    order: 1,
    label: 'Amplitude Modulation',
    heading: 'Amplitude Modulation',
    matcher: (key) => ['tremolo', 'tremolosync', 'tremolodepth', 'tremoloskew', 'tremolophase', 'tremoloshape'].includes(key),
    className: 'snippet-group-amplitude-modulation'
  },
  {
    id: 'amplitude-envelope',
    order: 2,
    label: 'Amplitude Envelope',
    heading: 'Amplitude Envelope',
    matcher: (key) => ['attack', 'decay', 'sustain', 'release', 'adsr'].includes(key),
    className: 'snippet-group-amplitude-envelope'
  },
  {
    id: 'filter-envelope',
    order: 3,
    label: 'Filter Envelope',
    heading: 'Filter Envelope',
    matcher: (key) => ['lpattack', 'lpdecay', 'lpsustain', 'lprelease', 'lpenv'].includes(key),
    className: 'snippet-group-filter-envelope'
  },
  {
    id: 'pitch-envelope',
    order: 4,
    label: 'Pitch Envelope',
    heading: 'Pitch Envelope',
    matcher: (key) => ['pattack', 'pdecay', 'prelease', 'penv', 'pcurve', 'panchor'].includes(key),
    className: 'snippet-group-pitch-envelope'
  },
  {
    id: 'dynamics',
    order: 5,
    label: 'Dynamics',
    heading: 'Dynamics',
    matcher: (key) => ['gain', 'velocity', 'compressor', 'postgain', 'xfade'].includes(key),
    className: 'snippet-group-dynamics'
  },
  {
    id: 'panning',
    order: 6,
    label: 'Panning',
    heading: 'Panning',
    matcher: (key) => ['jux', 'juxby', 'pan'].includes(key),
    className: 'snippet-group-panning'
  },
  {
    id: 'waveshaping',
    order: 7,
    label: 'Waveshaping',
    heading: 'Waveshaping',
    matcher: (key) => ['coarse', 'crush', 'distort'].includes(key),
    className: 'snippet-group-waveshaping'
  },
  {
    id: 'global-effects',
    order: 8,
    label: 'Global Effects',
    heading: 'Global Effects',
    matcher: (key) => ['orbit'].includes(key),
    className: 'snippet-group-global-effects'
  },
  {
    id: 'delay',
    order: 9,
    label: 'Delay',
    heading: 'Delay',
    matcher: (key) => ['delay', 'delaytime', 'delayfeedback'].includes(key),
    className: 'snippet-group-delay'
  },
  {
    id: 'reverb',
    order: 10,
    label: 'Reverb',
    heading: 'Reverb',
    matcher: (key) => ['room', 'roomsize', 'roomfade', 'roomlp', 'roomdim', 'iresponse'].includes(key),
    className: 'snippet-group-reverb'
  },
  {
    id: 'phaser',
    order: 11,
    label: 'Phaser',
    heading: 'Phaser',
    matcher: (key) => ['phaser', 'phaserdepth', 'phasercenter', 'phasersweep'].includes(key),
    className: 'snippet-group-phaser'
  },
  {
    id: 'duck',
    order: 12,
    label: 'Duck',
    heading: 'Duck',
    matcher: (key) => ['duckorbit', 'duckattack', 'duckdepth'].includes(key),
    className: 'snippet-group-duck'
  },
  {
    id: 'filters-hp',
    order: 5,
    label: 'Filters · High-pass',
    heading: 'Filters · High-pass',
    matcher: (key) => key.startsWith('hp'),
    className: 'snippet-group-filters-hp'
  },
  {
    id: 'filters-bp',
    order: 6,
    label: 'Filters · Band-pass',
    heading: 'Filters · Band-pass',
    matcher: (key) => key.startsWith('bp'),
    className: 'snippet-group-filters-bp'
  },
  {
    id: 'filters-lp',
    order: 7,
    label: 'Filters · Low-pass',
    heading: 'Filters · Low-pass',
    matcher: (key) => key.startsWith('lp') || key === 'ftype' || key === 'vowel' || key === 'applygraduallowpass',
    className: 'snippet-group-filters-lp'
  },
  {
    id: 'time',
    order: 8,
    label: 'Time Modifiers',
    heading: 'Time Modifiers',
    matcher: (key) =>
      [
        'slow',
        'fast',
        'early',
        'late',
        'clip',
        'legato',
        'euclid',
        'euclidrot',
        'euclidlegato',
        'rev',
        'palindrome',
        'iter',
        'iterback',
        'ply',
        'segment',
        'compress',
        'zoom',
        'linger',
        'fastgap',
        'inside',
        'outside',
        'cpm',
        'ribbon',
        'swingby',
        'swing'
      ].includes(key),
    className: 'snippet-group-time'
  },
  {
    id: 'control-operators',
    order: 9,
    label: 'Control · Operators',
    heading: 'Control Parameters · Operators',
    matcher: (key) =>
      ['add', 'sub', 'mul', 'div', 'floor', 'ceil', 'range', 'rangex', 'range2', 'ratio', 'as'].includes(key),
    className: 'snippet-group-controls'
  },
  {
    id: 'signals',
    order: 10,
    label: 'Signals',
    heading: 'Signals',
    matcher: (key) =>
      [
        'saw',
        'sine',
        'cosine',
        'tri',
        'square',
        'rand',
        'saw2',
        'sine2',
        'cosine2',
        'tri2',
        'square2',
        'rand2',
        'perlin',
        'irand',
        'brand',
        'brandby',
        'mousex',
        'mousey'
      ].includes(key),
    className: 'snippet-group-signals'
  },
  {
    id: 'visual-feedback',
    order: 11,
    label: 'Visual Feedback',
    heading: 'Visual Feedback',
    matcher: (key, snippet) => {
      if (key === 'color' || key === 'markcss') {
        return true;
      }
      // Direct key matches for visual feedback tags
      if (['fscope', 'generategraph', 'pianoroll', 'pitchwheel', 'scope', 'spiral', 'wordfall'].includes(key)) {
        return true;
      }
      if (!snippet || typeof snippet !== 'string') {
        return false;
      }
      const normalized = snippet.toLowerCase();
      return normalized.includes('_punchcard') ||
        normalized.includes('_pianoroll') ||
        normalized.includes('_scope') ||
        normalized.includes('_spiral') ||
        normalized.includes('_pitchwheel') ||
        normalized.includes('_spectrum');
    },
    className: 'snippet-group-visual-feedback'
  },
  {
    id: 'synths',
    order: 12,
    label: 'Synths',
    heading: 'Synths',
    matcher: (key, snippet) => {
      if (key === 'sound') {
        return typeof snippet === 'string' && snippet.includes('sound("');
      }
      return [
        'decay',
        'sustain',
        'attack',
        'release',
        'cutoff',
        'noise',
        'vib',
        'vibmod',
        'fm',
        'fmh',
        'fmattack',
        'fmdecay',
        'fmsustain',
        'fmenv',
        'fmwave',
        'zrand',
        'curve',
        'slide',
        'deltaslide',
        'zmod',
        'zcrush',
        'zdelay',
        'pitchjump',
        'pitchjumptime',
        'lfo',
        'tremolo',
        'octave',
        'pw',
        'pwrate',
        'pwsweep',
        'spread',
        'unison',
        'isaw',
        'isaw2',
        'itri',
        'itri2'
      ].includes(key);
    },
    className: 'snippet-group-synths'
  },
  {
    id: 'tonal',
    order: 13,
    label: 'Tonal Functions',
    heading: 'Tonal Functions',
    matcher: (key) => ['voicing', 'voicings', 'addvoicings', 'scale', 'transpose', 'scaletranspose', 'rootnotes'].includes(key),
    className: 'snippet-group-tonal'
  },
  {
    id: 'stepwise',
    order: 14,
    label: 'Stepwise Patterning',
    heading: 'Stepwise Patterning',
    matcher: (key) =>
      [
        'pace',
        'stepcat',
        'stepalt',
        'expand',
        'contract',
        'extend',
        'take',
        'drop',
        'polymeter',
        'shrink',
        'grow',
        'tour',
        'zip'
      ].includes(key),
    className: 'snippet-group-stepwise'
  },
  {
    id: 'random',
    order: 15,
    label: 'Random Modifiers',
    heading: 'Random Modifiers',
    matcher: (key) =>
      [
        'choose',
        'wchoose',
        'choosecycles',
        'wchoosecycles',
        'degradeby',
        'degrade',
        'undegradeby',
        'undegrade',
        'sometimesby',
        'sometimes',
        'somecyclesby',
        'somecycles',
        'often',
        'rarely',
        'almostnever',
        'almostalways',
        'never',
        'always'
      ].includes(key),
    className: 'snippet-group-random'
  },
  {
    id: 'conditional',
    order: 16,
    label: 'Conditional Modifiers',
    heading: 'Conditional Modifiers',
    matcher: (key) =>
      [
        'lastof',
        'firstof',
        'when',
        'chunk',
        'chunkback',
        'fastchunk',
        'arp',
        'arpwith',
        'struct',
        'mask',
        'reset',
        'restart',
        'hush',
        'invert',
        'pick',
        'pickmod',
        'pickf',
        'pickmodf',
        'pickrestart',
        'pickmodrestart',
        'pickreset',
        'pickmodreset',
        'inhabit',
        'inhabitmod',
        'squeeze'
      ].includes(key),
    className: 'snippet-group-conditional'
  },
  {
    id: 'accumulation',
    order: 17,
    label: 'Accumulation Modifiers',
    heading: 'Accumulation Modifiers',
    matcher: (key) => ['superimpose', 'layer', 'off', 'echo', 'echowith'].includes(key),
    className: 'snippet-group-accumulation'
  },
  {
    id: 'midi',
    order: 18,
    label: 'MIDI',
    heading: 'MIDI',
    matcher: (key) =>
      key.includes('midi') ||
      key.startsWith('ccn') ||
      key.startsWith('ccv') ||
      key === 'prognum' ||
      key === 'sysex' ||
      key === 'sysexid' ||
      key === 'sysexdata' ||
      key === 'control',
    className: 'snippet-group-midi',
    exclude: ['pianoroll']
  },
  {
    id: 'device',
    order: 19,
    label: 'Device Motion',
    heading: 'Device Motion',
    matcher: (key) => ['orientation', 'acceleration', 'accelerate', 'accelerationx', 'accelerationy', 'accelerationz', 'rotationx', 'rotationy', 'rotationz', 'gravityx', 'gravityy', 'gravityz'].some((token) => key.includes(token)),
    className: 'snippet-group-device'
  },
  {
    id: 'other',
    order: Number.MAX_SAFE_INTEGER,
    label: 'Other',
    heading: 'Other',
    matcher: () => true,
    className: 'snippet-group-other'
  }
];

const SNIPPET_GROUP_LOOKUP = PATTERN_SNIPPET_GROUPS.reduce((acc, group) => {
  acc.set(group.id, group);
  return acc;
}, new Map());

function getSnippetKey(snippet) {
  if (!snippet || typeof snippet !== 'string') return '';
  const cleaned = snippet.replace(/^[.]+/, '');
  const match = cleaned.match(/^([a-zA-Z0-9_]+)/);
  return (match ? match[1] : cleaned).toLowerCase();
}

function shouldUseCoreStyle(snippet) {
  if (!snippet || typeof snippet !== 'string') {
    return false;
  }

  if (PINNED_PATTERN_SNIPPETS.includes(snippet)) {
    return true;
  }

  const normalized = snippet.toLowerCase();
  return CORE_STYLE_KEYWORDS.some((keyword) => {
    const dotPattern = `.${keyword}`;
    const fnPattern = `${keyword}(`;
    return normalized.includes(dotPattern) || normalized.includes(fnPattern);
  });
}

function getCustomSnippetClass(snippet) {
  if (!snippet || typeof snippet !== 'string') {
    return '';
  }
  const normalized = snippet.replace(/^[.]+/, '').toLowerCase();
  for (const [key, className] of SOUND_COLOR_CLASS_MAP.entries()) {
    const normalizedKey = key.toLowerCase();
    if (normalized === normalizedKey || normalized.includes(normalizedKey)) {
      return className;
    }
  }
  return '';
}

function htmlToPlainText(html) {
  const placeholder = document.createElement('div');
  placeholder.innerHTML = html || '';
  return (placeholder.textContent || placeholder.innerText || '').trim();
}

let strudelReferenceLoadPromise = null;
let strudelReferenceMapCache = null;

async function loadStrudelReferenceDocs() {
  if (strudelReferenceMapCache) {
    return strudelReferenceMapCache;
  }

  if (!strudelReferenceLoadPromise) {
    strudelReferenceLoadPromise = import('@strudel/reference')
      .then((mod) => {
        const docs = mod?.reference?.docs || {};
        const map = new Map();
        for (const value of Object.values(docs)) {
          if (!value || !value.name) continue;
          const key = value.name.trim().toLowerCase();
          if (!key || map.has(key)) continue;
          const params = Array.isArray(value.params)
            ? value.params.map(param => ({
                name: param?.name || '',
                types: Array.isArray(param?.type?.names) ? param.type.names.slice() : [],
                description: htmlToPlainText(param?.description || '')
              }))
            : [];
          map.set(key, {
            name: value.name.trim(),
            descriptionHtml: value.description || '',
            descriptionText: htmlToPlainText(value.description || ''),
            params
          });
        }
        return map;
      })
      .catch((error) => {
        console.warn('⚠️ Unable to load Strudel reference docs:', error);
        return new Map();
      });
  }

  strudelReferenceMapCache = await strudelReferenceLoadPromise;
  return strudelReferenceMapCache;
}

function getReferenceDescriptionText(entry) {
  if (!entry) return '';
  if (typeof entry.descriptionText === 'string') {
    return entry.descriptionText;
  }
  entry.descriptionText = htmlToPlainText(entry.descriptionHtml || '');
  return entry.descriptionText;
}

function extractRangeFromDescription(description) {
  if (!description) return null;
  const text = description.toLowerCase();
  const betweenMatch = text.match(/between\s+([-\d.]+)\s+and\s+([-\d.]+)/);
  if (betweenMatch) {
    return `${betweenMatch[1]}-${betweenMatch[2]}`;
  }
  const hyphenMatch = text.match(/([-\d.]+)\s*-\s*([-\d.]+)/);
  if (hyphenMatch) {
    return `${hyphenMatch[1]}-${hyphenMatch[2]}`;
  }
  return null;
}

function buildParamPlaceholder(param) {
  if (!param) return '';
  const name = param.name || 'value';
  const types = param.types || [];
  const description = param.description || '';
  const range = extractRangeFromDescription(description);

  if (types.includes('number')) {
    if (range) return `${name}:${range}`;
    return `${name}:number`;
  }

  if (types.includes('string')) {
    return `${name}`;
  }

  if (types.includes('Pattern')) {
    return `${name}:pattern`;
  }

  return name;
}

function buildParamDescription(param) {
  if (!param) return '';
  const name = param.name || 'value';
  const types = param.types || [];
  const description = param.description || '';
  const range = extractRangeFromDescription(description);

  if (types.includes('number')) {
    if (range) return `${name} (number ${range})`;
    return `${name} (number)`;
  }

  if (types.includes('string')) {
    return `${name} (string)`;
  }

  if (types.includes('Pattern')) {
    return `${name} (pattern)`;
  }

  return description ? `${name} (${description})` : name;
}

function buildSnippetInsertion(snippet, referenceEntry) {
  if (!snippet || typeof snippet !== 'string') return snippet;
  if (!snippet.endsWith('()')) return snippet;
  const params = referenceEntry?.params || [];
  if (!params.length) return snippet;
  const placeholders = params.map(buildParamPlaceholder).filter(Boolean);
  if (!placeholders.length) return snippet;
  const base = snippet.slice(0, -1);
  return `${base}${placeholders.join(', ')})`;
}

function buildSnippetDescription(referenceEntry) {
  if (!referenceEntry || !Array.isArray(referenceEntry.params)) return '';
  const descriptions = referenceEntry.params
    .map(buildParamDescription)
    .filter(Boolean);
  return descriptions.join(', ');
}

let snippetTooltipElement = null;
let snippetTooltipActiveButton = null;
let snippetTooltipListenersAttached = false;

function ensureSnippetTooltipElement() {
  if (snippetTooltipElement && document.body.contains(snippetTooltipElement)) {
    return snippetTooltipElement;
  }

  snippetTooltipElement = document.createElement('div');
  snippetTooltipElement.id = 'pattern-snippet-tooltip';
  snippetTooltipElement.className = 'pattern-snippet-tooltip';
  snippetTooltipElement.setAttribute('role', 'tooltip');
  snippetTooltipElement.setAttribute('aria-hidden', 'true');
  document.body.appendChild(snippetTooltipElement);

  if (!snippetTooltipListenersAttached) {
    snippetTooltipListenersAttached = true;
    const handleGlobalHide = () => hideSnippetTooltip();
    window.addEventListener('scroll', handleGlobalHide, true);
    window.addEventListener('resize', handleGlobalHide, { passive: true });
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') {
          hideSnippetTooltip();
        }
      },
      true
    );
  }

  return snippetTooltipElement;
}

function hideSnippetTooltip(button = snippetTooltipActiveButton) {
  if (!snippetTooltipElement) {
    return;
  }

  snippetTooltipElement.classList.remove('visible');
  snippetTooltipElement.style.display = 'none';
  snippetTooltipElement.style.visibility = 'hidden';
  snippetTooltipElement.innerHTML = '';
  snippetTooltipElement.setAttribute('aria-hidden', 'true');

  if (button && button instanceof HTMLElement) {
    button.removeAttribute('aria-describedby');
  }

  if (snippetTooltipActiveButton && snippetTooltipActiveButton !== button) {
    snippetTooltipActiveButton.removeAttribute('aria-describedby');
  }

  snippetTooltipActiveButton = null;
}

function showSnippetTooltip(button) {
  if (!button || !(button instanceof HTMLElement) || !document.body.contains(button)) {
    return;
  }

  const tooltipEl = ensureSnippetTooltipElement();

  if (snippetTooltipActiveButton && snippetTooltipActiveButton !== button) {
    hideSnippetTooltip(snippetTooltipActiveButton);
  }

  const title = button.dataset.tooltipTitle || button.textContent || '';
  const description = button.dataset.tooltipDescription || '';
  const params = button.dataset.tooltipParams || '';

  tooltipEl.innerHTML = '';

  if (title) {
    const titleEl = document.createElement('div');
    titleEl.className = 'pattern-snippet-tooltip-title';
    titleEl.textContent = title;
    tooltipEl.appendChild(titleEl);
  }

  if (description) {
    const descEl = document.createElement('div');
    descEl.className = 'pattern-snippet-tooltip-body';
    description.split('\n').forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      if (index > 0) {
        descEl.appendChild(document.createElement('br'));
      }
      descEl.appendChild(document.createTextNode(trimmed));
    });
    if (descEl.childNodes.length > 0) {
      tooltipEl.appendChild(descEl);
    }
  }

  if (params) {
    const paramsWrapper = document.createElement('div');
    paramsWrapper.className = 'pattern-snippet-tooltip-params';
    params.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      const paramLine = document.createElement('div');
      paramLine.textContent = trimmed;
      paramsWrapper.appendChild(paramLine);
    });
    if (paramsWrapper.childElementCount > 0) {
      tooltipEl.appendChild(paramsWrapper);
    }
  }

  tooltipEl.style.display = 'block';
  tooltipEl.style.visibility = 'hidden';
  tooltipEl.classList.remove('visible');

  const buttonRect = button.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

  const tooltipRect = tooltipEl.getBoundingClientRect();
  const margin = 8;

  let top = buttonRect.bottom + margin;
  if (top + tooltipRect.height > viewportHeight - 12) {
    const aboveTop = buttonRect.top - tooltipRect.height - margin;
    if (aboveTop >= 12) {
      top = aboveTop;
    } else {
      top = Math.max(12, viewportHeight - tooltipRect.height - 12);
    }
  }

  let left = buttonRect.left + buttonRect.width / 2 - tooltipRect.width / 2;
  const maxLeft = viewportWidth - tooltipRect.width - 12;
  if (left > maxLeft) {
    left = maxLeft;
  }
  if (left < 12) {
    left = 12;
  }

  tooltipEl.style.left = `${Math.round(left)}px`;
  tooltipEl.style.top = `${Math.round(top)}px`;
  tooltipEl.style.visibility = 'visible';
  tooltipEl.classList.add('visible');
  tooltipEl.setAttribute('aria-hidden', 'false');

  if (!tooltipEl.id) {
    tooltipEl.id = 'pattern-snippet-tooltip';
  }
  button.setAttribute('aria-describedby', tooltipEl.id);

  snippetTooltipActiveButton = button;
}

let patternSnippetLoadPromise = null;
let patternSnippetCache = null;

let lastPatternSnippetBase = '';
let lastPatternSnippetResult = null;

function normalizePatternForSnippetFilter(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    return '';
  }
  const strippedComments = pattern
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  return strippedComments.replace(/\s+/g, ' ').trim();
}

function filterSnippetsForPattern(snippets, pattern) {
  if (!pattern) {
    return snippets;
  }

  const normalized = normalizePatternForSnippetFilter(pattern);
  const existingMethods = new Set(
    (normalized.match(/\.[a-zA-Z_][a-zA-Z0-9_]*/g) || []).map((match) => getSnippetKey(match))
  );

  return snippets.filter((snippet) => {
    const key = getSnippetKey(snippet);
    // Keep numeric tags visible even if they're already in the pattern (so sliders remain available)
    if (NUMERIC_TAG_PARAMS[key]) {
      return true; // Always show numeric tags
    }
    return !existingMethods.has(key);
  });
}

async function getPatternSnippets(patternForFilter = '') {
  const normalizedPattern = normalizePatternForSnippetFilter(patternForFilter);

  if (normalizedPattern === lastPatternSnippetBase && lastPatternSnippetResult) {
    return lastPatternSnippetResult;
  }

  if (!patternSnippetCache) {
    if (!patternSnippetLoadPromise) {
      patternSnippetLoadPromise = (async () => {
        const snippetMap = new Map();
        BASE_PATTERN_SNIPPETS.forEach((snippet) => {
          const key = getSnippetKey(snippet);
          if (!snippetMap.has(key) && snippet) {
            snippetMap.set(key, snippet);
          }
        });

        const referenceMap = await loadStrudelReferenceDocs();
        referenceMap.forEach((entry, key) => {
          if (snippetMap.has(key)) return;
          if (!/^[a-z][\w]*$/i.test(entry.name)) return;
          snippetMap.set(key, `${entry.name}()`);
        });

        const referenceEntries = PATTERN_SNIPPET_GROUPS.reduce((acc, group) => {
          acc.set(group.id, { snippets: [] });
          return acc;
        }, new Map());

        const pinnedKeys = new Set(PINNED_PATTERN_SNIPPETS.map((snippet) => getSnippetKey(snippet)));
        const pinnedMap = new Map();

        Array.from(snippetMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .forEach(([key, snippet]) => {
            const referenceEntry = referenceMap.get(key);
            const matchedGroup =
              PATTERN_SNIPPET_GROUPS.find((group) => {
                if (group.exclude && group.exclude.includes(key)) {
                  return false;
                }
                return group.matcher(key, snippet, referenceEntry);
              }) || SNIPPET_GROUP_LOOKUP.get('other');

            const groupData = referenceEntries.get(matchedGroup.id);
            if (groupData) {
              groupData.snippets.push({ snippet, groupId: matchedGroup.id, className: matchedGroup.className, heading: matchedGroup.heading });
            }

            if (pinnedKeys.has(key)) {
              pinnedMap.set(key, { snippet, groupId: matchedGroup.id, className: matchedGroup.className, heading: matchedGroup.heading });
            }
          });

        const orderedPinned = PINNED_PATTERN_SNIPPETS.map((snippet) => {
          const key = getSnippetKey(snippet);
          return pinnedMap.get(key) || { snippet, groupId: 'core', className: SNIPPET_GROUP_LOOKUP.get('core').className, heading: SNIPPET_GROUP_LOOKUP.get('core').heading };
        })
          .filter(Boolean)
          .sort((a, b) => a.snippet.localeCompare(b.snippet));

        const combined = [];
        const seenGroups = new Set();

        orderedPinned.forEach((entry) => {
          const { snippet, groupId, className, heading } = entry;
          combined.push({ snippet, groupId, className, heading });
        });

        const orderedGroups = [...PATTERN_SNIPPET_GROUPS].sort((a, b) => a.heading.localeCompare(b.heading));
        orderedGroups.forEach((group) => {
          const groupData = referenceEntries.get(group.id);
          if (!groupData || !groupData.snippets.length) {
            return;
          }
          if (!seenGroups.has(group.id)) {
            seenGroups.add(group.id);
          }
          groupData.snippets
            .slice()
            .sort((a, b) => a.snippet.localeCompare(b.snippet))
            .forEach(({ snippet, className, heading: groupHeading }) => {
            const isPinned = PINNED_PATTERN_SNIPPETS.includes(snippet);
            if (isPinned) {
              return;
            }
            combined.push({ snippet, groupId: group.id, className, heading: groupHeading });
          });
        });

        const synthGroup = SNIPPET_GROUP_LOOKUP.get('synths');
        if (synthGroup) {
          SYNTH_VARIANT_SNIPPETS.forEach((snippet) => {
            if (combined.some((entry) => entry.snippet === snippet)) {
              return;
            }
            combined.push({
              snippet,
              groupId: synthGroup.id,
              className: synthGroup.className,
              heading: synthGroup.heading
            });
          });
        }

        patternSnippetCache = combined;
        return combined;
      })();
    }
    await patternSnippetLoadPromise;
  }

  const baseSnippets = patternSnippetCache || [];
  const filtered = filterSnippetsForPattern(
    baseSnippets.map((entry) => entry.snippet),
    normalizedPattern
  );

  const filteredEntries = baseSnippets.filter((entry) => filtered.includes(entry.snippet));

  lastPatternSnippetBase = normalizedPattern;
  lastPatternSnippetResult = filteredEntries;
  return filteredEntries;
}

function normalizeSynthBankName(bankName) {
  if (!bankName || typeof bankName !== 'string') {
    return bankName;
  }
  const trimmed = bankName.trim();
  const normalized = SYNTH_BANK_ALIASES[trimmed.toLowerCase()];
  return normalized || trimmed;
}

function replaceSynthAliases(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    return pattern;
  }

  let result = pattern;
  for (const [legacyName, canonicalName] of Object.entries(SYNTH_BANK_ALIASES)) {
    const escapedLegacy = legacyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const aliasRegex = new RegExp(`(\\.s\\(["'])${escapedLegacy}(["']\\))`, 'gi');
    result = result.replace(aliasRegex, (_, prefix, suffix) => `${prefix}${canonicalName}${suffix}`);

    const soundRegex = new RegExp(`(sound\\(["'])${escapedLegacy}(["']\\))`, 'gi');
    result = result.replace(soundRegex, (_, prefix, suffix) => `${prefix}${canonicalName}${suffix}`);
  }
  return result;
}

function patternContainsKnownSynth(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    return false;
  }

  for (const synthName of SYNTH_NAME_MATCHERS) {
    const escaped = synthName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\.s\\(["']${escaped}["']\\)`, 'i');
    if (regex.test(pattern)) {
      return true;
    }
  }

  return /\b(note|n)\s*\(/.test(pattern);
}

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
  if (trimmed.includes('sound(') || trimmed.includes('s(') || containsNoteCall(trimmed)) {
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

/**
 * Normalize and parse a time signature string into useful metrics.
 * @param {string} signature - e.g., "4/4" or "3/4"
 * @returns {{signature: string, numerator: number, denominator: number, stepsPerBeat: number, totalSteps: number}}
 */
function getTimeSignatureMetrics(signature) {
  let numerator = 4;
  let denominator = 4;
  
  if (typeof signature === 'string' && signature.includes('/')) {
    const [numPart, denPart] = signature.split('/');
    const parsedNumerator = parseInt(numPart, 10);
    const parsedDenominator = parseInt(denPart, 10);
    if (Number.isFinite(parsedNumerator) && parsedNumerator > 0) {
      numerator = parsedNumerator;
    }
    if (Number.isFinite(parsedDenominator) && parsedDenominator > 0) {
      denominator = parsedDenominator;
    }
  }
  
  const stepsPerBeatRaw = 16 / denominator;
  const stepsPerBeat = Math.max(1, Math.round(stepsPerBeatRaw));
    const totalSteps = Math.max(numerator, 1) * stepsPerBeat;
  
  return {
    signature: `${numerator}/${denominator}`,
    numerator,
    denominator,
    stepsPerBeat,
    totalSteps
  };
}

const fromPolar = (angle, radius, cx, cy) => {
  const radians = ((angle - 90) * Math.PI) / 180;
  return [cx + Math.cos(radians) * radius, cy + Math.sin(radians) * radius];
};

const xyOnSpiral = (angle, margin, cx, cy, rotate = 0) => {
  const adjustedAngle = (angle + rotate) * 360;
  return fromPolar(adjustedAngle, margin * angle, cx, cy);
};

function drawSpiralSegment(ctx, options) {
  let {
    from = 0,
    to = 3,
    margin = 40,
    cx = 100,
    cy = 100,
    rotate = 0,
    thickness = margin / 2,
    color = '#4c51bf',
    cap = 'round',
    stretch = 1,
    fromOpacity = 1,
    toOpacity = 1
  } = options;
  from *= stretch;
  to *= stretch;
  rotate *= stretch;
  ctx.lineWidth = thickness;
  ctx.lineCap = cap;
  ctx.strokeStyle = color;
  ctx.globalAlpha = fromOpacity;

  ctx.beginPath();
  let [sx, sy] = xyOnSpiral(from, margin, cx, cy, rotate);
  ctx.moveTo(sx, sy);

  const increment = 1 / 60;
  let angle = from;
  while (angle <= to) {
    const [x, y] = xyOnSpiral(angle, margin, cx, cy, rotate);
    ctx.globalAlpha = ((angle - from) / (to - from)) * toOpacity;
    ctx.lineTo(x, y);
    angle += increment;
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
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
    this._applyingVisualizer = false; // Flag to prevent infinite loops when re-applying visualizers
    
    // Effects, Filters, and Synthesis storage
    this.elementEffects = {}; // Store effects for each element
    this.elementFilters = {}; // Store filters for each element
    this.elementSynthesis = {}; // Store synthesis (ADSR) for each element
    this.currentTimeSignature = '4/4';
    this.currentTimeSignatureMetrics = getTimeSignatureMetrics(this.currentTimeSignature);
    
    // Master punchcard visualization state
    this.masterPunchcardContainer = null;
    this.masterPunchcardHeaderNote = null;
    this.masterPunchcardCanvas = null;
    this.masterPunchcardCtx = null;
    this.masterPunchcardPlaceholder = null;
    this.masterPunchcardIsRendering = false;
    this.masterPunchcardPendingRefresh = false;
    this.masterPunchcardResizeTimer = null;
    this.externalVisualizerCanvas = null;
    this.externalVisualizerObserver = null;
    this.externalVisualizerType = null;
    this.scopeAnimationFrame = null;
    this.spectrumAnimationFrame = null;
    this.scopeDataArray = null;
    this.spectrumDataArray = null;
    this.activeVisualizerLoop = null;

    // Master editor highlighting
    this.masterHighlightData = null;
    this.masterHighlightRaf = null;
    this.currentMasterHighlightKey = null;
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

    uiController.onUpdate('scale', (scale) => {
      soundManager.setScale(scale);
      console.log(`🎼 Scale changed to: ${scale || '(none)'}`);
    });

    uiController.onUpdate('timeSignature', (timeSignature) => {
      this.currentTimeSignature = timeSignature || '4/4';
      this.currentTimeSignatureMetrics = getTimeSignatureMetrics(this.currentTimeSignature);
      soundManager.setTimeSignature(timeSignature);
      console.log(`🎵 Time signature changed to: ${timeSignature}`);
      if (typeof this.applyTimeSignatureToDrumGrid === 'function') {
        try {
          this.applyTimeSignatureToDrumGrid(this.currentTimeSignature);
        } catch (error) {
          console.warn('⚠️ Could not update drum grid for new time signature:', error);
        }
      }
      this.refreshMasterPunchcard('time-signature-change').catch(err => {
        console.warn('⚠️ Could not refresh punchcard after time signature change:', err);
      });
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
    soundManager.onMasterPatternUpdate(async () => {
      console.log('🔄 Master pattern updated - refreshing display');
      this.updateMasterPatternDisplay();
      
      // Update pattern slots display when master pattern changes
      this.updateActiveElementsDisplay();
      
      this.updateMasterPatternHighlights().catch(error => {
        console.warn('⚠️ Could not update master highlight data:', error);
      });

      // Don't re-apply visualizer when master pattern is updated from save
      // Visualizer will be applied when user presses play button
      // Only re-apply if master is actively playing (not when updating from save)
      // But since updateMasterPattern stops playback, we should not re-apply here
      // Visualizer will be applied when play button is pressed
      
      this.refreshMasterPunchcard('master-update').catch(err => {
        console.warn('⚠️ Could not refresh punchcard after master update:', err);
      });
    });

    // Set up callback for when master state changes (playing/stopped)
    soundManager.onMasterStateChange((isPlaying, elementIds) => {
      console.log(`🎚️ Master state changed: ${isPlaying ? 'playing' : 'stopped'}, elements: ${elementIds.join(', ')}`);
      
      // Sync UI button state with soundManager state
      this.masterActive = isPlaying;
      const playMasterBtn = document.getElementById('play-master-btn');
      const masterActiveDot = document.querySelector('.master-active-dot');
      
      if (playMasterBtn) {
        if (isPlaying) {
          playMasterBtn.textContent = '⏸';
          playMasterBtn.title = 'Pause Master';
          playMasterBtn.classList.add('active');
        } else {
          playMasterBtn.textContent = '▶';
          playMasterBtn.title = 'Play Master';
          playMasterBtn.classList.remove('active');
        }
      }
      
      if (masterActiveDot) {
        if (isPlaying) {
          masterActiveDot.classList.add('active');
        } else {
          masterActiveDot.classList.remove('active');
        }
      }
      
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

      if (isPlaying) {
        this.hideMasterPunchcardPlaceholder();
        this.updateMasterPatternHighlights()
          .catch(error => {
            console.warn('⚠️ Could not refresh master highlight data on play start:', error);
          })
          .finally(() => {
            this.startMasterHighlightLoop();
          });
      } else {
        this.stopMasterHighlightLoop();
        this.showMasterPunchcardPlaceholder();
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
      soundManager.masterVolume = initialVolume / 100;
      if (masterVolumeValue) {
        masterVolumeValue.textContent = Math.round(initialVolume);
      }
      console.log(`🎚️ Master volume slider initialized: ${initialVolume}% (${soundManager.masterVolume})`);

      masterVolumeSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        console.log(`🎚️ Master volume slider changed: ${value}%`);
        soundManager.setMasterVolume(value / 100);
        if (masterVolumeValue) {
          masterVolumeValue.textContent = Math.round(value);
        }
        soundManager.updateMasterPattern(this.soloedElements, this.mutedElements);
      });
      
      if (soundManager.isAudioReady() && soundManager.masterGainNode) {
        console.log(`🎚️ Audio already ready, setting master volume to ${initialVolume}%`);
        soundManager.setMasterVolume(initialVolume / 100);
      } else {
        console.log(`🎚️ Audio not ready yet, master volume will be set on initialization`);
      }
    } else {
      console.warn('⚠️ Master volume slider not found in DOM');
    }

    if (masterPanSlider) {
      const initialPan = parseFloat(masterPanSlider.value);
      soundManager.masterPan = initialPan;
      if (masterPanValue) {
        masterPanValue.textContent = initialPan.toFixed(2);
      }
      console.log(`🎚️ Master pan slider initialized: ${initialPan}`);

      masterPanSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        console.log(`🎚️ Master pan slider changed: ${value}`);
        soundManager.setMasterPan(value);
        if (masterPanValue) {
          masterPanValue.textContent = value.toFixed(2);
        }
        soundManager.updateMasterPattern(this.soloedElements, this.mutedElements);
      });
      
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
    }
    
    // Setup master pattern controls
    this.setupMasterPatternControls();
    this.setupMasterPunchcard();
    
    console.log('✅ Master channel controls setup complete');
  }

  /**
   * Setup master pattern controls
   */
  setupMasterPatternControls() {
    this.masterPatternField = document.getElementById('master-pattern');
    const playMasterBtn = document.getElementById('play-master-btn');
    const updateMasterBtn = document.getElementById('update-master-btn');
    const masterActiveDot = document.querySelector('.master-active-dot');

    if (!this.masterPatternField) {
      console.warn('⚠️ Master pattern field not found in DOM');
      return;
    }

    // Play/Pause Master button (toggles between play and pause)
    if (playMasterBtn) {
      playMasterBtn.addEventListener('click', async () => {
        if (this.masterActive) {
          // Currently playing - pause/stop
          console.log('⏸️ Pause Master button clicked');
          
          const result = await soundManager.stopMasterPattern();
          
          if (result.success) {
            this.masterActive = false;
            // Ensure soundManager.masterActive is also false
            soundManager.masterActive = false;
            playMasterBtn.textContent = '▶';
            playMasterBtn.title = 'Play Master';
            playMasterBtn.classList.remove('active');
            if (masterActiveDot) masterActiveDot.classList.remove('active');
            console.log('✅ Master playback paused');
          }
        } else {
          // Currently stopped - play
          console.log('▶️ Play Master button clicked');
          
          // Ensure modal preview isn't still playing to avoid double audio
          const previewElementId = 'modal-preview';
          if (soundManager.isPlaying(previewElementId)) {
            console.log('⏹️ Stopping modal preview before playing master');
            soundManager.stopSound(previewElementId);
            const previewBtn = document.getElementById('modal-preview-btn');
            if (previewBtn) {
              previewBtn.textContent = '▶ Preview Pattern';
              previewBtn.classList.remove('active');
            }
          }
          
          // Update master pattern before playing (in case it was manually edited)
          // Use CodeMirror editor value if available, otherwise fall back to textarea
          const currentCode = getStrudelEditorValue('master-pattern').trim();
          if (currentCode && currentCode !== soundManager.getMasterPatternCode()) {
            // Update the pattern code directly without calling setMasterPatternCode
            // to avoid it stopping playback (we're about to start playback anyway)
            soundManager.masterPattern = soundManager.formatMasterPatternWithTempoComment(currentCode);
            if (typeof this.syncElementsFromMasterPattern === 'function') {
              try {
                this.syncElementsFromMasterPattern(soundManager.masterPattern);
              } catch (syncError) {
                console.warn('⚠️ Could not sync elements from master code before play:', syncError);
              }
            }
            console.log(`📝 Updated master pattern code directly before playing`);
          }
          
          if (this.selectedVisualizer && this.selectedVisualizer !== 'punchcard') {
            console.log(`🎨 Preparing canvas for visualizer "${this.selectedVisualizer}"`);
            this.prepareCanvasForExternalVisualizer();
          } else {
            this.showMasterPunchcardPlaceholder();
          }

          console.log(`🎨 Applying visualizer "${this.selectedVisualizer || 'punchcard'}" before playing`);
          try {
            await this.applyVisualizerToMaster();
          } catch (visualizerError) {
            console.warn(`⚠️ Error applying visualizer, continuing with playback:`, visualizerError);
          }
          
          const result = await soundManager.playMasterPattern();
          
          if (result.success) {
            this.masterActive = true;
            playMasterBtn.textContent = '⏸';
            playMasterBtn.title = 'Pause Master';
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
          const headerComment = '// Created with Strudesk 4000 by eKommissar';
          const copyText = code.startsWith(headerComment) ? code : `${headerComment}\n\n${code}`;
          
          await navigator.clipboard.writeText(copyText);
          // Temporarily change button text to show success
          const originalText = copyCodeBtn.textContent;
          copyCodeBtn.textContent = '✓ Copied!';
          copyCodeBtn.title = 'Copied!';
          setTimeout(() => {
            copyCodeBtn.textContent = originalText;
            copyCodeBtn.title = 'Copy Code';
          }, 2000);
          console.log('✅ Master pattern code copied to clipboard');
        } catch (err) {
          console.error('❌ Failed to copy code:', err);
          alert('Failed to copy code to clipboard');
        }
      });
    }


    // Clear All button (trash can)
    const clearAllBtn = document.getElementById('clear-all-btn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all? This will clear the master pattern and all element configurations.')) {
          console.log('🗑️ Clear All button clicked');
          this.resetAll();
        }
      });
    }

    console.log('✅ Master pattern controls setup complete');
  }

  /**
   * Initialize master punchcard visualizer
   */
  setupMasterPunchcard() {
    this.masterPunchcardContainer = document.getElementById('master-punchcard');
    this.masterPunchcardCanvas = document.getElementById('master-punchcard-canvas');
    this.masterPunchcardPlaceholder = this.masterPunchcardContainer
      ? this.masterPunchcardContainer.querySelector('.punchcard-placeholder')
      : null;
    
    if (!this.masterPunchcardContainer || !this.masterPunchcardCanvas) {
      console.warn('⚠️ Master punchcard elements not found in DOM');
      return;
    }
    
    const initialCtx = this.getMasterPunchcardContext();
    if (initialCtx) {
      window.__strudelVisualizerCtx = initialCtx;
    }
    
    // Setup visualizer dropdown
    this.selectedVisualizer = 'scope'; // default
    const visualizerSelect = document.getElementById('visualizer-select');
    if (visualizerSelect) {
      visualizerSelect.value = this.selectedVisualizer;
      visualizerSelect.addEventListener('change', async (e) => {
        this.selectedVisualizer = e.target.value;
        console.log(`🎨 Visualizer changed to: ${this.selectedVisualizer}`);
        
        if (this.selectedVisualizer !== 'punchcard') {
          this.prepareCanvasForExternalVisualizer();
        } else {
          this.showMasterPunchcardPlaceholder();
        }

        await this.applyVisualizerToMaster();

        this.refreshMasterPunchcard('visualizer-change').catch(err => {
          console.warn('⚠️ Unable to refresh punchcard after visualizer change:', err);
        });
      });
    }
    
    // Ensure initial placeholder text reflects current steps
    this.showMasterPunchcardPlaceholder();
    
    window.addEventListener('resize', () => {
      if (this.masterPunchcardResizeTimer) {
        clearTimeout(this.masterPunchcardResizeTimer);
      }
      this.masterPunchcardResizeTimer = setTimeout(() => {
        this.refreshMasterPunchcard('resize').catch(err => {
          console.warn('⚠️ Unable to refresh punchcard after resize:', err);
        });
      }, 150);
    });
    
    this.refreshMasterPunchcard('initial').catch(err => {
      console.warn('⚠️ Unable to render initial punchcard:', err);
    });
  }

  /**
   * Apply the selected visualizer to the master pattern and restart playback
   */
  async applyVisualizerToMaster() {
    console.log(`🎨 Applying visualizer "${this.selectedVisualizer}" to master pattern`);
    
    // Clean up any existing visualizer observers and intervals
    this.scopeSpectrumObserver = null;
    this.scopeSpectrumCopyLoop = null;
    this.teardownExternalVisualizerCanvas();
    this.stopVisualizerAnimation();
    this.externalVisualizerType = null;
    
    // Clean up any existing pianoroll canvases from previous sessions
    if (this.selectedVisualizer !== 'pianoroll') {
      const existingPianorollCanvases = document.querySelectorAll('canvas[data-processed="true"]');
      existingPianorollCanvases.forEach(canvas => {
        if (canvas.id !== 'master-punchcard-canvas') {
          canvas.remove();
        }
      });
    }
    
    // Prepare canvas for visualizers (ensure context is ready)
    this.prepareCanvasForExternalVisualizer();
    
    // Get the current master pattern without any visualizers
    let basePattern = soundManager.getMasterPatternCode();
    
    // If master pattern is empty, check if there are tracked patterns
    // If so, rebuild the master pattern from tracked patterns first
    if (!basePattern || basePattern.trim() === '') {
      if (soundManager.trackedPatterns && soundManager.trackedPatterns.size > 0) {
        console.log(`🔄 Master pattern is empty but ${soundManager.trackedPatterns.size} tracked pattern(s) found - rebuilding master pattern`);
        soundManager.updateMasterPattern(new Set(), new Set());
        basePattern = soundManager.getMasterPatternCode();
      }
      
      // If still empty, try reading from editor
      if (!basePattern || basePattern.trim() === '') {
        const editorPattern = getStrudelEditorValue('master-pattern').trim();
        if (editorPattern && editorPattern !== '') {
          console.log(`📝 Reading master pattern from editor`);
          basePattern = editorPattern;
        }
      }
      
      // Only use silence as last resort
      if (!basePattern || basePattern.trim() === '') {
        console.warn('⚠️ No master pattern to apply visualizer to, using silence');
        basePattern = 'silence';
      }
    }
    
    // Strip JavaScript comments (// and /* */) but keep channel markers
    basePattern = basePattern.replace(/\/\/.*$/gm, '');
    basePattern = basePattern.replace(/\/\*[\s\S]*?\*\//g, (comment) => {
      return /\/\*\s*Channel\s+\d+\s*\*\//i.test(comment) ? comment : '';
    });
    basePattern = basePattern.replace(/\n\s*\n/g, '\n').trim();
    
    // Strip any existing visualizer methods using the same robust logic as computeMasterPunchcardData
    const findMatchingParen = (str, startIndex) => {
      let depth = 1;
      for (let i = startIndex + 1; i < str.length; i++) {
        if (str[i] === '(') depth++;
        else if (str[i] === ')') {
          depth--;
          if (depth === 0) return i;
        }
      }
      return -1;
    };
    
    const visualizerMethods = ['scope', 'tscope', 'fscope', 'spectrum', 'visual', 'pianoroll', 'barchart'];
    visualizerMethods.forEach(method => {
      const searchPattern = new RegExp(`\\.\\s*_?${method}\\s*\\(`, 'gi');
      let match;
      
      while ((match = searchPattern.exec(basePattern)) !== null) {
        const startPos = match.index;
        const openParenPos = match.index + match[0].length - 1;
        const closeParenPos = findMatchingParen(basePattern, openParenPos);
        
        if (closeParenPos !== -1) {
          basePattern = basePattern.substring(0, startPos) + basePattern.substring(closeParenPos + 1);
          searchPattern.lastIndex = 0;
        } else {
          break;
        }
      }
    });
    basePattern = basePattern.trim().replace(/\.\s*$/, '').replace(/\.\.+/g, '.').trim();
    
    // Add the selected visualizer with canvas ID targeting
    // This ensures the visualizer renders in the correct canvas, not full-page
    let patternWithVisualizer = basePattern;
    const canvasId = 'master-punchcard-canvas';
    
    // Setup analyser for visualizers that need audio data (scope, spectrum)
    // MUST be done BEFORE pattern evaluation so visualizers can find it
    if (this.selectedVisualizer === 'scope' || this.selectedVisualizer === 'spectrum') {
      // Ensure analyser is set up and connected BEFORE pattern evaluation
      soundManager.setupVisualizerAnalyser();
      // Wait a bit longer to ensure analyser is fully connected and ready
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify analyser is connected
      const analyserId = canvasId;
      const getAnalyserById = window.strudel?.getAnalyserById || globalThis.getAnalyserById;
      if (getAnalyserById) {
        try {
          const analyser = getAnalyserById(analyserId);
          if (analyser && analyser.context === soundManager.audioContext) {
            console.log(`✅ Verified analyser "${analyserId}" is ready in correct audio context`);
          } else {
            console.warn(`⚠️ Analyser "${analyserId}" not ready or in wrong context`);
          }
        } catch (e) {
          console.warn(`⚠️ Could not verify analyser:`, e.message);
        }
      }
    }
    
    // Ensure canvas is visible and properly sized BEFORE calling getDrawContext
    // This is critical for scope/spectrum - they need to find the canvas by ID
    const canvasElement = document.getElementById(canvasId);
    if (canvasElement) {
      // Ensure canvas is positioned correctly (not fixed/absolute which would make it full-page)
      canvasElement.style.position = 'relative';
      canvasElement.style.display = 'block';
      canvasElement.style.visibility = 'visible';
      canvasElement.style.opacity = '1';
      canvasElement.style.left = '0';
      canvasElement.style.top = '0';
      canvasElement.style.width = '100%';
      canvasElement.style.height = '100%';
      // Ensure canvas has the correct ID (scope/spectrum look for canvas by analyser ID)
      canvasElement.id = canvasId;
      
      // Ensure canvas is in the container, not moved elsewhere
      const container = document.getElementById('master-punchcard');
      if (container && canvasElement.parentNode !== container) {
        container.appendChild(canvasElement);
      }
      
      // Get container dimensions
      if (container) {
        const rect = container.getBoundingClientRect();
        const pixelRatio = window.devicePixelRatio || 1;
        const displayWidth = Math.max(rect.width || 320, 320);
        const displayHeight = Math.max(rect.height || 200, 200);
        
        // Set canvas dimensions (internal size with pixel ratio)
        canvasElement.width = displayWidth * pixelRatio;
        canvasElement.height = displayHeight * pixelRatio;
        canvasElement.style.width = `${displayWidth}px`;
        canvasElement.style.height = `${displayHeight}px`;
        
        // For scope/spectrum, ensure canvas is ready and accessible
        if (this.selectedVisualizer === 'scope' || this.selectedVisualizer === 'spectrum') {
          // Force a reflow to ensure canvas is rendered
          canvasElement.offsetHeight;
          console.log(`✅ Canvas "${canvasId}" is ready for ${this.selectedVisualizer}:`, {
            id: canvasElement.id,
            width: canvasElement.width,
            height: canvasElement.height,
            visible: canvasElement.style.display !== 'none',
            inDOM: document.contains(canvasElement)
          });
        }
      }
    } else {
      console.error(`❌ Canvas "${canvasId}" not found!`);
    }
    
    if (this.selectedVisualizer === 'scope' || this.selectedVisualizer === 'spectrum') {
      if (canvasElement && canvasElement.id !== canvasId) {
        canvasElement.id = canvasId;
      }
      this.masterPunchcardCanvas.style.display = 'block';
    }
    
    // For visualizers that need canvas context, register with getDrawContext AFTER canvas is sized
    // This MUST be done BEFORE pattern evaluation so visualizers can find the canvas
    if (this.selectedVisualizer === 'pianoroll') {
      try {
        // Register canvas with Strudel's draw system
        // getDrawContext will find our existing canvas and return its context
        // For scope/spectrum, this ensures they use our canvas instead of creating their own
        const ctx = getDrawContext(canvasId, { contextType: '2d' });
        
        window.__strudelVisualizerCtx = ctx;
        
        console.log(`✅ Registered canvas "${canvasId}" with getDrawContext for ${this.selectedVisualizer}`);
      } catch (error) {
        console.warn(`⚠️ Failed to register canvas with getDrawContext for ${this.selectedVisualizer}:`, error);
      }
    }
    
    const analyserId = canvasId; // Analyser ID matches canvas ID
    
    if (this.selectedVisualizer === 'scope') {
      patternWithVisualizer = basePattern;
    } else if (this.selectedVisualizer === 'spectrum') {
      patternWithVisualizer = basePattern;
    } else if (this.selectedVisualizer === 'pianoroll') {
      if (this.masterPunchcardCanvas) {
        this.masterPunchcardCanvas.style.display = 'none';
      }
      this.externalVisualizerType = 'pianoroll';
      this.watchForExternalVisualizerCanvas('pianoroll');
      patternWithVisualizer = `${basePattern}.pianoroll({ 
        cycles: 4,
        playhead: 0.5,
        fill: true,
        fillActive: true,
        stroke: true,
        strokeActive: true,
        autorange: true,
        colorizeInactive: true,
        background: 'transparent'
      })`;
    } else if (this.selectedVisualizer === 'barchart') {
      // barchart doesn't exist in Strudel - use spectrum as alternative (shows frequency bars)
      console.warn('⚠️ barchart visualizer not available in Strudel, using spectrum instead');
      patternWithVisualizer = `${basePattern}.spectrum({ id: '${canvasId}' })`;
    }
    // For 'punchcard', we don't add any visualizer method - it's just the default rendering
    
    console.log(`🎨 Pattern with visualizer: ${patternWithVisualizer.substring(0, 150)}...`);
    console.log(`🎨 Full pattern with visualizer:`, patternWithVisualizer);
    
    // Ensure we have a valid pattern
    if (!patternWithVisualizer || patternWithVisualizer.trim() === '') {
      console.warn(`⚠️ Pattern with visualizer is empty, using base pattern`);
      patternWithVisualizer = basePattern || 'silence';
    }
    
    // Verify visualizer is in the pattern
    const usesInternalVisualizer = this.selectedVisualizer === 'scope' || this.selectedVisualizer === 'spectrum';
    const requiresPatternVisualizer = !usesInternalVisualizer && this.selectedVisualizer !== 'punchcard';
    let hasVisualizer = true;
    if (requiresPatternVisualizer) {
      hasVisualizer = patternWithVisualizer.includes(`.${this.selectedVisualizer}(`);
      if (!hasVisualizer) {
        console.error(`❌ Visualizer "${this.selectedVisualizer}" not found in pattern! Pattern:`, patternWithVisualizer);
      } else {
        console.log(`✅ Visualizer "${this.selectedVisualizer}" found in pattern`);
      }
    } else if (usesInternalVisualizer) {
      console.log(`✅ Using internal analyser visualizer for ${this.selectedVisualizer}`);
    }
    
    // Update the master pattern and restart playback
    await soundManager.setMasterPatternCode(patternWithVisualizer);
    
    if (this.selectedVisualizer === 'scope') {
      this.startScopeVisualizerLoop();
    } else if (this.selectedVisualizer === 'spectrum') {
      this.startSpectrumVisualizerLoop();
    }

    // Refresh the punchcard display
    this.refreshMasterPunchcard('visualizer-applied').catch(err => {
      console.warn('⚠️ Unable to refresh punchcard after applying visualizer:', err);
    });
  }

  showMasterPunchcardPlaceholder() {
    if (!this.masterPunchcardContainer) return;
    
    if (this.masterPunchcardPlaceholder) {
      this.masterPunchcardPlaceholder.classList.remove('hidden');
    }

    if (this.masterPunchcardCanvas && this.masterPunchcardCtx) {
      this.masterPunchcardCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.masterPunchcardCtx.clearRect(0, 0, this.masterPunchcardCanvas.width, this.masterPunchcardCanvas.height);
    }
  }

  async refreshMasterPunchcard(reason = 'auto') {
    if (!this.masterPunchcardContainer) return;
    const activeVisualizer = this.selectedVisualizer || 'punchcard';
    if (activeVisualizer === 'scope') {
      this.prepareCanvasForExternalVisualizer();
      this.startScopeVisualizerLoop();
      this.hideMasterPunchcardPlaceholder();
      this.masterPunchcardIsRendering = false;
      return;
    }
    if (activeVisualizer === 'spectrum') {
      this.prepareCanvasForExternalVisualizer();
      this.startSpectrumVisualizerLoop();
      this.hideMasterPunchcardPlaceholder();
      this.masterPunchcardIsRendering = false;
      return;
    }
    if (activeVisualizer !== 'scope' && activeVisualizer !== 'spectrum') {
      this.stopVisualizerAnimation();
    }
    
    // Avoid overlapping renders; queue another refresh if needed
    if (this.masterPunchcardIsRendering) {
      this.masterPunchcardPendingRefresh = true;
      return;
    }
    
    const patternCode = soundManager.getMasterPatternCode();
    if (!patternCode || patternCode.trim() === '') {
      this.showMasterPunchcardPlaceholder();
      return;
    }
    const useSpiral = this.shouldUseSpiralVisualizer(patternCode);
    const useScope = !useSpiral && this.shouldUseScopeVisualizer(patternCode);
    const useSpectrum = !useSpiral && !useScope && this.shouldUseSpectrumVisualizer(patternCode);
    const usePitchwheel = !useSpiral && !useScope && !useSpectrum && this.shouldUsePitchwheelVisualizer(patternCode);
    const usePianoroll = !useSpiral && !useScope && !useSpectrum && !usePitchwheel && this.shouldUsePianorollVisualizer(patternCode);
    const useBarchart = !useSpiral && !useScope && !useSpectrum && !usePitchwheel && !usePianoroll && this.shouldUseBarchartVisualizer(patternCode);
    
    if (useScope || useSpectrum || useSpiral || usePitchwheel || usePianoroll || useBarchart) {
      if ((this.selectedVisualizer || 'punchcard') === 'punchcard') {
        if (useScope) {
          this.watchForExternalVisualizerCanvas('scope');
        } else if (useSpectrum) {
          this.watchForExternalVisualizerCanvas('spectrum');
        } else if (usePianoroll) {
          this.watchForExternalVisualizerCanvas('pianoroll');
        }
      }
      // External visualizers (scope, spectrum, spiral) rely on Strudel rendering directly
      this.prepareCanvasForExternalVisualizer();
      this.hideMasterPunchcardPlaceholder();
      this.masterPunchcardIsRendering = false;
      return;
    }
    
    this.masterPunchcardIsRendering = true;
    try {
      const metrics = this.currentTimeSignatureMetrics || getTimeSignatureMetrics(this.currentTimeSignature || '4/4');
      
      const data = await this.computeMasterPunchcardData(patternCode, metrics);

      if (!data || data.error) {
        const message = data?.error ? `Unable to render punchcard: ${data.error}` : 'Unable to render punchcard.';
        console.warn(message, { reason, data });
        this.showMasterPunchcardPlaceholder();
        return;
      }
       
       if (!data.counts || data.counts.length === 0) {
        this.showMasterPunchcardPlaceholder();
        return;
      }
      
      const maxValue = Math.max(...data.counts);
      if (maxValue <= 0) {
        this.showMasterPunchcardPlaceholder();
        return;
      }
      
      this.renderMasterPunchcard(metrics, data);
    } finally {
      this.masterPunchcardIsRendering = false;
      if (this.masterPunchcardPendingRefresh) {
        this.masterPunchcardPendingRefresh = false;
        this.refreshMasterPunchcard('queued-refresh').catch(err => {
          console.warn('⚠️ Queued punchcard refresh failed:', err);
        });
      }
    }
  }

  renderMasterPunchcard(metrics, data) {
    if (!this.masterPunchcardContainer || !this.masterPunchcardCanvas) return;
    
    this.hideMasterPunchcardPlaceholder();
    this.drawMasterPunchcardCanvas(metrics, data);
  }

  prepareCanvasForExternalVisualizer() {
    if (!this.masterPunchcardContainer || !this.masterPunchcardCanvas) {
      console.warn('⚠️ Canvas elements not found for visualizer');
      return;
    }
    
    const canvasId = this.masterPunchcardCanvas.id;
    console.log(`🎨 Preparing canvas for external visualizer: ${canvasId}`);
    
    // Verify canvas is accessible via getElementById
    const canvasById = document.getElementById(canvasId);
    if (!canvasById) {
      console.error(`❌ Canvas "${canvasId}" not found via getElementById!`);
      return;
    }
    console.log(`✅ Canvas "${canvasId}" is accessible via getElementById`);
    
    this.hideMasterPunchcardPlaceholder();
    this.masterPunchcardCanvas.style.position = 'relative';
    this.masterPunchcardCanvas.style.left = '0';
    this.masterPunchcardCanvas.style.top = '0';
    this.masterPunchcardCanvas.style.width = '100%';
    this.masterPunchcardCanvas.style.height = '100%';
    this.masterPunchcardCanvas.style.display = 'block';
    
    let ctx;
    try {
      ctx = getDrawContext(canvasId, { contextType: '2d' });
      console.log(`✅ Got draw context via getDrawContext for ${canvasId}`);
    } catch (error) {
      console.warn('⚠️ getDrawContext failed, falling back to native:', error);
      ctx = this.masterPunchcardCanvas.getContext('2d');
    }
    
    if (!ctx) {
      return;
    }
    
    this.sizeCanvasToContainer(this.masterPunchcardCanvas, ctx);
    window.__strudelVisualizerCtx = ctx;
    
    if (window.strudel && window.strudel.controls) {
      try {
        window.strudel.controls.setCanvas(canvasId);
        console.log(`✅ Registered canvas "${canvasId}" with Strudel controls`);
      } catch (e) {
        console.log(`ℹ️ Could not register with strudel.controls:`, e.message);
      }
    }
  }

  sizeCanvasToContainer(canvas, context) {
    if (!canvas || !this.masterPunchcardContainer) {
      return;
    }
    const containerRect = this.masterPunchcardContainer.getBoundingClientRect();
    const displayWidth = Math.max(containerRect.width || this.masterPunchcardContainer.offsetWidth || 320, 240);
    const displayHeight = Math.max(containerRect.height || this.masterPunchcardContainer.offsetHeight || 200, 220);
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = displayWidth * pixelRatio;
    canvas.height = displayHeight * pixelRatio;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.opacity = '1';
    if (context) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }
  }

  ensureVisualizerAnalyser() {
    if (!soundManager) {
      return null;
    }
    if (!soundManager.visualizerAnalyser) {
      if (typeof soundManager.setupVisualizerAnalyser === 'function') {
        soundManager.setupVisualizerAnalyser();
      }
    }
    return soundManager.visualizerAnalyser || null;
  }

  stopVisualizerAnimation() {
    if (this.scopeAnimationFrame) {
      cancelAnimationFrame(this.scopeAnimationFrame);
      this.scopeAnimationFrame = null;
    }
    if (this.spectrumAnimationFrame) {
      cancelAnimationFrame(this.spectrumAnimationFrame);
      this.spectrumAnimationFrame = null;
    }
    this.activeVisualizerLoop = null;
  }

  drawVisualizerMessage(message) {
    const canvas = this.masterPunchcardCanvas;
    const ctx = this.getMasterPunchcardContext();
    if (!canvas || !ctx) {
      return;
    }
    this.sizeCanvasToContainer(canvas, ctx);
    const pixelRatio = window.devicePixelRatio || 1;
    const width = canvas.width / pixelRatio;
    const height = canvas.height / pixelRatio;
    ctx.fillStyle = 'rgba(5, 6, 10, 0.92)';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px "Fira Sans", "Inter", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, width / 2, height / 2);
  }

  startScopeVisualizerLoop() {
    if (this.activeVisualizerLoop === 'scope') {
      return;
    }
    const canvas = this.masterPunchcardCanvas;
    const ctx = this.getMasterPunchcardContext();
    if (!canvas || !ctx) {
      return;
    }
    const analyser = this.ensureVisualizerAnalyser();
    if (!analyser) {
      this.drawVisualizerMessage('Scope analyser unavailable');
      return;
    }
    const bufferLength = analyser.fftSize || 2048;
    if (!this.scopeDataArray || this.scopeDataArray.length !== bufferLength) {
      this.scopeDataArray = new Uint8Array(bufferLength);
    }
    this.activeVisualizerLoop = 'scope';
    const draw = () => {
      if (this.selectedVisualizer !== 'scope') {
        this.stopVisualizerAnimation();
        return;
      }
      const context = this.getMasterPunchcardContext();
      if (!context) {
        this.stopVisualizerAnimation();
        return;
      }
      this.hideMasterPunchcardPlaceholder();
      this.masterPunchcardCanvas.style.display = 'block';
      this.sizeCanvasToContainer(canvas, context);
      analyser.getByteTimeDomainData(this.scopeDataArray);
      const pixelRatio = window.devicePixelRatio || 1;
      const width = canvas.width / pixelRatio;
      const height = canvas.height / pixelRatio;
      context.fillStyle = 'rgba(5, 6, 10, 0.92)';
      context.fillRect(0, 0, width, height);
      const mid = height / 2;
      context.strokeStyle = '#38bdf8';
      context.lineWidth = 2;
      context.beginPath();
      const sliceWidth = width / this.scopeDataArray.length;
      let x = 0;
      for (let i = 0; i < this.scopeDataArray.length; i++) {
        const v = this.scopeDataArray[i] / 128.0;
        const y = (v * height) / 2;
        if (i === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
        x += sliceWidth;
      }
      context.lineTo(width, mid);
      context.stroke();
      context.strokeStyle = 'rgba(14, 165, 233, 0.4)';
      context.beginPath();
      context.moveTo(0, mid);
      context.lineTo(width, mid);
      context.stroke();
      this.scopeAnimationFrame = requestAnimationFrame(draw);
    };
    draw();
  }

  startSpectrumVisualizerLoop() {
    if (this.activeVisualizerLoop === 'spectrum') {
      return;
    }
    const canvas = this.masterPunchcardCanvas;
    const ctx = this.getMasterPunchcardContext();
    if (!canvas || !ctx) {
      return;
    }
    const analyser = this.ensureVisualizerAnalyser();
    if (!analyser) {
      this.drawVisualizerMessage('Spectrum analyser unavailable');
      return;
    }
    const bufferLength = analyser.frequencyBinCount || 1024;
    if (!this.spectrumDataArray || this.spectrumDataArray.length !== bufferLength) {
      this.spectrumDataArray = new Uint8Array(bufferLength);
    }
    this.activeVisualizerLoop = 'spectrum';
    const draw = () => {
      if (this.selectedVisualizer !== 'spectrum') {
        this.stopVisualizerAnimation();
        return;
      }
      const context = this.getMasterPunchcardContext();
      if (!context) {
        this.stopVisualizerAnimation();
        return;
      }
      this.hideMasterPunchcardPlaceholder();
      this.masterPunchcardCanvas.style.display = 'block';
      this.sizeCanvasToContainer(canvas, context);
      analyser.getByteFrequencyData(this.spectrumDataArray);
      const pixelRatio = window.devicePixelRatio || 1;
      const width = canvas.width / pixelRatio;
      const height = canvas.height / pixelRatio;
      context.fillStyle = 'rgba(5, 6, 10, 0.92)';
      context.fillRect(0, 0, width, height);
      const barCount = Math.min(this.spectrumDataArray.length, Math.floor(width / 3));
      const step = this.spectrumDataArray.length / barCount;
      const barWidth = width / barCount;
      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor(i * step);
        const value = this.spectrumDataArray[dataIndex] / 255;
        const barHeight = Math.max(value * height, 2);
        const x = i * barWidth;
        const y = height - barHeight;
        const gradient = context.createLinearGradient(x, y, x, height);
        gradient.addColorStop(0, 'rgba(56, 189, 248, 0.95)');
        gradient.addColorStop(1, 'rgba(14, 116, 144, 0.75)');
        context.fillStyle = gradient;
        context.fillRect(x + barWidth * 0.15, y, barWidth * 0.7, barHeight);
      }
      this.spectrumAnimationFrame = requestAnimationFrame(draw);
    };
    draw();
  }

  teardownExternalVisualizerCanvas() {
    if (this.externalVisualizerObserver) {
      this.externalVisualizerObserver.disconnect();
      this.externalVisualizerObserver = null;
    }
    if (this.externalVisualizerCanvas && this.externalVisualizerCanvas.parentNode) {
      this.externalVisualizerCanvas.remove();
    }
    this.externalVisualizerCanvas = null;
    this.externalVisualizerType = null;
    if (this.masterPunchcardCanvas) {
      this.masterPunchcardCanvas.style.display = '';
    }
  }

  attachExternalVisualizerCanvas(canvas) {
    if (!canvas || !this.masterPunchcardContainer) {
      return false;
    }
    this.masterPunchcardCanvas.style.display = 'none';
    this.hideMasterPunchcardPlaceholder();
    if (this.masterPunchcardContainer.style.position === '') {
      this.masterPunchcardContainer.style.position = 'relative';
    }
    canvas.dataset.visualizerAttached = 'true';
    canvas.style.position = 'relative';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.pointerEvents = 'auto';
    this.sizeCanvasToContainer(canvas, canvas.getContext('2d'));
    this.masterPunchcardContainer.appendChild(canvas);
    this.externalVisualizerCanvas = canvas;
    return true;
  }

  watchForExternalVisualizerCanvas(type) {
    const tryAttach = () => {
      const candidate = this.findExternalVisualizerCanvasCandidate(type);
      if (candidate) {
        return this.attachExternalVisualizerCanvas(candidate);
      }
      return false;
    };
    if (tryAttach()) {
      return;
    }
    this.externalVisualizerObserver = new MutationObserver(() => {
      if (tryAttach() && this.externalVisualizerObserver) {
        this.externalVisualizerObserver.disconnect();
        this.externalVisualizerObserver = null;
      }
    });
    this.externalVisualizerObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  findExternalVisualizerCanvasCandidate(type) {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    for (const canvas of canvases) {
      if (canvas === this.masterPunchcardCanvas) continue;
      if (canvas.dataset.visualizerAttached === 'true') continue;
      if (type === 'pianoroll' && this.isPianorollCanvas(canvas)) {
        return canvas;
      }
      if (type === 'scope' && this.isScopeCanvas(canvas)) {
        return canvas;
      }
      if (type === 'spectrum' && this.isSpectrumCanvas(canvas)) {
        return canvas;
      }
    }
    return null;
  }

  isPianorollCanvas(canvas) {
    if (!canvas) return false;
    if (canvas.dataset.pianoroll !== undefined) return true;
    const className = canvas.className || '';
    if (/pianoroll/i.test(className)) return true;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const coversViewport = rect.width > window.innerWidth * 0.6 && rect.height > window.innerHeight * 0.4;
    return coversViewport;
  }
  isScopeCanvas(canvas) {
    if (!canvas) return false;
    const id = (canvas.id || '').toLowerCase();
    const className = (canvas.className || '').toLowerCase();
    if (id.includes('scope') || className.includes('scope')) return true;
    if (canvas.dataset.scope !== undefined) return true;
    const rect = canvas.getBoundingClientRect();
    return rect.width > window.innerWidth * 0.5 && rect.height < 260;
  }

  isSpectrumCanvas(canvas) {
    if (!canvas) return false;
    const id = (canvas.id || '').toLowerCase();
    const className = (canvas.className || '').toLowerCase();
    if (id.includes('spectrum') || className.includes('spectrum')) return true;
    if (canvas.dataset.spectrum !== undefined) return true;
    const rect = canvas.getBoundingClientRect();
    return rect.width > window.innerWidth * 0.5 && rect.height < 400;
  }

  hideMasterPunchcardPlaceholder() {
    if (this.masterPunchcardPlaceholder) {
      this.masterPunchcardPlaceholder.classList.add('hidden');
    }
  }

  shouldUseSpiralVisualizer(patternCode) {
    if (!patternCode) return false;
    return /\.\s*_?spiral\s*\(/i.test(patternCode);
  }

  shouldUseScopeVisualizer(patternCode) {
    if (!patternCode) return false;
    return /\.\s*_?(?:t?scope)\s*\(/i.test(patternCode);
  }

  shouldUseSpectrumVisualizer(patternCode) {
    if (!patternCode) return false;
    return /\.\s*_?spectrum\s*\(/i.test(patternCode);
  }

  shouldUsePitchwheelVisualizer(patternCode) {
    if (!patternCode) return false;
    // pitchwheel can be used with or without underscore prefix
    return /\.\s*_?pitchwheel\s*\(/i.test(patternCode);
  }

  shouldUsePianorollVisualizer(patternCode) {
    if (!patternCode) return false;
    // pianoroll can be used with or without underscore prefix
    return /\.\s*_?pianoroll\s*\(/i.test(patternCode);
  }

  shouldUseBarchartVisualizer(patternCode) {
    if (!patternCode) return false;
    return /\.\s*_?barchart\s*\(/i.test(patternCode);
  }

  extractSpiralOptions(patternCode) {
    if (!patternCode) return {};
    const match = patternCode.match(/\.\s*_?spiral\s*\(\s*\{([^}]*)\}\s*\)/i);
    if (!match) return {};
    const options = {};
    const body = match[1];
    body.split(',').forEach((segment) => {
      const [rawKey, rawValue] = segment.split(':');
      if (!rawKey || !rawValue) return;
      const key = rawKey.trim();
      const valueText = rawValue.trim();
      const numeric = Number(valueText.replace(/[^0-9.+-eE]/g, ''));
      if (!Number.isNaN(numeric)) {
        options[key] = numeric;
      } else if (/true|false/i.test(valueText)) {
        options[key] = /^true$/i.test(valueText);
      } else {
        options[key] = valueText.replace(/['"]/g, '');
      }
    });
    return options;
  }

  getMasterPunchcardContext() {
    if (!this.masterPunchcardCanvas) return null;
    if (!this.masterPunchcardCtx) {
      try {
        this.masterPunchcardCtx = getDrawContext(this.masterPunchcardCanvas.id, { contextType: '2d' });
      } catch (error) {
        console.warn('⚠️ Falling back to native canvas context:', error);
        this.masterPunchcardCtx = this.masterPunchcardCanvas.getContext('2d');
      }
    }
    return this.masterPunchcardCtx;
  }

  drawMasterPunchcardCanvas(metrics, data) {
    const canvas = this.masterPunchcardCanvas;
    const ctx = this.getMasterPunchcardContext();
    if (!canvas || !ctx) return;
    
    const containerRect = this.masterPunchcardContainer.getBoundingClientRect();
    const displayWidth = Math.max(containerRect.width || this.masterPunchcardContainer.offsetWidth || 600, 240);
    const displayHeight = Math.max(containerRect.height || this.masterPunchcardContainer.offsetHeight || 200, 200);
    const pixelRatio = window.devicePixelRatio || 1;
    
    if (canvas.width !== displayWidth * pixelRatio || canvas.height !== displayHeight * pixelRatio) {
      canvas.width = displayWidth * pixelRatio;
      canvas.height = displayHeight * pixelRatio;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
    }
    
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    
    const padding = 16;
    const chartWidth = displayWidth - padding * 2;
    const chartHeight = displayHeight - padding * 3;
    const originX = padding;
    const originY = displayHeight - padding * 1.5;
    
    // Background
    const backgroundGradient = ctx.createLinearGradient(0, 0, displayWidth, displayHeight);
    backgroundGradient.addColorStop(0, 'rgba(102, 126, 234, 0.06)');
    backgroundGradient.addColorStop(1, 'rgba(118, 75, 162, 0.08)');
    ctx.fillStyle = backgroundGradient;
    ctx.fillRect(0, 0, displayWidth, displayHeight);
    
    const { counts, hits } = data;
    const { totalSteps, stepsPerBeat } = metrics;
    if (counts.length !== totalSteps) {
      console.warn('⚠️ Punchcard data length mismatch', { expected: totalSteps, received: counts.length });
    }
    const safeMax = Math.max(...counts, 0.0001);
    const barWidth = chartWidth / totalSteps;
    
    // Quarter separators
    ctx.strokeStyle = 'rgba(102, 126, 234, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let step = 0; step <= totalSteps; step += stepsPerBeat) {
      const x = originX + step * barWidth;
      ctx.moveTo(x, originY);
      ctx.lineTo(x, originY - chartHeight);
    }
    ctx.stroke();
    
    // Bars
    counts.forEach((count, index) => {
      const normalized = Math.max(count / safeMax, 0);
      const barHeight = chartHeight * normalized;
      const x = originX + index * barWidth;
      const y = originY - barHeight;
      
      if (barHeight <= 2) {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.fillRect(x + barWidth * 0.3, originY - 3, barWidth * 0.4, 3);
        return;
      }
      
      const gradient = ctx.createLinearGradient(x, y, x, originY);
      gradient.addColorStop(0, 'rgba(102, 126, 234, 0.9)');
      gradient.addColorStop(1, 'rgba(118, 75, 162, 0.85)');
      ctx.fillStyle = gradient;
      const barX = x + barWidth * 0.2;
      const barW = barWidth * 0.6;
      const radius = Math.min(barWidth * 0.3, 8);
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(barX, y, barW, barHeight, radius);
        ctx.fill();
      } else {
        ctx.fillRect(barX, y, barW, barHeight);
      }
      
      const labels = hits?.[index];
      if (labels && labels.length) {
        ctx.fillStyle = 'rgba(26, 32, 44, 0.75)';
        ctx.font = '10px "Fira Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const labelText = labels.slice(0, 2).join(' • ');
        ctx.fillText(labelText, x + barWidth / 2, y - 4);
      }
    });
    
    // Baseline
    ctx.strokeStyle = 'rgba(79, 70, 229, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(originX + chartWidth, originY);
    ctx.stroke();
    
    ctx.restore();
  }

  renderMasterSpiral(metrics, data, spiralOptions = {}) {
    if (!this.masterPunchcardContainer || !this.masterPunchcardCanvas) return;
    const events = data.events || [];
    if (!events.length) {
      this.showMasterPunchcardPlaceholder();
      return;
    }
    this.hideMasterPunchcardPlaceholder();
    this.drawMasterSpiralCanvas(metrics, events, spiralOptions);
  }

  drawMasterSpiralCanvas(metrics, events, spiralOptions = {}) {
    const canvas = this.masterPunchcardCanvas;
    const ctx = this.getMasterPunchcardContext();
    if (!canvas || !ctx) return;

    const containerRect = this.masterPunchcardContainer.getBoundingClientRect();
    const displayWidth = Math.max(containerRect.width || this.masterPunchcardContainer.offsetWidth || 320, 240);
    const displayHeight = Math.max(containerRect.height || this.masterPunchcardContainer.offsetHeight || 240, 220);
    const pixelRatio = window.devicePixelRatio || 1;

    if (canvas.width !== displayWidth * pixelRatio || canvas.height !== displayHeight * pixelRatio) {
      canvas.width = displayWidth * pixelRatio;
      canvas.height = displayHeight * pixelRatio;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const padding = Number.isFinite(spiralOptions.padding) ? spiralOptions.padding : 32;
    const inset = Number.isFinite(spiralOptions.inset) ? spiralOptions.inset : 3;
    const stretch = Number.isFinite(spiralOptions.stretch) ? spiralOptions.stretch : 1;
    const rotations = Number.isFinite(spiralOptions.rotations)
      ? spiralOptions.rotations
      : Math.max(metrics.numerator ?? 4, 4);
    const steady = Number.isFinite(spiralOptions.steady) ? spiralOptions.steady : 0.9;
    const thicknessBase = Number.isFinite(spiralOptions.thickness) ? spiralOptions.thickness : 6;
    const cap = typeof spiralOptions.cap === 'string' ? spiralOptions.cap : 'round';

    const backgroundGradient = ctx.createLinearGradient(0, 0, displayWidth, displayHeight);
    backgroundGradient.addColorStop(0, 'rgba(102, 126, 234, 0.08)');
    backgroundGradient.addColorStop(1, 'rgba(118, 75, 162, 0.12)');
    ctx.fillStyle = backgroundGradient;
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    const cx = displayWidth / 2;
    const cy = displayHeight / 2;
    const maxRadius = Math.max(Math.min(displayWidth, displayHeight) / 2 - padding, 40);
    const margin = maxRadius / Math.max(rotations + inset + 1, 1);

    const time = 0; // static snapshot of first bar
    const rotate = steady * time;

    const baseSettings = {
      margin,
      cx,
      cy,
      stretch,
      cap,
      thickness: thicknessBase
    };

    const defaultColor = 'rgba(76, 81, 191, 0.85)';
    const inactiveColor = 'rgba(148, 163, 184, 0.35)';
    const weightScale = Math.max(...events.map(ev => ev.weight ?? 1), 1);
    const rotationsPerCycle = rotations;

    // Draw events
    events.forEach((event) => {
      const begin = Number.isFinite(event.begin) ? event.begin : 0;
      const end = Number.isFinite(event.endClipped) ? event.endClipped : Number.isFinite(event.end) ? event.end : begin;
      const weight = Number.isFinite(event.weight) ? Math.max(event.weight, 0.1) : 1;
      const color = event.color || defaultColor;

      const from = inset + begin * rotationsPerCycle;
      const to = inset + Math.max(end, begin) * rotationsPerCycle;

      drawSpiralSegment(ctx, {
        ...baseSettings,
        from,
        to,
        rotate,
        thickness: baseSettings.thickness * (0.6 + (weight / weightScale) * 0.8),
        color
      });
    });

    // Draw subtle inactive spiral for context
    const totalSpan = inset + rotationsPerCycle + 1;
    drawSpiralSegment(ctx, {
      ...baseSettings,
      from: inset,
      to: totalSpan,
      rotate,
      color: inactiveColor,
      thickness: baseSettings.thickness * 0.6,
      fromOpacity: 0.35,
      toOpacity: 0.1
    });

    ctx.restore();
  }

  async computeMasterPunchcardData(patternCode, metrics) {
    try {
      if (!soundManager.strudelLoaded) {
        await soundManager.initStrudel();
      }
    } catch (error) {
      console.warn('⚠️ Unable to initialize Strudel for punchcard:', error);
      return { error: 'Strudel is not ready yet.' };
    }
    
    if (!window.strudel || typeof window.strudel.evaluate !== 'function') {
      return { error: 'Strudel evaluate function is unavailable.' };
    }
    
    // Strip visualizer methods for punchcard evaluation
    // We only want the pattern data, not the visualization
    let patternForEval = patternCode;
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 PUNCHCARD EVALUATION - Original pattern:');
    console.log('   Full pattern:', patternForEval);
    console.log('───────────────────────────────────────────────────────────');
    
    // Strip JavaScript comments (// and /* */)
    // Remove single-line comments
    patternForEval = patternForEval.replace(/\/\/.*$/gm, '');
    // Remove multi-line comments
    patternForEval = patternForEval.replace(/\/\*[\s\S]*?\*\//g, '');
    // Clean up extra whitespace and newlines
    patternForEval = patternForEval.replace(/\n\s*\n/g, '\n').trim();
    
    // Fix corrupted patterns: ).(gain( -> ).gain( and ).(pan( -> ).pan(
    // This handles cases where gain/pan got incorrectly wrapped in parentheses
    patternForEval = patternForEval.replace(/\)\s*\.\s*\((gain|pan)\s*\(/g, ').$1(');
    
    // Fix patterns with modifiers that need wrapping before .gain() or .pan()
    // Pattern like s("bd").bank("RolandTR808").gain(0.80) needs to be
    // (s("bd").bank("RolandTR808")).gain(0.80)
    // BUT: Skip this entire step if the pattern already has ').gain(' or ').pan('
    // This indicates it's already properly wrapped (pattern).gain(...) or (pattern).pan(...)
    const hasWrappedGainPan = /\)\s*\.\s*(gain|pan)\s*\(/.test(patternForEval);
    
    if (!hasWrappedGainPan) {
      // Only apply wrapping fix if pattern doesn't already have wrapped gain/pan
      patternForEval = patternForEval.replace(
        /([a-zA-Z_$][a-zA-Z0-9_$]*\s*\([^()]*\)(?:\s*\.\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\([^()]*\))*)\s*\.\s*(gain|pan)\s*\(/g,
        (match, patternPart, modifier) => {
          // Check if patternPart itself starts with '(' (shouldn't happen with this regex, but safety check)
          const trimmed = patternPart.trim();
          if (trimmed.startsWith('(')) {
            return match; // Already wrapped, don't modify
          }
          // Wrap in parentheses
          return `(${patternPart}).${modifier}(`;
        }
      );
    }
    
    console.log('🔍 PUNCHCARD EVALUATION - After removing comments and fixing modifiers:');
    console.log('   Pattern:', patternForEval);
    console.log('───────────────────────────────────────────────────────────');
    
    // Helper function to find matching closing parenthesis
    const findMatchingParen = (str, startIndex) => {
      let depth = 1;
      for (let i = startIndex + 1; i < str.length; i++) {
        if (str[i] === '(') depth++;
        else if (str[i] === ')') {
          depth--;
          if (depth === 0) return i;
        }
      }
      return -1;
    };
    
    const visualizerMethods = ['scope', 'tscope', 'fscope', 'spectrum', 'visual', 'spiral'];
    visualizerMethods.forEach(method => {
      // Use a manual approach to handle nested parentheses
      const searchPattern = new RegExp(`\\.\\s*_?${method}\\s*\\(`, 'gi');
      let match;
      let removed = 0;
      
      while ((match = searchPattern.exec(patternForEval)) !== null) {
        const startPos = match.index;
        const openParenPos = match.index + match[0].length - 1;
        const closeParenPos = findMatchingParen(patternForEval, openParenPos);
        
        if (closeParenPos !== -1) {
          const before = patternForEval;
          patternForEval = patternForEval.substring(0, startPos) + patternForEval.substring(closeParenPos + 1);
          removed++;
          console.log(`  Stripped .${method}(...) occurrence #${removed}`);
          // Reset regex search since we modified the string
          searchPattern.lastIndex = 0;
        } else {
          console.warn(`  Could not find matching ) for .${method}( at position ${openParenPos}`);
          break;
        }
      }
    });
    patternForEval = patternForEval.trim();
    
    // Clean up any trailing dots or double dots that might be left
    patternForEval = patternForEval.replace(/\.\s*$/, '').replace(/\.\.+/g, '.').trim();
    
    console.log('🔍 PUNCHCARD EVALUATION - After stripping:');
    console.log('   Stripped pattern:', patternForEval);
    console.log('───────────────────────────────────────────────────────────');
    
    // If pattern is empty after stripping, return early
    if (!patternForEval || patternForEval.trim() === '') {
      console.warn('⚠️ Pattern is empty after stripping visualizers');
      return { error: 'Pattern is empty after removing visualizers.' };
    }
    
    // Final safety check: if pattern still contains visualizer patterns, log warning and try to show placeholder
    const stillHasVisualizers = visualizerMethods.some(method => {
      const checkRegex = new RegExp(`\\.\\s*_?${method}\\s*\\(`, 'i');
      return checkRegex.test(patternForEval);
    });
    
    if (stillHasVisualizers) {
      console.warn('═══════════════════════════════════════════════════════════');
      console.warn('⚠️ PUNCHCARD EVALUATION - FAILED TO STRIP VISUALIZERS');
      console.warn('   Pattern still contains visualizers after stripping:');
      console.warn('   ', patternForEval);
      console.warn('   This will cause Mini parser errors. Skipping punchcard evaluation.');
      console.warn('═══════════════════════════════════════════════════════════');
      return { error: 'Pattern contains visualizers that could not be stripped.' };
    }
    
    console.log('✅ PUNCHCARD EVALUATION - Ready to evaluate (no visualizers detected)');
    console.log('═══════════════════════════════════════════════════════════');
    
    // Validate pattern before evaluation
    if (!patternForEval || patternForEval.trim() === '') {
      console.warn('⚠️ Pattern is empty after stripping - cannot evaluate');
      return { error: 'Pattern is empty after processing' };
    }
    
    console.log('📝 Final pattern to evaluate:', patternForEval);
    
    try {
      // Ensure any banks or sample-based instruments referenced by the pattern are loaded
      await soundManager.ensurePatternResourcesLoaded(patternForEval);
    } catch (resourceError) {
      console.warn('⚠️ Unable to preload resources for punchcard evaluation:', resourceError);
    }
    
    const toNumber = (value) => {
      if (value == null) return 0;
      if (typeof value === 'number') return value;
      if (typeof value.valueOf === 'function') {
        const result = value.valueOf();
        if (typeof result === 'number' && !Number.isNaN(result)) {
          return result;
        }
      }
      if (typeof value === 'object' && value !== null && 'n' in value && 'd' in value) {
        const numerator = Number(value.n ?? 0);
        const denominator = Number(value.d ?? 1);
        return denominator !== 0 ? numerator / denominator : 0;
      }
      const coerced = Number(value);
      return Number.isFinite(coerced) ? coerced : 0;
    };
    
    const describeValue = (hapValue) => {
      if (!hapValue) return null;
      if (typeof hapValue === 'string') return hapValue;
      if (hapValue.label) return hapValue.label;
      if (hapValue.sample) return hapValue.sample;
      if (hapValue.s) return hapValue.s;
      if (hapValue.note) return hapValue.note;
      if (hapValue.n) return hapValue.n;
      if (hapValue.sound) return hapValue.sound;
      if (hapValue.instrument) return hapValue.instrument;
      return null;
    };
    
    let patternObject;
    try {
      const evaluation = await strudelCoreEvaluate(patternForEval, strudelTranspiler, {
        wrapAsync: false,
        addReturn: false,
        emitMiniLocations: false
      });
      patternObject = evaluation?.pattern;
      console.log('🔍 Evaluated pattern object:', patternObject);
    } catch (error) {
      console.error('❌ Failed to evaluate pattern for punchcard:', error);
      return { error: error?.message || 'Pattern evaluation failed.' };
    }
    
    if (!patternObject && window.strudel && typeof window.strudel.evaluate === 'function') {
      console.log('🔁 strudelCoreEvaluate returned no pattern - attempting fallback via window.strudel.evaluate');
      try {
        // Try evaluating the pattern directly and storing the result
        const evalCode = `globalThis.__punchcard_pattern = ${patternForEval}`;
        console.log('🔍 Fallback evaluation code:', evalCode.substring(0, 200));
        const evalResult = await window.strudel.evaluate(evalCode);
        
        // Check multiple ways the pattern might be stored
        if (globalThis.__punchcard_pattern) {
          patternObject = globalThis.__punchcard_pattern;
          console.log('🔍 Fallback pattern object from globalThis:', patternObject);
        } else if (evalResult && typeof evalResult.queryArc === 'function') {
          patternObject = evalResult;
          console.log('🔍 Fallback pattern object from eval result:', patternObject);
        } else if (evalResult && evalResult._Pattern) {
          patternObject = evalResult;
          console.log('🔍 Fallback pattern object (has _Pattern):', patternObject);
        } else {
          // Try evaluating without assignment to see what we get
          const directEval = await window.strudel.evaluate(patternForEval);
          if (directEval && (typeof directEval.queryArc === 'function' || directEval._Pattern)) {
            patternObject = directEval;
            console.log('🔍 Fallback pattern object from direct eval:', patternObject);
          }
        }
      } catch (fallbackError) {
        console.warn('⚠️ Fallback evaluation failed:', fallbackError);
        console.warn('⚠️ Pattern that failed:', patternForEval.substring(0, 200));
      }
    }
    
    // Check if patternObject is valid - it should have queryArc or query method, or _Pattern property
    const isValidPattern = patternObject && (
      typeof patternObject.queryArc === 'function' ||
      typeof patternObject.query === 'function' ||
      patternObject._Pattern === true
    );
    
    if (!isValidPattern) {
      console.warn('⚠️ Pattern did not return a valid Strudel pattern object');
      console.warn('⚠️ Pattern object type:', typeof patternObject);
      console.warn('⚠️ Pattern object:', patternObject);
      console.warn('⚠️ Pattern that failed:', patternForEval.substring(0, 300));
      
      // Try one more time with a simpler approach - wrap in parentheses
      if (window.strudel && typeof window.strudel.evaluate === 'function') {
        try {
          const wrappedPattern = `(${patternForEval})`;
          const lastAttempt = await window.strudel.evaluate(wrappedPattern);
          if (lastAttempt && (
            typeof lastAttempt.queryArc === 'function' ||
            typeof lastAttempt.query === 'function' ||
            lastAttempt._Pattern === true
          )) {
            patternObject = lastAttempt;
            console.log('✅ Last attempt succeeded with wrapped pattern');
          }
        } catch (lastError) {
          console.warn('⚠️ Last attempt also failed:', lastError);
        }
      }
      
      // Final check
      const finalCheck = patternObject && (
        typeof patternObject.queryArc === 'function' ||
        typeof patternObject.query === 'function' ||
        patternObject._Pattern === true
      );
      
      if (!finalCheck) {
        return { error: 'Pattern expression did not return a Strudel pattern.' };
      }
    }
    
    let haps;
    try {
      // Try queryArc first, then fall back to query if available
      if (typeof patternObject.queryArc === 'function') {
        haps = patternObject.queryArc(0, 1) || [];
      } else if (typeof patternObject.query === 'function') {
        haps = patternObject.query(0, 1) || [];
      } else {
        // If neither method exists but _Pattern is true, try to get haps from __steps
        if (patternObject.__steps && typeof patternObject.__steps === 'object') {
          // Try to extract haps from the pattern structure
          haps = [];
          console.warn('⚠️ Pattern has _Pattern but no queryArc/query - attempting to extract haps from __steps');
        } else {
          throw new Error('Pattern object does not have queryArc, query, or __steps');
        }
      }
    } catch (error) {
      console.error('❌ Failed to query pattern arc for punchcard:', error);
      return { error: error?.message || 'Pattern queryArc failed.' };
    }
    
    try {
      delete globalThis.__punchcard_pattern;
    } catch (_) {
      globalThis.__punchcard_pattern = undefined;
    }
    
    const parsed = {
      events: haps.map((hap) => {
        const part = hap?.part;
        const whole = hap?.whole;
        const begin = part ? toNumber(part.begin ?? part.start ?? 0) : toNumber(whole?.begin ?? 0);
        let end = part ? toNumber(part.end ?? part.finish ?? part.begin ?? 0) : toNumber(whole?.end ?? whole?.begin ?? 0);
        if (!Number.isFinite(end) || end < begin) {
          end = begin;
        }
        const value = hap?.value ?? null;
        const label = describeValue(value);
        const note = value && typeof value === 'object'
          ? (value.note ?? value.n ?? null)
          : null;
        const sound = value && typeof value === 'object'
          ? (value.sound ?? value.s ?? null)
          : null;
        const sample = value && typeof value === 'object'
          ? (value.sample ?? null)
          : null;
        const instrument = value && typeof value === 'object'
          ? (value.instrument ?? null)
          : null;
        const source = value && typeof value === 'object'
          ? (value.source ?? value.path ?? null)
          : null;
        const rawString = typeof value === 'string' ? value : null;
        const velocity = value && typeof value === 'object' && value.velocity != null ? Number(value.velocity) : 1;
        const gain = value && typeof value === 'object' && value.gain != null ? Number(value.gain) : 1;
        const weight = (Number.isFinite(velocity) ? velocity : 1) * (Number.isFinite(gain) ? gain : 1);
        return {
          begin,
          end,
          endClipped: toNumber(hap?.endClipped ?? end),
          wholeBegin: toNumber(whole?.begin ?? begin),
          wholeEnd: toNumber(whole?.end ?? end),
          label,
          weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
          color: value && typeof value === 'object' && value.color ? value.color : null,
          tags: Array.isArray(hap?.tags) ? hap.tags : [],
          meta: {
            label,
            note,
            sound,
            sample,
            instrument,
            source,
            rawString
          }
        };
      })
    };
    
    if (!parsed || parsed.error) {
      console.warn('⚠️ Parsed result has error:', parsed?.error);
      return { error: parsed?.error || 'Unknown error from Strudel evaluation.' };
    }
    
    const { totalSteps } = metrics;
    const counts = new Array(totalSteps).fill(0);
    const hits = new Array(totalSteps).fill(null).map(() => []);
    const events = parsed.events || [];
    
    events.forEach((event) => {
      if (!event) return;
      const { begin, end, endClipped, label, weight } = event;
      const normalizedBegin = ((Number(begin) % 1) + 1) % 1;
      const effectiveEnd = Number.isFinite(endClipped) ? endClipped : end;
      let normalizedEnd = ((Number(effectiveEnd) % 1) + 1) % 1;
      if (!Number.isFinite(normalizedEnd) || normalizedEnd < normalizedBegin) {
        normalizedEnd = normalizedBegin;
      }
      const startIndex = Math.min(totalSteps - 1, Math.max(0, Math.floor(normalizedBegin * totalSteps)));
      const endIndex = Math.min(totalSteps - 1, Math.max(startIndex, Math.ceil(normalizedEnd * totalSteps) - 1));
      const increment = Number.isFinite(weight) ? Math.max(weight, 0.1) : 1;
      for (let step = startIndex; step <= endIndex; step += 1) {
        counts[step] += increment;
        if (label) {
          const current = hits[step];
          if (!current.includes(label)) {
            current.push(label);
          }
        }
      }
    });
    
    return { counts, hits, events };
  }

  async computeMasterHighlightData(patternCode) {
    if (!patternCode || typeof patternCode !== 'string' || patternCode.trim() === '') {
      return null;
    }

    let transpiled;
    try {
      transpiled = strudelTranspiler(patternCode, { emitMiniLocations: true });
    } catch (error) {
      console.warn('⚠️ Could not transpile master pattern for highlighting:', error);
      return null;
    }

    const miniLocations = Array.isArray(transpiled?.miniLocations) ? transpiled.miniLocations : [];
    const tokenEntries = [];

    const pushToken = (from, to, text) => {
      if (typeof from !== 'number' || typeof to !== 'number') {
        return;
      }
      const length = to - from;
      if (!Number.isFinite(length) || length <= 0) {
        return;
      }
      const normalized = (text || '').replace(/['"]/g, '').trim().toLowerCase();
      if (!normalized) {
        return;
      }
      tokenEntries.push({ from, to, text, normalized, used: false, length });
    };

  miniLocations.forEach((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) {
        return;
      }
      const [from, to] = entry;
      if (typeof from !== 'number' || typeof to !== 'number' || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
        return;
      }
    const text = patternCode.slice(from, to);
    const commentIndex = text.indexOf('//');
    if (commentIndex !== -1) {
      const beforeComment = text.slice(0, commentIndex);
      if (beforeComment.trim()) {
        pushToken(from, from + beforeComment.length, beforeComment);
      const beforeRegex = /"[^"]*"|'[^']*'|[A-Za-z0-9_#:+-]+/g;
      let beforeMatch;
      while ((beforeMatch = beforeRegex.exec(beforeComment)) !== null) {
          const raw = beforeMatch[0];
          const tokenFrom = from + beforeMatch.index;
          const tokenTo = tokenFrom + raw.length;
          pushToken(tokenFrom, tokenTo, raw);
        }

      const beforeDigitRegex = /\b\d+\b/g;
      let beforeDigitMatch;
      while ((beforeDigitMatch = beforeDigitRegex.exec(beforeComment)) !== null) {
        const raw = beforeDigitMatch[0];
        const tokenFrom = from + beforeDigitMatch.index;
        const tokenTo = tokenFrom + raw.length;
        pushToken(tokenFrom, tokenTo, raw);
      }
      }
      const newlineIndex = text.indexOf('\n', commentIndex);
      if (newlineIndex === -1) {
        return;
      }
      const afterComment = text.slice(newlineIndex + 1);
      const trimmed = afterComment.replace(/^\s+/, '');
      const offset = afterComment.length - trimmed.length;
      const trimmedFrom = from + newlineIndex + 1 + offset;
      if (trimmed.trim()) {
        pushToken(trimmedFrom, trimmedFrom + trimmed.length, trimmed);
      const afterRegex = /"[^"]*"|'[^']*'|[A-Za-z0-9_#:+-]+/g;
      let afterMatch;
      while ((afterMatch = afterRegex.exec(trimmed)) !== null) {
          const raw = afterMatch[0];
          const tokenFrom = trimmedFrom + afterMatch.index;
          const tokenTo = tokenFrom + raw.length;
          pushToken(tokenFrom, tokenTo, raw);
        }

      const afterDigitRegex = /\b\d+\b/g;
      let afterDigitMatch;
      while ((afterDigitMatch = afterDigitRegex.exec(trimmed)) !== null) {
        const raw = afterDigitMatch[0];
        const tokenFrom = trimmedFrom + afterDigitMatch.index;
        const tokenTo = tokenFrom + raw.length;
        pushToken(tokenFrom, tokenTo, raw);
      }
      }
      return;
    }
    pushToken(from, to, text);

    const localText = text || '';
    const tokenRegex = /"[^"]*"|'[^']*'|[A-Za-z0-9_#:+-]+/g;
    let match;
    while ((match = tokenRegex.exec(localText)) !== null) {
      const raw = match[0];
      const tokenFrom = from + match.index;
      const tokenTo = tokenFrom + raw.length;
      pushToken(tokenFrom, tokenTo, raw);
    }

    const digitRegex = /\b\d+\b/g;
    let digitMatch;
    while ((digitMatch = digitRegex.exec(localText)) !== null) {
      const raw = digitMatch[0];
      const tokenFrom = from + digitMatch.index;
      const tokenTo = tokenFrom + raw.length;
      pushToken(tokenFrom, tokenTo, raw);
    }
    });

  tokenEntries.sort((a, b) => a.length - b.length);
  const numericTokenEntries = tokenEntries
    .filter((entry) => /^[0-9]+$/.test(entry.normalized))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  const takeNextNumericToken = () => {
    while (numericTokenEntries.length > 0) {
      const entry = numericTokenEntries.shift();
      if (entry && !entry.used) {
        entry.used = true;
        return entry;
      }
    }
    return null;
  };

    const metrics = this.currentTimeSignatureMetrics || getTimeSignatureMetrics(this.currentTimeSignature || '4/4');

    let punchcardData;
    try {
      punchcardData = await this.computeMasterPunchcardData(patternCode, metrics);
    } catch (error) {
      console.warn('⚠️ Could not compute master punchcard data for highlighting:', error);
      return null;
    }

    const events = Array.isArray(punchcardData?.events) ? punchcardData.events : [];
    if (typeof window !== 'undefined') {
      window.__lastHighlightEvents = events;
      window.__lastHighlightTokens = tokenEntries.slice();
    }

    const labelBuckets = new Map();
    const addEntryToBucket = (key, entry) => {
      if (!key) return;
      if (!labelBuckets.has(key)) {
        labelBuckets.set(key, []);
      }
      labelBuckets.get(key).push(entry);
    };

    tokenEntries.forEach((entry) => {
      if (!entry.normalized) {
        return;
      }
      addEntryToBucket(entry.normalized, entry);

      // Split on whitespace and punctuation to allow matching individual tokens
      entry.normalized.split(/[\s,;:()[\]{}<>]+/).forEach((part) => {
        const token = part.trim();
        if (token && token.length <= entry.normalized.length) {
          addEntryToBucket(token, entry);
        }
      });
    });

    const meaningfulEvents = events.filter((event) => {
      if (!event || typeof event !== 'object') {
        return false;
      }
      const label = typeof event.label === 'string' ? event.label.trim() : '';
      const meta = event.meta || {};
      const metaNote = meta.note != null ? String(meta.note).trim() : '';
      const metaSound = meta.sound != null ? String(meta.sound).trim() : '';
      const metaSample = meta.sample != null ? String(meta.sample).trim() : '';
      const metaInstrument = meta.instrument != null ? String(meta.instrument).trim() : '';
      const metaRaw = meta.rawString != null ? String(meta.rawString).trim() : '';
      return (
        label ||
        metaNote ||
        metaSound ||
        metaSample ||
        metaInstrument ||
        metaRaw
      );
    });

    if (!meaningfulEvents.length) {
      return {
        events: [],
        patternLength: patternCode.length
      };
    }

    const eventsWithIndex = meaningfulEvents
      .map((event, idx) => ({ event, idx }))
      .sort((a, b) => {
        const aBegin = Number.isFinite(a.event?.begin) ? a.event.begin : 0;
        const bBegin = Number.isFinite(b.event?.begin) ? b.event.begin : 0;
        if (aBegin !== bBegin) {
          return aBegin - bBegin;
        }
        const aEnd = Number.isFinite(a.event?.end) ? a.event.end : aBegin;
        const bEnd = Number.isFinite(b.event?.end) ? b.event.end : bBegin;
        return aEnd - bEnd;
      });

    const assignedEvents = eventsWithIndex.map(({ event }) => {
      const labelCandidates = new Set();
      const addCandidate = (value) => {
        if (typeof value === 'number') {
          labelCandidates.add(String(value));
        } else if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed) {
      const lower = trimmed.toLowerCase();
      labelCandidates.add(lower);
      labelCandidates.add(trimmed.replace(/['"]/g, '').trim().toLowerCase());
      if (/^\d+$/.test(trimmed)) {
        labelCandidates.add(trimmed);
      }
            trimmed.split(/[:/\\\s]+/).forEach(part => {
              const p = part.trim().toLowerCase();
              if (p) {
                labelCandidates.add(p);
              }
            });
          }
        } else if (Array.isArray(value)) {
          value.forEach(item => addCandidate(item));
        }
      };

      addCandidate(event?.label);
      addCandidate(event?.meta?.label);
      addCandidate(event?.meta?.sound);
      addCandidate(event?.meta?.sample);
      addCandidate(event?.meta?.instrument);
      addCandidate(event?.meta?.source);
      addCandidate(event?.meta?.rawString);
      addCandidate(event?.meta?.note);

      const normalizedLabel = Array.from(labelCandidates).find(Boolean) || '';
      let location = null;

      if (normalizedLabel) {
        for (const candidate of labelCandidates) {
          if (!candidate) continue;
          const bucket = labelBuckets.get(candidate);
          if (!bucket || bucket.length === 0) continue;
          let next = null;
          let index = 0;
          while (index < bucket.length) {
            const entry = bucket[index];
            index += 1;
            if (entry && !entry.used) {
              next = entry;
              break;
            }
          }
          if (next) {
            location = next;
            location.used = true;
            break;
          }
        }
      }

      if (!location) {
        location = takeNextNumericToken();
      }

      if (!location) {
        const fallback = tokenEntries.find(entry => !entry.used);
        if (fallback) {
          fallback.used = true;
          location = fallback;
        }
      }

      const begin = Number.isFinite(event?.begin) ? (Number(event.begin) % 1 + 1) % 1 : 0;
      const duration = Number.isFinite(event?.duration) ? Math.abs(Number(event.duration)) : null;
      let end;
      if (duration !== null && duration >= (1 / (metrics.totalSteps || 16))) {
        end = (begin + duration) % 1;
      } else {
        end = Number.isFinite(event?.end) ? (Number(event.end) % 1 + 1) % 1 : begin;
      }

      return {
        begin,
        end,
        label: event?.label ?? '',
        from: location ? location.from : 0,
        to: location ? location.to : patternCode.length
      };
    });

    assignedEvents.sort((a, b) => {
      if (a.begin !== b.begin) return a.begin - b.begin;
      return a.from - b.from;
    });

    const numericTokensOrdered = tokenEntries
      .filter((entry) => /^[0-9]+$/.test(entry.normalized))
      .sort((a, b) => a.from - b.from || a.to - b.to);

    if (numericTokensOrdered.length) {
      assignedEvents.forEach((event, idx) => {
        const token = numericTokensOrdered[idx % numericTokensOrdered.length];
        if (token) {
          event.from = token.from;
          event.to = token.to;
        }
      });
    }

    if (!assignedEvents.length && numericTokensOrdered.length) {
      const fallbackEvents = numericTokensOrdered.map((token, index) => {
        const begin = index / Math.max(numericTokensOrdered.length, 1);
        const end = Math.max(begin + 1e-6, (index + 1) / Math.max(numericTokensOrdered.length, 1));
        return {
          begin,
          end,
          label: '',
          from: token.from,
          to: token.to
        };
      });

      return {
        events: fallbackEvents,
        patternLength: patternCode.length
      };
    }
  }

  async updateMasterPatternHighlights() {
    const pattern = soundManager.getMasterPatternCode();
    if (!pattern || pattern.trim() === '') {
      this.masterHighlightData = null;
      setStrudelEditorHighlights('master-pattern', []);
      this.currentMasterHighlightKey = null;
      return;
    }

    try {
      const highlightData = await this.computeMasterHighlightData(pattern);
      this.masterHighlightData = highlightData;
      if (!highlightData || !Array.isArray(highlightData.events) || highlightData.events.length === 0) {
        setStrudelEditorHighlights('master-pattern', []);
        this.currentMasterHighlightKey = null;
      } else if (!soundManager.isMasterActive()) {
        setStrudelEditorHighlights('master-pattern', []);
        this.currentMasterHighlightKey = null;
      } else {
        this.updateMasterHighlightForCurrentPlayback();
      }
    } catch (error) {
      console.warn('⚠️ Unable to update master pattern highlights:', error);
      this.masterHighlightData = null;
      setStrudelEditorHighlights('master-pattern', []);
      this.currentMasterHighlightKey = null;
    }
  }

  startMasterHighlightLoop() {
    if (this.masterHighlightRaf != null) {
      return;
    }
    const tick = () => {
      this.masterHighlightRaf = requestAnimationFrame(tick);
      this.updateMasterHighlightForCurrentPlayback();
    };
    this.masterHighlightRaf = requestAnimationFrame(tick);
  }

  stopMasterHighlightLoop() {
    if (this.masterHighlightRaf != null) {
      cancelAnimationFrame(this.masterHighlightRaf);
      this.masterHighlightRaf = null;
    }
    this.currentMasterHighlightKey = null;
    setStrudelEditorHighlights('master-pattern', []);
  }

  updateMasterHighlightForCurrentPlayback() {
    const highlightData = this.masterHighlightData;
    if (!highlightData || !Array.isArray(highlightData.events) || highlightData.events.length === 0) {
      if (this.currentMasterHighlightKey !== null) {
        this.currentMasterHighlightKey = null;
        setStrudelEditorHighlights('master-pattern', []);
      }
      return;
    }

    const playbackInfo = soundManager.getMasterPlaybackInfo ? soundManager.getMasterPlaybackInfo() : null;
    if (
      !playbackInfo ||
      !playbackInfo.isPlaying ||
      !playbackInfo.startTime ||
      !Number.isFinite(playbackInfo.speed) ||
      playbackInfo.speed <= 0 ||
      !Number.isFinite(playbackInfo.tempo) ||
      playbackInfo.tempo <= 0
    ) {
      if (this.currentMasterHighlightKey !== null) {
        this.currentMasterHighlightKey = null;
        setStrudelEditorHighlights('master-pattern', []);
      }
      return;
    }

    const editor = getStrudelEditor('master-pattern');
    if (!editor) {
      return;
    }

    const audioContext = soundManager.audioContext;
    const nowSeconds = audioContext ? audioContext.currentTime : performance.now() / 1000;
    const elapsed = nowSeconds - playbackInfo.startTime;
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      return;
    }

    const phase = ((elapsed * playbackInfo.speed) % 1 + 1) % 1;

    const activeEvents = highlightData.events.filter((event) => {
      const begin = Number.isFinite(event.begin) ? ((event.begin % 1) + 1) % 1 : 0;
      const endRaw = Number.isFinite(event.end) ? event.end : event.begin;
      let end = ((endRaw % 1) + 1) % 1;

      if (end === begin) {
        return Math.abs(phase - begin) < 1e-2;
      }

      if (end > begin) {
        return phase >= begin && phase < end;
      }

      // Wrap-around event
      return phase >= begin || phase < end;
    });

    const ranges = activeEvents.map((event) => {
      const from = Math.max(0, Math.min(highlightData.patternLength, event.from));
      const to = Math.max(from, Math.min(highlightData.patternLength, event.to));
      return { from, to };
    });

    const key = JSON.stringify(ranges);
    if (key !== this.currentMasterHighlightKey) {
      setStrudelEditorHighlights('master-pattern', ranges);
      this.currentMasterHighlightKey = key;
    }
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
    
    // Initialize filter dropdowns
    this.setupFilterDropdowns(element, elementId);
    
    // Initialize effects dropdowns
    this.setupEffectsDropdowns(element, elementId);
    
    // Initialize synthesis dropdowns
    this.setupSynthesisDropdowns(element, elementId);
  }
  
  /**
   * Setup filter collapsible rows (HPF, LPF, BPF)
   */
  setupFilterDropdowns(element, elementId) {
    const filtersContent = element.querySelector('.filters-content');
    if (!filtersContent) return;
    
    // Clear any existing content (remove old hardcoded HTML)
    filtersContent.innerHTML = '';
    
    // Define filter types
    const filterTypes = [
      { key: 'hpf', label: 'HPF', params: [
        { key: 'hpf', label: 'Frequency', unit: 'Hz' },
        { key: 'hpq', label: 'HPQ', unit: '' }
      ]},
      { key: 'lpf', label: 'LPF', params: [
        { key: 'lpf', label: 'Frequency', unit: 'Hz' },
        { key: 'lpq', label: 'LPQ', unit: '' }
      ]},
      { key: 'bpf', label: 'BPF', params: [
        { key: 'bpf', label: 'Frequency', unit: 'Hz' },
        { key: 'bpq', label: 'Q', unit: '' }
      ]}
    ];
    
    // Create collapsible rows for each filter type
    filterTypes.forEach((filterType, index) => {
      const container = document.createElement('div');
      container.className = 'filter-collapsible-row';
      
      // Map filter types to their color classes
      const filterColorClasses = {
        'hpf': 'snippet-group-filters-hp',
        'lpf': 'snippet-group-filters-lp',
        'bpf': 'snippet-group-filters-bp'
      };
      
      const colorClass = filterColorClasses[filterType.key] || '';
      
      container.innerHTML = `
        <button class="filter-toggle ${colorClass}" data-filter-key="${filterType.key}">
          <span class="toggle-icon">▶</span> ${filterType.label}
        </button>
        <div class="filter-sliders-container" style="display: none;">
          <!-- Sliders will be added here -->
        </div>
      `;
      filtersContent.appendChild(container);
      
      const toggleBtn = container.querySelector('.filter-toggle');
      const slidersContainer = container.querySelector('.filter-sliders-container');
      
      // Setup toggle handler
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleBtn.classList.toggle('active');
        const isActive = toggleBtn.classList.contains('active');
        slidersContainer.style.display = isActive ? 'block' : 'none';
        
        // Update toggle icon
        const icon = toggleBtn.querySelector('.toggle-icon');
        icon.textContent = isActive ? '▼' : '▶';
        
        // Create sliders if not already created
        if (isActive && slidersContainer.children.length === 0) {
          filterType.params.forEach((param) => {
            const paramConfig = NUMERIC_TAG_PARAMS[param.key];
            if (!paramConfig) return;
            
            // Format default value display
            let defaultDisplay = paramConfig.default.toString();
            if (param.key === 'bpg' && param.unit === 'dB') {
              const sign = paramConfig.default >= 0 ? '+' : '';
              defaultDisplay = `${sign}${paramConfig.default.toFixed(1)} dB`;
            } else if (param.unit) {
              defaultDisplay = `${paramConfig.default}${param.unit ? ' ' + param.unit : ''}`;
            }
            
            const sliderRow = document.createElement('div');
            sliderRow.className = 'slider-row';
            sliderRow.innerHTML = `
              <div class="slider-label-row">
                <label>${param.label}</label>
                <span class="slider-value">${defaultDisplay}</span>
              </div>
              <input type="range" class="filter-slider" data-filter-type="${filterType.key}" data-param-key="${param.key}" 
                     min="${paramConfig.min}" max="${paramConfig.max}" step="${paramConfig.step}" 
                     value="${paramConfig.default}" />
            `;
            slidersContainer.appendChild(sliderRow);
            
            // Setup slider listener
            const slider = sliderRow.querySelector('.filter-slider');
            if (slider && !slider.dataset.hasListener) {
              slider.dataset.hasListener = 'true';
              slider.addEventListener('input', async (e) => {
                const value = parseFloat(e.target.value);
                const display = sliderRow.querySelector('.slider-value');
                if (display) {
                  if (param.key.includes('f')) {
                    display.textContent = Math.round(value) + ' Hz';
                  } else if (param.key === 'bpg' && param.unit === 'dB') {
                    // Show dB with +/- sign
                    const sign = value >= 0 ? '+' : '';
                    display.textContent = `${sign}${value.toFixed(1)} dB`;
                  } else {
                    display.textContent = value.toFixed(1) + (param.unit ? ' ' + param.unit : '');
                  }
                }
                await this.updateElementFilters(elementId);
              });
            }
          });
        }
      });
    });
  }
  
  /**
   * Setup effects collapsible rows dynamically
   */
  setupEffectsDropdowns(element, elementId) {
    const effectsContent = element.querySelector('.effects-content');
    if (!effectsContent) return;
    
    // Clear any existing content (remove old hardcoded HTML)
    effectsContent.innerHTML = '';
    
    // Define available effects with their sub-parameters
    const availableEffects = [
      { 
        key: 'delay', 
        label: 'Delay',
        params: [
          { key: 'delaytime', label: 'Delay Time' },
          { key: 'delayfeedback', label: 'Delay Feedback' }
        ]
      },
      { 
        key: 'room', 
        label: 'Reverb',
        params: [
          { key: 'roomsize', label: 'Room Size' }
        ]
      },
      { 
        key: 'phaser', 
        label: 'Phaser',
        params: [
          { key: 'phaserdepth', label: 'Depth' },
          { key: 'phasercenter', label: 'Center' },
          { key: 'phasersweep', label: 'Sweep' }
        ]
      },
      { 
        key: 'tremolo', 
        label: 'Tremolo',
        params: [
          { key: 'tremolodepth', label: 'Depth' },
          { key: 'tremoloskew', label: 'Skew' },
          { key: 'tremolophase', label: 'Phase' }
        ]
      }
    ];
    
    // Create collapsible rows for each effect
    availableEffects.forEach((effect) => {
      const container = document.createElement('div');
      container.className = 'effect-collapsible-row';
      
      // Map effect types to their color classes
      const effectColorClasses = {
        'delay': 'snippet-group-delay',
        'room': 'snippet-group-reverb',
        'phaser': 'snippet-group-phaser',
        'tremolo': 'snippet-group-amplitude-modulation'
      };
      
      const colorClass = effectColorClasses[effect.key] || '';
      
      container.innerHTML = `
        <button class="effect-toggle ${colorClass}" data-effect-key="${effect.key}">
          <span class="toggle-icon">▶</span> ${effect.label}
        </button>
        <div class="effect-sliders-container" style="display: none;">
          <!-- Sliders will be added here -->
        </div>
      `;
      effectsContent.appendChild(container);
      
      const toggleBtn = container.querySelector('.effect-toggle');
      const slidersContainer = container.querySelector('.effect-sliders-container');
      
      // Setup toggle handler
      toggleBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        toggleBtn.classList.toggle('active');
        const isActive = toggleBtn.classList.contains('active');
        slidersContainer.style.display = isActive ? 'block' : 'none';
        
        // Update toggle icon
        const icon = toggleBtn.querySelector('.toggle-icon');
        icon.textContent = isActive ? '▼' : '▶';
        
        // Create sliders if not already created
        if (isActive && slidersContainer.children.length === 0) {
          effect.params.forEach((param) => {
            const paramConfig = NUMERIC_TAG_PARAMS[param.key];
            if (!paramConfig) return;
            
            const sliderRow = document.createElement('div');
            sliderRow.className = 'slider-row';
            sliderRow.innerHTML = `
              <div class="slider-label-row">
                <label>${param.label}</label>
                <span class="slider-value">${paramConfig.default.toFixed(2)}${paramConfig.unit ? ' ' + paramConfig.unit : ''}</span>
              </div>
              <input type="range" class="effect-slider" data-effect-key="${param.key}" 
                     min="${paramConfig.min}" max="${paramConfig.max}" step="${paramConfig.step}" 
                     value="${paramConfig.default}" />
            `;
            slidersContainer.appendChild(sliderRow);
            
            // Setup slider listener
            const slider = sliderRow.querySelector('.effect-slider');
            if (slider && !slider.dataset.hasListener) {
              slider.dataset.hasListener = 'true';
              slider.addEventListener('input', async (e) => {
                const value = parseFloat(e.target.value);
                const display = sliderRow.querySelector('.slider-value');
                if (display) {
                  display.textContent = value.toFixed(2) + (paramConfig.unit ? ' ' + paramConfig.unit : '');
                }
                await this.updateElementEffects(elementId);
              });
            }
          });
        }
        
        await this.updateElementEffects(elementId);
      });
    });
  }
  
  /**
   * Setup synthesis ADSR sliders (always visible, vertical)
   */
  setupSynthesisDropdowns(element, elementId) {
    const synthesisContent = element.querySelector('.synthesis-content');
    if (!synthesisContent) return;
    
    // Clear any existing content (remove old hardcoded HTML)
    synthesisContent.innerHTML = '';
    
    // Create ADSR sliders container - always visible
    const container = document.createElement('div');
    container.className = 'synthesis-sliders-container';
    
    // Define ADSR parameters
    const adsrParams = [
      { key: 'attack', label: 'Attack', min: 0, max: 2, step: 0.01, default: 0.01, unit: 's' },
      { key: 'decay', label: 'Decay', min: 0, max: 2, step: 0.01, default: 0.1, unit: 's' },
      { key: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
      { key: 'release', label: 'Release', min: 0, max: 5, step: 0.01, default: 0.1, unit: 's' }
    ];
    
    adsrParams.forEach((param) => {
      const sliderRow = document.createElement('div');
      sliderRow.className = 'slider-row';
      sliderRow.innerHTML = `
        <div class="slider-label-row">
          <label>${param.label}</label>
          <span class="slider-value">${param.default.toFixed(2)}${param.unit ? ' ' + param.unit : ''}</span>
        </div>
        <input type="range" class="synth-slider ${param.key}-slider" 
               min="${param.min}" max="${param.max}" step="${param.step}" 
               value="${param.default}" />
      `;
      container.appendChild(sliderRow);
      
      // Setup slider listener
      const slider = sliderRow.querySelector('.synth-slider');
      if (slider && !slider.dataset.hasListener) {
        slider.dataset.hasListener = 'true';
        slider.addEventListener('input', async (e) => {
          const value = parseFloat(e.target.value);
          const display = sliderRow.querySelector('.slider-value');
          if (display) {
            display.textContent = value.toFixed(2) + (param.unit ? ' ' + param.unit : '');
          }
          await this.updateElementSynthesis(elementId);
        });
      }
    });
    
    synthesisContent.appendChild(container);
  }
  
  /**
   * Update element effects in the pattern
   */
  async updateElementEffects(elementId) {
    const element = document.querySelector(`[data-sound-id="${elementId}"]`);
    if (!element) return;
    
    // Get effect values from collapsible rows
    const effectRows = element.querySelectorAll('.effect-collapsible-row');
    const effects = {};
    
    effectRows.forEach(row => {
      const toggleBtn = row.querySelector('.effect-toggle');
      const isActive = toggleBtn.classList.contains('active');
      const sliders = row.querySelectorAll('.effect-slider');
      
      if (isActive && sliders.length > 0) {
        // Get all parameter values for this effect
        sliders.forEach(slider => {
          const effectKey = slider.dataset.effectKey;
          if (effectKey) {
            effects[effectKey] = parseFloat(slider.value);
          }
        });
      }
    });
    
    // Store effect values for later use when updating patterns
    if (!this.elementEffects) {
      this.elementEffects = {};
    }
    
    this.elementEffects[elementId] = effects;
    
    console.log(`🎛️ Effects updated for ${elementId}:`, this.elementEffects[elementId]);
    
    // Debounce apply to avoid rapid re-evaluation clicks while dragging
    this._effectsApplyTimers = this._effectsApplyTimers || new Map();
    if (this._effectsApplyTimers.has(elementId)) {
      clearTimeout(this._effectsApplyTimers.get(elementId));
    }
    const timer = setTimeout(() => {
      this.applyEffectsAndFiltersToPattern(elementId);
      this._effectsApplyTimers.delete(elementId);
    }, 150);
    this._effectsApplyTimers.set(elementId, timer);
  }
  
  /**
   * Update element filters in the pattern
   */
  async updateElementFilters(elementId) {
    const element = document.querySelector(`[data-sound-id="${elementId}"]`);
    if (!element) return;
    
    // Get filter values from collapsible rows
    const filterRows = element.querySelectorAll('.filter-collapsible-row');
    const filters = {};
    
    filterRows.forEach(row => {
      const toggleBtn = row.querySelector('.filter-toggle');
      const isActive = toggleBtn.classList.contains('active');
      const sliders = row.querySelectorAll('.filter-slider');
      
      if (isActive && sliders.length > 0) {
        // Get all parameter values for this filter type
        sliders.forEach(slider => {
          const paramKey = slider.dataset.paramKey;
          if (paramKey) {
            filters[paramKey] = parseFloat(slider.value);
          }
        });
      }
    });
    
    // Store filter values for later use when updating patterns
    if (!this.elementFilters) {
      this.elementFilters = {};
    }
    
    this.elementFilters[elementId] = filters;
    
    console.log(`🔊 Filters updated for ${elementId}:`, this.elementFilters[elementId]);
    
    // Debounce apply to avoid rapid re-evaluation clicks while dragging
    this._filtersApplyTimers = this._filtersApplyTimers || new Map();
    if (this._filtersApplyTimers.has(elementId)) {
      clearTimeout(this._filtersApplyTimers.get(elementId));
    }
    const timer = setTimeout(() => {
      this.applyEffectsAndFiltersToPattern(elementId);
      this._filtersApplyTimers.delete(elementId);
    }, 150);
    this._filtersApplyTimers.set(elementId, timer);
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
    
    // Debounce apply to avoid rapid re-evaluation clicks while dragging
    this._synthApplyTimers = this._synthApplyTimers || new Map();
    if (this._synthApplyTimers.has(elementId)) {
      clearTimeout(this._synthApplyTimers.get(elementId));
    }
    const timer = setTimeout(() => {
      this.applyEffectsAndFiltersToPattern(elementId);
      this._synthApplyTimers.delete(elementId);
    }, 150);
    this._synthApplyTimers.set(elementId, timer);
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
    if (effects.delaytime !== undefined) {
      modifiers.push(`.delay(${effects.delaytime.toFixed(2)})`);
    }
    if (effects.delayfeedback !== undefined) {
      modifiers.push(`.delayfeedback(${effects.delayfeedback.toFixed(2)})`);
    }
    if (effects.roomsize !== undefined) {
      modifiers.push(`.room(${effects.roomsize.toFixed(2)})`);
    }
    // Phaser effect - apply all parameters
    if (effects.phaserdepth !== undefined) {
      modifiers.push(`.phaser(${effects.phaserdepth.toFixed(2)})`);
    }
    if (effects.phasercenter !== undefined) {
      modifiers.push(`.phasercenter(${effects.phasercenter.toFixed(2)})`);
    }
    if (effects.phasersweep !== undefined) {
      modifiers.push(`.phasersweep(${effects.phasersweep.toFixed(2)})`);
    }
    
    // Tremolo effect - apply all parameters
    if (effects.tremolodepth !== undefined) {
      modifiers.push(`.tremolo(${effects.tremolodepth.toFixed(2)})`);
    }
    if (effects.tremoloskew !== undefined) {
      modifiers.push(`.tremoloskew(${effects.tremoloskew.toFixed(2)})`);
    }
    if (effects.tremolophase !== undefined) {
      modifiers.push(`.tremolophase(${effects.tremolophase.toFixed(2)})`);
    }
    
    // Add filters
    if (filters.lpf !== undefined && filters.lpf < 20000) {
      modifiers.push(`.lpf(${Math.round(filters.lpf)})`);
    }
    if (filters.hpf !== undefined && filters.hpf > 20) {
      modifiers.push(`.hpf(${Math.round(filters.hpf)})`);
    }
    if (filters.bpf !== undefined) {
      modifiers.push(`.bpf(${Math.round(filters.bpf)})`);
    }
    if (filters.bpq !== undefined && filters.bpq > 0) {
      modifiers.push(`.bpq(${filters.bpq.toFixed(1)})`);
    }
    
    if (filters.lpq !== undefined && filters.lpq > 0) {
      modifiers.push(`.lpq(${filters.lpq.toFixed(1)})`);
    }
    if (filters.hpq !== undefined && filters.hpq > 0) {
      modifiers.push(`.hpq(${filters.hpq.toFixed(1)})`);
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
    
    // Do not auto-restart playback while adjusting sliders.
    // Update stored pattern and master display only; playback changes apply on next manual play.
    if (isInMaster) {
      // Update the tracked pattern without forcing scheduler start
      await soundManager.updatePatternInPlace(elementId, finalPattern, /*preventAutoPlay*/ true);
      this.updateMasterPatternDisplay();
    } else {
      // If currently playing, avoid stop/restart; changes will reflect on next trigger
      const isPlaying = soundManager.isPlaying(elementId);
      if (!isPlaying) {
        // Not playing: don't auto-start. Just cache new pattern.
        await soundManager.cachePatternForElement(elementId, finalPattern);
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
    const canonicalPattern = replaceSynthAliases(pattern);
    const isSynthPattern = patternContainsKnownSynth(canonicalPattern);
    
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
    
    // Do not trigger individual element sound; only Master and Preview may start audio.
    // Keep UI non-playing; simply reflect focus/selection.
    uiController.setElementState(element, 'focus');
    this.updateStatusDots(elementId, this.elementHasPattern(elementId), false);
    uiController.updateStatus('Ready');
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
    // Check trackedPatterns (elements in master) instead of just activeElements
    const slotsInfo = document.getElementById('slots-info');
    if (slotsInfo) {
      // Get elements that are tracked in master pattern (have patterns saved)
      const trackedElementIds = soundManager.trackedPatterns ? Array.from(soundManager.trackedPatterns.keys()) : [];
      
      // Combine active elements and tracked elements (elements can be active without being in master, or in master without being active)
      const allRelevantElements = new Set([...this.activeElements, ...trackedElementIds]);
      
      if (allRelevantElements.size === 0) {
        slotsInfo.textContent = 'None active';
      } else {
        const slotsData = Array.from(allRelevantElements).map(id => {
          const slot = soundManager.strudelPatternSlots?.get(id);
          const isTracked = soundManager.trackedPatterns?.has(id);
          const isActive = this.activeElements.has(id);
          
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
          // Show status: (A)ctive, (M)aster, or both
          let statusIndicator = '';
          if (isActive && isTracked) {
            statusIndicator = ' (A+M)';
          } else if (isActive) {
            statusIndicator = ' (A)';
          } else if (isTracked) {
            statusIndicator = ' (M)';
          }
          
          const slotDisplay = slot ? `${id}→${slot}${statusIndicator}` : `${id}${statusIndicator}`;
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
   * Convert numeric pattern (n("0 2 4 5")) to note names (note("c4 e4 g4 a4")) based on key/scale
   */
  convertNumericPatternToNoteNames(pattern, key, scale) {
    if (!pattern || !scale) return pattern;
    
    // Helpers for enharmonic normalization
    const isFlatKey = (k) => typeof k === 'string' && /[b]/i.test(k);
    
    const DOUBLE_ACCIDENTAL_MAP = new Map([
      // Double flats
      ['Abb', 'G'], ['Bbb', 'A'], ['Cbb', 'Bb'], ['Dbb', 'C'], ['Ebb', 'D'], ['Fbb', 'Eb'], ['Gbb', 'F'],
      // Double sharps (rare in output, but normalize anyway)
      ['A##', 'B'], ['B##', 'C#'], ['C##', 'D'], ['D##', 'E'], ['E##', 'F#'], ['F##', 'G'], ['G##', 'A'],
      // Single flats to naturals where musically typical
      ['Fb', 'E'], ['Cb', 'B'],
      // Single sharps to naturals where musically typical
      ['E#', 'F'], ['B#', 'C']
    ]);
    
    const SHARP_TO_FLAT = new Map([
      ['A#', 'Bb'], ['C#', 'Db'], ['D#', 'Eb'], ['F#', 'Gb'], ['G#', 'Ab']
    ]);
    
    function normalizeSpelling(noteWithOctave, preferFlats) {
      // Split into pitch class and octave, e.g., "Ebb4" -> "Ebb", "4"
      const m = noteWithOctave.match(/^([A-Ga-g])([#b]{0,2})(-?\d+)?$/);
      if (!m) return noteWithOctave;
      const letter = m[1].toUpperCase();
      const acc = m[2] || '';
      const oct = m[3] || '';
      const pc = `${letter}${acc}`;
      
      // Resolve double accidentals and special single-accidental naturals
      if (DOUBLE_ACCIDENTAL_MAP.has(pc)) {
        const replacement = DOUBLE_ACCIDENTAL_MAP.get(pc);
        return `${replacement}${oct}`;
      }
      
      // Prefer flats for flat keys where possible
      if (preferFlats && acc === '#') {
        const sf = SHARP_TO_FLAT.get(`${letter}#`);
        if (sf) {
          return `${sf}${oct}`;
        }
      }
      
      return `${letter}${acc}${oct}`;
    }
    
    // Map scale names to Tonal.js scale names
    const SCALE_NAME_TONAL_MAP = {
      // Legacy/simple names
      major: 'major',
      minor: 'minor',
      chromatic: 'chromatic',
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
      'blues minor pentatonic': 'minor pentatonic',
      'major pentatonic mode 3': 'major pentatonic',
      egyptian: 'egyptian',
      'minor pentatonic mode 5': 'minor pentatonic',

      // Other systems
      'whole tone': 'whole tone',
      'half-whole diminished': 'dominant diminished',
      'whole-half diminished': 'diminished',
      'minor blues': 'blues'
    };
    
    const tonalScaleName = SCALE_NAME_TONAL_MAP[scale] || scale;
    
    // Normalize key root
    let rootNote = 'C';
    if (key) {
      const match = key.trim().match(/^([a-gA-G])([#b]?)/);
      if (match) {
        rootNote = `${match[1].toUpperCase()}${match[2] || ''}`;
      } else {
        rootNote = key.trim();
      }
    }
    
    const scaleName = `${rootNote} ${tonalScaleName}`;
    
    // Get scale notes using Tonal.js
    const scaleObj = Scale.get(scaleName);
    if (!scaleObj || !scaleObj.notes || scaleObj.notes.length === 0) {
      console.warn(`⚠️ Could not get scale notes for "${scaleName}"`);
      return pattern;
    }
    
    const preferFlats = isFlatKey(rootNote);
    const scaleNotes = scaleObj.notes.map(n => normalizeSpelling(`${n}`, preferFlats).replace(/-?\d+$/, '')); // strip any octave if present
    console.log(`🎼 Scale "${scaleName}" notes:`, scaleNotes);
    
    // Extract numeric pattern from n("0 2 4 5") or note("0 2 4 5")
    const numericPatternRegex = /\b(n|note)\s*\(\s*(["'])([^"']+)\2\s*\)/g;
    
    return pattern.replace(numericPatternRegex, (match, funcName, quote, content) => {
      // Split content by spaces and other separators, preserving them
      const separatorRegex = /(\s+|[,;:<>()[\]{}|\\/]+|\*+)/g;
      const parts = [];
      let lastIndex = 0;
      let sepMatch;
      
      // Split while preserving separators
      while ((sepMatch = separatorRegex.exec(content)) !== null) {
        if (sepMatch.index > lastIndex) {
          parts.push({ type: 'number', value: content.substring(lastIndex, sepMatch.index) });
        }
        parts.push({ type: 'separator', value: sepMatch[0] });
        lastIndex = sepMatch.index + sepMatch[0].length;
      }
      if (lastIndex < content.length) {
        parts.push({ type: 'number', value: content.substring(lastIndex) });
      }
      
      const noteNames = [];
      for (const part of parts) {
        if (part.type === 'separator') {
          noteNames.push(part.value);
        } else {
          // Try to parse as number (scale degree)
          const scaleDegree = parseInt(part.value.trim(), 10);
          if (!isNaN(scaleDegree) && scaleDegree >= 0) {
            // Map scale degree to note name (0 = root, 1 = second, etc.)
            const noteIndex = scaleDegree % scaleNotes.length;
            const octaveOffset = Math.floor(scaleDegree / scaleNotes.length);
            const noteName = scaleNotes[noteIndex];
            
            // Add octave (default to octave 4, adjust based on offset)
            const baseOctave = 4;
            const finalOctave = baseOctave + octaveOffset;
            noteNames.push(normalizeSpelling(`${noteName}${finalOctave}`, preferFlats));
          } else {
            // Not a number, preserve as-is
            noteNames.push(part.value);
          }
        }
      }
      
      // Convert back to note() call
      return `note(${quote}${noteNames.join('')}${quote})`;
    });
  }

  /**
   * Get all scale notes as a pattern string n("0 1 2 3 4 5 6...")
   */
  getAllScaleNotesAsPattern(key, scale) {
    if (!scale) return '';
    
    // Map scale names to Tonal.js scale names (extended)
    const SCALE_NAME_TONAL_MAP = {
      // Legacy/simple
      major: 'major',
      minor: 'minor',
      chromatic: 'chromatic',
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
      // Diatonic modes
      ionian: 'major',
      aeolian: 'minor',
      // Melodic minor modes
      'dorian b2': 'dorian b2',
      'lydian augmented': 'lydian augmented',
      'lydian dominant': 'lydian dominant',
      'mixolydian b6': 'mixolydian b6',
      'locrian #2': 'locrian #2',
      altered: 'altered',
      // Harmonic minor modes
      'harmonic minor': 'harmonic minor',
      'locrian #6': 'locrian #6',
      'ionian #5': 'ionian #5',
      'dorian #4': 'dorian #4',
      'phrygian dominant': 'phrygian dominant',
      'lydian #2': 'lydian #2',
      ultralocrian: 'ultralocrian',
      // Harmonic major modes
      'harmonic major': 'harmonic major',
      'dorian b5': 'dorian b5',
      'phrygian b4': 'phrygian b4',
      'lydian b3': 'lydian b3',
      'mixolydian b2': 'mixolydian b2',
      'lydian augmented #2': 'lydian augmented #2',
      'locrian bb7': 'locrian bb7',
      // Pentatonic modes
      'major pentatonic': 'major pentatonic',
      'minor pentatonic': 'minor pentatonic',
      'suspended pentatonic': 'suspended pentatonic',
      'man gong': 'man gong',
      ritusen: 'ritusen',
      'major pentatonic mode 3': 'major pentatonic',
      'minor pentatonic mode 5': 'minor pentatonic',
      'blues minor pentatonic': 'minor pentatonic',
      // Other systems
      'whole tone': 'whole tone',
      'half-whole diminished': 'dominant diminished',
      'whole-half diminished': 'diminished',
      'minor blues': 'blues'
    };
    
    const tonalScaleName = SCALE_NAME_TONAL_MAP[scale] || scale;
    
    // Normalize key root
    let rootNote = 'C';
    if (key) {
      const match = key.trim().match(/^([a-gA-G])([#b]?)/);
      if (match) {
        rootNote = `${match[1].toUpperCase()}${match[2] || ''}`;
      } else {
        rootNote = key.trim();
      }
    }
    
    const scaleName = `${rootNote} ${tonalScaleName}`;
    
    // Get scale notes using Tonal.js
    const scaleObj = Scale.get(scaleName);
    if (!scaleObj || !scaleObj.notes || scaleObj.notes.length === 0) {
      console.warn(`⚠️ Could not get scale notes for "${scaleName}"`);
      return '';
    }
    
    const scaleNotes = scaleObj.notes;
    console.log(`🎼 Scale "${scaleName}" notes:`, scaleNotes);
    
    // Create pattern with all scale degrees (0, 1, 2, 3, ... up to scale length)
    const scaleDegrees = Array.from({ length: scaleNotes.length }, (_, i) => i);
    return `n("${scaleDegrees.join(' ')}")`;
  }

  /**
   * Get all scale notes as note names pattern note("C4 D4 E4 F4 G4 A4 B4")
   */
  getAllScaleNotesAsNoteNames(key, scale) {
    if (!scale) return '';
    
    // Map scale names to Tonal.js scale names
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
    
    const tonalScaleName = SCALE_NAME_TONAL_MAP[scale] || scale;
    
    // Normalize key root
    let rootNote = 'C';
    if (key) {
      const match = key.trim().match(/^([a-gA-G])([#b]?)/);
      if (match) {
        rootNote = `${match[1].toUpperCase()}${match[2] || ''}`;
      } else {
        rootNote = key.trim();
      }
    }
    
    const scaleName = `${rootNote} ${tonalScaleName}`;
    
    // Get scale notes using Tonal.js
    const scaleObj = Scale.get(scaleName);
    if (!scaleObj || !scaleObj.notes || scaleObj.notes.length === 0) {
      console.warn(`⚠️ Could not get scale notes for "${scaleName}"`);
      return '';
    }
    
    const scaleNotes = scaleObj.notes;
    console.log(`🎼 Scale "${scaleName}" notes:`, scaleNotes);
    
    // Create pattern with all scale notes as note names with octave 4
    const noteNames = scaleNotes.map(note => `${note}4`);
    return `note("${noteNames.join(' ')}")`;
  }

  /**
   * Reset all elements and master pattern
   */
  resetAll() {
    console.log('🔄 Resetting all elements and master pattern...');
    
    // Stop all sounds first
    soundManager.stopAllSounds();
    
    // Remove all dynamically created elements (element-5 and above)
    const allElements = document.querySelectorAll('.sound-element');
    allElements.forEach(element => {
      const elementId = element.dataset.soundId;
      if (elementId) {
        // Extract element number
        const elementNumber = parseInt(elementId.replace('element-', ''));
        
        // Remove dynamically created elements (element-5 and above)
        if (elementNumber > 4) {
          console.log(`🗑️ Removing dynamically created element: ${elementId}`);
          element.remove();
        }
      }
    });
    
    // Reset element counter to initial state
    this.elementCounter = 4;
    
    // Clear ALL localStorage (complete cache clear)
    console.log('🗑️ Clearing all localStorage...');
    localStorage.clear();
    
    // Clear master pattern by clearing all tracked patterns
    soundManager.trackedPatterns.clear();
    soundManager.updateMasterPattern();
    if (this.masterPatternField) {
      setStrudelEditorValue('master-pattern', '');
      // Restore initial placeholder text
      this.masterPatternField.placeholder = 'Combined pattern will appear here...';
    }
    
    // Reset all default elements (element-1 through element-4) to initial state
    const defaultElements = document.querySelectorAll('.sound-element');
    defaultElements.forEach(element => {
      const elementId = element.dataset.soundId;
      if (elementId) {
        // Clear element config in memory
        const elementConfig = soundConfig.getElementConfig(elementId);
        if (elementConfig) {
          elementConfig.pattern = '';
          elementConfig.description = 'No sound assigned';
          elementConfig.title = '';
          elementConfig.sampleUrl = '';
          elementConfig.bank = undefined;
          elementConfig.key = undefined;
          elementConfig.scale = undefined;
          elementConfig.keepNotesAsWritten = false;
        }
        
        // Remove from master
        soundManager.removeElementFromMaster(elementId);
        
        // Reset UI
        const titleEl = element.querySelector('.element-title');
        const configButton = element.querySelector('.config-button');
        if (titleEl) {
          // Extract element number from elementId
          const elementNumber = elementId.replace('element-', '');
          titleEl.textContent = `Element ${elementNumber}`;
        }
        if (configButton) {
          configButton.textContent = 'Configure Sound';
        }
        
        // Reset status dots
        this.updateStatusDots(elementId, false, false);
        
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
        
        // Reset sliders to defaults
        const gainSlider = element.querySelector('.gain-slider');
        const panSlider = element.querySelector('.pan-slider');
        if (gainSlider) gainSlider.value = 0.8;
        if (panSlider) panSlider.value = 0;
        
        // Clear effects, filters, and synthesis UI
        const filterRows = element.querySelectorAll('.filter-collapsible-row');
        filterRows.forEach(row => {
          const toggleBtn = row.querySelector('.filter-toggle');
          const slidersContainer = row.querySelector('.filter-sliders-container');
          if (toggleBtn) {
            toggleBtn.classList.remove('active');
            const icon = toggleBtn.querySelector('.toggle-icon');
            if (icon) icon.textContent = '▶';
          }
          if (slidersContainer) {
            slidersContainer.style.display = 'none';
            slidersContainer.innerHTML = '';
          }
        });
        
        const effectRows = element.querySelectorAll('.effect-collapsible-row');
        effectRows.forEach(row => {
          const toggleBtn = row.querySelector('.effect-toggle');
          const slidersContainer = row.querySelector('.effect-sliders-container');
          if (toggleBtn) {
            toggleBtn.classList.remove('active');
            const icon = toggleBtn.querySelector('.toggle-icon');
            if (icon) icon.textContent = '▶';
          }
          if (slidersContainer) {
            slidersContainer.style.display = 'none';
            slidersContainer.innerHTML = '';
          }
        });
        
        // Reset synthesis section
        const synthesisSection = element.querySelector('.synthesis-section');
        if (synthesisSection) {
          synthesisSection.style.display = 'none';
          const synthesisContent = synthesisSection.querySelector('.synthesis-content');
          if (synthesisContent) {
            synthesisContent.innerHTML = '';
          }
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
    
    // Reset master state
    this.masterActive = false;
    this.currentEditingElementId = null;
    
    // Reset visualizer
    this.selectedVisualizer = 'scope';
    const visualizerSelect = document.getElementById('visualizer-select');
    if (visualizerSelect) {
      visualizerSelect.value = 'scope';
    }
    
    // Clear master visualizer canvas
    if (this.masterPunchcardCanvas) {
      const ctx = this.masterPunchcardCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, this.masterPunchcardCanvas.width, this.masterPunchcardCanvas.height);
      }
    }
    
    // Update UI
    this.updateActiveElementsDisplay();
    this.updateMasterPatternDisplay();
    this.updateMasterIndicators();
    
    // Soft reset complete without reloading to avoid UI freeze
    uiController.updateStatus('✅ All cleared');
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
          config.pattern = replaceSynthAliases(config.pattern);
        }
        if (config && config.bank) {
          const normalizedBank = normalizeSynthBankName(config.bank);
          if (normalizedBank !== config.bank) {
            console.log(`🔁 Normalized synth bank from "${config.bank}" to "${normalizedBank}" for ${elementId}`);
          }
          config.bank = normalizedBank;
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
   * @param {string} elementId - Element ID
   * @param {Object} config - Config object
   * @param {boolean} skipMasterSave - If true, skip saving to master (prevents auto-playback)
   */
  saveElementConfig(elementId, config, skipMasterSave = false) {
    try {
      if (config.bank && typeof config.bank === 'string') {
        const normalizedBank = normalizeSynthBankName(config.bank);
        if (normalizedBank !== config.bank) {
          console.log(`🔁 Normalized bank selection from "${config.bank}" to "${normalizedBank}" before saving`);
          config.bank = normalizedBank;
        }
      }

      if (config.pattern && typeof config.pattern === 'string') {
        const normalizedPattern = replaceSynthAliases(config.pattern);
        if (normalizedPattern !== config.pattern) {
          console.log(`🔁 Updated pattern to use canonical synth names before saving`);
          config.pattern = normalizedPattern;
        }
      }

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
        if (config.sampleUrl && config.sampleUrl.trim() !== '') {
          elementConfig.audioFile = config.sampleUrl;
          elementConfig.type = 'audio';
        } else {
          elementConfig.audioFile = undefined;
          elementConfig.type = 'strudel';
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
        const isSynthPattern = config.pattern && patternContainsKnownSynth(config.pattern);
        
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
      
      // Do NOT stop master or scheduler on save; allow seamless live updates
      const wasMasterActive = soundManager.masterActive;
      
      // Pre-evaluation should NOT start playback - it should only cache the pattern
      if (config.pattern !== undefined) {
        soundManager.invalidatePatternCache(elementId);
        // Pre-evaluate the new pattern in background (sets to silence, doesn't play)
        // Scheduler is already stopped, so this won't trigger playback
        soundManager.preEvaluatePattern(elementId, config.pattern).catch(err => {
          console.log(`⚠️ Failed to pre-evaluate pattern for ${elementId}:`, err);
        });
      }
      
      // Save pattern to master (unless skipMasterSave is true)
      if (!skipMasterSave && config.pattern !== undefined && config.pattern.trim() !== '') {
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
          // Update master pattern with current solo/mute states without changing playback
          soundManager.updateMasterPattern(this.soloedElements, this.mutedElements);
          
          // Enforce transport: do not start playback on save if it was stopped
          if (!wasMasterActive && soundManager.masterActive) {
            if (typeof soundManager.stopMasterPattern === 'function') {
              try {
                // Call without awaiting since this function isn't async
                soundManager.stopMasterPattern();
              } catch (e) {
                console.warn('⚠️ Could not stop master after save:', e);
              }
            }
            soundManager.masterActive = false;
          }
          
          // Additional guard: if master was stopped before save, ensure scheduler is not running
          if (!wasMasterActive && window.strudel && window.strudel.scheduler && window.strudel.scheduler.started) {
            try {
              window.strudel.scheduler.stop();
            } catch (e) {
              console.warn('⚠️ Could not stop scheduler after save:', e);
            }
          }
          
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
    
    // Capture 'this' for use in nested functions
    const appInstance = this;
    
    const bankSelect = document.getElementById('modal-pattern-bank');

    const ensurePatternBankOptions = (selectedValue = bankSelect ? bankSelect.value : '') => {
      if (!bankSelect) {
        return;
      }

      const previousValue = bankSelect.value;
      const targetValue = selectedValue != null ? selectedValue : previousValue;

      // Find or create all optgroups, preserving their order
      let drumsGroup = Array.from(bankSelect.children).find(
        (child) => child.tagName === 'OPTGROUP' && child.label && child.label.toLowerCase() === 'drums'
      );
      
      let waveformsGroup = Array.from(bankSelect.children).find(
        (child) => child.tagName === 'OPTGROUP' && child.label && child.label.toLowerCase().includes('waveform')
      );
      
      let synthsGroup = Array.from(bankSelect.children).find(
        (child) => child.tagName === 'OPTGROUP' && child.label && child.label.toLowerCase().includes('synth')
      );

      // Create groups if they don't exist, in the correct order
      if (!drumsGroup) {
        drumsGroup = document.createElement('optgroup');
        drumsGroup.label = 'Drums';
        bankSelect.insertBefore(drumsGroup, bankSelect.firstChild);
      }
      
      if (!waveformsGroup) {
        waveformsGroup = document.createElement('optgroup');
        waveformsGroup.label = 'Basic Waveforms';
        // Insert after drums group
        if (drumsGroup.nextSibling) {
          bankSelect.insertBefore(waveformsGroup, drumsGroup.nextSibling);
        } else {
          bankSelect.appendChild(waveformsGroup);
        }
      }
      
      if (!synthsGroup) {
        synthsGroup = document.createElement('optgroup');
        synthsGroup.label = 'Sample-based Synths';
        // Insert after waveforms group
        if (waveformsGroup.nextSibling) {
          bankSelect.insertBefore(synthsGroup, waveformsGroup.nextSibling);
        } else {
          bankSelect.appendChild(synthsGroup);
        }
      }

      // Only rebuild the Drums group, preserve other groups
      drumsGroup.innerHTML = '';

      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'Default';
      drumsGroup.appendChild(defaultOption);

      const sortedBanks = Array.from(DRUM_BANK_VALUES).sort((a, b) =>
        getDrumBankDisplayName(a).localeCompare(getDrumBankDisplayName(b))
      );

      sortedBanks.forEach((bank) => {
        const option = document.createElement('option');
        option.value = bank;
        option.textContent = getDrumBankDisplayName(bank);
        drumsGroup.appendChild(option);
      });

      // Don't add non-drum banks to drums group - they belong in their own groups
      // The other groups are preserved from the HTML, so options stay in place

      // Set the selected value without moving it
      if (targetValue && bankSelect.querySelector(`option[value="${targetValue}"]`)) {
        bankSelect.value = targetValue;
      } else if (previousValue && bankSelect.querySelector(`option[value="${previousValue}"]`)) {
        bankSelect.value = previousValue;
      } else {
        bankSelect.value = '';
      }
    };

    ensurePatternBankOptions();
    
    const drumGridSection = document.getElementById('modal-drum-grid-section');
    const drumGridTimesigLabel = document.getElementById('modal-drum-grid-timesig');
    
    const drumGridState = {
      active: false,
      totalSteps: 0,
      built: false,
      patternEditorEnabled: false, // Step editor is default
      updatingFromPattern: false,
      updatingFromGrid: false,
      currentBankRows: null,
      checkboxes: {},
      numBars: 1, // Number of bars in the grid
      currentBar: 1 // Currently displayed bar (1-indexed)
    };

    const patternEditorSelect = document.getElementById('modal-pattern-editor-select');
    const patternLabelRow = modal.querySelector('.pattern-label-row');
    let patternSnippetContainer = modal.querySelector('.pattern-snippet-container');
    let patternSnippetListEl = patternSnippetContainer ? patternSnippetContainer.querySelector('.pattern-snippet-list') : null;
    let patternSnippetSearchInput = patternSnippetContainer ? patternSnippetContainer.querySelector('.pattern-snippet-search') : null;
    const previewButton = document.getElementById('modal-preview-btn');

    const updatePreviewButtonState = () => {
      if (!previewButton) return;
      const pattern = getStrudelEditorValue('modal-pattern');
      const hasPattern = !!(pattern && pattern.trim().length > 0);
      previewButton.disabled = !hasPattern;
    };

    let refreshSnippetButtons = null;

    const ensurePatternSnippetContainer = async () => {
      const currentPattern = getStrudelEditorValue('modal-pattern');
      const searchTerm = patternSnippetSearchInput ? patternSnippetSearchInput.value.trim().toLowerCase() : '';
      const [snippets, referenceMap] = await Promise.all([
        getPatternSnippets(currentPattern),
        loadStrudelReferenceDocs()
      ]);

      if (!patternSnippetContainer) {
        patternSnippetContainer = document.createElement('div');
        patternSnippetContainer.className = 'pattern-snippet-container';
        patternSnippetContainer.setAttribute('aria-disabled', 'false');

        const snippetHeading = document.createElement('span');
        snippetHeading.className = 'pattern-snippet-heading';
        snippetHeading.textContent = 'Add to pattern:';
        patternSnippetContainer.appendChild(snippetHeading);

        patternSnippetSearchInput = document.createElement('input');
        patternSnippetSearchInput.type = 'search';
        patternSnippetSearchInput.className = 'pattern-snippet-search';
        patternSnippetSearchInput.setAttribute('placeholder', 'Search tags…');
        patternSnippetSearchInput.setAttribute('aria-label', 'Search snippet tags');
        patternSnippetContainer.appendChild(patternSnippetSearchInput);

        patternSnippetListEl = document.createElement('div');
        patternSnippetListEl.className = 'pattern-snippet-list';
        patternSnippetContainer.appendChild(patternSnippetListEl);

        if (patternLabelRow) {
          patternLabelRow.insertAdjacentElement('afterend', patternSnippetContainer);
        } else {
          modal.querySelector('.form-group')?.insertAdjacentElement('afterbegin', patternSnippetContainer);
        }
      }

      if (!patternSnippetListEl) {
        patternSnippetListEl = patternSnippetContainer.querySelector('.pattern-snippet-list');
      }

      if (!patternSnippetSearchInput) {
        patternSnippetSearchInput = patternSnippetContainer.querySelector('.pattern-snippet-search');
      }

      const renderSnippets = (listEl, items, reference, searchTermValue) => {
        hideSnippetTooltip();
        listEl.innerHTML = '';
        const hasSearch = !!(searchTermValue && searchTermValue.trim().length);
        const normalizedSearch = searchTermValue || '';

        const groupMap = new Map();
        const groupOrder = [];

        items.forEach((entry) => {
          const snippet = typeof entry === 'string' ? entry : entry.snippet;
          const groupId = typeof entry === 'string' ? 'other' : (entry.groupId || 'other');
          const className = typeof entry === 'string' ? '' : (entry.className || '');
          const heading = (typeof entry === 'string' ? 'Other' : entry.heading) || 'Other';
          const key = getSnippetKey(snippet);
          const referenceEntry = reference.get(key);
          const rawInsertion = buildSnippetInsertion(snippet, referenceEntry);
          const insertionSnippet = rawInsertion.replace(/^[.]+/, '');
          const displayLabel = insertionSnippet;
          const lowerLabel = displayLabel.toLowerCase();
          const headingLower = heading.toLowerCase();

          if (
            normalizedSearch &&
            !lowerLabel.includes(normalizedSearch) &&
            !key.includes(normalizedSearch) &&
            !headingLower.includes(normalizedSearch)
          ) {
            return;
          }

          if (!groupMap.has(groupId)) {
            groupMap.set(groupId, {
              id: groupId,
              heading,
              className,
              items: []
            });
            groupOrder.push(groupMap.get(groupId));
          }

          groupMap.get(groupId).items.push({
            snippet,
            insertionSnippet,
            displayLabel,
            key,
            className,
            heading,
            referenceEntry
          });
        });

        let renderedAny = false;

        // Show all groups (not just filters)
        groupOrder.forEach((group) => {
          if (!Array.isArray(group.items) || !group.items.length) {
            return;
          }

          group.items.sort((a, b) => {
            const labelA = (a.displayLabel || '').toLowerCase();
            const labelB = (b.displayLabel || '').toLowerCase();
            if (labelA < labelB) return -1;
            if (labelA > labelB) return 1;
            return 0;
          });

          renderedAny = true;
          const groupWrapper = document.createElement('div');
          groupWrapper.className = 'pattern-snippet-group';
          groupWrapper.dataset.groupId = group.id;

          // For filter groups, use DEFAULT_OPEN_FILTER_GROUP_IDS, otherwise use DEFAULT_OPEN_SNIPPET_GROUP_IDS
          const defaultOpenSet = FILTER_GROUP_IDS.has(group.id) 
            ? DEFAULT_OPEN_FILTER_GROUP_IDS 
            : DEFAULT_OPEN_SNIPPET_GROUP_IDS;
          const storedState = snippetGroupOpenState.has(group.id)
            ? snippetGroupOpenState.get(group.id)
            : defaultOpenSet.has(group.id);
          const shouldOpen = hasSearch ? true : storedState;
          if (!snippetGroupOpenState.has(group.id)) {
            snippetGroupOpenState.set(group.id, storedState);
          }

          const headingButton = document.createElement('button');
          headingButton.type = 'button';
          headingButton.className = 'pattern-snippet-group-heading';
          headingButton.textContent = group.heading;
          headingButton.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');

          const itemsContainer = document.createElement('div');
          itemsContainer.className = 'pattern-snippet-group-items';

          if (!shouldOpen) {
            groupWrapper.classList.add('collapsed');
          }

          headingButton.addEventListener('click', () => {
            hideSnippetTooltip();
            const isCollapsed = groupWrapper.classList.toggle('collapsed');
            const newState = !isCollapsed;
            headingButton.setAttribute('aria-expanded', newState ? 'true' : 'false');
            snippetGroupOpenState.set(group.id, newState);
          });

          group.items.forEach((item) => {
            const itemWrapper = document.createElement('div');
            itemWrapper.className = 'pattern-snippet-item';
            itemWrapper.dataset.snippetKey = getSnippetKey(item.snippet);
            
            // Check if this tag has numeric parameters
            const tagKey = getSnippetKey(item.snippet);
            let numericParams = NUMERIC_TAG_PARAMS[tagKey];
            
            // Also check if tag has numeric parameter in parentheses
            // Formats: gain(0.8), lpf(2000), bpattack(attack:number), etc.
            if (!numericParams && item.snippet) {
              // Check for format like bpattack(attack:number) or bpattack(0.5)
              const paramNameMatch = item.snippet.match(/\(([a-zA-Z_]+):number\)/);
              const numericMatch = item.snippet.match(/\(([0-9.]+)\)/);
              
              if (paramNameMatch || numericMatch) {
                let value = numericMatch ? parseFloat(numericMatch[1]) : null;
                
                // If it's a parameter name format (attack:number), use default from NUMERIC_TAG_PARAMS if available
                if (paramNameMatch && !value) {
                  const paramName = paramNameMatch[1];
                  // Check if we have defaults for this tag with this parameter
                  if (NUMERIC_TAG_PARAMS[tagKey]) {
                    numericParams = NUMERIC_TAG_PARAMS[tagKey];
                  } else {
                    // Use generic defaults based on parameter name
                    if (paramName.includes('attack') || paramName.includes('decay') || paramName.includes('release')) {
                      numericParams = { min: 0, max: 2, step: 0.01, default: 0.01, unit: 's' };
                    } else if (paramName.includes('sustain') || paramName.includes('modulation') || paramName.includes('env')) {
                      numericParams = { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' };
                    } else {
                      numericParams = { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' };
                    }
                  }
                } else if (numericMatch && value !== null) {
                  // Create default params for tags with numeric values
                  // Use reasonable defaults based on the value
                  let min = Math.max(0, value * 0.1);
                  let max = value * 10;
                  let step = value < 1 ? 0.01 : (value < 10 ? 0.1 : 1);
                  
                  // Special handling for common ranges
                  if (value >= 20 && value <= 20000) {
                    // Likely a frequency (Hz)
                    min = 20;
                    max = 20000;
                    step = 10;
                  } else if (value >= 0 && value <= 1) {
                    // Likely a normalized value (0-1)
                    min = 0;
                    max = 1;
                    step = 0.01;
                  } else if (value >= -1 && value <= 1) {
                    // Likely pan or similar (-1 to 1)
                    min = -1;
                    max = 1;
                    step = 0.01;
                  }
                  
                  numericParams = {
                    min: min,
                    max: max,
                    step: step,
                    default: value,
                    unit: ''
                  };
                }
              }
            }
            
            const hasNumericParams = !!numericParams;
            
            if (hasNumericParams) {
              // Create button and slider for tags with numeric parameters
              const button = document.createElement('button');
              button.type = 'button';
              const customClass = getCustomSnippetClass(item.snippet);
              const applyCoreStyle = !customClass && item.groupId !== 'core' && shouldUseCoreStyle(item.snippet);
              const extraClassNames = [
                item.className || '',
                customClass,
                applyCoreStyle ? 'pattern-snippet-tag-core' : ''
              ]
                .filter(Boolean)
                .join(' ');
              button.className = `pattern-snippet-tag ${extraClassNames}`.trim();
              button.dataset.snippet = item.snippet;
              button.dataset.insertion = item.insertionSnippet;
              // Format display text: 
              // - For (paramName:number) format: extract paramName -> "paramName()"
              // - For (number) format: keep function name -> "functionName()"
              let displayText = item.displayLabel;
              const paramNameMatch = displayText.match(/\(([a-zA-Z_]+):number\)/);
              if (paramNameMatch) {
                // Extract parameter name and use it as the display text
                const paramName = paramNameMatch[1];
                displayText = `${paramName}()`;
              } else {
                // Remove content inside parentheses but keep function name
                displayText = displayText.replace(/\([^)]*\)/g, '()');
              }
              button.textContent = displayText;
              button.setAttribute('aria-label', item.displayLabel);
              
              // Create slider row (initially hidden, displayed inline below button)
              const sliderRow = document.createElement('div');
              sliderRow.className = 'slider-row snippet-slider-row';
              sliderRow.style.display = 'none'; // Hidden by default
              sliderRow.style.width = '100%';
              sliderRow.style.marginTop = '8px';
              sliderRow.style.padding = '8px';
              sliderRow.style.backgroundColor = 'rgba(102, 126, 234, 0.05)';
              sliderRow.style.border = '1px solid rgba(102, 126, 234, 0.2)';
              sliderRow.style.borderRadius = '4px';
              
              const label = document.createElement('label');
              label.textContent = item.displayLabel.replace(/\(\)$/, '');
              label.style.fontSize = '0.75rem';
              label.style.fontWeight = '600';
              label.style.color = '#4c51bf';
              label.style.marginBottom = '4px';
              
              const sliderContainer = document.createElement('div');
              sliderContainer.style.display = 'flex';
              sliderContainer.style.alignItems = 'center';
              sliderContainer.style.gap = '8px';
              sliderContainer.style.width = '100%';
              
              const slider = document.createElement('input');
              slider.type = 'range';
              slider.className = 'snippet-slider';
              slider.dataset.snippet = item.snippet;
              slider.dataset.tagKey = tagKey;
              slider.style.flex = '1';
              
              // Get function name (e.g., 'lpf', 'hpf', 'gain')
              const functionName = tagKey;
              
              // Set slider properties from NUMERIC_TAG_PARAMS
              slider.min = String(numericParams.min);
              slider.max = String(numericParams.max);
              slider.step = String(numericParams.step);
              
              // Try to get existing value from pattern, otherwise use default
              const getCurrentPatternValue = () => {
                const currentPattern = getStrudelEditorValue('modal-pattern') || '';
                const functionRegex = new RegExp(`\\.${functionName}\\(([^)]+)\\)`, 'g');
                const match = functionRegex.exec(currentPattern);
                return match ? match[1] : null;
              };
              
              const existingValue = getCurrentPatternValue();
              slider.value = existingValue ? String(existingValue) : String(numericParams.default);
              
              const valueSpan = document.createElement('span');
              valueSpan.className = 'slider-value';
              valueSpan.style.minWidth = '60px';
              valueSpan.style.textAlign = 'right';
              valueSpan.style.fontSize = '0.75rem';
              valueSpan.style.fontWeight = '600';
              valueSpan.textContent = slider.value + (numericParams.unit ? ' ' + numericParams.unit : '');
              
              // Update value display on input (for visual feedback)
              slider.addEventListener('input', (e) => {
                const value = e.target.value;
                valueSpan.textContent = value + (numericParams.unit ? ' ' + numericParams.unit : '');
              });
              
              // Replace or insert function when slider is released
              slider.addEventListener('change', (e) => {
                const value = e.target.value;
                valueSpan.textContent = value + (numericParams.unit ? ' ' + numericParams.unit : '');
                
                // Get current pattern
                const currentPattern = getStrudelEditorValue('modal-pattern') || '';
                
                // Create the function call with value
                const functionCall = `.${functionName}(${value})`;
                
                // Check if pattern already has this function type
                const functionRegex = new RegExp(`\\.${functionName}\\([^)]*\\)`, 'g');
                const hasExistingFunction = functionRegex.test(currentPattern);
                
                if (hasExistingFunction) {
                  // Replace existing function call(s) with new one
                  const updatedPattern = currentPattern.replace(functionRegex, functionCall);
                  setStrudelEditorValue('modal-pattern', updatedPattern);
                } else {
                  // Append to the end of the pattern
                  const newPattern = currentPattern.trim() + functionCall;
                  setStrudelEditorValue('modal-pattern', newPattern);
                }
              });
              
              // Show slider when button is clicked (slider opens on first click and stays open)
              button.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent tag insertion
                e.preventDefault(); // Prevent any default behavior
                
                // Always show slider when button is clicked (open on first click)
                const isHidden = sliderRow.style.display === 'none' || sliderRow.style.display === '';
                if (isHidden) {
                  sliderRow.style.display = 'flex';
                  sliderRow.style.flexDirection = 'column';
                  sliderRow.style.gap = '4px';
                  
                  // Update slider value from pattern if it exists
                  const currentPattern = getStrudelEditorValue('modal-pattern') || '';
                  const functionRegex = new RegExp(`\\.${functionName}\\(([^)]+)\\)`, 'g');
                  const match = functionRegex.exec(currentPattern);
                  
                  if (match) {
                    // Pattern already has this function - update slider to match
                    const existingValue = match[1];
                    slider.value = existingValue;
                    valueSpan.textContent = existingValue + (numericParams.unit ? ' ' + numericParams.unit : '');
                  } else {
                    // Insert tag with default value if not already in pattern
                    const functionCall = `.${functionName}(${slider.value})`;
                    const newPattern = currentPattern.trim() + functionCall;
                    setStrudelEditorValue('modal-pattern', newPattern);
                  }
                }
                // Keep slider open - don't hide it when clicking again (as requested)
              });
              
              // Tooltip handling for button
              const tooltipTitle = item.referenceEntry?.name || item.displayLabel.replace(/^[.]+/, '').trim();
              const tooltipDescription = getReferenceDescriptionText(item.referenceEntry);
              const tooltipParams = Array.isArray(item.referenceEntry?.params)
                ? item.referenceEntry.params.map(buildParamDescription).filter(Boolean).join('\n')
                : '';
              
              button.dataset.tooltipTitle = tooltipTitle || item.displayLabel;
              button.dataset.tooltipDescription = tooltipDescription || '';
              button.dataset.tooltipParams = tooltipParams || '';
              
              const handleShowTooltip = () => showSnippetTooltip(button);
              const handleHideTooltip = () => hideSnippetTooltip(button);
              
              button.addEventListener('mouseenter', handleShowTooltip);
              button.addEventListener('mouseleave', handleHideTooltip);
              button.addEventListener('focus', handleShowTooltip);
              button.addEventListener('blur', handleHideTooltip);
              
              sliderContainer.appendChild(slider);
              sliderContainer.appendChild(valueSpan);
              
              sliderRow.appendChild(label);
              sliderRow.appendChild(sliderContainer);
              
              itemWrapper.appendChild(button);
              itemWrapper.appendChild(sliderRow);
            } else {
              // Create button for non-filter items
              const button = document.createElement('button');
              button.type = 'button';
              const customClass = getCustomSnippetClass(item.snippet);
              const applyCoreStyle = !customClass && item.groupId !== 'core' && shouldUseCoreStyle(item.snippet);
              const extraClassNames = [
                item.className || '',
                customClass,
                applyCoreStyle ? 'pattern-snippet-tag-core' : ''
              ]
                .filter(Boolean)
                .join(' ');
              button.className = `pattern-snippet-tag ${extraClassNames}`.trim();
              button.dataset.snippet = item.snippet;
              button.dataset.insertion = item.insertionSnippet;
              button.textContent = item.displayLabel;
              button.setAttribute('aria-label', item.displayLabel);

              const tooltipTitle = item.referenceEntry?.name || item.displayLabel.replace(/^[.]+/, '').trim();
              const tooltipDescription = getReferenceDescriptionText(item.referenceEntry);
              const tooltipParams = Array.isArray(item.referenceEntry?.params)
                ? item.referenceEntry.params.map(buildParamDescription).filter(Boolean).join('\n')
                : '';

              button.dataset.tooltipTitle = tooltipTitle || item.displayLabel;
              button.dataset.tooltipDescription = tooltipDescription || '';
              button.dataset.tooltipParams = tooltipParams || '';

              const handleShowTooltip = () => showSnippetTooltip(button);
              const handleHideTooltip = () => hideSnippetTooltip(button);

              button.addEventListener('mouseenter', handleShowTooltip);
              button.addEventListener('mouseleave', handleHideTooltip);
              button.addEventListener('focus', handleShowTooltip);
              button.addEventListener('blur', handleHideTooltip);
              button.addEventListener('click', handleHideTooltip);

              itemWrapper.appendChild(button);
            }
            
            itemsContainer.appendChild(itemWrapper);
          });

          groupWrapper.appendChild(headingButton);
          groupWrapper.appendChild(itemsContainer);
          listEl.appendChild(groupWrapper);
        });

        if (!renderedAny) {
          const emptyState = document.createElement('div');
          emptyState.className = 'pattern-snippet-empty';
          emptyState.textContent = 'No tags match your search.';
          listEl.appendChild(emptyState);
        }
      };

      if (patternSnippetListEl) {
        renderSnippets(patternSnippetListEl, snippets, referenceMap, searchTerm);
      }

      refreshSnippetButtons = async () => {
        if (!patternSnippetListEl) return;
        const updatedSnippets = await getPatternSnippets(getStrudelEditorValue('modal-pattern'));
        const ref = await loadStrudelReferenceDocs();
        const term = patternSnippetSearchInput ? patternSnippetSearchInput.value.trim().toLowerCase() : '';
        renderSnippets(patternSnippetListEl, updatedSnippets, ref, term);
      };

      if (patternSnippetListEl && !patternSnippetListEl.dataset.listenersAttached) {
        patternSnippetListEl.addEventListener('click', (event) => {
          const button = event.target.closest('.pattern-snippet-tag');
          if (!button || patternSnippetContainer.classList.contains('disabled')) {
            return;
          }
          if (!drumGridState.patternEditorEnabled) {
            return;
          }
          
          // Check if this is a numeric tag - if so, don't insert here (handled by button click)
          const itemWrapper = button.closest('.pattern-snippet-item');
          if (itemWrapper && itemWrapper.dataset.snippetKey) {
            const tagKey = itemWrapper.dataset.snippetKey;
            if (NUMERIC_TAG_PARAMS[tagKey]) {
              // Numeric tags are handled by their own click handler
              return;
            }
          }
          
          const snippet = button.dataset.insertion || button.dataset.snippet;
          if (!snippet) {
            return;
          }
          hideSnippetTooltip(button);
          insertStrudelEditorSnippet('modal-pattern', snippet);
        });

        patternSnippetListEl.addEventListener('mouseleave', () => {
          hideSnippetTooltip();
        });

        patternSnippetListEl.addEventListener('scroll', () => {
          hideSnippetTooltip();
        });

        patternSnippetListEl.dataset.listenersAttached = 'true';
      }

      if (patternSnippetSearchInput && !patternSnippetSearchInput.dataset.listenerAttached) {
        patternSnippetSearchInput.addEventListener('input', () => {
          hideSnippetTooltip();
          if (typeof refreshSnippetButtons === 'function') {
            refreshSnippetButtons().catch(err => console.warn('⚠️ Unable to refresh snippet tags:', err));
          }
        });
        patternSnippetSearchInput.dataset.listenerAttached = 'true';
      }
    };

    ensurePatternSnippetContainer().catch((error) => {
      console.warn('⚠️ Unable to prepare pattern snippet tags:', error);
    });
    updatePreviewButtonState();

    // Open/Close modal helpers
    const openModal = (elementId) => {
      try {
        if (!modal) return;
        // Remember which element we're editing
        this.currentEditingElementId = elementId;
        // Update header title
        const headerEl = document.getElementById('modal-element-id');
        if (headerEl) headerEl.textContent = elementId || '';
        // Load saved config
        const saved = this.loadElementConfig ? this.loadElementConfig(elementId) : null;
        // Populate bank
        const bankValue = saved?.bank || '';
        ensurePatternBankOptions(bankValue);
        if (bankSelect) bankSelect.value = bankValue;
        // Populate pattern editor (keep blank if no pattern saved)
        const pattern = saved?.pattern || '';
        setStrudelEditorValue('modal-pattern', pattern || '');
        // Key/Scale dropdowns (do not force values; leave as current UI state if empty)
        const modalKeySelect = document.getElementById('modal-key-select');
        const modalScaleSelect = document.getElementById('modal-scale-select');
        if (modalKeySelect && (saved?.key || saved?.key === '')) {
          modalKeySelect.value = saved.key || '';
        }
        if (modalScaleSelect && (saved?.scale || saved?.scale === '')) {
          modalScaleSelect.value = saved.scale || 'chromatic';
        }
        // Ensure UI reflects current state
        updatePreviewButtonState();
        updateKeyScaleVisibility();
        refreshDrumGridForCurrentState();
        // Show modal
        modal.style.display = 'block';
      } catch (e) {
        console.warn('⚠️ Failed to open modal:', e);
      }
    };

    const closeModal = () => {
      try {
        if (!modal) return;
        // Hide modal
        modal.style.display = 'none';
        // Stop and remove preview track if present
        const previewElementId = 'modal-preview';
        if (soundManager && typeof soundManager.stopSound === 'function') {
          soundManager.stopSound(previewElementId);
        }
      } catch (e) {
        console.warn('⚠️ Failed to close modal:', e);
      }
    };

    if (previewButton && !previewButton.dataset.listenerAttached) {
      let previewStartedMaster = false;
      previewButton.addEventListener('click', async () => {
        const previewElementId = 'modal-preview';
        const isPreviewPlaying = soundManager.trackedPatterns && soundManager.trackedPatterns.has(previewElementId);
        
        // Toggle: if playing, stop it
        if (isPreviewPlaying) {
          if (soundManager.stopSound) {
            soundManager.stopSound(previewElementId);
          }
          // If we started master for preview and there are no other tracks, stop master
          try {
            const remaining = soundManager.trackedPatterns ? soundManager.trackedPatterns.size : 0;
            if (previewStartedMaster && remaining === 0 && soundManager.stopMasterPattern) {
              await soundManager.stopMasterPattern();
            }
          } catch {}
          previewStartedMaster = false;
          previewButton.textContent = '▶ Preview Pattern';
          previewButton.classList.remove('active');
          uiController.updateStatus('⏹ Preview stopped');
          return;
        }
        
        // If drum grid is active, update pattern from grid first
        if (drumGridState.active) {
          updatePatternFromGrid();
        }
        
        let patternValue = getStrudelEditorValue('modal-pattern');
        if (!patternValue || !patternValue.trim()) {
          uiController.updateStatus('⚠️ No pattern to preview');
          return;
        }

        // Ensure pattern includes bank if one is selected
        const bankValue = bankSelect ? bankSelect.value : '';
        console.log('🎵 Preview: Original pattern:', patternValue);
        console.log('🎵 Preview: Bank value:', bankValue);
        
        // Check if this is a synth sound (not a drum bank)
        const synthSounds = [...OSCILLATOR_SYNTHS, ...SAMPLE_SYNTHS];
        const isSynthSound = bankValue && synthSounds.includes(bankValue.toLowerCase());
        const isDrumBank = bankValue && DRUM_BANK_VALUES.has(bankValue);
        
        if (bankValue && bankValue !== '') {
          // Only add .bank() for drum banks, NOT for synth sounds (synth sounds use .s() only)
          if (isDrumBank && !isSynthSound) {
            // Check if pattern already has a .bank() modifier
            if (!patternValue.includes('.bank(')) {
              // Add .bank() modifier if not present - ensure it's added before any other modifiers
              // If pattern has modifiers like .gain(), add bank before them
              if (patternValue.includes('.gain(') || patternValue.includes('.pan(') || patternValue.includes('.fast(') || patternValue.includes('.slow(')) {
                // Insert .bank() before other modifiers
                const modifierMatch = patternValue.match(/(\.(gain|pan|fast|slow)\([^)]*\))/);
                if (modifierMatch) {
                  const insertPos = modifierMatch.index;
                  patternValue = patternValue.slice(0, insertPos) + `.bank("${bankValue}")` + patternValue.slice(insertPos);
                } else {
                  patternValue = `${patternValue}.bank("${bankValue}")`;
                }
              } else {
                patternValue = `${patternValue}.bank("${bankValue}")`;
              }
            } else {
              // Replace existing .bank() modifier with current selection
              patternValue = patternValue.replace(/\.bank\(["'][^"']*["']\)/g, `.bank("${bankValue}")`);
            }
          } else if (isSynthSound) {
            // For synth sounds, remove any .bank() modifier (they should only use .s())
            patternValue = patternValue.replace(/\.bank\(["'][^"']*["']\)/g, '');
            patternValue = patternValue.replace(/\.+$/, '').trim();
          }
        } else {
          // Remove .bank() modifier if no bank is selected
          patternValue = patternValue.replace(/\.bank\(["'][^"']*["']\)/g, '');
          patternValue = patternValue.replace(/\.+$/, '').trim();
        }
        
        console.log('🎵 Preview: Final pattern before preview:', patternValue);
        
        // Get the actual element's gain/pan values to apply to preview
        const actualElementId = this.currentEditingElementId;
        if (actualElementId) {
          // Copy gain/pan values from the actual element to preview element
          // Lower preview volume by -6dB (multiply by 0.501)
          const actualGain = soundManager.elementGainValues.get(actualElementId) || 0.8;
          const actualPan = soundManager.elementPanValues.get(actualElementId) || 0;
          const previewGain = actualGain * 0.501; // -6dB reduction
          soundManager.elementGainValues.set(previewElementId, previewGain);
          soundManager.elementPanValues.set(previewElementId, actualPan);
          console.log(`🎵 Preview: Using gain=${previewGain} (${actualGain} * 0.501 for -6dB), pan=${actualPan} from element ${actualElementId}`);
        }
        
        // Ensure bank is loaded before previewing if one is selected
        if (bankValue && bankValue !== '') {
          console.log(`🎵 Preview: Ensuring bank "${bankValue}" is loaded...`);
          try {
            await soundManager.loadBank(bankValue);
            console.log(`✅ Preview: Bank "${bankValue}" loaded successfully`);
          } catch (loadError) {
            console.warn(`⚠️ Preview: Could not load bank "${bankValue}":`, loadError);
            // Continue anyway - processPattern will attempt to load it
          }
        }
        
        uiController.updateStatus('▶ Previewing pattern…');
        previewButton.textContent = '⏹ Stop Preview';
        previewButton.classList.add('active');

        try {
          const wasMasterActive = !!soundManager.masterActive;
          await soundManager.playStrudelPattern(previewElementId, patternValue);
          // Ensure master is running (playStrudelPattern auto-starts for preview, but double-check)
          if (!soundManager.masterActive && soundManager.playMasterPattern) {
            await soundManager.playMasterPattern();
          }
          previewStartedMaster = !wasMasterActive && !!soundManager.masterActive;
          uiController.updateStatus('✅ Preview playing');
        } catch (error) {
          console.error('Preview failed:', error);
          uiController.updateStatus('⚠️ Preview failed – check console for details');
          previewButton.textContent = '▶ Preview Pattern';
          previewButton.classList.remove('active');
        }
      });
      previewButton.dataset.listenerAttached = 'true';
    }

    const updatePatternFieldEditable = (editable) => {
      hideSnippetTooltip();
      setStrudelEditorEditable('modal-pattern', editable);
      const textarea = document.getElementById('modal-pattern');
      if (textarea) {
        textarea.classList.toggle('pattern-editor-readonly', !editable);
      }
      if (patternSnippetContainer) {
        patternSnippetContainer.classList.toggle('disabled', !editable);
        patternSnippetContainer.setAttribute('aria-disabled', (!editable).toString());
      }
      if (patternSnippetSearchInput) {
        patternSnippetSearchInput.disabled = !editable;
      }
    };

    const applyPatternEditorState = () => {
      if (patternEditorSelect) {
        patternEditorSelect.value = drumGridState.patternEditorEnabled ? 'code' : 'step';
      }
      updatePatternFieldEditable(drumGridState.patternEditorEnabled);
      
      // Show/hide code editor and tags based on editor state
      const patternEditorWrapper = document.getElementById('modal-pattern-editor-wrapper');
      if (patternEditorWrapper) {
        patternEditorWrapper.style.display = drumGridState.patternEditorEnabled ? 'block' : 'none';
        // Show/hide note conversion checkbox based on whether pattern uses note()
        updateNoteConversionCheckboxVisibility();
      }
      
      // Hide snippet container when showing drum grid
      if (patternSnippetContainer) {
        patternSnippetContainer.style.display = drumGridState.patternEditorEnabled ? 'block' : 'none';
      }
      
      // Show/hide Time Signature selector based on editor state
      // Visible when step editor (drum grid) is active, hidden when code editor is active
      const timeSignatureGroup = document.getElementById('modal-time-signature-select')?.closest('.form-group');
      if (timeSignatureGroup) {
        // patternEditorEnabled = false means step editor (drum grid) is active
        // patternEditorEnabled = true means code editor is active
        timeSignatureGroup.style.display = drumGridState.patternEditorEnabled ? 'none' : 'block';
      }
      
      // Show/hide drum grid based on editor state
      // Note: Don't show/hide here - let refreshDrumGridForCurrentState handle it
      // This prevents conflicts when the modal is not yet open
    };

    // Function to show/hide note conversion checkbox based on pattern content
    const updateNoteConversionCheckboxVisibility = () => {
      const checkboxControl = document.getElementById('modal-note-conversion-control');
      if (!checkboxControl) return;
      
      const patternValue = getStrudelEditorValue('modal-pattern');
      const hasNoteCall = patternValue && containsNoteCall(patternValue);
      const isNumericPattern = hasNoteCall && containsNumericNotePattern(patternValue);
      
      // Show toggle switch if pattern uses n() or note() - show for both numeric and non-numeric patterns
      if (hasNoteCall) {
        checkboxControl.style.display = 'block';
      } else {
        checkboxControl.style.display = 'none';
      }
    };

    const modalPatternTextareaForPreview = document.getElementById('modal-pattern');
    if (modalPatternTextareaForPreview && !modalPatternTextareaForPreview.dataset.previewListenerAttached) {
      // Helper: if user adds note()/n(), remove (silence) and rebase modifiers on the note
      const removeSilenceWhenNotesPresent = (code) => {
        if (!code || typeof code !== 'string') return code;
        if (!code.includes('(silence)')) return code;
        if (!/\b(note|n)\s*\(/i.test(code)) return code;
        
        // If pattern starts with (silence).<modifiers> and also contains note()/n(), rebase modifiers on the first note()/n()
        const silenceStart = code.trim().startsWith('(silence)');
        const silenceChainMatch = code.trim().match(/^\(silence\)\.\s*([\s\S]+)$/);
        if (silenceStart && silenceChainMatch) {
          const modifiers = silenceChainMatch[1].trim().replace(/^\.+/,'');
          
          // Find first note()/n() expression
          const idxNote = code.search(/\b(note|n)\s*\(/i);
          if (idxNote >= 0) {
            // Extract balanced parentheses for the note()/n() call
            let i = code.indexOf('(', idxNote);
            let depth = 0;
            let end = -1;
            for (let j = i; j < code.length; j++) {
              const ch = code[j];
              if (ch === '(') depth++;
              else if (ch === ')') {
                depth--;
                if (depth === 0) { end = j; break; }
              }
            }
            if (end > i) {
              const head = code.substring(idxNote, end + 1).trim();
              let rebuilt = `${head}`;
              if (modifiers && !/^\s*$/.test(modifiers)) {
                // Avoid duplicating gain()/pan() if user already added chaining to note()
                // Simple append; further normalization done by existing processors
                rebuilt = `${rebuilt}.${modifiers}`.replace(/\.\.+/g, '.').replace(/\.($|\s)/, '$1').trim();
              }
              return rebuilt;
            }
          }
        }
        // Fallback: just remove all occurrences of (silence) and stray leading dots
        let updated = code.replace(/\(silence\)/g, '').replace(/\.\.+/g, '.').trim();
        updated = updated.replace(/^\./, '').trim();
        return updated;
      };
      
      modalPatternTextareaForPreview.addEventListener('input', () => {
        // Auto-remove (silence) when user types note()/n()
        const currentVal = getStrudelEditorValue('modal-pattern');
        const cleaned = removeSilenceWhenNotesPresent(currentVal);
        if (cleaned !== currentVal) {
          setStrudelEditorValue('modal-pattern', cleaned);
        }
        
        updatePreviewButtonState();
        updateNoteConversionCheckboxVisibility();
        if (cleaned && containsNumericNotePattern(cleaned)) {
          lastCanonicalNumericPattern = cleaned;
        }
        semitoneSnapshotLocked = false;
        syncLastSemitonePattern(getStrudelEditorValue('modal-pattern'), true);
        
        // Show/hide Key/Scale controls based on pattern type or selected bank
        const keyScaleGroup = document.getElementById('modal-key-scale-group');
        const patternValue = getStrudelEditorValue('modal-pattern');
        const hasNotePattern = patternValue && containsNoteCall(patternValue);
        
        // Check if a sample-based synth bank is selected
        // bankSelect is already defined at the top of setupModal() as modal-pattern-bank
        const selectedBank = bankSelect ? bankSelect.value : '';
        const isSampleSynth = selectedBank && SAMPLE_SYNTHS.includes(selectedBank.toLowerCase());
        
        if (keyScaleGroup) {
          keyScaleGroup.style.display = (hasNotePattern || isSampleSynth) ? 'block' : 'none';
        }
        
        if (typeof refreshSnippetButtons === 'function') {
          refreshSnippetButtons().catch(err => console.warn('⚠️ Unable to refresh snippet tags:', err));
        }
      });
      modalPatternTextareaForPreview.dataset.previewListenerAttached = 'true';
    }

    const setPatternEditorEnabled = (enabled) => {
      drumGridState.patternEditorEnabled = !!enabled;
      applyPatternEditorState();
    };
    
    const isDrumBankValue = (value) => value && DRUM_BANK_VALUES.has(value);
    
    const setDrumGridSubtitle = (metrics) => {
      if (!drumGridTimesigLabel) return;
      drumGridTimesigLabel.textContent = `${metrics.signature} · ${metrics.totalSteps} steps`;
    };
    
    const updateBarSelector = () => {
      const barCountEl = document.getElementById('modal-drum-grid-bar-count');
      const leftArrow = document.getElementById('modal-drum-grid-bar-arrow-left');
      const rightArrow = document.getElementById('modal-drum-grid-bar-arrow-right');
      
      if (barCountEl) {
        if (drumGridState.numBars === 1) {
          barCountEl.textContent = '1 bar';
        } else {
          barCountEl.textContent = `Bar ${drumGridState.currentBar} of ${drumGridState.numBars}`;
        }
      }
      
      // Show/hide arrows based on current bar position and number of bars
      if (leftArrow) {
        leftArrow.style.display = (drumGridState.numBars > 1 && drumGridState.currentBar > 1) ? 'flex' : 'none';
      }
      if (rightArrow) {
        rightArrow.style.display = (drumGridState.numBars > 1 && drumGridState.currentBar < drumGridState.numBars) ? 'flex' : 'none';
      }
    };
    
    const switchToBar = (barNumber) => {
      if (barNumber < 1 || barNumber > drumGridState.numBars) return;
      drumGridState.currentBar = barNumber;
      updateBarSelector();
      // Force rebuild to show the selected bar
      const bankValue = bankSelect ? bankSelect.value : '';
      const modalTimeSigSelect = document.getElementById('modal-time-signature-select');
      const timeSig = modalTimeSigSelect?.value || this.currentTimeSignature || '4/4';
      const metrics = getTimeSignatureMetrics(timeSig);
      drumGridState.built = false; // Force rebuild
      ensureDrumGridBuilt(metrics, bankValue);
      // Update pattern from current bar
      const currentPattern = getStrudelEditorValue('modal-pattern');
      populateDrumGridFromPattern(currentPattern, metrics);
    };
    
    const addBar = () => {
      drumGridState.numBars++;
      updateBarSelector();
      // Switch to the new bar
      switchToBar(drumGridState.numBars);
    };
    
    const resetDrumGridSelection = () => {
      const currentBankRows = drumGridState.currentBankRows || DRUM_GRID_ROWS;
      currentBankRows.forEach(({ key }) => {
        const checkboxes = drumGridState.checkboxes[key];
        if (checkboxes && checkboxes.length) {
          checkboxes.forEach(cb => { if (cb) cb.checked = false; });
        }
      });
    };
    
    const handleDrumGridStepChange = () => {
      if (!drumGridState.active || drumGridState.updatingFromPattern) {
        return;
      }
      updatePatternFromGrid();
    };
    
    const ensureDrumGridBuilt = (metrics, bankValue) => {
      if (!drumGridSection) return;
      
      // Get instruments for the selected bank, or use default
      const currentBankRows = bankValue && DRUM_BANK_INSTRUMENTS[bankValue] 
        ? DRUM_BANK_INSTRUMENTS[bankValue] 
        : DRUM_GRID_ROWS;
      
      // Check if we need to rebuild (different bank, different step count, or bar changed)
      const needsRebuild = !drumGridState.built || 
                           drumGridState.totalSteps !== metrics.totalSteps ||
                           JSON.stringify(drumGridState.currentBankRows) !== JSON.stringify(currentBankRows);
      
      if (!needsRebuild) {
        return;
      }
      
      // Clear existing grid
      const gridContainer = document.getElementById('modal-drum-grid-container');
      if (!gridContainer) {
        console.error('❌ ensureDrumGridBuilt: Drum grid container not found!');
        console.error('   Looking for: modal-drum-grid-container');
        console.error('   Modal exists:', !!drumGridSection);
        if (drumGridSection) {
          console.error('   Drum grid section children:', Array.from(drumGridSection.children).map(c => c.id || c.className));
        }
        return;
      }
      console.log('🔨 Building drum grid with', currentBankRows.length, 'rows,', metrics.totalSteps, 'steps');
      console.log('   Grid container found:', gridContainer, 'current children:', gridContainer.children.length);
      gridContainer.innerHTML = '';
      
      // Reset checkboxes
      drumGridState.checkboxes = {};
      drumGridState.currentBankRows = currentBankRows;
      
      // Build rows dynamically based on bank
      currentBankRows.forEach(({ key, label, sample }) => {
        const row = document.createElement('div');
        row.className = 'drum-grid-row';
        row.setAttribute('data-row', key);
        
        const labelSpan = document.createElement('span');
        labelSpan.className = 'drum-grid-row-label';
        labelSpan.textContent = label;
        row.appendChild(labelSpan);
        
        const stepsContainer = document.createElement('div');
        stepsContainer.className = 'drum-grid-steps';
        stepsContainer.id = `drum-grid-steps-${key}`;
        stepsContainer.style.gridTemplateColumns = `repeat(${metrics.totalSteps}, minmax(18px, 1fr))`;
        
        drumGridState.checkboxes[key] = [];
        // Calculate total steps for all bars
        const totalStepsForAllBars = metrics.totalSteps * drumGridState.numBars;
        // Only show steps for the current bar
        const startStep = (drumGridState.currentBar - 1) * metrics.totalSteps;
        const endStep = startStep + metrics.totalSteps;
        
        for (let step = startStep; step < endStep; step += 1) {
          const stepWrapper = document.createElement('div');
          stepWrapper.className = 'drum-grid-step';
          const stepInBar = step - startStep;
          if (stepInBar > 0 && stepInBar % 4 === 0) {
            stepWrapper.classList.add('quarter-boundary');
          }
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.dataset.row = key;
          checkbox.dataset.step = String(step);
          checkbox.dataset.bar = String(drumGridState.currentBar);
          checkbox.addEventListener('change', handleDrumGridStepChange);
          stepWrapper.appendChild(checkbox);
          stepsContainer.appendChild(stepWrapper);
          drumGridState.checkboxes[key].push(checkbox);
        }
        
        row.appendChild(stepsContainer);
        gridContainer.appendChild(row);
      });
      
      drumGridState.totalSteps = metrics.totalSteps;
      drumGridState.built = true;
    };
    
    const tokenizePattern = (pattern) => {
      if (!pattern || typeof pattern !== 'string') return null;
      const match = pattern.match(/(?:s|sound)\(\s*["'`]([^"'`]+)["'`]\s*\)/i);
      if (!match || !match[1]) return null;
      const sequence = match[1].trim();
      if (!sequence) return null;
      return sequence.split(/\s+/).filter(Boolean);
    };
    
    const parseTokenToSamples = (token) => {
      if (!token) return [];
      const trimmed = token.trim();
      if (!trimmed || trimmed === '~') return [];
      let working = trimmed;
      if ((working.startsWith('[') && working.endsWith(']')) || (working.startsWith('{') && working.endsWith('}'))) {
        working = working.slice(1, -1);
      }
      working = working.replace(/[,]+/g, ' ');
      return working.split(/\s+/).map(part => part.trim()).filter(Boolean);
    };
    
    const populateDrumGridFromPattern = (pattern, metrics) => {
      if (!drumGridSection || !drumGridState.active) return;
      const tokens = tokenizePattern(pattern);
      resetDrumGridSelection();
      if (!tokens || tokens.length === 0) {
        return;
      }
      
      const totalStepsForAllBars = metrics.totalSteps * drumGridState.numBars;
      let workingTokens = tokens.slice();
      if (workingTokens.length !== totalStepsForAllBars) {
        const adjustedTokens = [];
        for (let step = 0; step < totalStepsForAllBars; step += 1) {
          adjustedTokens.push(workingTokens[step % workingTokens.length]);
        }
        workingTokens = adjustedTokens;
      }
      
      drumGridState.updatingFromPattern = true;
      // Only populate the current bar's checkboxes
      const startStep = (drumGridState.currentBar - 1) * metrics.totalSteps;
      const endStep = startStep + metrics.totalSteps;
      
      for (let step = startStep; step < endStep; step += 1) {
        const samples = parseTokenToSamples(workingTokens[step]);
        samples.forEach(sample => {
          const rowKey = DRUM_SAMPLE_TO_ROW.get(sample.toLowerCase());
          if (!rowKey) return;
          const checkboxes = drumGridState.checkboxes[rowKey];
          // Find checkbox for this step
          const checkbox = checkboxes ? checkboxes.find(cb => cb && parseInt(cb.dataset.step) === step) : null;
          if (checkbox) {
            checkbox.checked = true;
          }
        });
      }
      drumGridState.updatingFromPattern = false;
    };
    
    const generateTokensFromGrid = (metrics) => {
      const tokens = [];
      const currentBankRows = drumGridState.currentBankRows || DRUM_GRID_ROWS;
      const totalStepsForAllBars = metrics.totalSteps * drumGridState.numBars;
      
      // Generate tokens for all bars
      for (let step = 0; step < totalStepsForAllBars; step += 1) {
        const activeSamples = [];
        currentBankRows.forEach(({ key, sample }) => {
          const checkboxes = drumGridState.checkboxes[key];
          // Find checkbox for this step (may be in a different bar)
          const checkbox = checkboxes ? checkboxes.find(cb => cb && parseInt(cb.dataset.step) === step) : null;
          if (checkbox && checkbox.checked) {
            activeSamples.push(sample);
          }
        });
        if (activeSamples.length === 0) {
          tokens.push('~');
        } else if (activeSamples.length === 1) {
          tokens.push(activeSamples[0]);
        } else {
          tokens.push(`[${activeSamples.join(' ')}]`);
        }
      }
      return tokens;
    };
    
    const updatePatternFromGrid = () => {
      if (!drumGridSection || !drumGridState.active || !bankSelect) return;
      const modalTimeSigSelect = document.getElementById('modal-time-signature-select');
      const timeSig = modalTimeSigSelect?.value || this.currentTimeSignature || '4/4';
      const metrics = getTimeSignatureMetrics(timeSig);
      const tokens = generateTokensFromGrid(metrics);
      const sequence = tokens.join(' ');
      // Note: .fast() modifier removed - patterns are clean without tempo modifiers
      const bankValue = bankSelect.value;
      const bankSuffix = bankValue && bankValue !== '' ? `.bank("${bankValue}")` : '';
      // Use s() for drum patterns with banks (Strudel standard)
      const pattern = `s("${sequence}")${bankSuffix}`;
      drumGridState.updatingFromGrid = true;
      setStrudelEditorValue('modal-pattern', pattern);
      drumGridState.updatingFromGrid = false;
    };
    
    const showDrumGrid = (metrics, pattern) => {
      if (!drumGridSection) {
        console.warn('⚠️ Drum grid section not found');
        return;
      }
      const bankValue = bankSelect ? bankSelect.value : '';
      console.log('🎹 Showing drum grid for bank:', bankValue, 'metrics:', metrics);
      
      // Check if grid container exists
      const gridContainer = document.getElementById('modal-drum-grid-container');
      if (!gridContainer) {
        console.error('❌ Drum grid container not found!');
        return;
      }
      console.log('✅ Grid container found:', gridContainer);
      
      ensureDrumGridBuilt(metrics, bankValue);
      setDrumGridSubtitle(metrics);
      drumGridSection.style.display = 'block';
      drumGridState.active = true;
      populateDrumGridFromPattern(pattern, metrics);
      // Update bar selector after grid is shown to ensure correct arrow visibility
      updateBarSelector();
      
      // Verify grid was built
      const rows = gridContainer.querySelectorAll('.drum-grid-row');
      console.log('✅ Drum grid shown, active:', drumGridState.active, 'rows:', rows.length);
    };
    
    const hideDrumGrid = () => {
      if (!drumGridSection) return;
      drumGridSection.style.display = 'none';
      drumGridState.active = false;
      drumGridState.built = false; // Force rebuild when shown again
      // Reset to 1 bar when hiding
      drumGridState.numBars = 1;
      drumGridState.currentBar = 1;
      // Hide arrows when grid is hidden
      updateBarSelector();
    };
    
    // Initialize pattern editor state now that all functions are defined
    applyPatternEditorState();
    
    const refreshDrumGridForCurrentState = () => {
      if (!bankSelect) {
        console.log('⚠️ refreshDrumGridForCurrentState: bankSelect not found');
        return;
      }
      const bankValue = bankSelect.value;
      const isDrum = isDrumBankValue(bankValue);
      console.log('🔄 refreshDrumGridForCurrentState: bankValue=', bankValue, 'isDrum=', isDrum, 'patternEditorEnabled=', drumGridState.patternEditorEnabled);

      if (patternEditorSelect) {
        patternEditorSelect.style.display = isDrum ? 'block' : 'none';
      }

      if (!isDrum) {
        console.log('📝 Not a drum bank, enabling pattern editor');
        setPatternEditorEnabled(true);
        hideDrumGrid();
        applyPatternEditorState();
        return;
      }

      // For drum banks, show the drum grid by default
      // Only hide it if the user explicitly enables the pattern editor
      const patternValue = getStrudelEditorValue('modal-pattern');
      const trimmedPattern = patternValue ? patternValue.trim() : '';
      const tokens = tokenizePattern(patternValue);

      // If pattern editor is enabled, hide drum grid
      if (drumGridState.patternEditorEnabled) {
        console.log('📝 Pattern editor enabled, hiding drum grid');
        hideDrumGrid();
        applyPatternEditorState();
        return;
      }

      // If there's a pattern but it can't be tokenized (not a drum pattern), enable pattern editor
      if (trimmedPattern && (!tokens || tokens.length === 0)) {
        console.log('📝 Pattern cannot be tokenized, enabling pattern editor');
        setPatternEditorEnabled(true);
        hideDrumGrid();
        applyPatternEditorState();
        return;
      }

      // Show drum grid for drum banks
      console.log('🎹 Showing drum grid for drum bank');
      // Use time signature from modal select if available, otherwise fall back to currentTimeSignature
      const modalTimeSigSelect = document.getElementById('modal-time-signature-select');
      const timeSig = modalTimeSigSelect?.value || this.currentTimeSignature || '4/4';
      const metrics = getTimeSignatureMetrics(timeSig);
      console.log('🎹 Calling showDrumGrid with metrics:', metrics, 'pattern:', patternValue);
      showDrumGrid(metrics, patternValue);
    };

    const modalPatternTextarea = document.getElementById('modal-pattern');
    if (modalPatternTextarea) {
      modalPatternTextarea.addEventListener('input', () => {
        // CRITICAL: Don't trigger any evaluation or playback on input
        // This prevents auto-playback when patterns are typed or set programmatically
        if (!drumGridState.active || drumGridState.updatingFromGrid) {
          return;
        }
        if (!bankSelect || !isDrumBankValue(bankSelect.value)) {
          return;
        }
        // Use time signature from modal select if available, otherwise fall back to currentTimeSignature
        const modalTimeSigSelect = document.getElementById('modal-time-signature-select');
        const timeSig = modalTimeSigSelect?.value || this.currentTimeSignature || '4/4';
        const metrics = getTimeSignatureMetrics(timeSig);
        const trimmedValue = modalPatternTextarea.value ? modalPatternTextarea.value.trim() : '';
        const tokens = tokenizePattern(modalPatternTextarea.value);
        if (trimmedValue && (!tokens || tokens.length === 0)) {
          setPatternEditorEnabled(true);
          hideDrumGrid();
          return;
        }
        populateDrumGridFromPattern(modalPatternTextarea.value, metrics);
      });
    }

    if (patternEditorSelect) {
      patternEditorSelect.addEventListener('change', (event) => {
        const isCodeEditor = event.target.value === 'code';
        setPatternEditorEnabled(isCodeEditor);
        refreshDrumGridForCurrentState();
      });
    }
    
    // Time signature select in modal
    const modalTimeSignatureSelect = document.getElementById('modal-time-signature-select');
    if (modalTimeSignatureSelect) {
      modalTimeSignatureSelect.addEventListener('change', (e) => {
        const timeSignature = e.target.value;
        if (timeSignature) {
          this.currentTimeSignature = timeSignature;
          // Update drum grid if it's active
          if (drumGridState.active) {
            const metrics = getTimeSignatureMetrics(timeSignature);
            const currentPattern = getStrudelEditorValue('modal-pattern');
            const bankValue = bankSelect ? bankSelect.value : '';
            ensureDrumGridBuilt(metrics, bankValue);
            setDrumGridSubtitle(metrics);
            showDrumGrid(metrics, currentPattern);
          }
        }
      });
    }
    
    // Bar selector and add bar button
    const barCountEl = document.getElementById('modal-drum-grid-bar-count');
    const addBarBtn = document.getElementById('modal-drum-grid-add-bar');
    const leftArrow = document.getElementById('modal-drum-grid-bar-arrow-left');
    const rightArrow = document.getElementById('modal-drum-grid-bar-arrow-right');
    
    if (barCountEl) {
      barCountEl.addEventListener('click', () => {
        // Cycle through bars
        const nextBar = drumGridState.currentBar < drumGridState.numBars 
          ? drumGridState.currentBar + 1 
          : 1;
        switchToBar(nextBar);
      });
      barCountEl.style.cursor = 'pointer';
      barCountEl.title = 'Click to switch between bars';
    }
    
    if (leftArrow) {
      leftArrow.addEventListener('click', (e) => {
        e.stopPropagation();
        if (drumGridState.currentBar > 1) {
          switchToBar(drumGridState.currentBar - 1);
        }
      });
    }
    
    if (rightArrow) {
      rightArrow.addEventListener('click', (e) => {
        e.stopPropagation();
        if (drumGridState.currentBar < drumGridState.numBars) {
          switchToBar(drumGridState.currentBar + 1);
        }
      });
    }
    
    if (addBarBtn) {
      addBarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addBar();
      });
    }
    
    this.applyTimeSignatureToDrumGrid = (timeSignature) => {
      if (!drumGridSection || !drumGridState.active) return;
      const metrics = getTimeSignatureMetrics(timeSignature || '4/4');
      const currentPattern = getStrudelEditorValue('modal-pattern');
      const bankValue = bankSelect ? bankSelect.value : '';
      ensureDrumGridBuilt(metrics, bankValue);
      setDrumGridSubtitle(metrics);
      showDrumGrid(metrics, currentPattern);
    };
    
    /* Removed duplicate closeModal/openModal declarations to avoid redeclaration errors */

    // Close button
    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }

    // File input - handle file selection
    const fileInput = document.getElementById('modal-sample-file');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files.length > 0 ? e.target.files[0] : null;
        const patternBankGroup = document.getElementById('modal-pattern-bank')?.closest('.form-group');
        const timeSignatureGroup = document.getElementById('modal-time-signature-select')?.closest('.form-group');
        const titleInput = document.getElementById('modal-title');
        
        if (file) {
          // Hide Pattern Bank when file is selected
          // Time Signature visibility is controlled by editor state (step vs code editor)
          if (patternBankGroup) {
            patternBankGroup.style.display = 'none';
          }
          // Hide Time Signature when file is selected (regardless of editor state)
          if (timeSignatureGroup) {
            timeSignatureGroup.style.display = 'none';
          }
          
          // Set title to filename (without extension)
          if (titleInput) {
            const fileName = file.name;
            const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
            titleInput.value = nameWithoutExt;
          }
        } else {
          // Show Pattern Bank when file is cleared
          // Time Signature visibility is controlled by editor state (step vs code editor)
          if (patternBankGroup) {
            patternBankGroup.style.display = 'block';
          }
          // Time Signature visibility is handled by applyPatternEditorState()
        }
      });
    }
    
    // Key/Scale dropdowns - apply to pattern when changed
    const modalKeySelect = document.getElementById('modal-key-select');
    const modalScaleSelect = document.getElementById('modal-scale-select');
    
    // Lightweight syntax validator for obvious issues (balanced quotes/parens)
    const isLikelyValidPattern = (code) => {
      if (typeof code !== 'string') return false;
      let depth = 0;
      let inStr = false;
      let strCh = '';
      for (let i = 0; i < code.length; i++) {
        const c = code[i];
        if (inStr) {
          if (c === '\\') { i++; continue; }
          if (c === strCh) { inStr = false; strCh = ''; }
          continue;
        }
        if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
        if (c === '(') depth++;
        if (c === ')') depth--;
        if (depth < 0) return false;
      }
      return !inStr && depth === 0;
    };
    
    // Upsert .scale() and .s() modifiers; when pattern empty, use (silence) as neutral base
    const upsertPatternModifiers = (pattern, nextKey, nextScale, nextBank) => {
      const original = pattern || '';
      let base = original.trim();
      const hasAnyModifier = /\.\s*(s|sound|scale)\s*\(/i.test(base);
      if (!base) {
        base = '(silence)';
      } else if (!base.startsWith('(') || !base.endsWith(')')) {
        // Wrap when adding modifiers
        if (!hasAnyModifier) {
          base = `(${base})`;
        }
      }
      
      // Extract existing modifiers (so we can preserve when not overridden)
      const scaleMatch = base.match(/\.\s*scale\s*\(\s*['"]([^'"]+)['"]\s*\)/i);
      const existingScaleArg = scaleMatch ? scaleMatch[1] : null;
      const soundMatch = base.match(/\.\s*(s|sound)\s*\(\s*["']([^"']+)["']\s*\)/i);
      const existingSoundArg = soundMatch ? soundMatch[2] : null;
      
      // Remove existing .scale() and .s() (we'll re-add in canonical order: scale then s)
      let updated = base
        .replace(/\.\s*scale\s*\([^)]*\)/gi, '')
        .replace(/\.\s*(s|sound)\s*\([^)]*\)/gi, '');
      
      // Add scale first if provided
      const haveNewScale = (nextScale && nextScale.trim() !== '') || (nextKey && nextKey.trim() !== '');
      if (haveNewScale) {
        const keyPart = (nextKey && nextKey.trim() !== '') ? nextKey.trim().toLowerCase() : 'c';
        const scalePart = (nextScale && nextScale.trim() !== '') ? nextScale.trim() : 'major';
        updated = `${updated}.scale('${keyPart}:${scalePart}')`;
      } else if (existingScaleArg) {
        // Preserve prior scale if not overridden
        updated = `${updated}.scale('${existingScaleArg}')`;
      }
      
      // Then add sound/bank if provided
      if (nextBank && nextBank.trim() !== '') {
        updated = `${updated}.s("${nextBank.trim()}")`;
      } else if (existingSoundArg) {
        // Preserve prior sound if not overridden
        updated = `${updated}.s("${existingSoundArg}")`;
      }
      
      return updated;
    };
    
    const applyKeyScaleToPattern = (forceNoteNames = false) => {
      const patternValue = getStrudelEditorValue('modal-pattern');
      const keyValue = modalKeySelect ? (modalKeySelect.value || null) : null;
      const scaleValue = modalScaleSelect ? (modalScaleSelect.value || null) : null;
      
      console.log(`🎼 applyKeyScaleToPattern called: keyValue="${keyValue}", scaleValue="${scaleValue}"`);
      
      // Apply if at least one value is set (key or scale)
      if (!keyValue && !scaleValue) {
        console.log(`⚠️ No key/scale selected, skipping`);
        return; // No key/scale selected
      }
      
      // When selecting key/scale, update the existing pattern rather than replacing it
      const keepNotesCheckbox = document.getElementById('modal-keep-notes-as-written');
      const useNoteNames = forceNoteNames || (keepNotesCheckbox && keepNotesCheckbox.checked);
      const keyToPass = keyValue && keyValue.trim() !== '' ? keyValue : null;
      const scaleToPass = scaleValue && scaleValue.trim() !== '' ? scaleValue : null;
      
      // If no pattern or non-note pattern, render notes for selected scale instead of (silence)
      if (!patternValue || patternValue.trim() === '' || !containsNoteCall(patternValue)) {
        // Determine existing or selected bank to preserve
        let existingBank = null;
        if (patternValue && patternValue.trim() !== '') {
          const m = patternValue.match(/\.\s*(s|sound)\s*\(\s*["']([^"']+)["']\s*\)/i);
          if (m && m[2]) existingBank = m[2];
        }
        if (!existingBank) {
          const bankSelectEl = document.getElementById('modal-pattern-bank');
          if (bankSelectEl && bankSelectEl.value) {
            existingBank = bankSelectEl.value.toLowerCase();
          }
        }
        
        let basePattern = '';
        if (useNoteNames) {
          // note("...") with scale notes
          if (typeof this.getAllScaleNotesAsNoteNames === 'function') {
            basePattern = this.getAllScaleNotesAsNoteNames(keyValue || 'C', scaleValue || 'chromatic') || '';
          }
          if (!basePattern) {
            // Fallback: build from numeric degrees
            const numeric = this.getAllScaleNotesAsPattern(keyValue || 'C', scaleValue || 'chromatic');
            if (numeric) {
              basePattern = this.convertNumericPatternToNoteNames(numeric, keyValue || 'C', scaleValue || 'chromatic');
            }
          }
        } else {
          // n("0 1 2 ...").scale('key:scale')
          const numeric = this.getAllScaleNotesAsPattern(keyValue || 'C', scaleValue || 'chromatic');
          if (numeric) {
            const numMatch = numeric.match(/(?:note|n)\s*\(\s*["']([^"']+)["']\s*\)/);
            const numbers = numMatch ? numMatch[1] : '0 1 2 3 4 5';
            const scaleStr = `${(keyValue || 'C').toLowerCase()}:${scaleValue || 'chromatic'}`;
            basePattern = `n("${numbers}").scale('${scaleStr}')`;
          }
        }
        
        if (!basePattern) {
          console.warn('⚠️ Could not generate scale notes for empty/non-note pattern');
          return;
        }
        
        // Append existing/selected bank if present
        if (existingBank) {
          basePattern = `${basePattern}.s("${existingBank}")`;
        }
        
        if (isLikelyValidPattern(basePattern)) {
          setStrudelEditorValue('modal-pattern', basePattern);
          console.log(`🎼 Inserted scale notes for empty/non-note pattern: ${basePattern}`);
        } else {
          console.warn('⚠️ Generated scale-notes pattern failed quick syntax check; not applying');
        }
        return;
      }
      
      // Use the same detection logic as applyGlobalSettingsToPattern
      const hasNoteFunction = /\b(note|n)\s*\(/.test(patternValue);
      const hasNoteNames = /\b(note|n)\s*\(\s*["'][a-g][#b]?/.test(patternValue);
      const hasChordNames = /\b(note|n)\s*\(\s*["'][a-g][#b]?[a-z0-9]*\s*[a-z]/.test(patternValue) ||
                           /\b(note|n)\s*\(\s*["'][^"']*\b(maj|min|m|dim|aug|sus|add|7|9|11|13)\b/i.test(patternValue);
      const hasChordModifier = /\.\s*chord\s*\(/i.test(patternValue);
      const hasLetterNotes = /\b(note|n)\s*\(\s*["'][^"']*[a-g][#b]?\s/.test(patternValue);
      const hasExplicitNotes = hasNoteNames || hasChordNames || hasLetterNotes || hasChordModifier;
      const isNumericPattern = hasNoteFunction && !hasExplicitNotes && !hasChordModifier;
      
      if (useNoteNames && hasNoteNames && !hasChordModifier) {
        const numericPattern = soundManager.convertNoteNamesToSemitones(patternValue);
        const conversionKey = keyToPass || 'C';
        const conversionScale = scaleToPass || 'chromatic';
        let convertedPattern = numericPattern
          ? this.convertNumericPatternToNoteNames(numericPattern, conversionKey, conversionScale)
          : null;
        if (!convertedPattern || convertedPattern === patternValue) {
          convertedPattern = this.convertNumericPatternToNoteNames(patternValue, conversionKey, conversionScale);
        }
        if (convertedPattern && convertedPattern !== patternValue) {
          const latestScale = buildScaleModifier(keyToPass, scaleToPass);
          if (latestScale) {
            lastRemovedScaleModifier = latestScale;
          }
          semitoneSnapshotLocked = true;
          syncLastSemitonePattern(convertedPattern, true);
          setStrudelEditorValue('modal-pattern', convertedPattern);
          if (keyToPass) { soundManager.currentKey = keyToPass; }
          if (scaleToPass) { soundManager.currentScale = scaleToPass; }
          const ta = document.getElementById('modal-pattern');
          if (ta) {
            try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
            try { ta.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
          }
          console.log(`🎼 Converted note names to new key/scale: ${convertedPattern.substring(0, 120)}...`);
          return;
        } else {
          console.log(`⚠️ Note names unchanged after conversion attempt (key=${conversionKey}, scale=${conversionScale})`);
        }
      }
      
      if (!hasChordModifier && isNumericPattern) {
        // Apply key/scale to pattern immediately
        console.log(`🎼 applyKeyScaleToPattern: keyValue="${keyValue}", scaleValue="${scaleValue}", pattern="${patternValue.substring(0, 50)}..."`);

        // Convert pattern to new scale - preserve existing notes, convert them to new scale
        let convertedPattern = patternValue;
        if (scaleToPass && (keyToPass || scaleToPass)) {
          if (useNoteNames) {
            // Convert existing pattern to note names in the new scale
            const hasNoteNames = /\b(note|n)\s*\(\s*["'][a-gA-G][#b]?\d/.test(patternValue);
            const hasNumericNotes = /\b(n|note)\s*\(\s*["'][\d\s]+["']/.test(patternValue);
            
            if (hasNumericNotes && !hasNoteNames) {
              // Convert numeric pattern to note names in the new scale
              convertedPattern = this.convertNumericPatternToNoteNames(patternValue, keyToPass, scaleToPass);
              console.log(`🎼 Converted numeric pattern to note names in ${scaleToPass}: ${convertedPattern.substring(0, 100)}...`);
            } else if (hasNoteNames) {
              // Pattern already has note names - convert them to the new scale
              // First force-convert to numeric (semitone offsets), then back to note names in new scale
              const numericPattern = soundManager.convertNoteNamesToSemitones(patternValue);
              if (numericPattern && numericPattern !== patternValue) {
                convertedPattern = this.convertNumericPatternToNoteNames(numericPattern, keyToPass, scaleToPass);
                console.log(`🎼 Converted note names to ${scaleToPass} scale: ${convertedPattern.substring(0, 100)}...`);
              } else {
                // If conversion failed, try direct conversion
                convertedPattern = this.convertNumericPatternToNoteNames(patternValue, keyToPass, scaleToPass);
              }
            }
            
            // Ensure count of notes matches scale length by rebuilding from canonical degrees
            try {
              const desiredNumeric = this.getAllScaleNotesAsPattern(keyToPass || 'C', scaleToPass || 'chromatic');
              if (desiredNumeric) {
                const desiredNames = this.convertNumericPatternToNoteNames(desiredNumeric, keyToPass || 'C', scaleToPass || 'chromatic');
                const desiredMatch = desiredNames.match(/\b(note|n)\s*\(\s*["']([^"']+)["']\s*\)/i);
                const currentMatch = convertedPattern.match(/\b(note|n)\s*\(\s*["']([^"']+)["']\s*\)/i);
                if (desiredMatch && currentMatch) {
                  const desiredList = desiredMatch[2];
                  // Replace current note list with desired to reflect new scale length
                  convertedPattern = convertedPattern.replace(/\b(note|n)\s*\(\s*["'][^"']+["']\s*\)/i, (m, func) => {
                    return `${func}("${desiredList}")`;
                  });
                  console.log(`🎼 Resized note names to match scale: ${desiredList}`);
                }
              }
            } catch {}
          } else {
            // For semitones mode, upsert .scale() directly on the pattern to ensure replacement
            const upserted = upsertPatternModifiers(patternValue, keyToPass, scaleToPass, null);
            if (isLikelyValidPattern(upserted)) {
              convertedPattern = upserted;
              // Shrink/expand numeric degrees to match the selected scale length
              const numMatch = convertedPattern.match(/\b(n|note)\s*\(\s*["']([^"']+)["']\s*\)/i);
              if (numMatch && numMatch[2]) {
                const rawNums = numMatch[2].trim().split(/\s+/).map(x => parseInt(x, 10)).filter(n => !isNaN(n));
                const desired = this.getAllScaleNotesAsPattern(keyToPass || 'C', scaleToPass || 'chromatic');
                if (desired) {
                  const desiredNumsMatch = desired.match(/\b(n|note)\s*\(\s*["']([^"']+)["']\s*\)/i);
                  const desiredNums = desiredNumsMatch ? desiredNumsMatch[2] : null;
                  if (desiredNums) {
                    const desiredCount = desiredNums.trim().split(/\s+/).length;
                    if (rawNums.length !== desiredCount) {
                      convertedPattern = convertedPattern.replace(/\b(n|note)\s*\(\s*["'][^"']+["']\s*\)/i, (m, func) => {
                        return `${func}("${desiredNums}")`;
                      });
                      console.log(`🎼 Resized numeric degrees to match scale (${desiredCount} steps): ${desiredNums}`);
                    }
                  }
                }
              }
            } else {
              // Fallback: preserve existing pattern and let applyGlobalSettingsToPattern handle it
            convertedPattern = patternValue;
            }
            console.log(`🎼 Semitone mode: upserted scale=${scaleToPass} key=${keyToPass}`);
          }
        }
        
        // Only add .scale() modifier if using semitones (not note names)
        let patternWithScale = useNoteNames 
          ? convertedPattern  // Don't add scale modifier for note names
          : convertedPattern; // Already upserted .scale() above (or preserved)
        console.log(`🎼 applyKeyScaleToPattern: result="${patternWithScale ? patternWithScale.substring(0, 80) : 'null'}..."`);
        console.log(`🎼 Pattern comparison - original length: ${patternValue.length}, new length: ${patternWithScale ? patternWithScale.length : 0}, same: ${patternWithScale === patternValue}`);
        
        if (!useNoteNames && patternWithScale && containsNumericNotePattern(patternWithScale)) {
          const normalizedNumeric = normalizeNumericPatternForScale(patternWithScale, keyToPass, scaleToPass);
          if (normalizedNumeric && normalizedNumeric !== patternWithScale) {
            patternWithScale = normalizedNumeric;
            console.log(`🎼 Normalized numeric pattern to scale degrees (${scaleToPass || 'chromatic'})`);
          }
        }
        
        // Ensure numeric degree list matches selected scale length immediately after selection
        if (!useNoteNames && patternWithScale && (keyToPass || scaleToPass)) {
          try {
            const scalePattern = this.getAllScaleNotesAsPattern(keyToPass || 'C', scaleToPass || 'chromatic');
            const desiredNumsMatch = scalePattern && scalePattern.match(/\b(n|note)\s*\(\s*["']([^"']+)["']\s*\)/i);
            const desiredNums = desiredNumsMatch ? desiredNumsMatch[2] : null;
            const currentNumsMatch = patternWithScale.match(/\b(n|note)\s*\(\s*["']([^"']+)["']\s*\)/i);
            if (desiredNums && currentNumsMatch && currentNumsMatch[2]) {
              const currentTokens = currentNumsMatch[2].trim().split(/\s+/);
              const allNumeric = currentTokens.every(t => /^-?\d+$/.test(t));
              const ascendingFromZero = allNumeric && currentTokens.every((t, i) => parseInt(t, 10) === i);
              if (ascendingFromZero) {
                patternWithScale = patternWithScale.replace(/\b(n|note)\s*\(\s*["'][^"']+["']\s*\)/i, (m, func) => {
                  return `${func}("${desiredNums}")`;
                });
                console.log(`🎼 Resized numeric degrees to match scale (${scaleToPass || 'chromatic'}): ${desiredNums}`);
              }
            }
            
            const remapKey = keyToPass || 'C';
            const remapScale = scaleToPass || 'chromatic';
            const noteNameVersion = this.convertNumericPatternToNoteNames(patternWithScale, remapKey, remapScale);
            if (noteNameVersion) {
              const degreeVersion = soundManager.convertNoteNamesToScaleDegrees(noteNameVersion, remapKey, remapScale);
              if (degreeVersion && isLikelyValidPattern(degreeVersion)) {
                patternWithScale = degreeVersion;
                console.log(`🎼 Normalized numeric degrees to scale length (${remapScale})`);
              }
            }
          } catch (e) {
            console.warn('⚠️ Degree resize failed:', e);
          }
        }
        
        if (useNoteNames && (keyToPass || scaleToPass)) {
          const latestScale = buildScaleModifier(keyToPass || null, scaleToPass || null);
          if (latestScale) {
            lastRemovedScaleModifier = latestScale;
          }
        }

        if (patternWithScale) {
          if (!useNoteNames && containsNumericNotePattern(patternWithScale)) {
            patternWithScale = normalizeNumericPatternForScale(patternWithScale, keyToPass, scaleToPass);
            lastCanonicalNumericPattern = patternWithScale;
          }
          semitoneSnapshotLocked = false;
          syncLastSemitonePattern(patternWithScale, true);
          // Always update the editor, even if the pattern appears the same (to ensure scale is updated)
          setStrudelEditorValue('modal-pattern', patternWithScale);
          // Sync and notify editor
          if (keyToPass) { soundManager.currentKey = keyToPass; }
          if (scaleToPass) { soundManager.currentScale = scaleToPass; }
          const ta = document.getElementById('modal-pattern');
          if (ta) {
            try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
            try { ta.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
          }
          console.log(`✅ Applied key/scale to pattern immediately: ${patternWithScale.substring(0, 100)}...`);
        } else {
          console.log(`⚠️ Pattern unchanged - applyGlobalSettingsToPattern returned null or undefined`);
        }
      } else {
        // If we're in semitone mode but the pattern has note names, convert to degrees, upsert scale, and write back
        if (!hasChordModifier && hasExplicitNotes && !useNoteNames) {
          const patternScale = extractScaleFromPattern(patternValue);
          let mappingKey = keyToPass || null;
          let mappingScale = scaleToPass || null;
          if (patternScale) {
            mappingKey = mappingKey || patternScale.key || null;
            mappingScale = mappingScale || patternScale.scale || null;
          }
          const fallbackKey = mappingKey || 'C';
          const fallbackScale = mappingScale || 'chromatic';
          const numericPattern = soundManager.convertNoteNamesToScaleDegrees(patternValue, fallbackKey, fallbackScale);
          const normalizedPattern = normalizeNumericPatternForScale(numericPattern || patternValue, keyToPass, scaleToPass);
          const upserted = upsertPatternModifiers(normalizedPattern || patternValue, keyToPass, scaleToPass, null);
          if (isLikelyValidPattern(upserted)) {
            setStrudelEditorValue('modal-pattern', upserted);
            if (keyToPass) { soundManager.currentKey = keyToPass; }
            if (scaleToPass) { soundManager.currentScale = scaleToPass; }
            const ta = document.getElementById('modal-pattern');
            if (ta) {
              try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
              try { ta.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
            }
            console.log(`✅ Converted note names to semitone degrees for scale: ${upserted.substring(0, 120)}...`);
          } else {
            console.log(`⚠️ Conversion to semitones or upsert failed validation; leaving pattern unchanged`);
        }
      } else {
        console.log(`⚠️ Cannot apply scale - hasChordModifier: ${hasChordModifier}, isNumericPattern: ${isNumericPattern}, hasNoteFunction: ${hasNoteFunction}, hasExplicitNotes: ${hasExplicitNotes}`);
        }
      }
    };
    
    if (modalKeySelect && !modalKeySelect.dataset.listenerAttached) {
      modalKeySelect.addEventListener('change', () => {
        applyKeyScaleToPattern(false);
      });
      modalKeySelect.dataset.listenerAttached = 'true';
    }
    
    if (modalScaleSelect && !modalScaleSelect.dataset.listenerAttached) {
      modalScaleSelect.addEventListener('change', () => {
        // Respect the Semitones/Note names toggle (do not force note names)
        applyKeyScaleToPattern(false);
      });
      modalScaleSelect.dataset.listenerAttached = 'true';
    }
    
    // Function to extract scale from pattern's .scale() modifier
    const extractScaleFromPattern = (pattern) => {
      // Look for .scale('key:scale') or .scale('scale')
      const scaleMatch = pattern.match(/\.\s*scale\s*\(\s*['"]([^'"]+)['"]\s*\)/i);
      if (scaleMatch && scaleMatch[1]) {
        const scaleValue = scaleMatch[1];
        // Check if it's in format "key:scale" or just "scale"
        if (scaleValue.includes(':')) {
          const [keyPart, scalePart] = scaleValue.split(':');
          return { key: keyPart.trim(), scale: scalePart.trim() };
        } else {
          // Just scale name, use C as default key
          return { key: 'C', scale: scaleValue.trim() };
        }
      }
      return null;
    };
    
    // Remember last removed .scale() modifier so we can restore it when switching formats
    let lastRemovedScaleModifier = null;
    // Remember last semitone pattern when toggling to note names so we can restore it verbatim
    let lastSemitonePattern = null;
    let semitoneSnapshotLocked = false;
    let lastCanonicalNumericPattern = null;
    let lastNoteNamesSnapshot = null;

    const buildScaleModifier = (keyValue, scaleValue) => {
      const hasKey = keyValue && keyValue.trim() !== '';
      const hasScale = scaleValue && scaleValue.trim() !== '';
      if (!hasKey && !hasScale) {
        return null;
      }
      const keyPart = hasKey ? keyValue.trim().toLowerCase() : 'c';
      const scalePart = hasScale ? scaleValue.trim() : 'major';
      return `.scale('${keyPart}:${scalePart}')`;
    };

    const syncLastSemitonePattern = (pattern, force = false) => {
      if (!pattern || !containsNoteCall(pattern)) {
        lastSemitonePattern = null;
        semitoneSnapshotLocked = false;
        return;
      }
      if (semitoneSnapshotLocked && !force) {
        return;
      }
      if (containsNumericNotePattern(pattern)) {
        lastSemitonePattern = pattern;
        return;
      }
      const numericVersion = soundManager.convertNoteNamesToSemitones(pattern);
      if (numericVersion && containsNumericNotePattern(numericVersion)) {
        lastSemitonePattern = numericVersion;
      }
    };
    
    const insertScaleModifier = (pattern, scaleModifier) => {
      if (!pattern || !scaleModifier) {
        return pattern;
      }
      if (/\.\s*scale\s*\(/i.test(pattern)) {
        return pattern;
      }
      const sampleIndex = pattern.search(/\.(s|sound)\s*\(/i);
      if (sampleIndex !== -1) {
        const before = pattern.slice(0, sampleIndex);
        const after = pattern.slice(sampleIndex);
        return `${before}${scaleModifier}${after}`;
      }
      const trimmed = pattern.trim();
      if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        return `${pattern}${scaleModifier}`;
      }
      return `(${pattern})${scaleModifier}`;
    };
    
    const normalizeNumericPatternForScale = (pattern, keyValue, scaleValue) => {
      if (!pattern || !containsNumericNotePattern(pattern)) {
        return pattern;
      }
      const patternScale = (!keyValue || !keyValue.trim() || !scaleValue || !scaleValue.trim())
        ? extractScaleFromPattern(pattern)
        : null;
      const keySafe = (keyValue && keyValue.trim()) || patternScale?.key || 'C';
      const scaleSafe = (scaleValue && scaleValue.trim()) || patternScale?.scale || 'chromatic';
      const noteVersion = this.convertNumericPatternToNoteNames(pattern, keySafe, scaleSafe);
      if (!noteVersion) {
        return pattern;
      }
      const degreeVersion = soundManager.convertNoteNamesToScaleDegrees(noteVersion, keySafe, scaleSafe);
      if (degreeVersion && containsNumericNotePattern(degreeVersion)) {
        const steps = soundManager.getScaleSemitoneSteps(keySafe, scaleSafe);
        if (!steps || steps.length === 0) {
          return degreeVersion;
        }
        const scaleLen = steps.length;
        const collapseSequentialRuns = (code) => {
          const regex = /\b(n|note)\s*\(\s*(["'])([\s\S]*?)\2\s*\)/gi;
          return code.replace(regex, (match, funcName, quote, content) => {
            const tokens = content.trim().split(/\s+/);
            if (tokens.length <= scaleLen) {
              return match;
            }
            const ints = tokens.map(token => {
              const parsed = parseInt(token, 10);
              return Number.isFinite(parsed) ? parsed : null;
            });
            if (ints.some(val => val === null)) {
              return match;
            }
            const isSimpleSequence = ints.every((val, idx) => val === idx);
            if (!isSimpleSequence) {
              return match;
            }
            const canonical = Array.from({ length: scaleLen }, (_, i) => String(i)).join(' ');
            return `${funcName}(${quote}${canonical}${quote})`;
          });
        };
        return collapseSequentialRuns(degreeVersion);
      }
      return pattern;
    };
    
    // Function to convert pattern between semitones and note names
    const convertPatternFormat = (pattern, toNoteNames, skipSnapshot = false) => {
      if (!pattern || !containsNoteCall(pattern)) return pattern;
      
      const hasNoteNames = (soundManager.patternHasNoteNames && soundManager.patternHasNoteNames(pattern)) ||
        /\b(note|n)\s*\(\s*["'][^"']*[a-gA-G][#b]?\d/i.test(pattern);
      const hasNumericNotes = (soundManager.patternHasNumericNotePattern && soundManager.patternHasNumericNotePattern(pattern)) ||
        (/\b(note|n)\s*\(\s*["'][\d\s\-~<>[\]]+["']/i.test(pattern) && !hasNoteNames);
      
      if (toNoteNames) {
        // Convert semitones to note names
        if (hasNumericNotes && !hasNoteNames) {
          if (!semitoneSnapshotLocked) {
            lastSemitonePattern = pattern;
          }
          semitoneSnapshotLocked = true;
          // First, try to extract scale from pattern's .scale() modifier
          const patternScale = extractScaleFromPattern(pattern);
          
          // Get key/scale from modal or pattern
          const modalKeySelect = document.getElementById('modal-key-select');
          const modalScaleSelect = document.getElementById('modal-scale-select');
          let keyValue = modalKeySelect ? (modalKeySelect.value || null) : null;
          let scaleValue = modalScaleSelect ? (modalScaleSelect.value || null) : null;
          
          // If pattern has .scale() modifier, use that scale (it's what's actually being played)
          if (patternScale) {
            keyValue = patternScale.key;
            scaleValue = patternScale.scale;
            console.log(`🎼 Using scale from pattern .scale() modifier: ${keyValue}:${scaleValue}`);
          }
          
          if (keyValue || scaleValue) {
            // Use key/scale to convert - call method on app instance
            return appInstance.convertNumericPatternToNoteNames(pattern, keyValue, scaleValue || 'major');
          } else {
            // No key/scale, use default C major
            console.log(`⚠️ No key/scale selected, using C major for conversion`);
            return appInstance.convertNumericPatternToNoteNames(pattern, 'C', 'major');
          }
        }
        // Already in note names or can't convert
        return pattern;
      } else {
        // Convert note names to semitones/scale degrees
        if (hasNoteNames && !hasNumericNotes) {
          semitoneSnapshotLocked = false;
          if (lastSemitonePattern && containsNumericNotePattern(lastSemitonePattern)) {
            console.log('🔁 Restoring semitone snapshot for note-name toggle');
            return lastSemitonePattern;
          }
          // Prefer generating degrees sized to the current scale length
          const patternScale = extractScaleFromPattern(pattern);
          let keyValue = null;
          let scaleValue = null;
          if (patternScale) {
            keyValue = patternScale.key;
            scaleValue = patternScale.scale;
          } else {
            const modalKeySelect = document.getElementById('modal-key-select');
            const modalScaleSelect = document.getElementById('modal-scale-select');
            keyValue = modalKeySelect ? (modalKeySelect.value || 'C') : 'C';
            scaleValue = modalScaleSelect ? (modalScaleSelect.value || 'chromatic') : 'chromatic';
          }
          const converted = soundManager.convertNoteNamesToScaleDegrees(pattern, keyValue || 'C', scaleValue || 'chromatic');
          if (converted && converted !== pattern) {
            console.log(`🔄 Converted note names to scale degrees: ${converted.substring(0, 80)}...`);
            syncLastSemitonePattern(converted, true);
            lastCanonicalNumericPattern = converted;
            return converted;
          }
          return pattern;
        }
        // Already in semitones or can't convert
        return pattern;
      }
    };
    
    // Toggle switch - update pattern when switched between Semitones and Note names
    const keepNotesCheckbox = document.getElementById('modal-keep-notes-as-written');
    if (keepNotesCheckbox && !keepNotesCheckbox.dataset.listenerAttached) {
      keepNotesCheckbox.addEventListener('change', () => {
        const patternValue = getStrudelEditorValue('modal-pattern');
        const useNoteNames = keepNotesCheckbox.checked;
        
        // Convert pattern format based on toggle state
        let convertedPattern;
        if (!useNoteNames && lastNoteNamesSnapshot && patternValue === lastNoteNamesSnapshot && lastCanonicalNumericPattern) {
          convertedPattern = lastCanonicalNumericPattern;
          console.log('🔁 Restoring canonical numeric pattern from snapshot');
        } else {
          convertedPattern = convertPatternFormat(patternValue, useNoteNames, true);
        }
        
        const modalKeySelectRef = document.getElementById('modal-key-select');
        const modalScaleSelectRef = document.getElementById('modal-scale-select');
        
        if (useNoteNames) {
          semitoneSnapshotLocked = true;
        } else {
          semitoneSnapshotLocked = false;
        }
        
        // If switching to note names, remove .scale() modifier but remember it
        if (useNoteNames && convertedPattern) {
          const scaleRegex = /\.\s*scale\s*\((['"])(?:(?=(\\?))\2.)*?\1\)/gi;
          const matches = convertedPattern.match(scaleRegex);
          if (matches && matches.length > 0) {
            lastRemovedScaleModifier = matches[matches.length - 1];
          } else {
            const fallbackScale = buildScaleModifier(modalKeySelectRef?.value, modalScaleSelectRef?.value);
            if (fallbackScale) {
              lastRemovedScaleModifier = fallbackScale;
            }
          }
          convertedPattern = convertedPattern.replace(scaleRegex, '');
          convertedPattern = convertedPattern.replace(/\.\s*scale\s*\([^)]*\)/gi, '');
          // Clean up any double dots or trailing dots
          convertedPattern = convertedPattern.replace(/\.+/g, '.').replace(/\.\s*\./g, '.').trim();
          convertedPattern = convertedPattern.replace(/\.+$/, '').trim();
          console.log(`🗑️ Removed .scale() modifier when switching to note names`);
        } else if (!useNoteNames && convertedPattern && lastRemovedScaleModifier) {
          convertedPattern = insertScaleModifier(convertedPattern, lastRemovedScaleModifier);
        }
        
        if (convertedPattern !== patternValue) {
          setStrudelEditorValue('modal-pattern', convertedPattern);
          if (useNoteNames) {
            lastCanonicalNumericPattern = patternValue;
            lastNoteNamesSnapshot = convertedPattern;
            semitoneSnapshotLocked = true;
          } else {
            lastNoteNamesSnapshot = null;
            semitoneSnapshotLocked = false;
            syncLastSemitonePattern(convertedPattern, true);
          }
          console.log(`🔄 Converted pattern ${useNoteNames ? 'to note names' : 'to semitones'}: ${convertedPattern.substring(0, 100)}...`);
        } else if (!useNoteNames) {
          lastNoteNamesSnapshot = null;
          semitoneSnapshotLocked = false;
          syncLastSemitonePattern(patternValue, true);
        }
        
        // Update key/scale visibility based on toggle state
        updateKeyScaleVisibility();
        // Don't call applyKeyScaleToPattern() here to prevent feedback loop
        // The pattern conversion above handles the format change
      });
      keepNotesCheckbox.dataset.listenerAttached = 'true';
    }
    
    // Function to update key/scale visibility based on toggle state
    const updateKeyScaleVisibility = () => {
      const keyScaleGroup = document.getElementById('modal-key-scale-group');
      if (!keyScaleGroup) return;
      
      const keepNotesCheckbox = document.getElementById('modal-keep-notes-as-written');
      const patternValue = getStrudelEditorValue('modal-pattern');
      const hasNotePattern = patternValue && containsNoteCall(patternValue);
      
      // Always show Key/Scale when pattern has notes, regardless of Semitones/Note names toggle
      keyScaleGroup.style.display = hasNotePattern ? 'block' : 'none';
    };

    syncLastSemitonePattern(getStrudelEditorValue('modal-pattern'), true);
    
    this.syncElementsFromMasterPattern = (masterPattern) => {
      if (!masterPattern || typeof masterPattern !== 'string') {
        console.warn('⚠️ Cannot sync elements - master pattern missing or invalid');
        return;
      }
      
      try {
        const tempoRegex = /^\/\/\s*Controls Selected Tempo:[^\n]*\n?/im;
        let sanitized = masterPattern.replace(tempoRegex, '').trim();
        if (!sanitized) {
          console.warn('⚠️ Master pattern empty after sanitizing, skipping element sync');
          return;
        }

        let parseTarget = sanitized;
        const stackIdx = sanitized.indexOf('stack(');
        if (stackIdx !== -1) {
          const firstParen = sanitized.indexOf('(', stackIdx);
          if (firstParen !== -1) {
            let depth = 1;
            let i = firstParen + 1;
            let inString = false;
            let stringChar = null;
            while (i < sanitized.length && depth > 0) {
              const char = sanitized[i];
              const prevChar = sanitized[i - 1];
              if (inString) {
                if (char === stringChar && prevChar !== '\\') {
                  inString = false;
                  stringChar = null;
                }
              } else {
                if (char === '"' || char === "'") {
                  inString = true;
                  stringChar = char;
                } else if (char === '(') {
                  depth++;
                } else if (char === ')') {
                  depth--;
                  if (depth === 0) {
                    parseTarget = sanitized.slice(firstParen + 1, i);
                    break;
                  }
                }
              }
              i++;
            }
          }
        }

        const channelRegex = /\s*\/\*\s*Channel\s+(\d+)\s*\*\/([\s\S]*?)(?=(\s*\/\*\s*Channel\s+\d+\s*\*\/)|$)/g;
        let match;
        const updatedElements = [];

        while ((match = channelRegex.exec(parseTarget)) !== null) {
          const channelNumber = parseInt(match[1], 10);
          if (!Number.isFinite(channelNumber) || channelNumber < 1) {
            continue;
          }
          
          let patternBody = match[2].trim();
          if (!patternBody) continue;
          
          patternBody = patternBody.replace(/^,+/, '').replace(/,+$/, '').trim();
          if (!patternBody) continue;
          
          const elementId = `element-${channelNumber}`;
          const existingConfig = this.loadElementConfig(elementId) || {};
          const newConfig = {
            ...existingConfig,
            pattern: patternBody
          };
          
          this.saveElementConfig(elementId, newConfig, true);
          
          if (soundManager.trackedPatterns?.has(elementId)) {
            const trackData = soundManager.trackedPatterns.get(elementId);
            if (trackData) {
              trackData.pattern = patternBody;
            }
          }

          if (this.currentEditingElementId === elementId) {
            const existingValue = getStrudelEditorValue('modal-pattern');
            if (existingValue?.trim() !== patternBody.trim()) {
              setStrudelEditorValue('modal-pattern', patternBody);
              console.log(`📝 Updated modal editor for ${elementId} to match master pattern`);
            }
            
            const isDrumPatternActive = drumGridState.active &&
              bankSelect &&
              isDrumBankValue(bankSelect.value);
            if (isDrumPatternActive) {
              console.log('🔁 Refreshing drum grid to match updated pattern');
              drumGridState.updatingFromPattern = true;
              const modalTimeSigSelect = document.getElementById('modal-time-signature-select');
              const timeSig = modalTimeSigSelect?.value || this.currentTimeSignature || '4/4';
              const metrics = getTimeSignatureMetrics(timeSig);
              populateDrumGridFromPattern(patternBody, metrics);
              drumGridState.updatingFromPattern = false;
            }
          }
          
          updatedElements.push(elementId);
        }
        
        if (updatedElements.length > 0) {
          console.log(`🔄 Synced master pattern changes to elements: ${updatedElements.join(', ')}`);
        } else {
          console.warn('ℹ️ No channel definitions found while syncing master pattern');
        }
      } catch (error) {
        console.warn('⚠️ Failed to sync master pattern to elements:', error);
      }
    };
    
    // Apply key/scale immediately when modal opens if pattern and values exist
    // This ensures the pattern is updated right away when the modal opens
    setTimeout(() => {
      const patternValue = getStrudelEditorValue('modal-pattern');
      const keyValue = modalKeySelect ? (modalKeySelect.value || null) : null;
      const scaleValue = modalScaleSelect ? (modalScaleSelect.value || null) : null;
      
      if (patternValue && containsNoteCall(patternValue) && (keyValue || scaleValue)) {
        console.log(`🎼 Applying initial key/scale on modal open: key="${keyValue}", scale="${scaleValue}"`);
        applyKeyScaleToPattern();
      }
    }, 200);
    
    // Bank dropdown - load bank when changed
    if (bankSelect && !bankSelect.dataset.listenerAttached) {
      bankSelect.addEventListener('change', async (e) => {
        const bankValue = e.target.value;
        console.log('📦 Bank select changed to:', bankValue);
        ensurePatternBankOptions(bankValue);
        const elementId = this.currentEditingElementId;
        
        // If bank is selected, clear file input and show Pattern Bank
        // Time Signature visibility is controlled by editor state (step vs code editor)
        if (bankValue && bankValue !== '') {
          if (fileInput) {
            fileInput.value = '';
          }
          const patternBankGroup = document.getElementById('modal-pattern-bank')?.closest('.form-group');
          if (patternBankGroup) {
            patternBankGroup.style.display = 'block';
          }
          // Time Signature visibility is handled by applyPatternEditorState()
          
          // Show/hide Key/Scale controls based on bank selection and toggle state
          updateKeyScaleVisibility();
        } else {
          // Hide Key/Scale if no bank selected or toggle state requires it
          updateKeyScaleVisibility();
        }
        
        if (!elementId) {
          console.warn('⚠️ No elementId when bank changed');
          return;
        }
        
        const statusText = document.getElementById('status-text');
        const patternTextarea = document.getElementById('modal-pattern');
        const masterIsRunning = !!soundManager?.masterActive;
        
        // Show placeholder only when a bank is selected and pattern is empty
        const currentValue = getStrudelEditorValue('modal-pattern');
        if (bankValue && bankValue !== '' && (!currentValue || currentValue.trim() === '')) {
          if (patternTextarea) patternTextarea.placeholder = 'Drums and Percussion: s("bd sd rim cp hh oh cr rd ht mt lt sh cb tb perc misc fx"), Synths: note("c3 d3 [e3 f3]")';
        }
        
        // Show/hide sample URL and file input based on bank selection
        const sampleUrlGroup = document.getElementById('modal-sample-url')?.closest('.form-group');
        const sampleFileGroup = document.getElementById('modal-sample-file')?.closest('.form-group');
        const hasBankSelected = bankValue && bankValue !== '';
        if (sampleUrlGroup) {
          sampleUrlGroup.style.display = hasBankSelected ? 'none' : 'block';
        }
        if (sampleFileGroup) {
          sampleFileGroup.style.display = hasBankSelected ? 'none' : 'block';
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
          
          // Update modal header title
          const modalElementId = document.getElementById('modal-element-id');
          if (modalElementId) {
            modalElementId.textContent = 'Default';
          }
          
          // Update title in DOM immediately and save it
          const element = document.querySelector(`[data-sound-id="${elementId}"]`);
          if (element) {
            const titleEl = element.querySelector('.element-title');
            if (titleEl) {
              titleEl.textContent = 'Default';
              console.log(`📝 Updated element title in DOM to: Default`);
            } else {
              console.warn(`⚠️ Element title not found for ${elementId}`);
            }
          } else {
            console.warn(`⚠️ Element not found: ${elementId}`);
          }
          
          // Save title immediately when Default is selected
          const currentConfig = this.loadElementConfig(elementId) || {};
          this.saveElementConfig(elementId, {
            ...currentConfig,
            title: 'Default',
            bank: undefined
          });
          console.log(`📝 Saved title "Default" for ${elementId}`);
          
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
          const canonicalBankValue = normalizeSynthBankName(bankValue);
          const synthSounds = [...OSCILLATOR_SYNTHS, ...SAMPLE_SYNTHS];
          const isSynthSound = synthSounds.includes(canonicalBankValue) || LEGACY_SAMPLE_SYNTHS.includes(bankValue);
          
          if (isSynthSound) {
            // Update title with better display names
            const titleInput = document.getElementById('modal-title');
            const displayNames = {
              'piano': 'Piano',
              'supersaw': 'Saw Synth',
              'gtr': 'Guitar',
              'casio': 'Casio',
              'wood': 'Jazz',  // Wood is now called Jazz
              'jazz': 'Jazz',
              'metal': 'Metal',
              'folkharp': 'Folk Harp',
              'superpiano': 'Piano'
            };
            const displayName = displayNames[canonicalBankValue] || displayNames[bankValue] || canonicalBankValue.charAt(0).toUpperCase() + canonicalBankValue.slice(1);
            
            // Handle synth sound - no bank loading needed
            console.log(`🎹 Using synth sound: ${canonicalBankValue}`);
            if (statusText) {
              statusText.textContent = `🎹 Using ${displayName}`;
            }
            titleInput.value = displayName;
            
            // Update modal header title
            const modalElementId = document.getElementById('modal-element-id');
            if (modalElementId) {
              modalElementId.textContent = displayName;
            }
            
            // Update title in DOM immediately and save it
            const element = document.querySelector(`[data-sound-id="${elementId}"]`);
            if (element) {
              const titleEl = element.querySelector('.element-title');
              if (titleEl) {
                titleEl.textContent = displayName;
                console.log(`📝 Updated element title in DOM to: ${displayName}`);
              } else {
                console.warn(`⚠️ Element title not found for ${elementId}`);
              }
            } else {
              console.warn(`⚠️ Element not found: ${elementId}`);
            }
            
            // Save title immediately when synth is selected
            const currentConfig = this.loadElementConfig(elementId) || {};
            this.saveElementConfig(elementId, {
              ...currentConfig,
              title: displayName,
              bank: bankValue
            });
            console.log(`📝 Saved title "${displayName}" for ${elementId}`);
            
            // Update pattern to use synth waveform
            let currentPattern = getStrudelEditorValue('modal-pattern').trim();
            // Convert display to Strudel format for processing
            let strudelPattern = drumDisplayToPattern(currentPattern);
            
            // Remove any existing .bank(), .s(), or .sound() modifiers
            strudelPattern = strudelPattern.replace(/\.bank\(["'][^"']*["']\)/g, '');
            strudelPattern = strudelPattern.replace(/\.s\(["'][^"']*["']\)/g, '');
            strudelPattern = strudelPattern.replace(/\.sound\(["'][^"']*["']\)/g, '');
            strudelPattern = strudelPattern.replace(/\.+$/, '').trim();
            
            // Update pattern to include synth sound
            if (strudelPattern && strudelPattern.trim() !== '') {
              console.log(`🎹 BANK CHANGE: Processing existing pattern: ${strudelPattern}`);
              
              // Preserve existing notes as-is; just upsert .s("..."), preserving .scale() if present
              strudelPattern = upsertPatternModifiers(strudelPattern, null, null, canonicalBankValue);
              console.log(`🎹 BANK CHANGE: Upserted .s("${canonicalBankValue}") on existing pattern`);
            } else {
              // If editor is empty, upsert .s("...") on (silence) so selection is reflected
              const updated = upsertPatternModifiers('', null, null, canonicalBankValue);
              if (isLikelyValidPattern(updated)) {
                strudelPattern = updated;
                console.log(`🎹 BANK CHANGE: Inserted synth on (silence): ${strudelPattern}`);
                } else {
                console.warn('⚠️ Generated synth pattern failed quick syntax check; leaving editor blank');
                strudelPattern = '';
              }
            }
            
            if (strudelPattern && strudelPattern.trim() !== '') {
            console.log(`🎹 BANK CHANGE: Setting textarea to: ${strudelPattern}`);
            // Keep in Strudel format (don't convert to drum display)
            setStrudelEditorValue('modal-pattern', strudelPattern);
            // Clear placeholder when pattern is set
            patternTextarea.placeholder = '';
            } else {
              // Keep editor blank and show helpful placeholder
              if (patternTextarea) {
                patternTextarea.placeholder = 'Add a pattern, e.g., note("c3 e3 g3").s("piano") or n("0 2 4").scale("c:major")';
              }
            }
            
            // Update checkbox visibility after pattern update
            setTimeout(() => {
              updateNoteConversionCheckboxVisibility();
            }, 50);
            
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
              ...OSCILLATOR_SYNTHS,
              ...SAMPLE_SYNTHS,
              'insect', 'wind', 'east', 'crow', 'space', 'numbers',
              'superpiano', 'jazz'
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
              let bankDisplayName;
              if (bankValue.startsWith('github:')) {
                bankDisplayName = bankValue.replace('github:tidalcycles/', '');
              } else if (DRUM_BANK_VALUES.has(bankValue)) {
                // Use proper display name for drum banks
                bankDisplayName = getDrumBankDisplayName(bankValue);
              } else {
                bankDisplayName = bankValue;
              }
              
              // Always update title when bank is selected
              titleInput.value = bankDisplayName;
              
              // Update modal header title
              const modalElementId = document.getElementById('modal-element-id');
              if (modalElementId) {
                modalElementId.textContent = bankDisplayName;
              }
              
              // Update title in DOM immediately and save it
              const element = document.querySelector(`[data-sound-id="${elementId}"]`);
              if (element) {
                const titleEl = element.querySelector('.element-title');
                if (titleEl) {
                  titleEl.textContent = bankDisplayName;
                  console.log(`📝 Updated element title in DOM to: ${bankDisplayName}`);
                } else {
                  console.warn(`⚠️ Element title not found for ${elementId}`);
                }
              } else {
                console.warn(`⚠️ Element not found: ${elementId}`);
              }
              
              // Stop any currently playing sound BEFORE saving config to prevent auto-playback
              if (this.activeElements.has(elementId)) {
                console.log(`🛑 Stopping sound for ${elementId} (bank selected, not auto-playing)`);
                soundManager.stopSound(elementId);
                this.activeElements.delete(elementId);
                // Update UI to reflect stopped state
                const element = document.querySelector(`[data-sound-id="${elementId}"]`);
                if (element) {
                  const elementCircle = element.querySelector('.element-circle');
                  if (elementCircle) {
                    elementCircle.classList.remove('playing');
                  }
                  this.updateStatusDots(elementId, true, false);
                }
              }
              
              // CRITICAL: Don't save to master when bank is selected - only save title and bank
              // Saving to master triggers updateMasterPattern which can cause auto-playback
              // We'll save to master only when user explicitly clicks Save button
              const currentConfig = this.loadElementConfig(elementId) || {};
              
              // Save only title and bank to localStorage, NOT pattern to master
              // This prevents auto-playback when bank is selected
              try {
                const configToSave = {
                  ...currentConfig,
                  title: bankDisplayName,
                  bank: bankValue
                };
                localStorage.setItem(`elementConfig_${elementId}`, JSON.stringify(configToSave));
                console.log(`📝 Saved title "${bankDisplayName}" and bank "${bankValue}" for ${elementId} (NOT saved to master)`);
              } catch (saveError) {
                console.warn(`⚠️ Could not save config:`, saveError);
              }
              
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
                  else if (containsNoteCall(strudelPattern)) {
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
            
            // Update checkbox visibility after pattern update
            setTimeout(() => {
              updateNoteConversionCheckboxVisibility();
            }, 50);
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
                  
                  // If pattern is empty or auto-generated default, DO NOT create a default drum pattern
                  // Leave editor blank and let the drum grid drive pattern generation
                  if (!currentDisplay || currentDisplay === '' || isAutoDefault) {
                    strudelPattern = '';
                    console.log(`📝 Skipped default drum pattern for bank: ${strudelBankName}`);
                  } else {
                    // Convert display format to Strudel format if needed
                    if (isDisplayFormat) {
                      strudelPattern = drumDisplayToPattern(currentDisplay);
                    } else {
                      // Already in Strudel format (might have modifiers)
                      strudelPattern = currentDisplay;
                    }
                    
                    // Check if current pattern is a synth pattern (note() or has .s() or .synth())
                    const isSynthPattern = containsNoteCall(strudelPattern) || strudelPattern.includes('n(') || 
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
                  if (!strudelPattern) {
                    // Show helpful placeholder when blank
                    patternTextarea.placeholder = 'Use the drum grid to build a pattern, or type s("bd sd rim ...").bank("Bank")';
                  } else {
                  patternTextarea.placeholder = '';
                  console.log(`   Pattern: ${strudelPattern.substring(0, 80)}...`);
                  }
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
        
        // Convert notes to semitones only if checkbox is NOT checked
        const keepNotesCheckbox = document.getElementById('modal-keep-notes-as-written');
        const shouldKeepNotes = keepNotesCheckbox && keepNotesCheckbox.checked;
        
        if (finalPattern && containsNoteCall(finalPattern) && !containsNumericNotePattern(finalPattern) && !shouldKeepNotes) {
          const convertedPattern = soundManager.convertPatternForScale(finalPattern);
          if (convertedPattern && convertedPattern !== finalPattern) {
            finalPattern = convertedPattern;
            if (patternTextarea) {
              setStrudelEditorValue('modal-pattern', convertedPattern);
            }
          }
        }
        
        // Stop any currently playing sound FIRST before saving config to prevent auto-playback
        if (!masterIsRunning && this.activeElements.has(elementId)) {
          console.log(`🛑 Stopping sound for ${elementId} (bank changed, not auto-playing)`);
          soundManager.stopSound(elementId);
          this.activeElements.delete(elementId);
          // Update UI to reflect stopped state
          const element = document.querySelector(`[data-sound-id="${elementId}"]`);
          if (element) {
            const elementCircle = element.querySelector('.element-circle');
            if (elementCircle) {
              elementCircle.classList.remove('playing');
            }
            this.updateStatusDots(elementId, true, false);
          }
        } else if (masterIsRunning) {
          console.log(`⏭️ Master running – skipping element stop for ${elementId}`);
        }
        
        // Also check if element has loop active and stop it
        const element = document.querySelector(`[data-sound-id="${elementId}"]`);
        if (!masterIsRunning && element) {
          const loopButton = element.querySelector('.loop-button');
          if (loopButton && loopButton.classList.contains('active')) {
            console.log(`🛑 Stopping loop for ${elementId} (bank changed)`);
            loopButton.classList.remove('active');
            soundManager.stopSound(elementId);
          }
        }
        
        // Save config with updated bank and pattern AFTER stopping playback
        const keepNotesCheckboxForSave = document.getElementById('modal-keep-notes-as-written');
        const keepNotesAsWrittenForSave = keepNotesCheckboxForSave ? keepNotesCheckboxForSave.checked : false;
        
        // CRITICAL: Skip master save when bank is selected to prevent auto-playback
        // Master save will happen when user explicitly clicks Save button
        this.saveElementConfig(elementId, {
          title: currentTitle || bankDisplayName,
          pattern: finalPattern,
          bank: bankValue || undefined,
          keepNotesAsWritten: keepNotesAsWrittenForSave
        }, true); // skipMasterSave = true
        console.log(`💾 Saved config with bank: ${bankValue}`);
        
        // Invalidate and pre-evaluate pattern cache AFTER stopping playback and saving config
        // This ensures the pattern is cached but doesn't start playing
        soundManager.invalidatePatternCache(elementId);
        if (finalPattern) {
          // Pre-evaluate sets pattern to silence, so it won't start playback
          await soundManager.preEvaluatePattern(elementId, finalPattern);
          console.log(`📦 Pre-evaluated pattern for ${elementId} (silent, ready for manual trigger)`);
        }

        // When switching to a drum bank, disable pattern editor to show drum grid
        const isDrum = bankValue && DRUM_BANK_VALUES.has(bankValue);
        console.log('📦 Bank change: isDrum=', isDrum, 'bankValue=', bankValue);
        if (isDrum) {
          console.log('📦 Switching to drum bank, using step editor');
          setPatternEditorEnabled(false);
          // Force rebuild of drum grid with new bank instruments
          drumGridState.built = false;
          // Show drum grid immediately - no save required
          setTimeout(() => {
            refreshDrumGridForCurrentState();
          }, 0);
        } else {
          console.log('📦 Not a drum bank, using code editor');
          setPatternEditorEnabled(true);
          refreshDrumGridForCurrentState();
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
        
        if (drumGridState.active) {
          updatePatternFromGrid();
        }
        
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
            containsNoteCall(displayPattern) || displayPattern.includes('sound(') || displayPattern.includes('s(')) {
          // Already in Strudel format
          pattern = displayPattern;
        } else {
          // Convert from drum display format
          pattern = drumDisplayToPattern(displayPattern);
        }

        // Preserve the format as written: if pattern uses note names, keep note names; if semitones, keep semitones
        // Don't convert based on toggle state - preserve what user wrote
        const keepNotesCheckbox = document.getElementById('modal-keep-notes-as-written');
        const useNoteNames = keepNotesCheckbox ? keepNotesCheckbox.checked : false;
        
        // Check pattern format and preserve it
        if (pattern && containsNoteCall(pattern)) {
          // Note names have letter notes (a-g) followed by optional accidental and octave
          const hasNoteNames = /\b(note|n)\s*\(\s*["'][a-gA-G][#b]?\d/.test(pattern);
          // Numeric notes are pure numbers/spaces (e.g., n("0 2 4")), NOT note names with octaves
          // Match patterns that start with digits/spaces only (no letters a-g)
          const hasNumericNotes = /\b(n|note)\s*\(\s*["'][\d\s\-]+["']/.test(pattern) && 
                                  !/\b(note|n)\s*\(\s*["'][a-gA-G]/.test(pattern);
          
          // Preserve the format: if written in note names, keep note names; if written in semitones, keep semitones
          if (hasNoteNames && !hasNumericNotes) {
            // Pattern is in note names format - keep it as note names
            console.log(`📝 Preserving note names format: ${pattern.substring(0, 50)}...`);
            // Don't convert - keep as-is
          } else if (hasNumericNotes && !hasNoteNames) {
            // Pattern is in semitones format - keep it as semitones
            console.log(`📝 Preserving semitones format: ${pattern.substring(0, 50)}...`);
            // Don't convert - keep as-is
          }
          // If mixed format, keep as-is
        }
        
        // Save checkbox state
        const keepNotesAsWritten = useNoteNames;
        
        // Get key/scale from modal (always read, even if empty)
        const modalKeySelect = document.getElementById('modal-key-select');
        const modalScaleSelect = document.getElementById('modal-scale-select');
        const elementKey = modalKeySelect ? (modalKeySelect.value || null) : null;
        const elementScale = modalScaleSelect ? (modalScaleSelect.value || null) : null;
        
        console.log(`🎼 Modal save: Reading key/scale from dropdowns - elementKey="${elementKey}", elementScale="${elementScale}", modalKeySelect.value="${modalKeySelect?.value}", modalScaleSelect.value="${modalScaleSelect?.value}"`);
        
        // Apply key/scale to pattern if set in modal (only for numeric note patterns without chord modifiers)
        // Don't apply scale to note names patterns - they already have explicit notes
        if (pattern && containsNoteCall(pattern) && (elementKey || elementScale)) {
          // Use the same detection logic as applyGlobalSettingsToPattern
          const hasNoteFunction = /\b(note|n)\s*\(/.test(pattern);
          // Note names have letter notes (a-g) followed by optional accidental and octave
          const hasNoteNames = /\b(note|n)\s*\(\s*["'][a-gA-G][#b]?\d/.test(pattern);
          // Numeric notes are pure numbers/spaces (e.g., n("0 2 4")), NOT note names with octaves
          // Match patterns that start with digits/spaces only (no letters a-g)
          const hasNumericNotes = /\b(n|note)\s*\(\s*["'][\d\s\-]+["']/.test(pattern) && 
                                  !/\b(note|n)\s*\(\s*["'][a-gA-G]/.test(pattern);
          const hasChordNames = /\b(note|n)\s*\(\s*["'][a-g][#b]?[a-z0-9]*\s*[a-z]/.test(pattern) ||
                               /\b(note|n)\s*\(\s*["'][^"']*\b(maj|min|m|dim|aug|sus|add|7|9|11|13)\b/i.test(pattern);
          const hasChordModifier = /\.\s*chord\s*\(/i.test(pattern);
          const hasLetterNotes = /\b(note|n)\s*\(\s*["'][^"']*[a-g][#b]?\s/.test(pattern);
          const hasExplicitNotes = hasNoteNames || hasChordNames || hasLetterNotes || hasChordModifier;
          const isNumericPattern = hasNoteFunction && hasNumericNotes && !hasNoteNames && !hasChordModifier;
          
          console.log(`🎼 Modal save: pattern="${pattern.substring(0, 50)}...", hasNoteFunction=${hasNoteFunction}, hasNoteNames=${hasNoteNames}, hasNumericNotes=${hasNumericNotes}, isNumericPattern=${isNumericPattern}, elementKey="${elementKey}", elementScale="${elementScale}"`);
          
          // Only apply scale to numeric patterns (semitones), not to note names patterns
          if (!hasChordModifier && isNumericPattern && !hasNoteNames) {
            // Apply key/scale to pattern using soundManager's function
            const patternWithScale = soundManager.applyGlobalSettingsToPattern(pattern, false, false, elementKey || null, elementScale || null);
            console.log(`🎼 Modal save: patternWithScale="${patternWithScale ? patternWithScale.substring(0, 80) : 'null'}..."`);
            if (patternWithScale && patternWithScale !== pattern) {
              pattern = patternWithScale;
              // Update the editor to show the pattern with scale
              setStrudelEditorValue('modal-pattern', pattern);
              console.log(`✅ Applied key/scale to pattern: ${pattern.substring(0, 80)}...`);
            } else {
              console.log(`⚠️ Scale not applied - pattern unchanged or applyGlobalSettingsToPattern returned same pattern`);
            }
          } else {
            if (hasNoteNames) {
              console.log(`📝 Pattern uses note names - preserving format, not applying scale modifier`);
            } else {
              console.log(`⚠️ Scale not applied - hasChordModifier=${hasChordModifier}, isNumericPattern=${isNumericPattern}`);
            }
          }
        } else {
          console.log(`⚠️ Key/Scale not applied - pattern: ${!!pattern}, hasNoteCall: ${pattern ? containsNoteCall(pattern) : false}, elementKey: ${elementKey}, elementScale: ${elementScale}`);
        }
        
        const sampleUrl = document.getElementById('modal-sample-url').value.trim();
        const fileInput = document.getElementById('modal-sample-file');
        const bankValue = bankSelect ? bankSelect.value : '';
        
        let finalSampleUrl = sampleUrl;
        
        // Handle file selection
        if (fileInput.files && fileInput.files.length > 0) {
          const file = fileInput.files[0];
          const reader = new FileReader();
          reader.onload = (e) => {
            // Store as data URL
            finalSampleUrl = e.target.result;
            this.saveElementConfig(this.currentEditingElementId, {
              title: title || this.currentEditingElementId,
              pattern: pattern,
              sampleUrl: finalSampleUrl,
              fileName: file.name,
              bank: bankValue || undefined,
              keepNotesAsWritten: keepNotesAsWritten,
              key: elementKey,
              scale: elementScale
            });
            
            // Don't start playback when saving - user can manually trigger playback
            closeModal();
          };
          reader.readAsDataURL(file);
        } else {
          // Save without file
          this.saveElementConfig(this.currentEditingElementId, {
            title: title || this.currentEditingElementId,
            pattern: pattern,
            sampleUrl: finalSampleUrl,
            bank: bankValue || undefined,
            keepNotesAsWritten: keepNotesAsWritten,
            key: elementKey,
            scale: elementScale
          });
          
          // Don't start playback when saving - user can manually trigger playback
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
              <span class="slider-endpoint slider-endpoint--min">20 Hz</span>
              <input type="range" class="filter-slider lpf-slider" min="20" max="20000" step="10" value="20000" />
              <span class="slider-value">20000</span>
              <span class="slider-endpoint slider-endpoint--max">20 kHz</span>
            </div>
            <div class="slider-row">
              <label>High-pass</label>
              <span class="slider-endpoint slider-endpoint--min">20 Hz</span>
              <input type="range" class="filter-slider hpf-slider" min="20" max="20000" step="10" value="20" />
              <span class="slider-value">20</span>
              <span class="slider-endpoint slider-endpoint--max">20 kHz</span>
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

