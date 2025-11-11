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

const NOTE_CALL_REGEX = /\bnote\s*\(/i;
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
  ['oh', 'hh'],
  ['hihat', 'hh']
]);

const SYNTH_BANK_ALIASES = {
  superpiano: 'piano',
  jazz: 'wood'
};

const OSCILLATOR_SYNTHS = ['sine', 'square', 'triangle', 'sawtooth', 'supersaw', 'pulse'];
const SAMPLE_SYNTHS = ['piano', 'supersaw', 'gtr', 'casio', 'wood', 'metal', 'folkharp'];
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

const CORE_STYLE_KEYWORDS = ['beat', 'chord', 'note', 'sound', 'stack', 'vowel'];
const SOUND_COLOR_CLASS_MAP = new Map([
  ['sound("brown")', 'pattern-snippet-tag-sound-brown'],
  ['sound("pink")', 'pattern-snippet-tag-sound-pink'],
  ['sound("white")', 'pattern-snippet-tag-sound-white']
]);

const DEFAULT_OPEN_SNIPPET_GROUP_IDS = new Set(['core']);
const snippetGroupOpenState = new Map();

const PATTERN_SNIPPET_GROUPS = [
  {
    id: 'core',
    order: 0,
    label: 'Core',
    heading: 'Core',
    matcher: (key) => ['stack', 'vowel', 'beat', 'bank', 'sound', 'chord', 'note'].includes(key),
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
    matcher: (key) => key.startsWith('lp') || key === 'ftype',
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
        'tremolo'
      ].includes(key);
    },
    className: 'snippet-group-synths'
  },
  {
    id: 'tonal',
    order: 13,
    label: 'Tonal Functions',
    heading: 'Tonal Functions',
    matcher: (key) => ['voicing', 'scale', 'transpose', 'scaletranspose', 'rootnotes'].includes(key),
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
    matcher: (key) => ['orientation', 'acceleration', 'accelerate', 'accelerationx', 'accelerationy', 'accelerationz', 'rotationx', 'rotationy', 'rotationz'].some((token) => key.includes(token)),
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
      
      this.updateMasterPatternHighlights().catch(error => {
        console.warn('⚠️ Could not update master highlight data:', error);
      });

      // If a visualizer is selected and master is active, re-apply it
      // Use a flag to prevent infinite loops
      if (this.selectedVisualizer && this.selectedVisualizer !== 'punchcard' && soundManager.masterActive && !this._applyingVisualizer) {
        console.log(`🎨 Re-applying visualizer "${this.selectedVisualizer}" after master pattern update`);
        this._applyingVisualizer = true;
        try {
          this.prepareCanvasForExternalVisualizer();
          await this.applyVisualizerToMaster();
        } finally {
          this._applyingVisualizer = false;
        }
      }
      
      this.refreshMasterPunchcard('master-update').catch(err => {
        console.warn('⚠️ Could not refresh punchcard after master update:', err);
      });
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
          
          if (this.selectedVisualizer && this.selectedVisualizer !== 'punchcard') {
            console.log(`🎨 Preparing canvas for visualizer "${this.selectedVisualizer}"`);
            this.prepareCanvasForExternalVisualizer();
          } else {
            this.showMasterPunchcardPlaceholder();
          }

          console.log(`🎨 Applying visualizer "${this.selectedVisualizer || 'punchcard'}" before playing`);
          await this.applyVisualizerToMaster();
          
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
    
    // Get the current master pattern without any visualizers
    let basePattern = soundManager.getMasterPatternCode();
    if (!basePattern || basePattern.trim() === '') {
      console.warn('⚠️ No master pattern to apply visualizer to');
      return;
    }
    
    // Strip JavaScript comments (// and /* */)
    basePattern = basePattern.replace(/\/\/.*$/gm, '');
    basePattern = basePattern.replace(/\/\*[\s\S]*?\*\//g, '');
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
    
    const visualizerMethods = ['scope', 'tscope', 'fscope', 'spectrum', 'visual', 'spiral'];
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
    
    if (this.selectedVisualizer === 'scope') {
      patternWithVisualizer = `${basePattern}.scope({ id: '${canvasId}' })`;
    } else if (this.selectedVisualizer === 'spectrum') {
      patternWithVisualizer = `${basePattern}.spectrum({ id: '${canvasId}' })`;
    } else if (this.selectedVisualizer === 'spiral') {
      patternWithVisualizer = `${basePattern}.spiral({ id: '${canvasId}' })`;
    }
    // For 'punchcard', we don't add any visualizer method - it's just the default rendering
    
    console.log(`🎨 Pattern with visualizer: ${patternWithVisualizer.substring(0, 150)}...`);
    
    // Update the master pattern and restart playback
    await soundManager.setMasterPatternCode(patternWithVisualizer);
    
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
    
    if (useScope || useSpectrum || useSpiral) {
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
    
    // Get or create context using Strudel's getDrawContext
    let ctx;
    try {
      ctx = getDrawContext(canvasId, { contextType: '2d' });
      console.log(`✅ Got draw context via getDrawContext for ${canvasId}`);
    } catch (error) {
      console.warn('⚠️ getDrawContext failed, falling back to native:', error);
      ctx = this.masterPunchcardCanvas.getContext('2d');
    }
    
    if (ctx) {
      const containerRect = this.masterPunchcardContainer.getBoundingClientRect();
      const displayWidth = Math.max(containerRect.width || this.masterPunchcardContainer.offsetWidth || 320, 240);
      const displayHeight = Math.max(containerRect.height || this.masterPunchcardContainer.offsetHeight || 200, 220);
      const pixelRatio = window.devicePixelRatio || 1;

      console.log(`🎨 Canvas dimensions: ${displayWidth}x${displayHeight}, pixelRatio: ${pixelRatio}`);

      if (this.masterPunchcardCanvas.width !== displayWidth * pixelRatio || this.masterPunchcardCanvas.height !== displayHeight * pixelRatio) {
        this.masterPunchcardCanvas.width = displayWidth * pixelRatio;
        this.masterPunchcardCanvas.height = displayHeight * pixelRatio;
        this.masterPunchcardCanvas.style.width = `${displayWidth}px`;
        this.masterPunchcardCanvas.style.height = `${displayHeight}px`;
      }
      
      // Make canvas visible
      this.masterPunchcardCanvas.style.display = 'block';
      this.masterPunchcardCanvas.style.opacity = '1';

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.masterPunchcardCanvas.width, this.masterPunchcardCanvas.height);
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      
      // Store context in both places for Strudel to find
      window.__strudelVisualizerCtx = ctx;
      
      // Also try to register with Strudel's draw system if available
      if (window.strudel && window.strudel.controls) {
        try {
          window.strudel.controls.setCanvas(canvasId);
          console.log(`✅ Registered canvas "${canvasId}" with Strudel controls`);
        } catch (e) {
          console.log(`ℹ️ Could not register with strudel.controls:`, e.message);
        }
      }
      
      console.log(`✅ Canvas prepared, context stored in window.__strudelVisualizerCtx`);
    }
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
    
    console.log('🔍 PUNCHCARD EVALUATION - After removing comments:');
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
    
    if (!patternObject || typeof patternObject.queryArc !== 'function') {
      console.warn('⚠️ Pattern did not return a valid Strudel pattern object');
      return { error: 'Pattern expression did not return a Strudel pattern.' };
    }
    
    let haps;
    try {
      haps = patternObject.queryArc(0, 1) || [];
    } catch (error) {
      console.error('❌ Failed to query pattern arc for punchcard:', error);
      return { error: error?.message || 'Pattern queryArc failed.' };
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
   */
  saveElementConfig(elementId, config) {
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
    
    const bankSelect = document.getElementById('modal-pattern-bank');

    const ensurePatternBankOptions = (selectedValue = bankSelect ? bankSelect.value : '') => {
      if (!bankSelect) {
        return;
      }

      const previousValue = bankSelect.value;
      const targetValue = selectedValue != null ? selectedValue : previousValue;

      let drumsGroup = Array.from(bankSelect.children).find(
        (child) => child.tagName === 'OPTGROUP' && child.label && child.label.toLowerCase() === 'drums'
      );

      if (!drumsGroup) {
        drumsGroup = document.createElement('optgroup');
        drumsGroup.label = 'Drums';
        bankSelect.insertBefore(drumsGroup, bankSelect.firstChild);
      }

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

      if (targetValue && targetValue !== '' && !DRUM_BANK_VALUES.has(targetValue)) {
        const option = document.createElement('option');
        option.value = targetValue;
        option.textContent = getDrumBankDisplayName(targetValue);
        drumsGroup.appendChild(option);
      }

      const availableValues = new Set(
        Array.from(drumsGroup.children)
          .filter((child) => child.tagName === 'OPTION')
          .map((option) => option.value)
      );

      if (availableValues.has(targetValue)) {
        bankSelect.value = targetValue;
      } else if (availableValues.has(previousValue)) {
        bankSelect.value = previousValue;
    } else {
        bankSelect.value = '';
      }
    };

    ensurePatternBankOptions();
    
    const drumGridSection = document.getElementById('modal-drum-grid-section');
    const drumGridTimesigLabel = document.getElementById('modal-drum-grid-timesig');
    const drumGridStepsContainers = {
      bd: document.getElementById('drum-grid-steps-bd'),
      sn: document.getElementById('drum-grid-steps-sn'),
      hh: document.getElementById('drum-grid-steps-hh')
    };
    
    const drumGridState = {
      active: false,
      totalSteps: 0,
      built: false,
      patternEditorEnabled: true,
      updatingFromPattern: false,
      updatingFromGrid: false,
      checkboxes: {
        bd: [],
        sn: [],
        hh: []
      }
    };

    const patternEditorToggleWrapper = document.getElementById('modal-pattern-editor-toggle-wrapper');
    const patternEditorToggle = document.getElementById('modal-pattern-editor-toggle');
    const patternEditorToggleText = document.getElementById('modal-pattern-editor-toggle-text');
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

          const storedState = snippetGroupOpenState.has(group.id)
            ? snippetGroupOpenState.get(group.id)
            : DEFAULT_OPEN_SNIPPET_GROUP_IDS.has(group.id);
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

            const itemWrapper = document.createElement('div');
            itemWrapper.className = 'pattern-snippet-item';
            itemWrapper.appendChild(button);
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

    if (previewButton && !previewButton.dataset.listenerAttached) {
      previewButton.addEventListener('click', async () => {
        const patternValue = getStrudelEditorValue('modal-pattern');
        if (!patternValue || !patternValue.trim()) {
          uiController.updateStatus('⚠️ No pattern to preview');
          return;
        }

        const elementId = this.currentEditingElementId || 'modal-preview';
        uiController.updateStatus('▶ Previewing pattern…');

        try {
          await soundManager.previewPattern(patternValue, elementId);
          uiController.updateStatus('✅ Preview playing (preview slot d16)');
        } catch (error) {
          console.error('Preview failed:', error);
          uiController.updateStatus('⚠️ Preview failed – check console for details');
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
      if (patternEditorToggle) {
        patternEditorToggle.checked = drumGridState.patternEditorEnabled;
      }
      if (patternEditorToggleText) {
        patternEditorToggleText.textContent = drumGridState.patternEditorEnabled ? 'Enable' : 'Disable';
      }
      updatePatternFieldEditable(drumGridState.patternEditorEnabled);
    };

    const modalPatternTextareaForPreview = document.getElementById('modal-pattern');
    if (modalPatternTextareaForPreview && !modalPatternTextareaForPreview.dataset.previewListenerAttached) {
      modalPatternTextareaForPreview.addEventListener('input', () => {
        updatePreviewButtonState();
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
    applyPatternEditorState();
    
    const isDrumBankValue = (value) => value && DRUM_BANK_VALUES.has(value);
    
    const setDrumGridSubtitle = (metrics) => {
      if (!drumGridTimesigLabel) return;
      drumGridTimesigLabel.textContent = `${metrics.signature} · ${metrics.totalSteps} steps`;
    };
    
    const resetDrumGridSelection = () => {
      DRUM_GRID_ROWS.forEach(({ key }) => {
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
    
    const ensureDrumGridBuilt = (metrics) => {
      if (!drumGridSection) return;
      if (drumGridState.built && drumGridState.totalSteps === metrics.totalSteps) {
        return;
      }
      
      DRUM_GRID_ROWS.forEach(({ key }) => {
        const container = drumGridStepsContainers[key];
        if (!container) return;
        container.innerHTML = '';
        container.style.gridTemplateColumns = `repeat(${metrics.totalSteps}, minmax(18px, 1fr))`;
        drumGridState.checkboxes[key] = [];
        for (let step = 0; step < metrics.totalSteps; step += 1) {
          const stepWrapper = document.createElement('div');
          stepWrapper.className = 'drum-grid-step';
          if (step > 0 && step % 4 === 0) {
            stepWrapper.classList.add('quarter-boundary');
          }
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.dataset.row = key;
          checkbox.dataset.step = String(step);
          checkbox.addEventListener('change', handleDrumGridStepChange);
          stepWrapper.appendChild(checkbox);
          container.appendChild(stepWrapper);
          drumGridState.checkboxes[key].push(checkbox);
        }
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
      
      let workingTokens = tokens.slice();
      if (workingTokens.length !== metrics.totalSteps) {
        const adjustedTokens = [];
        for (let step = 0; step < metrics.totalSteps; step += 1) {
          adjustedTokens.push(workingTokens[step % workingTokens.length]);
        }
        workingTokens = adjustedTokens;
      }
      
      drumGridState.updatingFromPattern = true;
      for (let step = 0; step < metrics.totalSteps; step += 1) {
        const samples = parseTokenToSamples(workingTokens[step]);
        samples.forEach(sample => {
          const rowKey = DRUM_SAMPLE_TO_ROW.get(sample.toLowerCase());
          if (!rowKey) return;
          const checkboxes = drumGridState.checkboxes[rowKey];
          if (checkboxes && checkboxes[step]) {
            checkboxes[step].checked = true;
          }
        });
      }
      drumGridState.updatingFromPattern = false;
    };
    
    const generateTokensFromGrid = (metrics) => {
      const tokens = [];
      for (let step = 0; step < metrics.totalSteps; step += 1) {
        const activeSamples = [];
        DRUM_GRID_ROWS.forEach(({ key, sample }) => {
          const checkboxes = drumGridState.checkboxes[key];
          const checkbox = checkboxes ? checkboxes[step] : null;
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
      const metrics = getTimeSignatureMetrics(this.currentTimeSignature || '4/4');
      const tokens = generateTokensFromGrid(metrics);
      const sequence = tokens.join(' ');
      // Note: .fast() modifier removed - patterns are clean without tempo modifiers
      const bankValue = bankSelect.value;
      const bankSuffix = bankValue && bankValue !== '' ? `.bank("${bankValue}")` : '';
      const pattern = `s("${sequence}")${bankSuffix}`;
      drumGridState.updatingFromGrid = true;
      setStrudelEditorValue('modal-pattern', pattern);
      drumGridState.updatingFromGrid = false;
    };
    
    const showDrumGrid = (metrics, pattern) => {
      if (!drumGridSection) return;
      ensureDrumGridBuilt(metrics);
      setDrumGridSubtitle(metrics);
      drumGridSection.style.display = 'block';
      drumGridState.active = true;
      populateDrumGridFromPattern(pattern, metrics);
    };
    
    const hideDrumGrid = () => {
      if (!drumGridSection) return;
      drumGridSection.style.display = 'none';
      drumGridState.active = false;
    };
    
    const refreshDrumGridForCurrentState = () => {
      if (!bankSelect) return;
      const bankValue = bankSelect.value;
      const isDrum = isDrumBankValue(bankValue);

      if (patternEditorToggleWrapper) {
        patternEditorToggleWrapper.style.display = isDrum ? 'inline-flex' : 'none';
      }

      applyPatternEditorState();

      if (!isDrum) {
        setPatternEditorEnabled(true);
        hideDrumGrid();
        return;
      }

      if (drumGridState.patternEditorEnabled) {
        hideDrumGrid();
        return;
      }

      const patternValue = getStrudelEditorValue('modal-pattern');
      const trimmedPattern = patternValue ? patternValue.trim() : '';
      const tokens = tokenizePattern(patternValue);

      if (trimmedPattern && (!tokens || tokens.length === 0)) {
        setPatternEditorEnabled(true);
        hideDrumGrid();
        return;
      }

      const metrics = getTimeSignatureMetrics(this.currentTimeSignature || '4/4');
      showDrumGrid(metrics, patternValue);
    };

    const modalPatternTextarea = document.getElementById('modal-pattern');
    if (modalPatternTextarea) {
      modalPatternTextarea.addEventListener('input', () => {
        if (!drumGridState.active || drumGridState.updatingFromGrid) {
          return;
        }
        if (!bankSelect || !isDrumBankValue(bankSelect.value)) {
          return;
        }
        const metrics = getTimeSignatureMetrics(this.currentTimeSignature || '4/4');
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

    if (patternEditorToggle) {
      patternEditorToggle.addEventListener('change', (event) => {
        setPatternEditorEnabled(event.target.checked);
        refreshDrumGridForCurrentState();
      });
      bankSelect.dataset.listenerAttached = 'true';
    }
    
    this.applyTimeSignatureToDrumGrid = (timeSignature) => {
      if (!drumGridSection || !drumGridState.active) return;
      const metrics = getTimeSignatureMetrics(timeSignature || '4/4');
      const currentPattern = getStrudelEditorValue('modal-pattern');
      ensureDrumGridBuilt(metrics);
      setDrumGridSubtitle(metrics);
      showDrumGrid(metrics, currentPattern);
    };
    
    const closeModal = () => {
      // Preview removed - no longer needed
      modal.style.display = 'none';
      this.currentEditingElementId = null;
      setPatternEditorEnabled(true);
      hideDrumGrid();
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
      const savedBankValue = savedConfig?.bank || '';
      ensurePatternBankOptions(savedBankValue);
      if (bankSelect) {
        bankSelect.value = savedBankValue;
      }
      
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
        if (savedBankValue) {
          patternField.placeholder = 'Drums and Percussion: s("bd sd rim cp hh oh cr rd ht mt lt sh cb tb perc misc fx"), Synths: note("c3 d3 [e3 f3]")';
        } else {
          patternField.placeholder = '';
        }
      }

      setPatternEditorEnabled(true);
      
      document.getElementById('modal-sample-url').value = savedConfig?.sampleUrl || '';
      document.getElementById('modal-sample-file').value = '';
      
      this.currentEditingElementId = elementId;
      refreshDrumGridForCurrentState();
      modal.style.display = 'flex';
    };

    // Close button
    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }

    // Bank dropdown - load bank when changed
    if (bankSelect && !bankSelect.dataset.listenerAttached) {
      bankSelect.addEventListener('change', async (e) => {
        const bankValue = e.target.value;
        ensurePatternBankOptions(bankValue);
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
              'wood': 'Wood',
              'metal': 'Metal',
              'folkharp': 'Folk Harp',
              'superpiano': 'Piano',
              'jazz': 'Wood'
            };
            const displayName = displayNames[canonicalBankValue] || displayNames[bankValue] || canonicalBankValue.charAt(0).toUpperCase() + canonicalBankValue.slice(1);
            
            // Handle synth sound - no bank loading needed
            console.log(`🎹 Using synth sound: ${canonicalBankValue}`);
            if (statusText) {
              statusText.textContent = `🎹 Using ${displayName}`;
            }
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
              strudelPattern = `note("${notes}").s("${canonicalBankValue}")`;
              console.log(`🎹 BANK CHANGE: Created note("${notes}").s("${canonicalBankValue}")`);
            } else {
              // Create default pattern when empty
              const defaultNotes = 'c3 d3 e3 f3';
              strudelPattern = `note("${defaultNotes}").s("${canonicalBankValue}")`;
              console.log(`🎹 BANK CHANGE: Created default pattern with ${canonicalBankValue}`);
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
        
        if (finalPattern && containsNoteCall(finalPattern) && !containsNumericNotePattern(finalPattern)) {
          const convertedPattern = soundManager.convertPatternForScale(finalPattern);
          if (convertedPattern && convertedPattern !== finalPattern) {
            finalPattern = convertedPattern;
            if (patternTextarea) {
              setStrudelEditorValue('modal-pattern', convertedPattern);
            }
          }
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
          let updatedPattern = drumDisplayToPattern(displayPattern);
          if (updatedPattern && containsNoteCall(updatedPattern) && !containsNumericNotePattern(updatedPattern)) {
            const convertedPattern = soundManager.convertPatternForScale(updatedPattern);
            if (convertedPattern && convertedPattern !== updatedPattern) {
              updatedPattern = convertedPattern;
              setStrudelEditorValue('modal-pattern', convertedPattern);
            }
          }
          
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

        refreshDrumGridForCurrentState();
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

        if (pattern && containsNoteCall(pattern) && !containsNumericNotePattern(pattern)) {
          const convertedPattern = soundManager.convertPatternForScale(pattern);
          if (convertedPattern && convertedPattern !== pattern) {
            pattern = convertedPattern;
            setStrudelEditorValue('modal-pattern', convertedPattern);
          }
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

