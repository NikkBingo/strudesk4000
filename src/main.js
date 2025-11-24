/**
 * Main entry point - Wires together all components
 */

import { soundManager } from './soundManager.js';
import { uiController } from './ui.js';
import { soundConfig } from './config.js';
import { initStrudelReplEditors, getStrudelEditor, getStrudelEditorValue, setStrudelEditorValue, setStrudelEditorEditable, insertStrudelEditorSnippet } from './strudelReplEditor.js';
// Strudel modules are loaded dynamically via soundManager to avoid duplicate loading
// Use getStrudelModules() or window.strudel functions instead of static imports
import { Scale, Note, Progression } from '@tonaljs/tonal';
import { LoginModal } from './components/LoginModal.js';
import { UserProfile } from './components/UserProfile.js';
import { UserProfilesListing } from './components/UserProfilesListing.js';
import { SavePatternDialog } from './components/SavePatternDialog.js';
import { ProfileOnboardingModal } from './components/ProfileOnboardingModal.js';
import { AdminUserManager } from './components/AdminUserManager.js';
import { getCurrentUser, authAPI } from './api.js';

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
  'CasioRZ1'
]);

const VCSL_SAMPLE_MANIFEST_URL = 'https://raw.githubusercontent.com/felixroos/dough-samples/main/vcsl.json';
const VCSL_OPTION_PREFIX = 'vcsl:';
let cachedVcslInstrumentOptions = null;
let vcslInstrumentFetchPromise = null;

const SPECIAL_SAMPLE_BANK_GROUP_LABEL = 'World Instruments';
const VCSL_OPTGROUP_LABEL = 'VCSL Instruments';
const VCSL_FAMILY_ORDER = ['Chordophones', 'Aerophones', 'Membranophones', 'Electrophones', 'Idiophones'];

let cachedVcslManifest = null;
let cachedNormalizedVcslManifest = null;
const SPECIAL_SAMPLE_BANKS = [
  { value: 'mridangam', label: 'Mridangam Percussion Set' }
];
const SPECIAL_SAMPLE_BANK_VALUES = new Set(SPECIAL_SAMPLE_BANKS.map(bank => bank.value.toLowerCase()));

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
const isServerDeployment = typeof window !== 'undefined'
  ? !LOCAL_HOSTNAMES.has(window.location.hostname)
  : false;
const getSliderDebounceDelay = () => (isServerDeployment ? 60 : 150);
const requestFrame = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
  ? window.requestAnimationFrame.bind(window)
  : (callback) => setTimeout(callback, 16);
const sliderDisplayUpdateMap = new Map();
let sliderDisplayRaf = null;
const queueSliderDisplayUpdate = (displayEl, text) => {
  if (!displayEl) return;
  sliderDisplayUpdateMap.set(displayEl, text);
  if (sliderDisplayRaf !== null) {
    return;
  }
  sliderDisplayRaf = requestFrame(() => {
    sliderDisplayUpdateMap.forEach((value, target) => {
      target.textContent = value;
    });
    sliderDisplayUpdateMap.clear();
    sliderDisplayRaf = null;
  });
};

const parseBankSelectionValue = (rawValue) => {
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

const formatVcslInstrumentLabel = (name) => {
  if (!name) return '';
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const extractSamplePathFromEntry = (entry) => {
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) {
    return typeof entry[0] === 'string' ? entry[0] : '';
  }
  if (typeof entry === 'object') {
    const firstValue = Object.values(entry)[0];
    if (typeof firstValue === 'string') return firstValue;
    if (Array.isArray(firstValue) && typeof firstValue[0] === 'string') {
      return firstValue[0];
    }
  }
  return '';
};

const classifyVcslInstrumentCategory = (samplePath, name) => {
  const target = (samplePath || name || '').toLowerCase();
  const percussionRegex = /(membranophone|idiophone|drum|percussion|bongo|cajon|shaker|triangle|tambourine|clave|cowbell|snare|kick|timpani|gong|cymbal)/i;
  if (percussionRegex.test(target)) {
    return 'drums';
  }
  return 'world';
};

const resolveSamplePath = (path, baseUrl) => {
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
    return resolveSamplePath(entry, baseUrl);
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

const getVcslInstrumentFamily = (samplePath) => {
  if (!samplePath || typeof samplePath !== 'string') return 'Other';
  const match = samplePath.match(/^([^/]+)/);
  if (!match) return 'Other';
  try {
    const decoded = decodeURIComponent(match[1]);
    return decoded.charAt(0).toUpperCase() + decoded.slice(1);
  } catch {
    return match[1];
  }
};

const getVcslFamilyOrder = (family) => {
  const index = VCSL_FAMILY_ORDER.indexOf(family);
  return index === -1 ? VCSL_FAMILY_ORDER.length + 1 : index;
};

const loadVcslInstrumentOptions = async () => {
  if (cachedVcslInstrumentOptions) {
    return cachedVcslInstrumentOptions;
  }
  if (vcslInstrumentFetchPromise) {
    return vcslInstrumentFetchPromise;
  }
  vcslInstrumentFetchPromise = fetch(VCSL_SAMPLE_MANIFEST_URL)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load VCSL instruments: ${response.status}`);
      }
      const manifest = await response.json();
      cachedVcslManifest = manifest;
      cachedNormalizedVcslManifest = normalizeSampleManifest(manifest);
      const entries = Object.entries(manifest || {})
        .filter(([name]) => name && name !== '_base');
      const options = entries.map(([name, entry]) => {
        const samplePath = extractSamplePathFromEntry(entry);
        const family = getVcslInstrumentFamily(samplePath);
        const category = classifyVcslInstrumentCategory(samplePath, family);
        return {
          value: name,
          optionValue: `${VCSL_OPTION_PREFIX}${name}`,
          label: `VCSL · ${formatVcslInstrumentLabel(name)}`,
          category,
          samplePath,
          family,
          familyOrder: getVcslFamilyOrder(family)
        };
      }).sort((a, b) => {
        if (a.familyOrder !== b.familyOrder) {
          return a.familyOrder - b.familyOrder;
        }
        return a.label.localeCompare(b.label);
      });
      cachedVcslInstrumentOptions = options;
      return options;
    })
    .catch((error) => {
      console.warn('⚠️ Unable to load VCSL instrument list:', error);
      cachedVcslInstrumentOptions = [];
      return [];
    })
    .finally(() => {
      vcslInstrumentFetchPromise = null;
    });
  return vcslInstrumentFetchPromise;
};

const DRUM_BANK_DISPLAY_NAMES = {
  RolandTR808: 'Roland TR-808',
  RolandTR909: 'Roland TR-909',
  RolandTR707: 'Roland TR-707',
  RhythmAce: 'Rhythm Ace',
  AkaiLinn: 'Akai Linn',
  ViscoSpaceDrum: 'Visco Space Drum',
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

const getChannelDisplayLabel = (elementId) => {
  if (!elementId) return 'Channel';
  const match = elementId.match(/element-(\d+)/i);
  return match && match[1] ? `Channel ${match[1]}` : elementId;
};

const formatElementTitle = (elementId, rawTitle) => {
  const channelLabel = getChannelDisplayLabel(elementId);
  const title = rawTitle ? rawTitle.trim() : '';
  if (!title || /^element\s*\d+$/i.test(title)) {
    return channelLabel;
  }
  if (/^channel\s*\d+$/i.test(title)) {
    return title;
  }
  const stripped = title.replace(/^channel\s*\d+\s*(–|-)\s*/i, '');
  return `${channelLabel} – ${stripped}`;
};

const updateElementTitleDisplay = (elementId, baseTitle) => {
  const element = document.querySelector(`[data-sound-id="${elementId}"]`);
  if (!element) return;
  const titleEl = element.querySelector('.element-title');
  if (titleEl) {
    titleEl.textContent = formatElementTitle(elementId, baseTitle);
  }
  const configButton = element.querySelector('.config-button');
  if (configButton) {
    configButton.textContent = baseTitle && baseTitle.trim() ? baseTitle.trim() : 'Configure Sound';
  }
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

const DRUM_PATTERN_PRESETS = [
  {
    id: 'roland808-simple-bd-hh',
    label: 'Roland 808 – Kick & Hat',
    bank: 'RolandTR808',
    description: 'Simple BD/HH groove shown in the step editor',
    pattern: 's("bd ~ hh ~ bd ~ hh ~ bd ~ hh ~ bd ~ hh ~").bank("RolandTR808")',
    editorBadge: 'Step editor'
  },
  {
    id: 'drum-beat-generator',
    label: 'Beat Generator',
    bank: '',
    description: 'Opens in code editor for generative BD patterns',
    pattern: 's("bd").bank("RolandTR808").segment(16).degradeBy(.5).ribbon(16,1)',
    editorBadge: 'Code'
  },
  {
    id: 'random-modifiers',
    label: 'Random Modifiers',
    bank: '',
    description: 'chooseCycles randomizes BD / HH / SD each cycle',
    pattern: 's(chooseCycles("bd","hh","sd")).bank("RolandTR808").fast(8)',
    editorBadge: 'Code'
  },
  {
    id: 'mridangam-pulse',
    label: 'Mridangam Percussion Set',
    bank: '',
    description: 'Classical tha · dhi · thom · nam motif on the mridangam bank',
    pattern: '"tha dhi thom nam".drop("0 -1 -2 -3").sound().bank("mridangam")\n\n/* Available sounds: tha · dhi · dhin · thom · nam · na · ta · ka · ki · gumki · dhum · chaapu · ardha */',
    editorBadge: 'Code'
  }
];

const TONAL_PATTERN_PRESETS = [
  {
    id: 'independent-params',
    label: 'Note Names and Filter Pattern',
    bank: '',
    description: 'note, cutoff, gain and sound controlled independently',
    pattern: 'note("F3 A3 C3 E3").cutoff("<500 1000 2000 [4000 8000]>").gain(.8).s("sawtooth").log()'
  },
  {
    id: 'semitones-scale-transpose',
    label: 'Semitones, Scale & Transpose',
    bank: '',
    description: 'Transposes notes inside the scale by the number of steps',
    pattern: '"[-8 [2,4,6]]*2".scale(\'c:ionian\').scaleTranspose("<0 -1 -2 -3 -4 -5 -6 -4>*2").note().s("piano")',
    useNoteNames: false
  },
  {
    id: 'simple-arpeggios',
    label: 'Simple Arpeggios in Semitones & Chords',
    bank: '',
    description: 'Combines numeric semitones with chord progressions',
    pattern: 'n("0 1 2 3").chord("<C Am F G>").voicing()',
    useNoteNames: false
  },
  {
    id: 'simple-backing-track',
    label: 'Simple Backing Track',
    bank: '',
    description: 'Together with layer, struct and voicings, this can be used to create a basic backing track',
    pattern: '"<C^7 A7b13 Dm7 G7>*2".layer(\n  x => x.voicings("lefthand").struct("[~ x]*2").note(),\n  x => x.rootNotes(2).note().s("sawtooth").cutoff(800)\n)'
  },
  {
    id: 'vcsl-vocal-bed',
    label: 'VCSL World Textures',
    bank: '',
    description: 'Layered Ball Whistle + Bongo textures from the VCSL set',
    pattern: 'sound("<ballwhistle ~ bongo ~>*2").bank("vcsl").slow(2).room(.35).shape(.2)'
  },
  {
    id: 'jazz-blues-in-f',
    label: 'Jazz Blues in F',
    bank: '',
    description: 'Classic jazz-blues progression with layered voicings and struct patterns',
    pattern: `(() => {
  const chords = chord(\`<

F7 Bb7 F7 [Cm7 F7]

Bb7 Bo F7 [Am7 D7]

Gm7 C7 [F7 D7] [Gm7 C7]

>\`);

  return stack(
    n("7 8 [10 9] 8").set(chords).voicing().dec(.2),
    chords.struct("- x - x").voicing().room(.5),
    n("0 - 1 -").set(chords).mode("root:g2").voicing()
  );
})()`
  },
  {
    id: 'mini-notation-example',
    label: 'Mini-notation Example',
    bank: '',
    description: 'Layered mini-notation demo showing melody + bass progressions',
    pattern: `note(\`<

[e5 [b4 c5] d5 [c5 b4]]

[a4 [a4 c5] e5 [d5 c5]]

[b4 [~ c5] d5 e5]

[c5 a4 a4 ~]

[[~ d5] [~ f5] a5 [g5 f5]]

[e5 [~ c5] e5 [d5 c5]]

[b4 [b4 c5] d5 e5]

[c5 a4 a4 ~]

,

[[e2 e3]*4]

[[a2 a3]*4]

[[g#2 g#3]*2 [e2 e3]*2]

[a2 a3 a2 a3 a2 a3 b1 c2]

[[d2 d3]*4]

[[c2 c3]*4]

[[b1 b2]*2 [e2 e3]*2]

[[a1 a2]*4]

>\`)`
  }
];

const SAMPLER_EFFECT_PRESETS = [
  {
    id: 'sampler-begin',
    label: 'begin',
    description: 'Skip the first section of each triggered sample.',
    tooltip: 'A 0–1 pattern that trims the start of each hit (0.25 removes the first quarter).',
    pattern: `samples({
  "rave": "rave/AREUREADY.wav"
}, "github:tidalcycles/dirt-samples")

s("rave")
  .begin("<0 0.25 0.5 0.75>")
  .fast(2)`
  },
  {
    id: 'sampler-end',
    label: 'end',
    description: 'Cut the tail of the sample instead of the beginning.',
    tooltip: 'Same as .begin but trims from the end (1 = full sample, 0.5 = half length).',
    pattern: `s("bd*2,oh*4").bank("RolandTR808")
  .end("<0.1 0.2 0.5 1>")
  .fast(2)`
  },
  {
    id: 'sampler-loop',
    label: 'loop',
    description: 'Keep a sample looping regardless of the cycle length.',
    tooltip: 'Enable sustained looping (1 = on) — tempo is free-running.',
    pattern: `s("casio")
  .loop(1)`
  },
  {
    id: 'sampler-loopBegin',
    label: 'loopBegin',
    description: 'Set the point inside the sample where looping starts.',
    tooltip: 'Choose the loop start within 0–1 of the file; must be before loopEnd.',
    pattern: `s("space").loop(1)
  .loopBegin("<0 0.125 0.25>")
  ._scope()`
  },
  {
    id: 'sampler-loopEnd',
    label: 'loopEnd',
    description: 'Set the point inside the sample where looping ends.',
    tooltip: 'Choose the loop end (0–1). Must be after loopBegin for a valid loop.',
    pattern: `s("space").loop(1)
  .loopEnd("<1 0.75 0.5 0.25>")
  ._scope()`
  },
  {
    id: 'sampler-cut',
    label: 'cut',
    description: 'Use classic drum-machine style choke groups.',
    tooltip: 'Samples in the same cut group (1 here) stop each other when they retrigger.',
    pattern: `s("[oh hh]*4").bank("RolandTR808")
  .cut(1)`
  },
  {
    id: 'sampler-clip',
    label: 'clip',
    description: 'Shorten or lengthen the note duration without altering tempo.',
    tooltip: 'Multiplies sustain by the factor; values <1 gate the sample early.',
    pattern: `note("c a f e")
  .s("piano")
  .clip("<0.5 1 2>")
  .legato(1)`
  },
  {
    id: 'sampler-loopAt',
    label: 'loopAt',
    description: 'Time-stretch samples to a specific number of cycles.',
    tooltip: 'Stretches/compresses playback so the loop fits exactly 2 cycles.',
    pattern: `samples({
  "rhodes": "https://cdn.freesound.org/previews/132/132051_316502-lq.mp3"
})

s("rhodes").loopAt(2)`
  },
  {
    id: 'sampler-fit',
    label: 'fit',
    description: 'Resize a sample to the length of each event.',
    tooltip: 'Fits every triggered slice to its event duration — great for breakbeats.',
    pattern: `samples({
  "rhodes": "https://cdn.freesound.org/previews/132/132051-lq.mp3"
})

s("rhodes/2")
  .fit()`
  },
  {
    id: 'sampler-chop',
    label: 'chop',
    description: 'Split samples into equal slices for granular tricks.',
    tooltip: 'Cuts each hit into 4 tiny grains, then reorders/repeats them in two cycles.',
    pattern: `samples({
  "rhodes": "https://cdn.freesound.org/previews/132/132051-lq.mp3"
})

s("rhodes")
  .chop(4)
  .rev()
  .loopAt(2)`
  },
  {
    id: 'sampler-striate',
    label: 'striate',
    description: 'Sequentially scan through chunks of each sample.',
    tooltip: 'Each trigger jumps forward through 6 slices of the source file.',
    pattern: `s("numbers:0 numbers:1 numbers:2")
  .striate(6)
  .slow(3)`
  },
  {
    id: 'sampler-slice',
    label: 'slice',
    description: 'Address slices explicitly using indexes or fractional lists.',
    tooltip: 'Divide the file into slices and trigger them via patterns or fractional lists.',
    pattern: `samples("github:tidalcycles/dirt-samples")

s("breaks165")
  .slice(8, "0 1 <2 2*2> 3 [4 0] 5 6 7")
  .slow(0.75)

s("breaks125")
  .fit()
  .slice([0, 0.25, 0.5, 0.75], "0 1 1 <2 3>")`
  },
  {
    id: 'sampler-splice',
    label: 'splice',
    description: 'Slice like .slice but time-stretches to match step length.',
    tooltip: 'Each slice is warped to fill its step, so rhythms stay tight.',
    pattern: `samples("github:tidalcycles/dirt-samples")

s("breaks165")
  .splice(8, "0 1 [2 3 0]@2 3 0@2 7")`
  },
  {
    id: 'sampler-scrub',
    label: 'scrub',
    description: 'Manually scrub through audio (great for granular tape FX).',
    tooltip: 'Supply 0–1 positions (optionally with :speed) to scrub through the waveform.',
    pattern: `samples("github:switchangel/pad")
s("swpad:0")
  .scrub("{0.1!2 0.25@3 0.7!2 <0.8:1.5>}%8")

samples("github:yaxu/clean-breaks/main")
s("amen/4")
  .fit()
  .scrub(pattern("{0@3 0@2 4@3}%8").div(16))`
  },
  {
    id: 'sampler-speed',
    label: 'speed',
    description: 'Pitch-shift or reverse by changing playback speed.',
    tooltip: 'Positive speeds raise the pitch; negatives play the sample backwards.',
    pattern: `s("bd*6")
  .speed("1 2 4 1 -2 -4")

speed("1 1.5*2 [2 1.1]")
  .s("piano")
  .clip(1)`
  }
].map((preset) => ({
  ...preset,
  editorBadge: 'Code'
}));
TONAL_PATTERN_PRESETS.forEach((preset) => {
  if (!preset.editorBadge) {
    preset.editorBadge = 'Code';
  }
});

const MASTER_SONG_PRESETS = [
  {
    id: 'song-acidic-tooth',
    label: 'Song · "acidic tooth" @by eddyflux',
    pattern: `// "acidic tooth" @by eddyflux
// @version 1.0

setcps(1)

stack(

  /* Channel 1 */
  stack(
    s("bd*2").mask("<0@4 1@16>"),
    s("hh*8").gain(saw.mul(saw.fast(2))).clip(sine)
    .mask("<0@8 1@16>")
  ).bank('RolandTR909')

  ,

  /* Channel 2 */
  note("[<g1 f1>/8](<3 5>,8)")
  .clip(perlin.range(.15,1.5))
  .release(.1)
  .s("sawtooth")
  .lpf(sine.range(400,800).slow(16))
  .lpq(cosine.range(6,14).slow(3))
  .lpenv(sine.mul(4).slow(4))
  .lpd(.2).lpa(.02)
  .ftype('24db')
  .rarely(add(note(12)))
  .room(.2).shape(.3).postgain(.5)
  .superimpose(x=>x.add(note(12)).delay(.5).bpf(1000))
  .gain("[.2 1@3]*2") // fake sidechain

)`.trim()
  }
];

const INTRO_SAMPLE_PATH = new URL('./assets/samples/voice/Strudesk4000_de.mp3', document.baseURI).href;

let interactiveSoundAppInstance = null;

const CHANNEL_HISTORY_LIMIT = 25;
const MASTER_HISTORY_LIMIT = 25;
const CHANNEL_HISTORY_PREFIX = 'strudel_channel_history:';
const MASTER_HISTORY_KEY = 'strudel_master_history';

const safeStorage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      console.warn('Pattern history storage get failed:', error);
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      console.warn('Pattern history storage set failed:', error);
    }
  }
};

const patternHistoryStore = (() => {
  const lastChannelSnapshots = new Map();
  let lastMasterSnapshot = null;

  const parseHistory = (raw) => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const writeHistory = (key, entries) => {
    safeStorage.set(key, JSON.stringify(entries));
  };

  const saveChannelVersion = (elementId, pattern) => {
    const trimmed = (pattern || '').trim();
    if (!elementId || !trimmed) return;
    if (lastChannelSnapshots.get(elementId) === trimmed) return;

    const storageKey = `${CHANNEL_HISTORY_PREFIX}${elementId}`;
    let history = parseHistory(safeStorage.get(storageKey));
    if (history.length && history[0].pattern === trimmed) {
      lastChannelSnapshots.set(elementId, trimmed);
      return;
    }

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pattern: trimmed,
      createdAt: Date.now()
    };
    history.unshift(entry);
    if (history.length > CHANNEL_HISTORY_LIMIT) {
      history = history.slice(0, CHANNEL_HISTORY_LIMIT);
    }
    writeHistory(storageKey, history);
    lastChannelSnapshots.set(elementId, trimmed);
  };

  const getChannelVersions = (elementId) => {
    if (!elementId) return [];
    return parseHistory(safeStorage.get(`${CHANNEL_HISTORY_PREFIX}${elementId}`));
  };

  const markChannelSnapshot = (elementId, pattern) => {
    if (!elementId) return;
    lastChannelSnapshots.set(elementId, (pattern || '').trim());
  };

  const saveMasterVersion = (pattern) => {
    const trimmed = (pattern || '').trim();
    if (!trimmed || trimmed === lastMasterSnapshot) {
      lastMasterSnapshot = trimmed;
      return;
    }
    let history = parseHistory(safeStorage.get(MASTER_HISTORY_KEY));
    if (history.length && history[0].pattern === trimmed) {
      lastMasterSnapshot = trimmed;
      return;
    }
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pattern: trimmed,
      createdAt: Date.now()
    };
    history.unshift(entry);
    if (history.length > MASTER_HISTORY_LIMIT) {
      history = history.slice(0, MASTER_HISTORY_LIMIT);
    }
    writeHistory(MASTER_HISTORY_KEY, history);
    lastMasterSnapshot = trimmed;
  };

  const getMasterVersions = () => {
    return parseHistory(safeStorage.get(MASTER_HISTORY_KEY));
  };

  const markMasterSnapshot = (pattern) => {
    lastMasterSnapshot = (pattern || '').trim();
  };

  return {
    saveChannelVersion,
    getChannelVersions,
    markChannelSnapshot,
    saveMasterVersion,
    getMasterVersions,
    markMasterSnapshot
  };
})();

window.__patternHistory = patternHistoryStore;

const createPatternHistoryModal = () => {
  const overlay = document.getElementById('pattern-history-modal');
  if (!overlay) {
    return {
      openChannelHistory: () => {},
      openMasterHistory: () => {},
      close: () => {}
    };
  }

  const titleEl = document.getElementById('pattern-history-title');
  const listEl = document.getElementById('pattern-history-list');
  const tabsEl = document.getElementById('pattern-history-tabs');
  const closeBtn = document.getElementById('pattern-history-close');
  let context = null;
  let currentEntries = [];
  let currentTab = 'local';

  const escapeHtml = (value) => {
    return value.replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#039;';
        default: return char;
      }
    });
  };

  const formatTimestamp = (value) => {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return '';
    }
  };

  const closeModal = () => {
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    context = null;
    currentEntries = [];
  };

  const openModal = () => {
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
  };

  const renderEntries = (entries, options = {}) => {
    const { includeMasterSongs = false, isCloudPatterns = false } = options;
    const fragment = document.createDocumentFragment();
    const hasEntries = Array.isArray(entries) && entries.length > 0;

    if (hasEntries) {
      entries.forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = 'pattern-history-entry';
        
        let patternCode = entry.patternCode || entry.pattern || '';
        const snippet = patternCode.length > 240 ? `${patternCode.slice(0, 240)}…` : patternCode;
        const displayIndex = (index + 1).toString().padStart(2, '0');
        
        // For cloud patterns, show metadata
        let metaInfo = formatTimestamp(entry.createdAt);
        if (isCloudPatterns) {
          const metaParts = [];
          if (entry.title) metaParts.push(`"${entry.title}"`);
          if (entry.artistName) metaParts.push(`by ${entry.artistName}`);
          if (entry.version) metaParts.push(`v${entry.version}${entry.versionName ? ` (${entry.versionName})` : ''}`);
          if (entry.userCount > 0) metaParts.push(`${entry.userCount} user${entry.userCount > 1 ? 's' : ''}`);
          if (metaParts.length > 0) {
            metaInfo = metaParts.join(' • ');
          }
        }
        
        row.innerHTML = `
          <div class="pattern-history-meta">
            <span class="pattern-history-index">#${displayIndex}</span>
            <p class="pattern-history-date">${escapeHtml(metaInfo)}</p>
          </div>
          <pre class="pattern-history-snippet">${escapeHtml(snippet)}</pre>
          <div class="pattern-history-actions">
            <button type="button" class="pattern-history-load" data-version-id="${entry.id}" data-is-cloud="${isCloudPatterns}">Load</button>
          </div>
        `;
        fragment.appendChild(row);
      });
    } else {
      const emptyMsg = document.createElement('p');
      emptyMsg.className = 'pattern-history-empty';
      emptyMsg.textContent = 'No saved versions yet.';
      fragment.appendChild(emptyMsg);
    }

    if (includeMasterSongs && MASTER_SONG_PRESETS.length && currentTab === 'local') {
      const songsHeader = document.createElement('h4');
      songsHeader.className = 'pattern-history-section-title';
      songsHeader.textContent = 'Songs';
      fragment.appendChild(songsHeader);

      MASTER_SONG_PRESETS.forEach((song, index) => {
        const row = document.createElement('div');
        row.className = 'pattern-history-entry pattern-history-entry--song';
        const snippet = song.pattern.length > 400 ? `${song.pattern.slice(0, 400)}…` : song.pattern;
        const displayIndex = (index + 1).toString().padStart(2, '0');
        row.innerHTML = `
          <div class="pattern-history-meta">
            <span class="pattern-history-index">#${displayIndex}</span>
            <p class="pattern-history-date">${escapeHtml(song.label)}</p>
          </div>
          <pre class="pattern-history-snippet">${escapeHtml(snippet)}</pre>
          <div class="pattern-history-actions">
            <button type="button" class="pattern-history-load" data-song-id="${song.id}">Load</button>
          </div>
        `;
        fragment.appendChild(row);
      });
    }

    listEl.innerHTML = '';
    listEl.appendChild(fragment);
  };

  listEl.addEventListener('click', async (event) => {
    const loadButton = event.target.closest('.pattern-history-load');
    if (!loadButton || !interactiveSoundAppInstance) return;
    const entryId = loadButton.dataset.versionId;
    const songId = loadButton.dataset.songId;
    const isCloud = loadButton.dataset.isCloud === 'true';

    if (songId && context?.type === 'master') {
      const song = MASTER_SONG_PRESETS.find((item) => item.id === songId);
      if (!song) return;
      interactiveSoundAppInstance.applyMasterHistoryEntry(song.pattern);
      closeModal();
      return;
    }

    let entry = currentEntries.find((item) => item.id === entryId);
    
    // If cloud pattern, fetch full pattern (requires authentication)
    if (isCloud && entry) {
      try {
        const { patternsAPI, getCurrentUser } = await import('./api.js');
        const user = await getCurrentUser();
        if (!user) {
          alert('Please log in to load patterns from cloud');
          return;
        }
        const fullPattern = await patternsAPI.getPattern(entryId);
        entry = fullPattern;
      } catch (error) {
        console.error('Error loading cloud pattern:', error);
        alert('Failed to load pattern: ' + (error.message || 'Please check your login status'));
        return;
      }
    }
    
    if (!entry) return;

    let patternCode = entry.patternCode || entry.pattern;
    if (!patternCode) return;

    // Clean master-injected modifiers (postgain, pan, fast, slow, cpm) from loaded pattern
    // These shouldn't be in saved patterns, but clean them if they exist
    patternCode = patternCode.replace(/\.postgain\s*\([^)]*\)/gi, '');
    patternCode = patternCode.replace(/\.pan\s*\([^)]*\)/gi, '');
    patternCode = patternCode.replace(/\.fast\s*\([^)]*\)/gi, '');
    patternCode = patternCode.replace(/\.slow\s*\([^)]*\)/gi, '');
    patternCode = patternCode.replace(/\.cpm\s*\([^)]*\)/gi, '');
    // Clean up any double dots or trailing dots
    patternCode = patternCode.replace(/\.\.+/g, '.').trim();
    patternCode = patternCode.replace(/\.+$/, '').trim();

    if (context?.type === 'channel') {
      interactiveSoundAppInstance.applyChannelHistoryEntry(context.elementId, patternCode);
    } else if (context?.type === 'master') {
      interactiveSoundAppInstance.applyMasterHistoryEntry(patternCode);
    }
    closeModal();
  });

  closeBtn?.addEventListener('click', closeModal);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeModal();
    }
  });

  const loadCloudPatterns = async (type, elementId = null) => {
    try {
      const { patternsAPI, getCurrentUser } = await import('./api.js');
      const user = await getCurrentUser();
      
      if (!user) {
        return [];
      }

      const filters = { type };
      if (elementId) {
        // For channel patterns, we'd need to filter by elementId in the API
        // For now, just get all channel patterns
      }

      let patterns = [];
      if (currentTab === 'my-patterns') {
        patterns = await patternsAPI.getPatterns({ type, isPublic: false });
        // Filter to current user's patterns
        patterns = patterns.filter(p => p.userId === user.id);
      } else if (currentTab === 'public') {
        patterns = await patternsAPI.getPatterns({ type, isPublic: true });
      } else if (currentTab === 'shared') {
        patterns = await patternsAPI.getPatterns({ type, shared: true });
      }

      return patterns;
    } catch (error) {
      console.error('Error loading cloud patterns:', error);
      return [];
    }
  };

  const switchTab = async (tabName) => {
    currentTab = tabName;
    
    // Update tab UI
    if (tabsEl) {
      tabsEl.querySelectorAll('.pattern-history-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
      });
    }

    // Load appropriate patterns
    listEl.innerHTML = '<p class="pattern-history-empty">Loading…</p>';
    
    if (tabName === 'local') {
      if (context?.type === 'channel') {
        currentEntries = patternHistoryStore.getChannelVersions(context.elementId);
        renderEntries(currentEntries);
      } else if (context?.type === 'master') {
        currentEntries = patternHistoryStore.getMasterVersions();
        renderEntries(currentEntries, { includeMasterSongs: true });
      }
    } else {
      const cloudPatterns = await loadCloudPatterns(context?.type || 'master', context?.elementId);
      currentEntries = cloudPatterns;
      renderEntries(cloudPatterns, { isCloudPatterns: true });
    }
  };

  const openChannelHistory = async (elementId) => {
    if (!elementId) return;
    context = { type: 'channel', elementId };
    titleEl.textContent = `${getChannelDisplayLabel(elementId)} history`;
    openModal();
    
    // Show tabs if user is logged in
    const { getCurrentUser } = await import('./api.js');
    const user = await getCurrentUser();
    if (tabsEl) {
      tabsEl.style.display = user ? 'flex' : 'none';
    }
    
    listEl.innerHTML = '<p class="pattern-history-empty">Loading…</p>';
    currentTab = 'local';
    currentEntries = patternHistoryStore.getChannelVersions(elementId);
    renderEntries(currentEntries);
  };

  const openMasterHistory = async () => {
    context = { type: 'master' };
    titleEl.textContent = 'Master history';
    openModal();
    
    // Show tabs if user is logged in
    const { getCurrentUser } = await import('./api.js');
    const user = await getCurrentUser();
    if (tabsEl) {
      tabsEl.style.display = user ? 'flex' : 'none';
    }
    
    listEl.innerHTML = '<p class="pattern-history-empty">Loading…</p>';
    currentTab = 'local';
    currentEntries = patternHistoryStore.getMasterVersions();
    renderEntries(currentEntries, { includeMasterSongs: true });
  };

  // Setup tab switching
  if (tabsEl) {
    tabsEl.addEventListener('click', (e) => {
      const tab = e.target.closest('.pattern-history-tab');
      if (tab) {
        switchTab(tab.dataset.tab);
      }
    });
  }

  return {
    openChannelHistory,
    openMasterHistory,
    close: closeModal
  };
};

let patternHistoryModalInstance = null;

const historyButtonHandler = (event) => {
  if (!patternHistoryModalInstance) return;
  const saveBtn = event.target.closest('[data-history-save]');
  if (saveBtn) {
    event.preventDefault();
    const target = saveBtn.dataset.historySave;
    if (target === 'channel') {
      const element = saveBtn.closest('.sound-element');
      const elementId = element?.getAttribute('data-sound-id');
      if (elementId && interactiveSoundAppInstance) {
        interactiveSoundAppInstance.saveChannelWithEffects?.(elementId);
      }
    } else if (target === 'master') {
      if (interactiveSoundAppInstance) {
        interactiveSoundAppInstance.saveMasterHistoryEntry?.();
      }
    }
    return;
  }
  const channelBtn = event.target.closest('[data-history-target="channel"]');
  if (channelBtn) {
    event.preventDefault();
    const element = channelBtn.closest('.sound-element');
    const elementId = element?.getAttribute('data-sound-id');
    if (elementId) {
      patternHistoryModalInstance.openChannelHistory(elementId);
    }
    return;
  }
  const masterBtn = event.target.closest('#load-master-history-btn');
  if (masterBtn) {
    event.preventDefault();
    patternHistoryModalInstance.openMasterHistory();
  }
};

const initializePatternHistoryUI = () => {
  patternHistoryModalInstance = createPatternHistoryModal();
  document.addEventListener('click', historyButtonHandler);
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
  'n()',
  'sound()',
  's()',
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

// Non-linear frequency mapping functions for Hz sliders and visualizers
// Distribution: 20-100Hz=25%, 100-500Hz=25%, 500-5000Hz=30%, 5000-20000Hz=20%
function frequencyToPosition(hz) {
  const minHz = 20;
  const maxHz = 20000;
  if (hz <= minHz) return 0;
  if (hz >= maxHz) return 1;
  
  // Normalize to 0-1 range
  const normalized = (hz - minHz) / (maxHz - minHz);
  
  // Map to non-linear distribution
  if (hz <= 100) {
    // 20-100Hz = 25% (0-0.25)
    const range = 100 - 20;
    const pos = (hz - 20) / range;
    return pos * 0.25;
  } else if (hz <= 500) {
    // 100-500Hz = 25% (0.25-0.5)
    const range = 500 - 100;
    const pos = (hz - 100) / range;
    return 0.25 + pos * 0.25;
  } else if (hz <= 5000) {
    // 500-5000Hz = 30% (0.5-0.8)
    const range = 5000 - 500;
    const pos = (hz - 500) / range;
    return 0.5 + pos * 0.3;
  } else {
    // 5000-20000Hz = 20% (0.8-1.0)
    const range = 20000 - 5000;
    const pos = (hz - 5000) / range;
    return 0.8 + pos * 0.2;
  }
}

function positionToFrequency(position) {
  const minHz = 20;
  const maxHz = 20000;
  if (position <= 0) return minHz;
  if (position >= 1) return maxHz;
  
  // Map from non-linear distribution
  if (position <= 0.25) {
    // 0-0.25 -> 20-100Hz
    const pos = position / 0.25;
    return 20 + pos * (100 - 20);
  } else if (position <= 0.5) {
    // 0.25-0.5 -> 100-500Hz
    const pos = (position - 0.25) / 0.25;
    return 100 + pos * (500 - 100);
  } else if (position <= 0.8) {
    // 0.5-0.8 -> 500-5000Hz
    const pos = (position - 0.5) / 0.3;
    return 500 + pos * (5000 - 500);
  } else {
    // 0.8-1.0 -> 5000-20000Hz
    const pos = (position - 0.8) / 0.2;
    return 5000 + pos * (20000 - 5000);
  }
}

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
  'room': { min: 0, max: 5, step: 0.01, default: 0, unit: '' },
  'roomsize': { min: 0, max: 4, step: 0.01, default: 0.5, unit: '' },
  'roomfade': { min: 0, max: 1, step: 0.01, default: 0.5, unit: '' },
  'roomlp': { min: 20, max: 20000, step: 10, default: 20, unit: 'Hz' },
  'roomdim': { min: 0, max: 1, step: 0.01, default: 0, unit: '' },
  'iresponse': { min: 0, max: 1, step: 0.01, default: 0, unit: '' },
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
    matcher: (key) => ['stack', 'beat', 'bank', 'sound', 's', 'note', 'n'].includes(key),
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
        'brandby'
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
    matcher: (key) => ['voicing', 'voicings', 'addvoicings', 'scale', 'transpose', 'scaletranspose', 'rootnotes', 'chord', 'dict', 'anchor', 'mode', 'below', 'duck', 'above', 'offset', 'n', 'note'].includes(key),
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
    matcher: (key) => {
      const deviceKeys = ['orientation', 'acceleration', 'accelerate', 'accelerationx', 'accelerationy', 'accelerationz', 'rotationx', 'rotationy', 'rotationz', 'gravityx', 'gravityy', 'gravityz', 'mousex', 'mousey'];
      return deviceKeys.some((token) => key.includes(token));
    },
    className: 'snippet-group-device'
  },
  {
    id: 'external-communication',
    order: 20,
    label: 'External Communication',
    heading: 'External Communication',
    matcher: (key) => ['osc', 'mqtt'].includes(key),
    className: 'snippet-group-external-communication'
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

// Tag suggestions: maps tag keys to arrays of suggested related tag keys
const TAG_SUGGESTIONS = {
  // Core functions
  'sound': ['bank', 'note', 'chord', 'delay', 'room', 'phaser', 'gain', 'lpf', 'pan'],
  's': ['bank', 'note', 'chord', 'delay', 'room', 'phaser', 'gain', 'lpf', 'pan'],
  'note': ['chord', 'scale', 'voicing', 'transpose', 'scaletranspose', 'rootnotes', 'attack', 'decay', 'release', 'lpf', 'gain', 'pan'],
  'stack': ['beat', 'sound', 'note', 'gain', 'pan'],
  'beat': ['sound', 's', 'euclid', 'mask', 'slow', 'fast', 'rev', 'iter'],
  'bank': ['sound', 's', 'gain', 'pan', 'slow', 'fast', 'euclid', 'mask', 'delay', 'room', 'crush', 'distort'],
  
  // Filters
  'lpf': ['lpenv', 'lpattack', 'lpdecay', 'lpsustain', 'lprelease', 'lpq', 'ftype', 'hpf', 'bpf', 'gain'],
  'hpf': ['hpattack', 'hpdecay', 'hpsustain', 'hprelease', 'hpq', 'lpf', 'bpf', 'gain'],
  'bpf': ['bpattack', 'bpdecay', 'bpsustain', 'bprelease', 'bpq', 'bpg', 'lpf', 'hpf', 'gain'],
  'lpenv': ['lpf', 'lpattack', 'lpdecay', 'lpsustain', 'lprelease', 'lpq'],
  'lpattack': ['lpf', 'lpenv', 'lpdecay', 'lpsustain', 'lprelease'],
  'lpdecay': ['lpf', 'lpenv', 'lpattack', 'lpsustain', 'lprelease'],
  'lpsustain': ['lpf', 'lpenv', 'lpattack', 'lpdecay', 'lprelease'],
  'lprelease': ['lpf', 'lpenv', 'lpattack', 'lpdecay', 'lpsustain'],
  'lpq': ['lpf', 'lpenv'],
  'hpq': ['hpf'],
  'bpq': ['bpf', 'bpg'],
  'bpg': ['bpf', 'bpq'],
  'ftype': ['lpf'],
  'vowel': ['lpf', 'ftype'],
  
  // Envelopes
  'attack': ['decay', 'sustain', 'release', 'adsr', 'gain', 'lpf'],
  'decay': ['attack', 'sustain', 'release', 'adsr', 'gain'],
  'sustain': ['attack', 'decay', 'release', 'adsr', 'gain'],
  'release': ['attack', 'decay', 'sustain', 'adsr', 'gain'],
  'adsr': ['attack', 'decay', 'sustain', 'release', 'gain'],
  'pattack': ['pdecay', 'prelease', 'penv', 'pcurve', 'panchor'],
  'pdecay': ['pattack', 'prelease', 'penv', 'pcurve'],
  'prelease': ['pattack', 'pdecay', 'penv', 'pcurve'],
  'penv': ['pattack', 'pdecay', 'prelease', 'pcurve', 'panchor'],
  'pcurve': ['penv', 'pattack', 'pdecay', 'prelease'],
  'panchor': ['penv', 'pattack'],
  
  // Effects - show parameters when effect is selected
  'delay': ['delaytime', 'delayfeedback'],
  'delaytime': ['delay', 'delayfeedback'],
  'delayfeedback': ['delay', 'delaytime'],
  'room': ['roomsize', 'roomfade', 'roomlp', 'roomdim', 'iresponse'],
  'roomsize': ['room', 'roomfade', 'roomlp', 'roomdim'],
  'roomfade': ['room', 'roomsize', 'roomlp'],
  'roomlp': ['room', 'roomsize', 'roomfade'],
  'roomdim': ['room', 'roomsize'],
  'iresponse': ['room', 'roomsize'],
  'phaser': ['phaserdepth', 'phasercenter', 'phasersweep'],
  'phaserdepth': ['phaser', 'phasercenter', 'phasersweep'],
  'phasercenter': ['phaser', 'phaserdepth', 'phasersweep'],
  'phasersweep': ['phaser', 'phaserdepth', 'phasercenter'],
  'duckorbit': ['duckattack', 'duckdepth'],
  'duckattack': ['duckorbit', 'duckdepth'],
  'duckdepth': ['duckorbit', 'duckattack'],
  
  // Dynamics
  'gain': ['velocity', 'compressor', 'postgain', 'pan', 'delay', 'room'],
  'velocity': ['gain', 'attack', 'decay'],
  'compressor': ['gain', 'postgain'],
  'postgain': ['gain', 'compressor'],
  'xfade': ['gain'],
  
  // Panning
  'pan': ['jux', 'juxby', 'gain'],
  'jux': ['juxby', 'pan'],
  'juxby': ['jux', 'pan'],
  
  // Waveshaping
  'crush': ['distort', 'coarse', 'gain'],
  'distort': ['crush', 'coarse', 'gain'],
  'coarse': ['crush', 'distort'],
  
  // Time modifiers - suggest other time modifiers for rhythmic patterns
  'slow': ['fast', 'early', 'late', 'clip', 'legato', 'swing'],
  'fast': ['slow', 'early', 'late', 'clip', 'legato'],
  'early': ['late', 'slow', 'fast', 'clip'],
  'late': ['early', 'slow', 'fast', 'clip'],
  'clip': ['slow', 'fast', 'legato', 'early', 'late'],
  'legato': ['clip', 'early', 'late', 'slow', 'fast'],
  'euclid': ['euclidrot', 'euclidlegato', 'mask', 'beat', 'slow', 'fast'],
  'euclidrot': ['euclid', 'euclidlegato', 'mask'],
  'euclidlegato': ['euclid', 'euclidrot', 'mask'],
  'rev': ['palindrome', 'iter', 'iterback'],
  'palindrome': ['rev', 'iter', 'iterback'],
  'iter': ['iterback', 'rev', 'palindrome'],
  'iterback': ['iter', 'rev', 'palindrome'],
  'ply': ['segment', 'compress', 'zoom'],
  'segment': ['ply', 'compress', 'zoom', 'ribbon'],
  'compress': ['ply', 'segment'],
  'zoom': ['linger', 'fastgap', 'ply', 'segment'],
  'linger': ['zoom', 'fastgap'],
  'fastgap': ['zoom', 'linger'],
  'inside': ['outside', 'clip'],
  'outside': ['inside', 'clip'],
  'swing': ['swingby', 'cpm', 'slow', 'fast'],
  'swingby': ['swing', 'cpm'],
  'cpm': ['swing', 'swingby'],
  'ribbon': ['segment', 'ply'],
  
  // Control operators
  'add': ['sub', 'mul', 'div', 'range', 'rangex'],
  'sub': ['add', 'mul', 'div', 'range'],
  'mul': ['add', 'sub', 'div', 'range'],
  'div': ['add', 'sub', 'mul', 'range'],
  'range': ['rangex', 'range2', 'add', 'sub', 'mul'],
  'rangex': ['range', 'range2'],
  'range2': ['range', 'rangex'],
  'floor': ['ceil', 'ratio'],
  'ceil': ['floor', 'ratio'],
  'ratio': ['floor', 'ceil'],
  'as': ['range'],
  
  // Signals
  'saw': ['sine', 'tri', 'square', 'rand', 'range'],
  'sine': ['saw', 'cosine', 'tri', 'square', 'range'],
  'cosine': ['sine', 'saw', 'tri', 'square'],
  'tri': ['saw', 'sine', 'square', 'rand'],
  'square': ['saw', 'sine', 'tri', 'rand'],
  'rand': ['saw', 'sine', 'tri', 'square', 'irand', 'brand'],
  'saw2': ['sine2', 'tri2', 'square2', 'rand2'],
  'sine2': ['saw2', 'cosine2', 'tri2', 'square2'],
  'cosine2': ['sine2', 'saw2', 'tri2', 'square2'],
  'tri2': ['saw2', 'sine2', 'square2', 'rand2'],
  'square2': ['saw2', 'sine2', 'tri2', 'rand2'],
  'rand2': ['saw2', 'sine2', 'tri2', 'square2'],
  'perlin': ['rand', 'brand', 'range'],
  'irand': ['rand', 'brand'],
  'brand': ['rand', 'irand', 'brandby'],
  'brandby': ['brand'],
  
  // Tonal functions - suggest other tonal modifiers
  'chord': ['voicing', 'addvoicings', 'scale', 'transpose', 'scaletranspose', 'rootnotes', 'dict', 'mode', 'note'],
  'voicing': ['chord', 'addvoicings', 'scale', 'transpose', 'note'],
  'addvoicings': ['voicing', 'chord'],
  'scale': ['chord', 'voicing', 'transpose', 'scaletranspose', 'rootnotes', 'dict', 'mode', 'note'],
  'transpose': ['scale', 'scaletranspose', 'chord', 'note', 'offset'],
  'scaletranspose': ['scale', 'transpose', 'chord'],
  'rootnotes': ['scale', 'chord', 'transpose'],
  'dict': ['chord', 'scale', 'note'],
  'anchor': ['penv', 'pcurve', 'panchor', 'scale'],
  'mode': ['scale', 'chord', 'note'],
  'below': ['above', 'note', 'chord'],
  'above': ['below', 'note', 'chord'],
  'offset': ['transpose', 'scale', 'note'],
  'n': ['note', 'chord', 'scale', 'voicing', 'transpose'],
  
  // Synths
  'cutoff': ['lpf', 'resonance', 'lpenv'],
  'resonance': ['cutoff', 'lpf', 'lpq'],
  'noise': ['sound', 'cutoff', 'lpf'],
  'vib': ['vibmod', 'tremolo'],
  'vibmod': ['vib'],
  'fm': ['fmh', 'fmattack', 'fmdecay', 'fmsustain', 'fmenv', 'fmwave'],
  'fmh': ['fm', 'fmattack', 'fmdecay'],
  'fmattack': ['fm', 'fmdecay', 'fmsustain', 'fmenv'],
  'fmdecay': ['fm', 'fmattack', 'fmsustain', 'fmenv'],
  'fmsustain': ['fm', 'fmattack', 'fmdecay', 'fmenv'],
  'fmenv': ['fm', 'fmattack', 'fmdecay', 'fmsustain'],
  'fmwave': ['fm'],
  'zrand': ['rand', 'brand'],
  'curve': ['slide', 'deltaslide'],
  'slide': ['curve', 'deltaslide'],
  'deltaslide': ['slide', 'curve'],
  'zmod': ['vib', 'vibmod'],
  'zcrush': ['crush', 'distort'],
  'zdelay': ['delay', 'delaytime'],
  'pitchjump': ['pitchjumptime', 'penv'],
  'pitchjumptime': ['pitchjump'],
  'lfo': ['tremolo', 'vib'],
  'octave': ['transpose', 'note'],
  'pw': ['pwrate', 'pwsweep'],
  'pwrate': ['pw', 'pwsweep'],
  'pwsweep': ['pw', 'pwrate'],
  'spread': ['unison', 'pan'],
  'unison': ['spread'],
  'isaw': ['isaw2', 'itri', 'itri2'],
  'isaw2': ['isaw', 'itri', 'itri2'],
  'itri': ['isaw', 'isaw2', 'itri2'],
  'itri2': ['isaw', 'isaw2', 'itri'],
  
  // Amplitude modulation
  'tremolo': ['tremolosync', 'tremolodepth', 'tremoloskew', 'tremolophase', 'tremoloshape', 'lfo'],
  'tremolosync': ['tremolo', 'tremolodepth'],
  'tremolodepth': ['tremolo', 'tremolosync'],
  'tremoloskew': ['tremolo', 'tremolophase'],
  'tremolophase': ['tremolo', 'tremoloshape'],
  'tremoloshape': ['tremolo', 'tremolophase'],
  
  // Random modifiers
  'choose': ['wchoose', 'sometimes', 'rarely'],
  'wchoose': ['choose', 'sometimes'],
  'choosecycles': ['wchoosecycles', 'somecycles'],
  'wchoosecycles': ['choosecycles', 'somecycles'],
  'degradeby': ['degrade', 'sometimes'],
  'degrade': ['degradeby', 'sometimes'],
  'undegradeby': ['undegrade'],
  'undegrade': ['undegradeby'],
  'sometimesby': ['sometimes', 'rarely', 'often'],
  'sometimes': ['sometimesby', 'rarely', 'often', 'choose'],
  'somecyclesby': ['somecycles', 'choosecycles'],
  'somecycles': ['somecyclesby', 'choosecycles'],
  'often': ['sometimes', 'rarely', 'almostalways'],
  'rarely': ['sometimes', 'often', 'almostnever'],
  'almostnever': ['rarely', 'never'],
  'almostalways': ['often', 'always'],
  'never': ['almostnever'],
  'always': ['almostalways'],
  
  // Conditional modifiers - rhythmic/pattern modifiers
  'lastof': ['firstof', 'when', 'mask'],
  'firstof': ['lastof', 'when', 'mask'],
  'when': ['lastof', 'firstof', 'mask', 'struct'],
  'chunk': ['chunkback', 'fastchunk', 'mask', 'struct'],
  'chunkback': ['chunk', 'fastchunk', 'mask'],
  'fastchunk': ['chunk', 'chunkback', 'mask'],
  'arp': ['arpwith', 'chord', 'voicing', 'note'],
  'arpwith': ['arp', 'chord'],
  'struct': ['mask', 'pick', 'when', 'beat'],
  'mask': ['struct', 'when', 'euclid', 'beat', 'chunk'],
  'reset': ['restart', 'pickreset'],
  'restart': ['reset', 'pickrestart'],
  'hush': ['silence'],
  'invert': ['rev', 'palindrome'],
  'pick': ['pickmod', 'pickf', 'pickmodf', 'struct', 'mask'],
  'pickmod': ['pick', 'pickmodf', 'struct'],
  'pickf': ['pick', 'pickmodf', 'struct'],
  'pickmodf': ['pick', 'pickf', 'struct'],
  'pickrestart': ['pickmodrestart', 'restart'],
  'pickmodrestart': ['pickrestart'],
  'pickreset': ['pickmodreset', 'reset'],
  'pickmodreset': ['pickreset'],
  'inhabit': ['inhabitmod', 'mask', 'struct'],
  'inhabitmod': ['inhabit', 'mask'],
  'squeeze': ['compress', 'segment'],
  
  // Accumulation modifiers
  'superimpose': ['layer', 'off', 'echo'],
  'layer': ['superimpose', 'off'],
  'off': ['superimpose', 'layer'],
  'echo': ['echowith', 'delay', 'superimpose'],
  'echowith': ['echo'],
  
  // Stepwise patterning - rhythmic/time modifiers
  'pace': ['stepcat', 'stepalt', 'polymeter', 'slow', 'fast'],
  'stepcat': ['pace', 'stepalt', 'polymeter'],
  'stepalt': ['pace', 'stepcat'],
  'expand': ['contract', 'extend', 'take', 'drop'],
  'contract': ['expand', 'extend', 'take', 'drop'],
  'extend': ['expand', 'contract', 'take', 'drop'],
  'take': ['drop', 'extend', 'expand', 'contract'],
  'drop': ['take', 'extend', 'expand', 'contract'],
  'polymeter': ['pace', 'stepcat', 'slow', 'fast'],
  'shrink': ['grow', 'compress'],
  'grow': ['shrink', 'expand'],
  'tour': ['zip', 'iter'],
  'zip': ['tour', 'iter'],
  
  // Device motion
  'orientation': ['acceleration', 'rotationx', 'rotationy', 'rotationz'],
  'acceleration': ['accelerationx', 'accelerationy', 'accelerationz', 'gravityx', 'gravityy', 'gravityz'],
  'accelerate': ['acceleration'],
  'accelerationx': ['accelerationy', 'accelerationz', 'gravityx'],
  'accelerationy': ['accelerationx', 'accelerationz', 'gravityy'],
  'accelerationz': ['accelerationx', 'accelerationy', 'gravityz'],
  'rotationx': ['rotationy', 'rotationz', 'orientation'],
  'rotationy': ['rotationx', 'rotationz', 'orientation'],
  'rotationz': ['rotationx', 'rotationy', 'orientation'],
  'gravityx': ['gravityy', 'gravityz', 'accelerationx'],
  'gravityy': ['gravityx', 'gravityz', 'accelerationy'],
  'gravityz': ['gravityx', 'gravityy', 'accelerationz'],
  'mousex': ['mousey', 'pan', 'range'],
  'mousey': ['mousex', 'gain', 'range'],
  
  // External communication
  'osc': ['mqtt'],
  'mqtt': ['osc'],
  
  // MIDI
  'midi': ['midiport', 'midicmd', 'midibend', 'miditouch'],
  'midiport': ['midi'],
  'midicmd': ['midi'],
  'midibend': ['midi', 'miditouch'],
  'miditouch': ['midi', 'midibend'],
  'midimap': ['midimaps', 'defaultmidimap'],
  'midimaps': ['midimap', 'defaultmidimap'],
  'defaultmidimap': ['midimap', 'midimaps'],
  'ccn': ['ccv', 'control'],
  'ccv': ['ccn', 'control'],
  'control': ['ccn', 'ccv'],
  'prognum': ['midi'],
  'sysex': ['sysexid', 'sysexdata'],
  'sysexid': ['sysex', 'sysexdata'],
  'sysexdata': ['sysex', 'sysexid'],
  
  // Global effects
  'orbit': ['duckorbit', 'pan'],
  
  // Visual feedback
  'scope': ['fscope', 'pianoroll', 'spiral'],
  'fscope': ['scope', 'pianoroll'],
  'pianoroll': ['scope', 'fscope'],
  'spiral': ['scope'],
  'pitchwheel': ['penv'],
  'color': ['markcss'],
  'markcss': ['color'],
  
  // Other
  'vowel': ['ftype', 'lpf'],
  'speed': ['slow', 'fast'],
  'seg': ['segment'],
  'fancor': ['lpf'],
  'patt': ['struct'],
  'dec': ['decay'],
  'set': ['struct'],
  'irand': ['rand', 'brand']
};

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
    interactiveSoundAppInstance = this;
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
    this.barchartAnimationFrame = null;
    this.scopeDataArray = null;
    this.spectrumDataArray = null;
    this.activeVisualizerLoop = null;
    this.introSamplePlayed = false;
    this._introSampleActivationHandler = null;

    // Native Strudel highlighting
    this.nativeHighlightingEnabled = false;
    this.nativeHighlightingDisabled = false;
    this.nativeHighlightRetryCount = 0;
    this.nativeHighlightRetryTimer = null;

    this.visualizerFullscreenBtn = null;
    this.handleVisualizerFullscreenChange = this.handleVisualizerFullscreenChange.bind(this);
    document.addEventListener('fullscreenchange', this.handleVisualizerFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this.handleVisualizerFullscreenChange);
    document.addEventListener('mozfullscreenchange', this.handleVisualizerFullscreenChange);
    document.addEventListener('MSFullscreenChange', this.handleVisualizerFullscreenChange);
    
    // Chaospad state
    this.chaospadEnabled = false;
    this.currentCutoffValue = null;
    this.lastCutoffUpdate = null;
    this.currentResonanceValue = null;
    this.lastResonanceUpdate = null;
    this.chaospadDefaults = {
      cutoff: 4040,
      resonance: 0
    };
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
      this.enableNativeStrudelHighlighting();
    });

    // Set up callback for when master pattern is updated
    soundManager.onMasterPatternUpdate(async () => {
      console.log('🔄 Master pattern updated - refreshing display');
      this.updateMasterPatternDisplay();
      
      // Update pattern slots display when master pattern changes
      this.updateActiveElementsDisplay();

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
          playMasterBtn.textContent = '❚❚';
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
      
      // Update status message
      if (isPlaying) {
        uiController.updateStatus('Playing Master');
      } else {
        // Restore normal status when master stops
        const hasActiveElements = this.activeElements.size > 0;
        if (!hasActiveElements) {
          uiController.updateStatus('Ready - Click elements to start/stop patterns (Press Escape to stop all)');
        }
      }
      
      // Hide/show pattern slots display based on master state
      const patternSlotsDiv = document.getElementById('pattern-slots');
      if (patternSlotsDiv) {
        patternSlotsDiv.style.display = isPlaying ? 'none' : 'block';
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
        // Hide placeholder when playing (unless visualizer is "off")
        if (this.selectedVisualizer === 'off') {
          this.showMasterPunchcardPlaceholder();
        } else {
          this.hideMasterPunchcardPlaceholder();
        }
        this.enableNativeStrudelHighlighting();
      } else {
        // Show placeholder when stopped if visualizer is "off", otherwise hide
        if (this.selectedVisualizer === 'off') {
          this.showMasterPunchcardPlaceholder();
        } else {
          this.hideMasterPunchcardPlaceholder();
        }
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
        this.enableNativeStrudelHighlighting();
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
        const resolvedTitle = saved.title && saved.title.trim()
          ? saved.title
          : (saved.bank ? (DRUM_BANK_DISPLAY_NAMES[saved.bank] || saved.bank) : '');
        updateElementTitleDisplay(id, resolvedTitle);
          } else {
        updateElementTitleDisplay(id, '');
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

  tryPlayIntroSample() {
    if (this.introSamplePlayed || !INTRO_SAMPLE_PATH) {
      return;
    }

    if (!soundManager) {
      return;
    }

    const audioContext = typeof soundManager.getAudioContext === 'function'
      ? soundManager.getAudioContext()
      : null;

    const audioReady = soundManager.isAudioReady() && audioContext;

    const playAndCleanup = () => {
      try {
        soundManager.playAudioFile('intro-sample', INTRO_SAMPLE_PATH);
        this.introSamplePlayed = true;
        this.detachIntroSampleActivationHandlers();
      } catch (error) {
        console.warn('⚠️ Unable to play intro sample automatically:', error);
      }
    };

    if (audioReady) {
      if (audioContext.state !== 'running') {
        audioContext.resume().then(() => {
          playAndCleanup();
        }).catch((error) => {
          console.warn('⚠️ Unable to resume audio context for intro sample:', error);
          this.attachIntroSampleActivationHandlers();
        });
      } else {
        playAndCleanup();
      }
    } else {
      this.attachIntroSampleActivationHandlers();
    }
  }

  attachIntroSampleActivationHandlers() {
    if (this._introSampleActivationHandler || this.introSamplePlayed) {
      return;
    }

    this._introSampleActivationHandler = () => {
      if (soundManager?.getAudioContext) {
        const audioContext = soundManager.getAudioContext();
        if (audioContext && audioContext.state === 'suspended') {
          audioContext.resume().catch(() => {});
        }
      }
      this.tryPlayIntroSample();
    };

    document.addEventListener('pointerdown', this._introSampleActivationHandler, { passive: true });
    document.addEventListener('keydown', this._introSampleActivationHandler);
  }

  detachIntroSampleActivationHandlers() {
    if (!this._introSampleActivationHandler) {
      return;
    }

    document.removeEventListener('pointerdown', this._introSampleActivationHandler);
    document.removeEventListener('keydown', this._introSampleActivationHandler);
    this._introSampleActivationHandler = null;
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
          
          if (this.selectedVisualizer && this.selectedVisualizer !== 'punchcard' && this.selectedVisualizer !== 'off') {
            console.log(`🎨 Preparing canvas for visualizer "${this.selectedVisualizer}"`);
            await this.prepareCanvasForExternalVisualizer();
          } else {
            this.showMasterPunchcardPlaceholder();
          }

          console.log(`🎨 Applying visualizer "${this.selectedVisualizer || 'off'}" before playing`);
          try {
            await this.applyVisualizerToMaster();
          } catch (visualizerError) {
            console.warn(`⚠️ Error applying visualizer, continuing with playback:`, visualizerError);
          }
          
          const result = await soundManager.playMasterPattern();
          
          if (result.success) {
            this.masterActive = true;
            playMasterBtn.textContent = '❚❚';
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

      // Toggle master play/pause with spacebar (when not typing in an input)
      if (!this._masterSpacebarHandlerAttached) {
        this._masterSpacebarHandlerAttached = true;
        document.addEventListener('keydown', async (event) => {
          if (event.code !== 'Space') {
            return;
          }

          const activeElement = document.activeElement;
          const tag = activeElement?.tagName?.toLowerCase();
          const typingElement = activeElement?.isContentEditable ||
            tag === 'textarea' ||
            (tag === 'input' && activeElement?.type !== 'button' && activeElement?.type !== 'checkbox' && activeElement?.type !== 'range') ||
            tag === 'select';

          if (typingElement) {
            return;
          }

          event.preventDefault();
          playMasterBtn.click();
        });
      }
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
            copyCodeBtn.title = 'Copy';
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
    this.selectedVisualizer = 'off'; // default
    const visualizerSelect = document.getElementById('visualizer-select');
    this.visualizerSelect = visualizerSelect;
    if (visualizerSelect) {
      visualizerSelect.value = this.selectedVisualizer;
      visualizerSelect.addEventListener('change', async (e) => {
        this.selectedVisualizer = e.target.value;
        console.log(`🎨 Visualizer changed to: ${this.selectedVisualizer}`);
        
        if (this.selectedVisualizer === 'off') {
          // When "Off" is selected, always show placeholder
          this.showMasterPunchcardPlaceholder();
        } else if (this.selectedVisualizer !== 'punchcard') {
          await this.prepareCanvasForExternalVisualizer();
        } else {
          this.showMasterPunchcardPlaceholder();
        }

        await this.applyVisualizerToMaster();

        this.refreshMasterPunchcard('visualizer-change').catch(err => {
          console.warn('⚠️ Unable to refresh punchcard after visualizer change:', err);
        });
      });
    }
    
    this.visualizerFullscreenBtn = document.getElementById('visualizer-fullscreen-btn');
    if (this.visualizerFullscreenBtn) {
      this.visualizerFullscreenBtn.addEventListener('click', () => {
        this.toggleVisualizerFullscreen();
      });
      this.updateVisualizerFullscreenButton(false);
    }
    
    // Setup Chaospad checkbox
    const chaospadCheckbox = document.getElementById('chaospad-checkbox');
    if (chaospadCheckbox) {
      chaospadCheckbox.addEventListener('change', async (e) => {
        this.chaospadEnabled = e.target.checked;
        console.log(`🎛️ Chaospad ${this.chaospadEnabled ? 'enabled' : 'disabled'}`);
        
        // Update cursor style
        if (this.masterPunchcardCanvas) {
          this.masterPunchcardCanvas.style.cursor = this.chaospadEnabled ? 'pointer' : '';
        }
        
        if (!this.chaospadEnabled) {
          // Remove modifiers when disabled
          console.log('🎛️ Chaospad: Disabled - removing cutoff and resonance');
          await this.removeCutoffFromMaster();
          await this.removeResonanceFromMaster();
        } else {
          // Apply defaults when enabled
          console.log('🎛️ Chaospad: Enabled - applying default cutoff and resonance');
          await this.resetChaospadToDefaults();
        }
      });
    }
    
    // Setup mouse move listener for Chaospad on canvas
    if (this.masterPunchcardCanvas) {
      // Update cursor style based on Chaospad state
      const updateCursor = () => {
        if (this.chaospadEnabled) {
          this.masterPunchcardCanvas.style.cursor = 'pointer';
        } else {
          this.masterPunchcardCanvas.style.cursor = '';
        }
      };
      
      this.masterPunchcardCanvas.addEventListener('mousemove', (e) => {
        if (this.chaospadEnabled) {
          this.handleChaospadMouseMove(e);
          // Create smoke trail when chaospad is enabled
          if (this.createSmokeTrail) {
            this.createSmokeTrail(e.clientX, e.clientY);
          }
        }
      });
      // Also add mouseenter to ensure it works
      this.masterPunchcardCanvas.addEventListener('mouseenter', (e) => {
        if (this.chaospadEnabled) {
          this.handleChaospadMouseMove(e);
          // Create smoke trail when chaospad is enabled
          if (this.createSmokeTrail) {
            this.createSmokeTrail(e.clientX, e.clientY);
          }
        }
      });
      this.masterPunchcardCanvas.addEventListener('mouseleave', () => {
        if (this.chaospadEnabled) {
          this.resetChaospadToDefaults();
        }
      });
      
      // Initial cursor update
      updateCursor();
      
      // Setup mouse trail effect on canvas
      this.setupMouseTrail();
    }
    
    // Ensure initial placeholder text reflects current steps
    this.showMasterPunchcardPlaceholder();
    
    // Chaospad mouse move handler
    this.handleChaospadMouseMove = this.handleChaospadMouseMove.bind(this);
    this.removeCutoffFromMaster = this.removeCutoffFromMaster.bind(this);
    
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
   * Setup mouse trail effect on the visualizer canvas
   */
  setupMouseTrail() {
    if (!this.masterPunchcardCanvas) return;

    const createSmoke = (x, y) => {
      const puff = document.createElement('div');
      puff.className = 'smoke';

      // random sizing + distortion
      const size = Math.random() * 12 + 8;
      puff.style.width = size + 'px';
      puff.style.height = size + 'px';
      puff.style.left = x - size/2 + 'px';
      puff.style.top = y - size/2 + 'px';
      puff.style.transform += ` rotate(${Math.random()*360}deg)`;

      document.body.appendChild(puff);

      // remove after animation
      setTimeout(() => puff.remove(), 800);
    };

    // Store createSmoke function for use in chaospad handler
    this.createSmokeTrail = createSmoke;
  }

  getCurrentFullscreenElement() {
    return document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement ||
      null;
  }

  async toggleVisualizerFullscreen() {
    if (!this.masterPunchcardContainer) return;
    const fullscreenElement = this.getCurrentFullscreenElement();
    const isCssFullscreen = this.masterPunchcardContainer.classList.contains('is-fullscreen') && !fullscreenElement;
    
    if (fullscreenElement === this.masterPunchcardContainer || isCssFullscreen) {
      // Exit fullscreen
      if (fullscreenElement === this.masterPunchcardContainer) {
        // Exit native fullscreen
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
          await document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
          await document.msExitFullscreen();
        }
      } else {
        // Exit CSS fallback fullscreen
        this.masterPunchcardContainer.classList.remove('is-fullscreen');
        document.body.style.overflow = '';
        this.updateVisualizerFullscreenButton(false);
        this.removeMobileFullscreenCloseButton();
      }
      return;
    }

    // Enter fullscreen - try different methods for mobile compatibility
    try {
      // Try standard fullscreen first
      if (this.masterPunchcardContainer.requestFullscreen) {
        await this.masterPunchcardContainer.requestFullscreen();
        return;
      }
      
      // Try webkit (Safari/iOS) - iOS may need different handling
      if (this.masterPunchcardContainer.webkitRequestFullscreen) {
        try {
          // Try with options for iOS
          const options = typeof Element !== 'undefined' && Element.ALLOW_KEYBOARD_INPUT !== undefined 
            ? Element.ALLOW_KEYBOARD_INPUT 
            : undefined;
          if (options !== undefined) {
            await this.masterPunchcardContainer.webkitRequestFullscreen(options);
          } else {
            await this.masterPunchcardContainer.webkitRequestFullscreen();
          }
          return;
        } catch (webkitErr) {
          // If webkit fails, fall through to CSS fallback
          console.warn('⚠️ Webkit fullscreen failed, trying fallback:', webkitErr);
        }
      }
      
      // Try Mozilla
      if (this.masterPunchcardContainer.mozRequestFullScreen) {
        await this.masterPunchcardContainer.mozRequestFullScreen();
        return;
      }
      
      // Try MS
      if (this.masterPunchcardContainer.msRequestFullscreen) {
        await this.masterPunchcardContainer.msRequestFullscreen();
        return;
      }
      
      // Fallback: If fullscreen API is not available, use CSS-based fullscreen for mobile
      if (this.isMobileDevice()) {
        this.masterPunchcardContainer.classList.add('is-fullscreen');
        document.body.style.overflow = 'hidden';
        this.updateVisualizerFullscreenButton(true);
        this.addMobileFullscreenCloseButton();
        // Trigger refresh after CSS fullscreen
        setTimeout(() => {
          this.refreshMasterPunchcard('css-fullscreen').catch(err => {
            console.warn('⚠️ Unable to refresh punchcard after CSS fullscreen:', err);
          });
        }, 100);
        return;
      }
      
      console.warn('⚠️ Fullscreen API not supported on this device');
    } catch (err) {
      console.warn('⚠️ Unable to enter visualizer fullscreen:', err);
      // Fallback for mobile if fullscreen fails
      if (this.isMobileDevice()) {
        this.masterPunchcardContainer.classList.add('is-fullscreen');
        document.body.style.overflow = 'hidden';
        this.updateVisualizerFullscreenButton(true);
        this.addMobileFullscreenCloseButton();
        setTimeout(() => {
          this.refreshMasterPunchcard('css-fullscreen-fallback').catch(err => {
            console.warn('⚠️ Unable to refresh punchcard after CSS fullscreen fallback:', err);
          });
        }, 100);
      }
    }
  }

  isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (window.innerWidth <= 768 && 'ontouchstart' in window);
  }

  addMobileFullscreenCloseButton() {
    // Remove existing close button if any
    this.removeMobileFullscreenCloseButton();
    
    if (!this.masterPunchcardContainer) return;
    
    // Create close button
    const closeBtn = document.createElement('button');
    closeBtn.id = 'mobile-fullscreen-close';
    closeBtn.className = 'mobile-fullscreen-close-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.setAttribute('aria-label', 'Close fullscreen');
    closeBtn.addEventListener('click', () => {
      this.toggleVisualizerFullscreen();
    });
    
    this.masterPunchcardContainer.appendChild(closeBtn);
  }

  removeMobileFullscreenCloseButton() {
    const closeBtn = document.getElementById('mobile-fullscreen-close');
    if (closeBtn) {
      closeBtn.remove();
    }
  }

  updateVisualizerFullscreenButton(isFullscreen) {
    if (!this.visualizerFullscreenBtn) return;
    this.visualizerFullscreenBtn.classList.toggle('is-active', isFullscreen);
    this.visualizerFullscreenBtn.setAttribute(
      'aria-label',
      isFullscreen ? 'Exit visualizer fullscreen' : 'Enter visualizer fullscreen'
    );
  }

  handleVisualizerFullscreenChange() {
    const fullscreenElement = this.getCurrentFullscreenElement();
    const isFullscreen = fullscreenElement === this.masterPunchcardContainer;
    if (this.masterPunchcardContainer) {
      this.masterPunchcardContainer.classList.toggle('is-fullscreen', isFullscreen);
      // If exiting fullscreen and using CSS fallback, restore body overflow
      if (!isFullscreen && this.isMobileDevice()) {
        document.body.style.overflow = '';
        this.removeMobileFullscreenCloseButton();
      } else if (isFullscreen && this.isMobileDevice()) {
        // Add close button when entering native fullscreen on mobile
        setTimeout(() => {
          this.addMobileFullscreenCloseButton();
        }, 100);
      }
    }
    this.updateVisualizerFullscreenButton(isFullscreen);
    // Recalculate canvas sizing after entering/exiting fullscreen
    this.refreshMasterPunchcard('fullscreen-change').catch(err => {
      console.warn('⚠️ Unable to refresh punchcard after fullscreen change:', err);
    });
  }

  /**
   * Apply the selected visualizer to the master pattern and restart playback
   */
  async applyVisualizerToMaster() {
    console.log(`🎨 Applying visualizer "${this.selectedVisualizer}" to master pattern`);
    
    // If "off" is selected, just use the base pattern without any visualizer processors
    if (this.selectedVisualizer === 'off') {
      // Clean up any existing visualizer observers and intervals
      this.scopeSpectrumObserver = null;
      this.scopeSpectrumCopyLoop = null;
      this.teardownExternalVisualizerCanvas();
      this.stopVisualizerAnimation();
      
      // Get the current master pattern without any visualizers
      let basePattern = soundManager.getMasterPatternCode();
      
      // If master pattern is empty, check if there are tracked patterns
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
      
      // Strip any existing visualizer methods
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
      
      // Update the master pattern without any visualizer
      await soundManager.setMasterPatternCode(basePattern);
      
      // Always show placeholder when visualizer is "off"
      this.showMasterPunchcardPlaceholder();
      
      // Refresh the punchcard display
      this.refreshMasterPunchcard('visualizer-off').catch(err => {
        console.warn('⚠️ Unable to refresh punchcard after turning off visualizer:', err);
      });
      
      return; // Exit early - no visualizer processing needed
    }
    
    // Clean up any existing visualizer observers and intervals
      this.scopeSpectrumObserver = null;
      this.scopeSpectrumCopyLoop = null;
    this.teardownExternalVisualizerCanvas();
    this.stopVisualizerAnimation();
    
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
    await this.prepareCanvasForExternalVisualizer();
    
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
    
    // Setup analyser for visualizers that need audio data (scope, bar, spectrum)
    // MUST be done BEFORE pattern evaluation so visualizers can find it
    if (this.selectedVisualizer === 'scope' || this.selectedVisualizer === 'barchart' || this.selectedVisualizer === 'spectrum') {
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
        
        // For scope/barchart/spectrum, ensure canvas is ready and accessible
        if (this.selectedVisualizer === 'scope' || this.selectedVisualizer === 'barchart' || this.selectedVisualizer === 'spectrum') {
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
    
    if (this.selectedVisualizer === 'scope' || this.selectedVisualizer === 'barchart' || this.selectedVisualizer === 'spectrum') {
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
        const { getDrawContext } = await import('@strudel/draw');
        const ctx = getDrawContext(canvasId, { contextType: '2d' });
        
        window.__strudelVisualizerCtx = ctx;
        
        console.log(`✅ Registered canvas "${canvasId}" with getDrawContext for ${this.selectedVisualizer}`);
      } catch (error) {
        console.warn(`⚠️ Failed to register canvas with getDrawContext for ${this.selectedVisualizer}:`, error);
      }
    }
    
    const ctxExpression = "(window.__strudelVisualizerCtx || (document.getElementById('master-punchcard-canvas') && document.getElementById('master-punchcard-canvas').getContext && document.getElementById('master-punchcard-canvas').getContext('2d')))";
    
    if (this.selectedVisualizer === 'scope' || this.selectedVisualizer === 'barchart') {
      patternWithVisualizer = basePattern;
    } else if (this.selectedVisualizer === 'spectrum') {
      patternWithVisualizer = `${basePattern}._spectrum({
        id: '${canvasId}',
        ctx: ${ctxExpression},
        thickness: 3,
        speed: 1,
        min: -80,
        max: 0
      })`;
    } else if (this.selectedVisualizer === 'pianoroll') {
      this.externalVisualizerType = 'pianoroll';
      this.watchForExternalVisualizerCanvas('pianoroll');
      if (this.masterPunchcardCanvas) {
        this.masterPunchcardCanvas.style.display = 'none';
      }
        patternWithVisualizer = `${basePattern}.pianoroll({ 
          cycles: 4,
          playhead: 0.5,
          fill: true,
          fillActive: true,
          stroke: true,
          strokeActive: true,
          autorange: true,
          colorizeInactive: true,
          background: '#05060a'
        })`;
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
    const usesInternalVisualizer = this.selectedVisualizer === 'scope' || this.selectedVisualizer === 'barchart';
    const requiresPatternVisualizer = !usesInternalVisualizer && this.selectedVisualizer !== 'punchcard' && this.selectedVisualizer !== 'off';
    let hasVisualizer = true;
    if (requiresPatternVisualizer) {
      const checkRegex = new RegExp(`\\.\\s*_?${this.selectedVisualizer}\\s*\\(`);
      hasVisualizer = checkRegex.test(patternWithVisualizer);
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
    
    // Don't start visualizer loops if visualizer is "off"
    if (this.selectedVisualizer === 'off') {
      this.stopVisualizerAnimation();
      this.showMasterPunchcardPlaceholder();
    } else if (this.selectedVisualizer === 'scope') {
      this.startScopeVisualizerLoop();
    } else if (this.selectedVisualizer === 'barchart') {
      this.startBarchartVisualizerLoop();
    } else if (this.selectedVisualizer === 'pianoroll') {
      this.watchForExternalVisualizerCanvas('pianoroll');
      if (this.masterPunchcardCanvas) {
        this.masterPunchcardCanvas.style.display = 'none';
      }
      this.hideMasterPunchcardPlaceholder();
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
    
    // If visualizer is "off", just show placeholder and stop any visualizer animations
    if (this.selectedVisualizer === 'off') {
      this.stopVisualizerAnimation();
      this.teardownExternalVisualizerCanvas(); // Ensure external visualizers are removed
      this.showMasterPunchcardPlaceholder();
      // Clear canvas and ensure it's visible
      if (this.masterPunchcardCanvas) {
        this.masterPunchcardCanvas.style.display = 'block';
        if (this.masterPunchcardCtx) {
          this.masterPunchcardCtx.setTransform(1, 0, 0, 1, 0, 0);
          this.masterPunchcardCtx.clearRect(0, 0, this.masterPunchcardCanvas.width, this.masterPunchcardCanvas.height);
        }
      }
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
    
    if (useSpectrum && this.selectedVisualizer !== 'spectrum' &&
        (!this.selectedVisualizer || this.selectedVisualizer === 'off' || ['scope', 'punchcard', 'barchart'].includes(this.selectedVisualizer))) {
      this.selectedVisualizer = 'spectrum';
      if (this.visualizerSelect) {
        this.visualizerSelect.value = 'spectrum';
      }
    }
    
    if (usePianoroll && this.selectedVisualizer !== 'pianoroll' &&
        (!this.selectedVisualizer || ['scope', 'punchcard', 'barchart', 'spectrum'].includes(this.selectedVisualizer))) {
      this.selectedVisualizer = 'pianoroll';
      if (this.visualizerSelect) {
        this.visualizerSelect.value = 'pianoroll';
      }
    }
    
    const activeVisualizer = this.selectedVisualizer || 'punchcard';
    if (activeVisualizer === 'scope') {
      await this.prepareCanvasForExternalVisualizer();
      this.startScopeVisualizerLoop();
      this.hideMasterPunchcardPlaceholder();
      this.masterPunchcardIsRendering = false;
      return;
    }
    if (activeVisualizer === 'barchart') {
      await this.prepareCanvasForExternalVisualizer();
      this.startBarchartVisualizerLoop();
      this.hideMasterPunchcardPlaceholder();
      this.masterPunchcardIsRendering = false;
      return;
    }
    if (activeVisualizer === 'spectrum') {
      await this.prepareCanvasForExternalVisualizer();
      this.watchForExternalVisualizerCanvas('spectrum');
      this.hideMasterPunchcardPlaceholder();
      this.masterPunchcardIsRendering = false;
      return;
    }
    if (activeVisualizer === 'pianoroll') {
      this.watchForExternalVisualizerCanvas('pianoroll');
      if (this.masterPunchcardCanvas) {
        this.masterPunchcardCanvas.style.display = 'none';
      }
      this.hideMasterPunchcardPlaceholder();
      this.masterPunchcardIsRendering = false;
      return;
    }
    if (activeVisualizer !== 'scope' && activeVisualizer !== 'barchart') {
      this.stopVisualizerAnimation();
    }
    
    // Don't start any visualizers if "off" is selected
    if (this.selectedVisualizer === 'off') {
      this.stopVisualizerAnimation();
      this.showMasterPunchcardPlaceholder();
      return;
    }
    
    if (useScope || useSpectrum || useSpiral || usePitchwheel || usePianoroll || useBarchart) {
      if ((this.selectedVisualizer || 'punchcard') === 'punchcard' && useScope) {
        this.watchForExternalVisualizerCanvas('scope');
      }
      if (usePianoroll) {
        this.watchForExternalVisualizerCanvas('pianoroll');
        if (this.masterPunchcardCanvas) {
          this.masterPunchcardCanvas.style.display = 'none';
        }
      }
      await this.prepareCanvasForExternalVisualizer();
      this.hideMasterPunchcardPlaceholder();
      this.masterPunchcardIsRendering = false;
      return;
    }
    
    // Avoid overlapping renders; queue another refresh if needed
    if (this.masterPunchcardIsRendering) {
      this.masterPunchcardPendingRefresh = true;
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

  async prepareCanvasForExternalVisualizer() {
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
    const darkVisualizers = ['scope', 'barchart', 'spectrum'];
    this.masterPunchcardCanvas.style.background = darkVisualizers.includes(this.selectedVisualizer)
      ? '#05060a'
      : 'rgba(255, 255, 255, 0.9)';
    
    let ctx;
    try {
      const { getDrawContext } = await import('@strudel/draw');
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
    if (this.barchartAnimationFrame) {
      cancelAnimationFrame(this.barchartAnimationFrame);
      this.barchartAnimationFrame = null;
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
    // Stop any existing loop first
    if (this.scopeAnimationFrame) {
      cancelAnimationFrame(this.scopeAnimationFrame);
      this.scopeAnimationFrame = null;
    }
    
    const canvas = this.masterPunchcardCanvas;
    const ctx = this.getMasterPunchcardContext();
    if (!canvas || !ctx) {
      console.warn('⚠️ Scope visualizer: Canvas or context not available');
      return;
    }
    const analyser = this.ensureVisualizerAnalyser();
    if (!analyser) {
      console.warn('⚠️ Scope visualizer: Analyser not available');
      this.drawVisualizerMessage('Scope analyser unavailable');
      return;
    }
    const bufferLength = analyser.fftSize || 2048;
    if (!this.scopeDataArray || this.scopeDataArray.length !== bufferLength) {
      this.scopeDataArray = new Uint8Array(bufferLength);
    }
    this.activeVisualizerLoop = 'scope';
    console.log('🎨 Starting scope visualizer loop');
    const draw = () => {
      if (this.selectedVisualizer !== 'scope') {
        console.log(`🎨 Scope loop stopping: selectedVisualizer is "${this.selectedVisualizer}", expected "scope"`);
        this.stopVisualizerAnimation();
        return;
      }
      // Use cached context or get native 2D context (visualizers need native context for setTransform)
      let context = this.masterPunchcardCtx;
      if (!context || typeof context.setTransform !== 'function') {
        // Fallback to native 2D context for visualizers
        context = this.masterPunchcardCanvas.getContext('2d');
        if (!context || typeof context.setTransform !== 'function') {
          console.warn('⚠️ Scope visualizer: Cannot get valid 2D context');
          this.stopVisualizerAnimation();
          return;
        }
        // Cache the native context
        this.masterPunchcardCtx = context;
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

  startBarchartVisualizerLoop() {
    // Stop any existing loop first
    if (this.barchartAnimationFrame) {
      cancelAnimationFrame(this.barchartAnimationFrame);
      this.barchartAnimationFrame = null;
    }
    
    const canvas = this.masterPunchcardCanvas;
    const ctx = this.getMasterPunchcardContext();
    if (!canvas || !ctx) {
      console.warn('⚠️ Bar chart visualizer: Canvas or context not available');
      return;
    }
    const analyser = this.ensureVisualizerAnalyser();
    if (!analyser) {
      console.warn('⚠️ Bar chart visualizer: Analyser not available');
      this.drawVisualizerMessage('Spectrum analyser unavailable');
      return;
    }
    const bufferLength = analyser.frequencyBinCount || 1024;
    if (!this.spectrumDataArray || this.spectrumDataArray.length !== bufferLength) {
      this.spectrumDataArray = new Uint8Array(bufferLength);
    }
    // Get sample rate for frequency calculation
    const sampleRate = analyser.context?.sampleRate || 44100;
    const nyquist = sampleRate / 2;
    this.activeVisualizerLoop = 'barchart';
    console.log('🎨 Starting bar chart visualizer loop');
    const draw = () => {
      if (this.selectedVisualizer !== 'barchart') {
        console.log(`🎨 Bar chart loop stopping: selectedVisualizer is "${this.selectedVisualizer}", expected "barchart"`);
        this.stopVisualizerAnimation();
        return;
      }
      // Use cached context or get native 2D context (visualizers need native context for setTransform)
      let context = this.masterPunchcardCtx;
      if (!context || typeof context.setTransform !== 'function') {
        // Fallback to native 2D context for visualizers
        context = this.masterPunchcardCanvas.getContext('2d');
        if (!context || typeof context.setTransform !== 'function') {
          console.warn('⚠️ Bar chart visualizer: Cannot get valid 2D context');
          this.stopVisualizerAnimation();
          return;
        }
        // Cache the native context
        this.masterPunchcardCtx = context;
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
      
      // Use non-linear frequency mapping
      // Create bars distributed across the non-linear frequency ranges
      const barCount = Math.min(200, Math.floor(width / 2)); // More bars for smoother visualization
      const bars = [];
      
      // Map each frequency bin to its position and value
      for (let i = 0; i < this.spectrumDataArray.length; i++) {
        // Calculate frequency for this bin
        const frequency = (i / this.spectrumDataArray.length) * nyquist;
        // Only process frequencies in our range (20-20000 Hz)
        if (frequency >= 20 && frequency <= 20000) {
          const position = frequencyToPosition(frequency);
          const value = this.spectrumDataArray[i] / 255;
          bars.push({ position, value, frequency });
        }
      }
      
      // Sort by position
      bars.sort((a, b) => a.position - b.position);
      
      // Group bars by position ranges and draw
      const barWidth = width / barCount;
      for (let i = 0; i < barCount; i++) {
        const targetPosition = i / barCount;
        // Use a wider search window in low-frequency regions to avoid gaps
        const baseRadius = 1 / barCount;
        const searchRadius = targetPosition < 0.3
          ? baseRadius * 4
          : targetPosition < 0.6
            ? baseRadius * 2
            : baseRadius;

        // Find bars near this position
        const nearbyBars = bars.filter(b => Math.abs(b.position - targetPosition) < searchRadius);
        let maxValue = nearbyBars.length > 0 ? Math.max(...nearbyBars.map(b => b.value)) : 0;

        // Fallback: use the nearest bar if none found (ensures no blank segments)
        if (maxValue === 0 && bars.length > 0) {
          let closestValue = 0;
          let closestDistance = Infinity;
          for (const bar of bars) {
            const distance = Math.abs(bar.position - targetPosition);
            if (distance < closestDistance) {
              closestDistance = distance;
              closestValue = bar.value;
            } else if (distance > closestDistance) {
              break; // bars are sorted, so we can stop once distance increases
            }
          }
          maxValue = closestValue;
        }
        
        const barHeight = Math.max(maxValue * height, 2);
        const x = targetPosition * width;
        const y = height - barHeight;
        const gradient = context.createLinearGradient(x, y, x, height);
        gradient.addColorStop(0, 'rgba(56, 189, 248, 0.95)');
        gradient.addColorStop(1, 'rgba(14, 116, 144, 0.75)');
        context.fillStyle = gradient;
        // Fill entire segment to eliminate blank space between bars
        context.fillRect(x, y, barWidth + 1, barHeight);
      }
      this.barchartAnimationFrame = requestAnimationFrame(draw);
    };
    draw();
  }


  teardownExternalVisualizerCanvas() {
    // Disconnect observer
    if (this.externalVisualizerObserver) {
      this.externalVisualizerObserver.disconnect();
      this.externalVisualizerObserver = null;
    }
    
    // Remove tracked external canvas
    if (this.externalVisualizerCanvas && this.externalVisualizerCanvas.parentNode) {
      this.externalVisualizerCanvas.remove();
    }
    this.externalVisualizerCanvas = null;
    this.externalVisualizerType = null;
    
    // Remove any canvases created by Strudel visualizers (spectrum, scope, etc.)
    // Look for canvases that might have been created by Strudel but not tracked
    const allCanvases = document.querySelectorAll('canvas');
    allCanvases.forEach(canvas => {
      // Skip the master punchcard canvas
      if (canvas === this.masterPunchcardCanvas || canvas.id === 'master-punchcard-canvas') {
        return;
      }
      
      // Check if this canvas is inside the master punchcard container
      if (this.masterPunchcardContainer && this.masterPunchcardContainer.contains(canvas)) {
        // Check if it looks like a visualizer canvas (spectrum, scope, etc.)
        const id = (canvas.id || '').toLowerCase();
        const className = (canvas.className || '').toLowerCase();
        if (id.includes('spectrum') || id.includes('scope') || 
            className.includes('spectrum') || className.includes('scope') ||
            canvas.dataset.spectrum !== undefined || canvas.dataset.scope !== undefined) {
          console.log('🧹 Removing external visualizer canvas:', canvas.id || canvas.className);
          canvas.remove();
        }
      }
    });
    
    // Ensure master canvas is visible
    if (this.masterPunchcardCanvas) {
      this.masterPunchcardCanvas.style.display = 'block';
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

  /**
   * Handle mouse move on canvas for Chaospad cutoff control
   */
  handleChaospadMouseMove(e) {
    if (!this.masterPunchcardCanvas || !this.chaospadEnabled) {
      console.log('🎛️ Chaospad: Skipping - canvas or enabled check failed', {
        hasCanvas: !!this.masterPunchcardCanvas,
        enabled: this.chaospadEnabled
      });
      return;
    }

    const pointerEvent = e.touches && e.touches.length ? e.touches[0] : e;
    if (typeof pointerEvent.clientX !== 'number' || typeof pointerEvent.clientY !== 'number') {
      return;
    }

    const rect = this.masterPunchcardCanvas.getBoundingClientRect();
    const mouseX = pointerEvent.clientX - rect.left;
    const mouseYFromBottom = rect.bottom - pointerEvent.clientY;
    const canvasWidth = rect.width;
    const canvasHeight = rect.height;
    
    if (canvasWidth === 0 || canvasHeight === 0) {
      console.log('⚠️ Chaospad: Canvas not sized yet');
      return; // Canvas not sized yet
    }
    
    const percentage = Math.max(0, Math.min(1, mouseX / canvasWidth));
    const verticalPercentage = Math.max(0, Math.min(1, mouseYFromBottom / canvasHeight));

    // Smoothly interpolate cutoff frequency from 80 Hz (left) to 8000 Hz (right)
    const minFreq = 80;
    const maxFreq = 8000;
    
    // Linear interpolation
    const cutoffValue = Math.round(minFreq + (maxFreq - minFreq) * percentage);

    // Throttle updates: only update if value changed significantly (more than 50 Hz)
    // or if it's been more than 100ms since last update
    const now = Date.now();
    const shouldUpdate = 
      this.currentCutoffValue === null ||
      Math.abs(this.currentCutoffValue - cutoffValue) > 50 ||
      (this.lastCutoffUpdate && (now - this.lastCutoffUpdate) > 100);

    if (shouldUpdate) {
      console.log(`🎛️ Chaospad: Mouse at ${(percentage * 100).toFixed(1)}% - updating cutoff to ${cutoffValue} Hz`);
      this.currentCutoffValue = cutoffValue;
      this.lastCutoffUpdate = now;
      this.applyCutoffToMaster(cutoffValue);
    }

    // Resonance control (vertical)
    const minResonance = 0;
    const maxResonance = 20;
    const resonanceValueRaw = minResonance + (maxResonance - minResonance) * verticalPercentage;
    const resonanceValue = Math.round(resonanceValueRaw * 10) / 10; // match slider precision
    const shouldUpdateResonance =
      this.currentResonanceValue === null ||
      Math.abs(this.currentResonanceValue - resonanceValue) > 0.2 ||
      (this.lastResonanceUpdate && (now - this.lastResonanceUpdate) > 120);

    if (shouldUpdateResonance) {
      console.log(`🎛️ Chaospad: Vertical ${(verticalPercentage * 100).toFixed(1)}% - updating resonance to ${resonanceValue}`);
      this.currentResonanceValue = resonanceValue;
      this.lastResonanceUpdate = now;
      this.applyResonanceToMaster(resonanceValue);
    }
  }

  /**
   * Apply cutoff modifier to master pattern
   * Applies cutoff to the entire stack, after the stack closing parenthesis
   */
  async applyCutoffToMaster(cutoffValue) {
    try {
      // Get base pattern without cutoff
      let basePattern = soundManager.getMasterPatternCode();
      
      if (!basePattern || basePattern.trim() === '') {
        console.log('⚠️ Chaospad: No master pattern to apply cutoff to - master may not be playing');
        // Even if master isn't playing, we should still add cutoff so it's there when play starts
        // But we need at least a silence pattern to work with
        basePattern = 'silence';
        console.log('🎛️ Chaospad: Using silence as base pattern');
      }

      console.log(`🎛️ Chaospad: Base pattern before cutoff: ${basePattern.substring(0, 100)}...`);

      // Remove existing cutoff modifier
      basePattern = basePattern.replace(/\.\s*cutoff\s*\([^)]*\)/gi, '');
      basePattern = basePattern.trim().replace(/\.\s*$/, '').replace(/\.\.+/g, '.').trim();

      // Find where to insert the cutoff modifier
      // For stack patterns, insert after the closing parenthesis
      // For single patterns, append at the end
      let patternWithCutoff;
      const stackMatch = basePattern.match(/stack\s*\(/);
      
      if (stackMatch) {
        // Find the closing parenthesis of the stack(...) call
        let stackStart = stackMatch.index + stackMatch[0].length - 1; // Position of '('
        let depth = 1;
        let stackEnd = stackStart + 1;
        let inString = false;
        let stringChar = null;
        
        while (stackEnd < basePattern.length && depth > 0) {
          const char = basePattern[stackEnd];
          
          // Handle strings
          if (!inString && (char === '"' || char === "'")) {
            inString = true;
            stringChar = char;
          } else if (inString && char === stringChar && basePattern[stackEnd - 1] !== '\\') {
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
          // Insert cutoff right after the closing parenthesis, before any .gain() or .pan()
          const beforeStackEnd = basePattern.substring(0, stackEnd + 1);
          const afterStackEnd = basePattern.substring(stackEnd + 1);
          
          // Insert cutoff before any existing modifiers
          patternWithCutoff = `${beforeStackEnd}.cutoff(${cutoffValue})${afterStackEnd}`;
          console.log(`🎛️ Chaospad: Inserted cutoff after stack at position ${stackEnd}`);
        } else {
          // Couldn't find matching closing paren, append at end
          patternWithCutoff = `${basePattern}.cutoff(${cutoffValue})`;
          console.log(`🎛️ Chaospad: Couldn't find stack end, appending cutoff`);
        }
      } else {
        // Not a stack pattern, append at the end
        patternWithCutoff = `${basePattern}.cutoff(${cutoffValue})`;
        console.log(`🎛️ Chaospad: Not a stack pattern, appending cutoff`);
      }

      console.log(`🎛️ Chaospad: Applying cutoff ${cutoffValue} Hz to master pattern`);
      console.log(`🎛️ Chaospad: Full pattern with cutoff: ${patternWithCutoff.substring(0, 200)}...`);
      console.log(`🎛️ Chaospad: Master active: ${soundManager.isMasterActive()}`);

      // Update master pattern
      await soundManager.setMasterPatternCode(patternWithCutoff);
      this.currentCutoffValue = cutoffValue;
      this.lastCutoffUpdate = Date.now();
      console.log(`🎛️ ✅ Chaospad: Cutoff ${cutoffValue} Hz applied successfully`);
    } catch (error) {
      console.error('⚠️ Chaospad: Error applying cutoff to master pattern:', error);
    }
  }

  /**
   * Apply resonance modifier to master pattern based on Chaospad input
   */
  async applyResonanceToMaster(resonanceValue) {
    try {
      let basePattern = soundManager.getMasterPatternCode();

      if (!basePattern || basePattern.trim() === '') {
        console.log('⚠️ Chaospad: No master pattern to apply resonance to - using silence');
        basePattern = 'silence';
      }

      // Remove existing resonance modifier before applying new value
      basePattern = basePattern.replace(/\.\s*resonance\s*\([^)]*\)/gi, '');
      basePattern = basePattern.trim().replace(/\.\s*$/, '').replace(/\.\.+/g, '.').trim();

      let patternWithResonance;
      const stackMatch = basePattern.match(/stack\s*\(/);

      if (stackMatch) {
        let stackStart = stackMatch.index + stackMatch[0].length - 1;
        let depth = 1;
        let stackEnd = stackStart + 1;
        let inString = false;
        let stringChar = null;

        while (stackEnd < basePattern.length && depth > 0) {
          const char = basePattern[stackEnd];
          if (!inString && (char === '"' || char === "'")) {
            inString = true;
            stringChar = char;
          } else if (inString && char === stringChar && basePattern[stackEnd - 1] !== '\\') {
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
          const beforeStackEnd = basePattern.substring(0, stackEnd + 1);
          const afterStackEnd = basePattern.substring(stackEnd + 1);
          patternWithResonance = `${beforeStackEnd}.resonance(${resonanceValue})${afterStackEnd}`;
        } else {
          patternWithResonance = `${basePattern}.resonance(${resonanceValue})`;
        }
      } else {
        patternWithResonance = `${basePattern}.resonance(${resonanceValue})`;
      }

      await soundManager.setMasterPatternCode(patternWithResonance);
      this.currentResonanceValue = resonanceValue;
      this.lastResonanceUpdate = Date.now();
      console.log(`🎛️ ✅ Chaospad: Resonance ${resonanceValue} applied successfully`);
    } catch (error) {
      console.error('⚠️ Chaospad: Error applying resonance to master pattern:', error);
    }
  }

  /**
   * Reset Chaospad-controlled modifiers back to defaults
   */
  async resetChaospadToDefaults() {
    if (!this.chaospadEnabled) return;
    try {
      await this.applyCutoffToMaster(this.chaospadDefaults.cutoff);
      await this.applyResonanceToMaster(this.chaospadDefaults.resonance);
    } catch (error) {
      console.warn('⚠️ Chaospad: Unable to reset to default values', error);
    }
  }

  /**
   * Remove cutoff modifier from master pattern
   */
  async removeCutoffFromMaster() {
    try {
      let pattern = soundManager.getMasterPatternCode();
      
      if (!pattern || pattern.trim() === '') {
        return;
      }

      // Remove cutoff modifier
      pattern = pattern.replace(/\.\s*cutoff\s*\([^)]*\)/gi, '');
      pattern = pattern.trim().replace(/\.\s*$/, '').replace(/\.\.+/g, '.').trim();

      // Update master pattern
      await soundManager.setMasterPatternCode(pattern);
      this.currentCutoffValue = null;
      this.lastCutoffUpdate = null;
      console.log('🎛️ Removed Chaospad cutoff from master pattern');
    } catch (error) {
      console.warn('⚠️ Error removing cutoff from master pattern:', error);
    }
  }

  /**
   * Remove resonance modifier from master pattern
   */
  async removeResonanceFromMaster() {
    try {
      let pattern = soundManager.getMasterPatternCode();

      if (!pattern || pattern.trim() === '') {
        return;
      }

      pattern = pattern.replace(/\.\s*resonance\s*\([^)]*\)/gi, '');
      pattern = pattern.trim().replace(/\.\s*$/, '').replace(/\.\.+/g, '.').trim();

      await soundManager.setMasterPatternCode(pattern);
      this.currentResonanceValue = null;
      this.lastResonanceUpdate = null;
      console.log('🎛️ Removed Chaospad resonance from master pattern');
    } catch (error) {
      console.warn('⚠️ Error removing resonance from master pattern:', error);
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

  async getMasterPunchcardContext() {
    if (!this.masterPunchcardCanvas) return null;
    if (!this.masterPunchcardCtx) {
      try {
        const { getDrawContext } = await import('@strudel/draw');
        const drawCtx = getDrawContext(this.masterPunchcardCanvas.id, { contextType: '2d' });
        // getDrawContext might return a wrapper, try to get the actual 2D context
        if (drawCtx && typeof drawCtx.setTransform === 'function') {
          this.masterPunchcardCtx = drawCtx;
        } else if (drawCtx && drawCtx.canvas) {
          // If it's a wrapper with a canvas property, get the native context
          this.masterPunchcardCtx = drawCtx.canvas.getContext('2d');
        } else {
          // Fallback to native context
          this.masterPunchcardCtx = this.masterPunchcardCanvas.getContext('2d');
        }
      } catch (error) {
        console.warn('⚠️ Falling back to native canvas context:', error);
        this.masterPunchcardCtx = this.masterPunchcardCanvas.getContext('2d');
      }
    }
    // Ensure we have a valid 2D context with setTransform
    if (this.masterPunchcardCtx && typeof this.masterPunchcardCtx.setTransform !== 'function') {
      console.warn('⚠️ Context from getDrawContext does not have setTransform, using native context');
      this.masterPunchcardCtx = this.masterPunchcardCanvas.getContext('2d');
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
      // Use dynamic imports to avoid duplicate loading
      const [{ evaluate: strudelCoreEvaluate }, { transpiler: strudelTranspiler }] = await Promise.all([
        import('@strudel/core'),
        import('@strudel/transpiler')
      ]);
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

  enableNativeStrudelHighlighting(retryDelay = 500) {
    if (this.nativeHighlightingEnabled || this.nativeHighlightingDisabled) {
        return;
      }

    const strudelAPI =
      globalThis?.Strudel ||
      globalThis?.strudel ||
      window?.Strudel ||
      window?.strudel;

    const enableFn = strudelAPI && typeof strudelAPI.enableHighlighting === 'function'
      ? strudelAPI.enableHighlighting
      : null;

    if (enableFn) {
      try {
        enableFn.call(strudelAPI);
        this.nativeHighlightingEnabled = true;
        this.nativeHighlightRetryCount = 0;
        if (this.nativeHighlightRetryTimer) {
          clearTimeout(this.nativeHighlightRetryTimer);
          this.nativeHighlightRetryTimer = null;
        }
        console.log('✅ Enabled Strudel.enableHighlighting()');
        return;
    } catch (error) {
        console.warn('⚠️ Strudel.enableHighlighting() failed:', error);
        this.nativeHighlightingDisabled = true;
      return;
    }
    }

    if (this.nativeHighlightRetryTimer) {
      return;
    }

    if (this.nativeHighlightRetryCount >= 5) {
      console.warn('⚠️ Strudel.enableHighlighting() unavailable; falling back without editor highlights.');
      this.nativeHighlightingDisabled = true;
      this.nativeHighlightRetryCount = 0;
      return;
    }

    this.nativeHighlightRetryCount += 1;
    const nextDelay = Math.min(retryDelay * 2, 4000);
    this.nativeHighlightRetryTimer = setTimeout(() => {
      this.nativeHighlightRetryTimer = null;
      this.enableNativeStrudelHighlighting(nextDelay);
    }, nextDelay);
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
              slider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                const display = sliderRow.querySelector('.slider-value');
                if (display) {
                  let formatted;
                  if (param.key.includes('f')) {
                    formatted = Math.round(value) + ' Hz';
                  } else if (param.key === 'bpg' && param.unit === 'dB') {
                    // Show dB with +/- sign
                    const sign = value >= 0 ? '+' : '';
                    formatted = `${sign}${value.toFixed(1)} dB`;
                  } else {
                    formatted = value.toFixed(1) + (param.unit ? ' ' + param.unit : '');
                  }
                  queueSliderDisplayUpdate(display, formatted);
                }
                this.updateElementFilters(elementId);
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
          { key: 'delay', label: 'Delay Mix' },
          { key: 'delayfeedback', label: 'Delay Feedback' },
          { key: 'delaytime', label: 'Delay Time' }
        ]
      },
      { 
        key: 'room', 
        label: 'Reverb',
        params: [
          { key: 'room', label: 'Room Mix' },
          { key: 'roomsize', label: 'Room Size' },
          { key: 'roomlp', label: 'Low-pass' },
          { key: 'roomdim', label: 'Dimension' },
          { key: 'roomfade', label: 'Fade' },
          { key: 'iresponse', label: 'Impulse Response' }
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
        'room': 'snippet-group-reverb'
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
              slider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                const display = sliderRow.querySelector('.slider-value');
                if (display) {
                  const formatted = value.toFixed(2) + (paramConfig.unit ? ' ' + paramConfig.unit : '');
                  queueSliderDisplayUpdate(display, formatted);
                }
                this.updateElementEffects(elementId);
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
        slider.addEventListener('input', (e) => {
          const value = parseFloat(e.target.value);
          const display = sliderRow.querySelector('.slider-value');
          if (display) {
            const formatted = value.toFixed(2) + (param.unit ? ' ' + param.unit : '');
            queueSliderDisplayUpdate(display, formatted);
          }
          this.updateElementSynthesis(elementId);
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
    
    this.scheduleElementPatternApply(elementId);
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
    
    this.scheduleElementPatternApply(elementId);
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
    
    this.scheduleElementPatternApply(elementId);
  }
  
  scheduleElementPatternApply(elementId) {
    if (!elementId) return;
    this._parameterApplyTimers = this._parameterApplyTimers || new Map();
    if (this._parameterApplyTimers.has(elementId)) {
      clearTimeout(this._parameterApplyTimers.get(elementId));
    }
    const timer = setTimeout(() => {
      this.applyEffectsAndFiltersToPattern(elementId);
      this._parameterApplyTimers.delete(elementId);
    }, getSliderDebounceDelay());
    this._parameterApplyTimers.set(elementId, timer);
  }
  
  /**
   * Get pattern with effects, filters, and synthesis applied
   * Returns the modified pattern string (does not save or trigger playback)
   */
  getPatternWithEffects(elementId, basePattern) {
    if (!basePattern) return basePattern;
    
    // Remove master-injected modifiers (postgain, pan, fast, slow, cpm) that shouldn't be in saved patterns
    // These are added dynamically when playing through master, but shouldn't be persisted
    // Use case-insensitive and global flags to catch all instances
    let cleanedPattern = basePattern;
    // Remove all instances of postgain() - must remove all occurrences
    cleanedPattern = cleanedPattern.replace(/\.postgain\s*\([^)]*\)/gi, '');
    cleanedPattern = cleanedPattern.replace(/\.pan\s*\([^)]*\)/gi, '');
    cleanedPattern = cleanedPattern.replace(/\.fast\s*\([^)]*\)/gi, '');
    cleanedPattern = cleanedPattern.replace(/\.slow\s*\([^)]*\)/gi, '');
    cleanedPattern = cleanedPattern.replace(/\.cpm\s*\([^)]*\)/gi, '');
    // Clean up any double dots or extra whitespace that might result
    cleanedPattern = cleanedPattern.replace(/\.\.+/g, '.').trim();
    cleanedPattern = cleanedPattern.replace(/\.+$/, '').trim();
    cleanedPattern = cleanedPattern.replace(/\s+\./g, '.');
    
    // Get effects, filters, and synthesis
    const effects = this.elementEffects?.[elementId] || {};
    const filters = this.elementFilters?.[elementId] || {};
    const synthesis = this.elementSynthesis?.[elementId] || {};
    
    // Helper to check whether a value differs from its default (so we only emit necessary modifiers)
    const effectValueChanged = (key, value) => {
      if (value === undefined) return false;
      const config = NUMERIC_TAG_PARAMS[key];
      if (!config) return true;
      return value !== config.default;
    };
    const formatEffectValue = (key, value) => {
      if (value === undefined) return '';
      const config = NUMERIC_TAG_PARAMS[key];
      if (config?.unit === 'Hz' || key === 'roomlp') {
        return Math.round(value);
      }
      return value.toFixed(2);
    };
    
    // Build modifiers string
    let modifiers = [];
    
    // Add effects
    if (effectValueChanged('delay', effects.delay)) {
      modifiers.push(`.delay(${formatEffectValue('delay', effects.delay)})`);
    }
    if (effectValueChanged('delayfeedback', effects.delayfeedback)) {
      modifiers.push(`.delayfeedback(${formatEffectValue('delayfeedback', effects.delayfeedback)})`);
    }
    if (effectValueChanged('delaytime', effects.delaytime)) {
      modifiers.push(`.delaytime(${formatEffectValue('delaytime', effects.delaytime)})`);
    }
    if (effectValueChanged('room', effects.room)) {
      modifiers.push(`.room(${formatEffectValue('room', effects.room)})`);
    }
    if (effectValueChanged('roomsize', effects.roomsize)) {
      modifiers.push(`.roomsize(${formatEffectValue('roomsize', effects.roomsize)})`);
    }
    if (effectValueChanged('roomlp', effects.roomlp) && effects.roomlp < NUMERIC_TAG_PARAMS.roomlp.default) {
      modifiers.push(`.roomlp(${formatEffectValue('roomlp', effects.roomlp)})`);
    }
    if (effectValueChanged('roomdim', effects.roomdim)) {
      modifiers.push(`.roomdim(${formatEffectValue('roomdim', effects.roomdim)})`);
    }
    if (effectValueChanged('roomfade', effects.roomfade)) {
      modifiers.push(`.roomfade(${formatEffectValue('roomfade', effects.roomfade)})`);
    }
    if (effectValueChanged('iresponse', effects.iresponse)) {
      modifiers.push(`.iresponse(${formatEffectValue('iresponse', effects.iresponse)})`);
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
    return modifiers.length > 0 ? cleanedPattern + modifiers.join('') : cleanedPattern;
  }
  
  /**
   * Apply effects, filters, and synthesis to the current pattern
   */
  async applyEffectsAndFiltersToPattern(elementId) {
    if (!elementId) return;
    this._pendingPatternApplyStates = this._pendingPatternApplyStates || new Map();
    const existingState = this._pendingPatternApplyStates.get(elementId);
    if (existingState) {
      existingState.queued = true;
      return;
    }
    const state = { queued: false };
    this._pendingPatternApplyStates.set(elementId, state);

    // Get the base pattern
    const savedConfig = this.loadElementConfig(elementId);
    if (!savedConfig || !savedConfig.pattern) {
      this._pendingPatternApplyStates.delete(elementId);
      if (state.queued) {
        this.applyEffectsAndFiltersToPattern(elementId);
      }
      return;
    }
    
    const pattern = savedConfig.pattern;
    const finalPattern = this.getPatternWithEffects(elementId, pattern);
    
    if (finalPattern !== pattern) {
      console.log(`🎚️ Applying effects/filters/synthesis to ${elementId}: ${finalPattern}`);
    }
    
    // Check if element is tracked in master
    const isInMaster = soundManager.trackedPatterns && soundManager.trackedPatterns.has(elementId);
    
    // Do not auto-restart playback while adjusting sliders.
    // Update stored pattern and master display only; playback changes apply on next manual play.
    try {
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
    } finally {
      this._pendingPatternApplyStates.delete(elementId);
      if (state.queued) {
        this.applyEffectsAndFiltersToPattern(elementId);
      }
    }
  }

  applyChannelHistoryEntry(elementId, pattern) {
    if (!elementId || !pattern) {
      return;
    }
    const trimmed = pattern.trim();
    const existingConfig = this.loadElementConfig(elementId) || {};
    patternHistoryStore.markChannelSnapshot(elementId, trimmed);
    this.saveElementConfig(elementId, { ...existingConfig, pattern: trimmed }, true);
    
    if (this.currentEditingElementId !== elementId) {
      if (this.openConfigModal) {
        this.openConfigModal(elementId);
      } else {
        console.warn('⚠️ openConfigModal not available, modal may not open');
      }
    }
    
    setTimeout(() => {
      setStrudelEditorValue('modal-pattern', trimmed);
    }, 50);
    
    this.uiController?.updateStatus?.(`Loaded history for ${elementId}. Save to apply.`);
  }

  applyMasterHistoryEntry(pattern) {
    if (!pattern) {
      return;
    }
    const trimmed = pattern.trim();
    setStrudelEditorValue('master-pattern', trimmed);
    soundManager.masterPattern = trimmed;
    patternHistoryStore.markMasterSnapshot(trimmed);
    this.updateMasterPatternDisplay();
    this.uiController?.updateStatus?.('Loaded master pattern history entry.');
  }

  async saveChannelWithEffects(elementId) {
    // Check if user is logged in - required for saving
    const { getCurrentUser } = await import('./api.js');
    const user = await getCurrentUser();
    
    if (!user) {
      alert('Please log in to save patterns');
      return;
    }

    const savedConfig = this.loadElementConfig(elementId);
    if (!savedConfig || !savedConfig.pattern) {
      this.uiController?.updateStatus?.('Nothing to save for this channel.');
      return;
    }
    const finalPattern = this.getPatternWithEffects(elementId, savedConfig.pattern);
    
    if (window.savePatternDialog) {
      // Show save dialog for cloud save
      await window.savePatternDialog.show(finalPattern, 'channel', elementId);
      window.savePatternDialog.setOnSave(async (savedPattern) => {
        // Also save locally
        const updatedConfig = { ...savedConfig, pattern: finalPattern };
        this.saveElementConfig(elementId, updatedConfig, false);
        patternHistoryStore.markChannelSnapshot(elementId, finalPattern);
        this.uiController?.updateStatus?.(`Saved channel ${elementId} to cloud.`);
      });
    } else {
      this.uiController?.updateStatus?.('Save dialog not available.');
    }
  }

  async saveMasterHistoryEntry() {
    // Check if user is logged in - required for saving
    const { getCurrentUser } = await import('./api.js');
    const user = await getCurrentUser();
    
    if (!user) {
      alert('Please log in to save patterns');
      return;
    }

    const masterTextarea = document.getElementById('master-pattern');
    const pattern = masterTextarea ? masterTextarea.value : '';
    const trimmed = (pattern || '').trim();
    if (!trimmed) {
      this.uiController?.updateStatus?.('Master pattern is empty.');
      return;
    }
    
    if (window.savePatternDialog) {
      // Show save dialog for cloud save
      await window.savePatternDialog.show(trimmed, 'master', null);
      window.savePatternDialog.setOnSave(async (savedPattern) => {
        // Also save locally
        patternHistoryStore.saveMasterVersion(trimmed);
        patternHistoryStore.markMasterSnapshot(trimmed);
        soundManager.masterPattern = trimmed;
        this.updateMasterPatternDisplay();
        this.uiController?.updateStatus?.(`Saved master pattern to cloud.`);
      });
    } else {
      this.uiController?.updateStatus?.('Save dialog not available.');
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
          if (!isNaN(scaleDegree)) {
            const stepsPerOctave = scaleNotes.length || 1;
            const octaveOffset = Math.floor(scaleDegree / stepsPerOctave);
            const noteIndex = ((scaleDegree % stepsPerOctave) + stepsPerOctave) % stepsPerOctave;
            const noteName = scaleNotes[noteIndex];
            
            // Add octave (default to octave 4, adjust based on offset)
            const baseOctave = 4;
            const finalOctave = baseOctave + octaveOffset;
            
            const resolvedNote = normalizeSpelling(`${noteName}${finalOctave}`, preferFlats);
            noteNames.push(resolvedNote);
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
        updateElementTitleDisplay(elementId, '');
        
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
        const resolvedTitle = savedConfig.title && savedConfig.title.trim()
          ? savedConfig.title
          : (savedConfig.bank && savedConfig.bank.trim()
              ? (DRUM_BANK_DISPLAY_NAMES[savedConfig.bank] || savedConfig.bank.replace('github:tidalcycles/', ''))
              : '');
        updateElementTitleDisplay(elementConfig.id, resolvedTitle);
        
        // Update config array (but keep original as fallback)
        if (savedConfig.pattern !== undefined) {
          elementConfig.pattern = savedConfig.pattern;
        }
        if (savedConfig.title !== undefined) {
          elementConfig.description = savedConfig.title;
        }
      } else {
        updateElementTitleDisplay(elementConfig.id, elementConfig.description || '');
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
        patternHistoryStore.saveChannelVersion(elementId, config.pattern);
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
      
      const displayTitle = config.title && config.title.trim()
        ? config.title
        : (config.bank ? (DRUM_BANK_DISPLAY_NAMES[config.bank] || config.bank.replace('github:tidalcycles/', '')) : '');
      updateElementTitleDisplay(elementId, displayTitle);

      const element = document.querySelector(`[data-sound-id="${elementId}"]`);
      if (element) {
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
    const sampleUrlInput = document.getElementById('modal-sample-url');
    const sampleNameInput = document.getElementById('modal-sample-name');
    const addSampleButton = document.getElementById('modal-add-sample-btn');
    const sampleFileInput = document.getElementById('modal-sample-file');

    const parseSampleLocation = (rawUrl) => {
      const fallback = { baseUrl: './', samplePath: '' };
      if (!rawUrl || typeof rawUrl !== 'string') {
        return fallback;
      }
      const trimmedUrl = rawUrl.trim();
      if (!trimmedUrl) {
        return fallback;
      }
      try {
        const parsed = new URL(trimmedUrl);
        const pathname = parsed.pathname || '';
        const normalizedPath = pathname.endsWith('/') && pathname.length > 1
          ? pathname.slice(0, -1)
          : pathname;
        const lastSlash = normalizedPath.lastIndexOf('/');
        if (lastSlash !== -1) {
          const fileName = normalizedPath.slice(lastSlash + 1) || '';
          const basePath = normalizedPath.slice(0, lastSlash + 1);
          return {
            baseUrl: `${parsed.origin}${basePath}`,
            samplePath: fileName || trimmedUrl
          };
        }
        return {
          baseUrl: `${parsed.origin}/`,
          samplePath: normalizedPath || parsed.origin
        };
      } catch {
        const normalized = trimmedUrl.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash !== -1) {
          return {
            baseUrl: normalized.slice(0, lastSlash + 1),
            samplePath: normalized.slice(lastSlash + 1) || normalized
          };
        }
        return {
          baseUrl: './',
          samplePath: normalized || 'sample.wav'
        };
      }
    };

    const sanitizeUrlValue = (value = '') => value.replace(/[\r\n]+/g, '').trim();
    const quoteForPattern = (value = '') => JSON.stringify(value ?? '');

    const insertSampleIntoPattern = (sampleName, baseUrl, samplePath) => {
      const sampleKey = quoteForPattern(sampleName || 'sample');
      const sanitizedSamplePath = sanitizeUrlValue(samplePath || sampleName || '');
      const safeSamplePath = quoteForPattern(sanitizedSamplePath);
      const sanitizedBaseUrl = sanitizeUrlValue(baseUrl || './');
      const safeBaseUrl = quoteForPattern(sanitizedBaseUrl || './');
      const samplesSnippet = `samples({\n  ${sampleKey}: ${safeSamplePath}\n}, { baseUrl: ${safeBaseUrl} })`;
      const soundCall = `sound(${sampleKey})`;
      const combinedExpression = `(${samplesSnippet},\n ${soundCall})`;
      const currentPattern = getStrudelEditorValue('modal-pattern') || '';
      const trimmedPattern = currentPattern.trim();
      const newPattern = trimmedPattern
        ? `${trimmedPattern}\n\n${combinedExpression}`
        : combinedExpression;
      setStrudelEditorValue('modal-pattern', newPattern);
      if (typeof updatePreviewButtonState === 'function') {
        updatePreviewButtonState();
      }
      sampleNameInput.value = '';
      sampleUrlInput.value = '';
      if (sampleFileInput) {
        sampleFileInput.value = '';
      }
      sampleNameInput.focus();
    };

    if (addSampleButton) {
      addSampleButton.addEventListener('click', () => {
        if (!sampleNameInput || !sampleUrlInput) {
          return;
        }
        const sampleName = sampleNameInput.value.trim();
        const sampleUrl = sampleUrlInput.value.trim();
        const hasFileSelection = sampleFileInput && sampleFileInput.files && sampleFileInput.files.length > 0;
        if (!sampleName || (!sampleUrl && !hasFileSelection)) {
          alert('Please provide a Sample Name and either a Sample URL or select a file.');
          return;
        }

        if (sampleUrl) {
          const { baseUrl, samplePath } = parseSampleLocation(sampleUrl);
          insertSampleIntoPattern(sampleName, baseUrl, samplePath || sampleName);
        } else if (hasFileSelection) {
          const file = sampleFileInput.files[0];
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target.result;
            if (typeof dataUrl === 'string' && dataUrl.length > 0) {
              insertSampleIntoPattern(sampleName, './', dataUrl);
            } else {
              alert('Unable to read the selected file. Please try again.');
            }
          };
          reader.onerror = () => {
            alert('Unable to read the selected file. Please try again.');
          };
          reader.readAsDataURL(file);
        }
      });
    }

    const removeExistingSpecialtyOptions = () => {
      if (!bankSelect) return;
      bankSelect.querySelectorAll('option[data-source="specialty-vcsl"]').forEach((option) => option.remove());
    };

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
      
      let specialtyGroup = Array.from(bankSelect.children).find(
        (child) => child.tagName === 'OPTGROUP' && child.label === SPECIAL_SAMPLE_BANK_GROUP_LABEL
      );
      
      let vcslGroup = Array.from(bankSelect.children).find(
        (child) => child.tagName === 'OPTGROUP' && child.label === VCSL_OPTGROUP_LABEL
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
      
      if (!specialtyGroup) {
        specialtyGroup = document.createElement('optgroup');
        specialtyGroup.label = SPECIAL_SAMPLE_BANK_GROUP_LABEL;
        if (synthsGroup.nextSibling) {
          bankSelect.insertBefore(specialtyGroup, synthsGroup.nextSibling);
        } else {
          bankSelect.appendChild(specialtyGroup);
        }
      }
      
      if (!vcslGroup) {
        vcslGroup = document.createElement('optgroup');
        vcslGroup.label = VCSL_OPTGROUP_LABEL;
        bankSelect.appendChild(vcslGroup);
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

      // Populate specialty/world/vocal sample banks (base entries)
      specialtyGroup.innerHTML = '';
      vcslGroup.innerHTML = '';
      SPECIAL_SAMPLE_BANKS.forEach(({ value, label }) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        if (value.toLowerCase() === 'vcsl') {
          vcslGroup.appendChild(option);
        } else {
          specialtyGroup.appendChild(option);
        }
      });
      removeExistingSpecialtyOptions();
      if (Array.isArray(cachedVcslInstrumentOptions) && cachedVcslInstrumentOptions.length > 0) {
        cachedVcslInstrumentOptions.forEach((entry) => {
          const option = document.createElement('option');
          option.value = entry.optionValue;
          option.textContent = entry.label;
          option.dataset.source = 'specialty-vcsl';
          option.dataset.instrument = entry.value;
          vcslGroup.appendChild(option);
        });
      } else if (!vcslInstrumentFetchPromise) {
        loadVcslInstrumentOptions().then(() => {
          ensurePatternBankOptions(selectedValue);
        }).catch(() => {});
      }

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
    
    const lastEditorMode = (() => {
      if (typeof localStorage === 'undefined') return null;
      try {
        return localStorage.getItem('drumGridEditorMode');
      } catch {
        return null;
      }
    })();
    
    const drumGridState = {
      active: false,
      totalSteps: 0,
      built: false,
      patternEditorEnabled: lastEditorMode ? lastEditorMode === 'code' : true,
      updatingFromPattern: false,
      updatingFromGrid: false,
      currentBankRows: null,
      checkboxes: {},
      numBars: 1,
      currentBar: 1,
      barTokens: []
    };

    const patternEditorSelect = document.getElementById('modal-pattern-editor-select');
    const patternLabelRow = modal.querySelector('.pattern-label-row');
    let patternSnippetContainer = modal.querySelector('#modal-pattern-snippets-toggle')?.closest('.modal-presets') || null;
    let patternSnippetListEl = patternSnippetContainer ? patternSnippetContainer.querySelector('.pattern-snippet-list') : null;
    let patternSnippetSearchInput = patternSnippetContainer ? patternSnippetContainer.querySelector('.pattern-snippet-search') : null;
    const presetsToggle = document.getElementById('modal-presets-toggle');
    const presetsContent = document.getElementById('modal-presets-content');
    const drumPresetsContainer = document.getElementById('modal-drum-presets');
    const tonalPresetsContainer = document.getElementById('modal-tonal-presets');
    const samplerPresetsContainer = document.getElementById('modal-sampler-presets');
    const previewButton = document.getElementById('modal-preview-btn');

    const updatePresetsSectionState = (expanded) => {
      if (!presetsToggle || !presetsContent) return;
      presetsToggle.setAttribute('aria-expanded', expanded.toString());
      presetsContent.classList.toggle('is-open', expanded);
      presetsContent.setAttribute('aria-hidden', (!expanded).toString());
      // Update collapsed class for arrow rotation (like tags)
      const presetsContainer = presetsToggle.closest('.modal-presets');
      if (presetsContainer) {
        presetsContainer.classList.toggle('collapsed', !expanded);
      }
    };

    const resetPresetsSection = () => {
      if (presetsContent && presetsContent.hasAttribute('hidden')) {
        presetsContent.removeAttribute('hidden');
      }
      updatePresetsSectionState(false);
    };

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
        patternSnippetContainer.className = 'modal-presets';
        patternSnippetContainer.setAttribute('aria-disabled', 'false');

        const snippetToggle = document.createElement('button');
        snippetToggle.type = 'button';
        snippetToggle.id = 'modal-pattern-snippets-toggle';
        snippetToggle.className = 'modal-presets-toggle pattern-snippet-group-heading';
        snippetToggle.setAttribute('aria-expanded', 'false');
        const toggleSpan = document.createElement('span');
        toggleSpan.textContent = 'Add to pattern';
        snippetToggle.appendChild(toggleSpan);
        patternSnippetContainer.appendChild(snippetToggle);

        const snippetContent = document.createElement('div');
        snippetContent.id = 'modal-pattern-snippets-content';
        snippetContent.className = 'modal-presets-content';
        snippetContent.setAttribute('hidden', '');

        patternSnippetSearchInput = document.createElement('input');
        patternSnippetSearchInput.type = 'search';
        patternSnippetSearchInput.className = 'pattern-snippet-search';
        patternSnippetSearchInput.setAttribute('placeholder', 'Search tags…');
        patternSnippetSearchInput.setAttribute('aria-label', 'Search snippet tags');
        snippetContent.appendChild(patternSnippetSearchInput);

        patternSnippetListEl = document.createElement('div');
        patternSnippetListEl.className = 'pattern-snippet-list';
        snippetContent.appendChild(patternSnippetListEl);

        patternSnippetContainer.appendChild(snippetContent);

        // Setup toggle handler for the newly created container
        const updatePatternSnippetsSectionState = (expanded) => {
          snippetToggle.setAttribute('aria-expanded', expanded.toString());
          snippetContent.classList.toggle('is-open', expanded);
          snippetContent.setAttribute('aria-hidden', (!expanded).toString());
          patternSnippetContainer.classList.toggle('collapsed', !expanded);
        };

        // Initialize as closed
        if (snippetContent.hasAttribute('hidden')) {
          snippetContent.removeAttribute('hidden');
        }
        updatePatternSnippetsSectionState(false);

        // Only set up handler if not already set up
        if (!snippetToggle.dataset.listenerAttached) {
          snippetToggle.addEventListener('click', () => {
            const expanded = snippetToggle.getAttribute('aria-expanded') === 'true';
            const nextExpanded = !expanded;
            updatePatternSnippetsSectionState(nextExpanded);
          });
          snippetToggle.dataset.listenerAttached = 'true';
        }

        if (patternLabelRow) {
          // Insert after presets if they exist, otherwise after patternLabelRow
          const presetsContainer = modal.querySelector('#modal-presets-toggle')?.closest('.modal-presets');
          if (presetsContainer && presetsContainer.parentElement === patternLabelRow.parentElement) {
            presetsContainer.insertAdjacentElement('afterend', patternSnippetContainer);
          } else {
            patternLabelRow.insertAdjacentElement('afterend', patternSnippetContainer);
          }
        } else {
          modal.querySelector('.form-group')?.insertAdjacentElement('afterbegin', patternSnippetContainer);
        }

        // Move or create Add samples section after Add to pattern
        let samplesContainer = modal.querySelector('#modal-samples-toggle')?.closest('.modal-presets');
        if (!samplesContainer) {
          // Create the samples section if it doesn't exist
          const formGroup = document.createElement('div');
          formGroup.className = 'form-group';
          
          samplesContainer = document.createElement('div');
          samplesContainer.className = 'modal-presets';
          
          const samplesToggle = document.createElement('button');
          samplesToggle.type = 'button';
          samplesToggle.id = 'modal-samples-toggle';
          samplesToggle.className = 'modal-presets-toggle pattern-snippet-group-heading';
          samplesToggle.setAttribute('aria-expanded', 'false');
          const toggleSpan = document.createElement('span');
          toggleSpan.textContent = 'Add samples';
          samplesToggle.appendChild(toggleSpan);
          samplesContainer.appendChild(samplesToggle);
          
          const samplesContent = document.createElement('div');
          samplesContent.id = 'modal-samples-content';
          samplesContent.className = 'modal-presets-content';
          samplesContent.setAttribute('hidden', '');
          
          const sampleUrlGroup = document.createElement('div');
          sampleUrlGroup.className = 'form-group';
          const urlLabel = document.createElement('label');
          urlLabel.setAttribute('for', 'modal-sample-url');
          urlLabel.textContent = 'Sample URL:';
          const urlInput = document.createElement('input');
          urlInput.type = 'text';
          urlInput.id = 'modal-sample-url';
          urlInput.placeholder = 'e.g., https://example.com/sample.wav (optional)';
          sampleUrlGroup.appendChild(urlLabel);
          sampleUrlGroup.appendChild(urlInput);
          samplesContent.appendChild(sampleUrlGroup);
          
          const sampleFileGroup = document.createElement('div');
          sampleFileGroup.className = 'form-group';
          const fileLabel = document.createElement('label');
          fileLabel.setAttribute('for', 'modal-sample-file');
          fileLabel.textContent = 'Or Select File:';
          const fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.id = 'modal-sample-file';
          fileInput.setAttribute('accept', 'audio/*');
          sampleFileGroup.appendChild(fileLabel);
          sampleFileGroup.appendChild(fileInput);
          samplesContent.appendChild(sampleFileGroup);
          
          const sampleNameGroup = document.createElement('div');
          sampleNameGroup.className = 'form-group';
          sampleNameGroup.id = 'modal-sample-name-group';
          const nameLabel = document.createElement('label');
          nameLabel.setAttribute('for', 'modal-sample-name');
          nameLabel.textContent = 'Sample Name:';
          const addRow = document.createElement('div');
          addRow.className = 'sample-add-row';
          const nameInput = document.createElement('input');
          nameInput.type = 'text';
          nameInput.id = 'modal-sample-name';
          nameInput.placeholder = 'e.g., "dream-pad"';
          const addButton = document.createElement('button');
          addButton.type = 'button';
          addButton.id = 'modal-add-sample-btn';
          addButton.className = 'sample-add-button';
          addButton.textContent = 'Add';
          const hint = document.createElement('small');
          hint.className = 'sample-add-hint';
          hint.textContent = 'Adds a samples(...) block and sound("name") to the pattern.';
          addRow.appendChild(nameInput);
          addRow.appendChild(addButton);
          sampleNameGroup.appendChild(nameLabel);
          sampleNameGroup.appendChild(addRow);
          sampleNameGroup.appendChild(hint);
          samplesContent.appendChild(sampleNameGroup);
          
          samplesContainer.appendChild(samplesContent);
          formGroup.appendChild(samplesContainer);
          
          // Insert after pattern snippet container
          patternSnippetContainer.insertAdjacentElement('afterend', formGroup);
          
          // Setup toggle handler for the newly created samples section
          const updateSamplesSectionState = (expanded) => {
            samplesToggle.setAttribute('aria-expanded', expanded.toString());
            samplesContent.classList.toggle('is-open', expanded);
            samplesContent.setAttribute('aria-hidden', (!expanded).toString());
            samplesContainer.classList.toggle('collapsed', !expanded);
          };

          // Initialize as closed
          if (samplesContent.hasAttribute('hidden')) {
            samplesContent.removeAttribute('hidden');
          }
          updateSamplesSectionState(false);

          // Only set up handler if not already set up
          if (!samplesToggle.dataset.listenerAttached) {
            samplesToggle.addEventListener('click', () => {
              const expanded = samplesToggle.getAttribute('aria-expanded') === 'true';
              const nextExpanded = !expanded;
              updateSamplesSectionState(nextExpanded);
            });
            samplesToggle.dataset.listenerAttached = 'true';
          }
        } else {
          // Move existing samples container to after pattern snippet container
          const samplesFormGroup = samplesContainer.closest('.form-group');
          if (samplesFormGroup && samplesFormGroup !== patternSnippetContainer.parentElement) {
            patternSnippetContainer.insertAdjacentElement('afterend', samplesFormGroup);
          } else if (!samplesFormGroup) {
            // If no form-group wrapper, create one and move
            const formGroup = document.createElement('div');
            formGroup.className = 'form-group';
            samplesContainer.parentElement.insertBefore(formGroup, samplesContainer);
            formGroup.appendChild(samplesContainer);
            patternSnippetContainer.insertAdjacentElement('afterend', formGroup);
          }
        }
      }

      if (!patternSnippetListEl) {
        const contentDiv = patternSnippetContainer.querySelector('#modal-pattern-snippets-content');
        patternSnippetListEl = contentDiv ? contentDiv.querySelector('.pattern-snippet-list') : null;
      }

      if (!patternSnippetSearchInput) {
        const contentDiv = patternSnippetContainer.querySelector('#modal-pattern-snippets-content');
        patternSnippetSearchInput = contentDiv ? contentDiv.querySelector('.pattern-snippet-search') : null;
      }

      // State to track selected tag for suggestions (stored on app instance for external access)
      if (!this.selectedTagKey) {
        this.selectedTagKey = null;
      }
      let selectedTagKey = this.selectedTagKey;

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
          let rawInsertion = buildSnippetInsertion(snippet, referenceEntry);
          // Fix: Replace "display bank(bank)" with "bank()" in core group
          if (key === 'bank' && rawInsertion.includes('display bank(bank)')) {
            rawInsertion = 'bank()';
          }
          const insertionSnippet = rawInsertion.replace(/^[.]+/, '');
          let displayLabel = insertionSnippet;
          // Preserve instrument names for sound() tags that have instruments
          // Check if it's a sound() tag with an instrument (e.g., sound("sawtooth"))
          const soundWithInstrumentMatch = insertionSnippet.match(/^sound\s*\(\s*["']([^"']+)["']\s*\)/i);
          if (soundWithInstrumentMatch && soundWithInstrumentMatch[1]) {
            // Preserve the instrument name
            const instrumentName = soundWithInstrumentMatch[1];
            displayLabel = `sound("${instrumentName}")`;
          } else {
            // Remove text inside parentheses for all other tags
            displayLabel = displayLabel.replace(/\([^)]*\)/g, '()');
          }
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

        // Sort groups by name (heading)
        groupOrder.sort((a, b) => {
          const headingA = (a.heading || '').toLowerCase();
          const headingB = (b.heading || '').toLowerCase();
          return headingA.localeCompare(headingB);
        });

        let renderedAny = false;

        // Build a map of all available items by key for suggestions lookup
        const availableItemsMap = new Map();
        items.forEach((entry) => {
          const snippet = typeof entry === 'string' ? entry : entry.snippet;
          const key = getSnippetKey(snippet);
          if (!availableItemsMap.has(key)) {
            availableItemsMap.set(key, entry);
          }
        });

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
              // - For sound("instrument"): preserve instrument name
              let displayText = item.displayLabel;
              const paramNameMatch = displayText.match(/\(([a-zA-Z_]+):number\)/);
              if (paramNameMatch) {
                // Extract parameter name and use it as the display text
                const paramName = paramNameMatch[1];
                displayText = `${paramName}()`;
              } else if (displayText.includes('sound("') && displayText.includes('")')) {
                // Preserve sound("instrument") format - already handled in displayLabel
                displayText = item.displayLabel;
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
              
              let valueSpan;
              
              // Get function name (e.g., 'lpf', 'hpf', 'gain')
              const functionName = tagKey;
              
              // Check if this is a frequency slider (Hz unit)
              const isFrequencySlider = numericParams.unit === 'Hz' && 
                (tagKey === 'lpf' || tagKey === 'hpf' || tagKey === 'bpf' || tagKey === 'cutoff' || tagKey === 'roomlp');
              
              if (isFrequencySlider) {
                // Use non-linear frequency mapping for Hz sliders
                // Slider internally uses 0-1 range, but we map it to Hz
                slider.min = '0';
                slider.max = '1';
                slider.step = '0.001'; // Fine-grained steps for smooth control
                
                // Try to get existing value from pattern, otherwise use default
                const getCurrentPatternValue = () => {
                  const currentPattern = getStrudelEditorValue('modal-pattern') || '';
                  const functionRegex = new RegExp(`\\.${functionName}\\(([^)]+)\\)`, 'g');
                  const match = functionRegex.exec(currentPattern);
                  return match ? match[1] : null;
                };
                
                const existingValue = getCurrentPatternValue();
                let currentHz = existingValue ? parseFloat(existingValue) : numericParams.default;
                // Clamp to valid range
                currentHz = Math.max(numericParams.min, Math.min(numericParams.max, currentHz));
                // Convert Hz to slider position (0-1)
                const sliderPosition = frequencyToPosition(currentHz);
                slider.value = String(sliderPosition);
                
                valueSpan = document.createElement('span');
                valueSpan.className = 'slider-value';
                valueSpan.style.minWidth = '60px';
                valueSpan.style.textAlign = 'right';
                valueSpan.style.fontSize = '0.75rem';
                valueSpan.style.fontWeight = '600';
                valueSpan.textContent = Math.round(currentHz) + ' ' + numericParams.unit;
                
                // Update value display on input (for visual feedback)
                slider.addEventListener('input', (e) => {
                  const position = parseFloat(e.target.value);
                  const hz = positionToFrequency(position);
                  queueSliderDisplayUpdate(valueSpan, Math.round(hz) + ' ' + numericParams.unit);
                });
              } else {
                // Regular linear slider for non-frequency parameters
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
              
                valueSpan = document.createElement('span');
              valueSpan.className = 'slider-value';
              valueSpan.style.minWidth = '60px';
              valueSpan.style.textAlign = 'right';
              valueSpan.style.fontSize = '0.75rem';
              valueSpan.style.fontWeight = '600';
              valueSpan.textContent = slider.value + (numericParams.unit ? ' ' + numericParams.unit : '');
              
              // Update value display on input (for visual feedback)
              slider.addEventListener('input', (e) => {
                const value = e.target.value;
                queueSliderDisplayUpdate(valueSpan, value + (numericParams.unit ? ' ' + numericParams.unit : ''));
              });
              }
              
              // Replace or insert function when slider is released
              slider.addEventListener('change', (e) => {
                let value = e.target.value;
                
                // For frequency sliders, convert position to Hz
                if (isFrequencySlider) {
                  const position = parseFloat(value);
                  const hz = positionToFrequency(position);
                  value = Math.round(hz); // Round to nearest Hz for cleaner values
                  queueSliderDisplayUpdate(valueSpan, value + ' ' + numericParams.unit);
                } else {
                queueSliderDisplayUpdate(valueSpan, value + (numericParams.unit ? ' ' + numericParams.unit : ''));
                }
                
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
                    let existingValue = match[1];
                    
                    // For frequency sliders, convert Hz to slider position
                    if (isFrequencySlider) {
                      const hz = parseFloat(existingValue);
                      const clampedHz = Math.max(numericParams.min, Math.min(numericParams.max, hz));
                      const position = frequencyToPosition(clampedHz);
                      slider.value = String(position);
                      valueSpan.textContent = Math.round(clampedHz) + ' ' + numericParams.unit;
                    } else {
                    slider.value = existingValue;
                    valueSpan.textContent = existingValue + (numericParams.unit ? ' ' + numericParams.unit : '');
                    }
                  } else {
                    // Insert tag with default value if not already in pattern
                    let valueToInsert = slider.value;
                    if (isFrequencySlider) {
                      // For frequency sliders, convert position to Hz
                      const position = parseFloat(slider.value);
                      valueToInsert = Math.round(positionToFrequency(position));
                    }
                    const functionCall = `.${functionName}(${valueToInsert})`;
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
            
            // Show suggestions if this is the selected tag (check both local and app instance)
            const currentSelectedTag = selectedTagKey || appInstance.selectedTagKey;
            if (currentSelectedTag && tagKey === currentSelectedTag) {
              const suggestions = TAG_SUGGESTIONS[tagKey];
              if (suggestions && Array.isArray(suggestions) && suggestions.length > 0) {
                // Create suggestions container
                const suggestionsContainer = document.createElement('div');
                suggestionsContainer.className = 'pattern-snippet-suggestions';
                
                const suggestionsLabel = document.createElement('div');
                suggestionsLabel.className = 'pattern-snippet-suggestions-label';
                suggestionsLabel.textContent = 'Suggested:';
                suggestionsContainer.appendChild(suggestionsLabel);
                
                const suggestionsList = document.createElement('div');
                suggestionsList.className = 'pattern-snippet-suggestions-list';
                
                // Filter suggestions to only show tags that exist in current items
                const validSuggestions = suggestions.filter(suggestedKey => {
                  return availableItemsMap.has(suggestedKey);
                });
                
                // Limit to top 8 suggestions to avoid clutter
                const topSuggestions = validSuggestions.slice(0, 8);
                
                topSuggestions.forEach(suggestedKey => {
                  const suggestedEntry = availableItemsMap.get(suggestedKey);
                  const suggestedSnippet = typeof suggestedEntry === 'string' ? suggestedEntry : suggestedEntry.snippet;
                  const suggestedKeyActual = getSnippetKey(suggestedSnippet);
                  const suggestedReferenceEntry = reference.get(suggestedKeyActual);
                  let suggestedRawInsertion = buildSnippetInsertion(suggestedSnippet, suggestedReferenceEntry);
                  const suggestedInsertionSnippet = suggestedRawInsertion.replace(/^[.]+/, '');
                  let suggestedDisplayLabel = suggestedInsertionSnippet;
                  suggestedDisplayLabel = suggestedDisplayLabel.replace(/\([^)]*\)/g, '()');
                  
                  // Find the group for this suggestion
                  let suggestedGroupId = 'other';
                  let suggestedClassName = '';
                  for (const group of PATTERN_SNIPPET_GROUPS) {
                    if (group.matcher(suggestedKeyActual, suggestedSnippet)) {
                      suggestedGroupId = group.id;
                      suggestedClassName = group.className;
                      break;
                    }
                  }
                  
                  const suggestedButton = document.createElement('button');
                  suggestedButton.type = 'button';
                  const suggestedCustomClass = getCustomSnippetClass(suggestedSnippet);
                  const suggestedApplyCoreStyle = !suggestedCustomClass && suggestedGroupId !== 'core' && shouldUseCoreStyle(suggestedSnippet);
                  const suggestedExtraClassNames = [
                    suggestedClassName,
                    suggestedCustomClass,
                    suggestedApplyCoreStyle ? 'pattern-snippet-tag-core' : '',
                    'pattern-snippet-tag-suggested'
                  ]
                    .filter(Boolean)
                    .join(' ');
                  suggestedButton.className = `pattern-snippet-tag ${suggestedExtraClassNames}`.trim();
                  suggestedButton.dataset.snippet = suggestedSnippet;
                  suggestedButton.dataset.insertion = suggestedInsertionSnippet;
                  suggestedButton.textContent = suggestedDisplayLabel;
                  suggestedButton.setAttribute('aria-label', suggestedDisplayLabel);
                  
                  // Add click handler for suggested tag
                  suggestedButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!patternSnippetContainer.classList.contains('disabled') && drumGridState.patternEditorEnabled) {
                      // Update selected tag to the newly clicked suggestion
                      selectedTagKey = suggestedKeyActual;
                      appInstance.selectedTagKey = suggestedKeyActual;
                      hideSnippetTooltip(suggestedButton);
                      insertStrudelEditorSnippet('modal-pattern', suggestedInsertionSnippet);
                      // Refresh to show new suggestions
                      if (typeof refreshSnippetButtons === 'function') {
                        refreshSnippetButtons().catch(err => console.warn('⚠️ Unable to refresh snippet tags:', err));
                      }
                    }
                  });
                  
                  // Add tooltip
                  const suggestedTooltipTitle = suggestedReferenceEntry?.name || suggestedDisplayLabel.replace(/^[.]+/, '').trim();
                  const suggestedTooltipDescription = getReferenceDescriptionText(suggestedReferenceEntry);
                  const suggestedTooltipParams = Array.isArray(suggestedReferenceEntry?.params)
                    ? suggestedReferenceEntry.params.map(buildParamDescription).filter(Boolean).join('\n')
                    : '';
                  
                  suggestedButton.dataset.tooltipTitle = suggestedTooltipTitle || suggestedDisplayLabel;
                  suggestedButton.dataset.tooltipDescription = suggestedTooltipDescription || '';
                  suggestedButton.dataset.tooltipParams = suggestedTooltipParams || '';
                  
                  const handleSuggestedShowTooltip = () => showSnippetTooltip(suggestedButton);
                  const handleSuggestedHideTooltip = () => hideSnippetTooltip(suggestedButton);
                  
                  suggestedButton.addEventListener('mouseenter', handleSuggestedShowTooltip);
                  suggestedButton.addEventListener('mouseleave', handleSuggestedHideTooltip);
                  suggestedButton.addEventListener('focus', handleSuggestedShowTooltip);
                  suggestedButton.addEventListener('blur', handleSuggestedHideTooltip);
                  
                  suggestionsList.appendChild(suggestedButton);
                });
                
                if (topSuggestions.length > 0) {
                  suggestionsContainer.appendChild(suggestionsList);
                  itemsContainer.appendChild(suggestionsContainer);
                }
              }
            }
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
        // Sync selectedTagKey from app instance
        selectedTagKey = appInstance.selectedTagKey;
        renderSnippets(patternSnippetListEl, updatedSnippets, ref, term);
      };
      
      // Store refreshSnippetButtons on app instance for external access
      appInstance.refreshSnippetButtons = refreshSnippetButtons;

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
          
          // Track selected tag for suggestions
          const tagKey = getSnippetKey(snippet);
          selectedTagKey = tagKey;
          appInstance.selectedTagKey = tagKey; // Store on app instance for external access
          
          hideSnippetTooltip(button);
          insertStrudelEditorSnippet('modal-pattern', snippet);
          
          // Refresh to show suggestions
          if (typeof refreshSnippetButtons === 'function') {
            refreshSnippetButtons().catch(err => console.warn('⚠️ Unable to refresh snippet tags:', err));
          }
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
        // Always default to code editor when opening the modal
        setPatternEditorEnabled(true);
        if (patternEditorSelect) {
          patternEditorSelect.value = 'code';
        }
        // Update header title
        const headerEl = document.getElementById('modal-element-id');
        if (headerEl) headerEl.textContent = elementId || '';
        // Load saved config
        const saved = this.loadElementConfig ? this.loadElementConfig(elementId) : null;
        // Populate bank
        const bankValue = saved?.bank || '';
        const savedVcslInstrument = saved?.vcslInstrument || '';
        const selectValue = bankValue === 'vcsl' && savedVcslInstrument
          ? `${VCSL_OPTION_PREFIX}${savedVcslInstrument}`
          : bankValue;
        ensurePatternBankOptions(selectValue);
        if (bankSelect) bankSelect.value = selectValue;
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
        updateScaleChordSuggestionsUI();
        updateScaleNotesDisplay();
        // Ensure UI reflects current state
        updatePreviewButtonState();
        updateKeyScaleVisibility();
        refreshDrumGridForCurrentState();
        // Reset presets section state each time the modal opens
        resetPresetsSection();
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
        const bankSelection = bankSelect ? parseBankSelectionValue(bankSelect.value) : { bankValue: '', isVcslInstrument: false };
        const bankValue = bankSelection.bankValue;
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
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('drumGridEditorMode', drumGridState.patternEditorEnabled ? 'code' : 'step');
        }
      } catch {
        // ignore storage errors
      }
    };
    
    const isDrumBankValue = (value) => {
      const parsed = parseBankSelectionValue(value);
      return parsed.bankValue && DRUM_BANK_VALUES.has(parsed.bankValue);
    };
    
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
      const modalTimeSigSelect = document.getElementById('modal-time-signature-select');
      const timeSig = modalTimeSigSelect?.value || this.currentTimeSignature || '4/4';
      const metrics = getTimeSignatureMetrics(timeSig);
      saveCurrentBarTokens(metrics);
      drumGridState.currentBar = barNumber;
      updateBarSelector();
      const bankValue = bankSelect ? bankSelect.value : '';
      drumGridState.built = false;
      ensureDrumGridBuilt(metrics, bankValue);
      if (!drumGridState.barTokens || !drumGridState.barTokens.length) {
      const currentPattern = getStrudelEditorValue('modal-pattern');
        const tokens = tokenizePattern(currentPattern);
        initializeBarTokensFromSequence(metrics, tokens || []);
      } else {
        rebalanceBarTokens(metrics);
      }
      applyBarTokensToGrid(metrics);
    };
    
    const addBar = () => {
      const modalTimeSigSelect = document.getElementById('modal-time-signature-select');
      const timeSig = modalTimeSigSelect?.value || this.currentTimeSignature || '4/4';
      const metrics = getTimeSignatureMetrics(timeSig);
      saveCurrentBarTokens(metrics);
      drumGridState.numBars++;
      rebalanceBarTokens(metrics);
      const stepsPerBar = metrics.totalSteps;
      drumGridState.barTokens[drumGridState.numBars - 1] = new Array(stepsPerBar).fill('~');
      updateBarSelector();
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
      
      rebalanceBarTokens(metrics);
      applyBarTokensToGrid(metrics);
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
    
    function parseTokenToSamples(token) {
      if (!token) return [];
      const trimmed = token.trim();
      if (!trimmed || trimmed === '~') return [];
      let working = trimmed;
      if ((working.startsWith('[') && working.endsWith(']')) || (working.startsWith('{') && working.endsWith('}'))) {
        working = working.slice(1, -1);
      }
      working = working.replace(/[,]+/g, ' ');
      return working.split(/\s+/).map(part => part.trim()).filter(Boolean);
    }

    function rebalanceBarTokens(metrics) {
      if (!drumGridState.barTokens) {
        drumGridState.barTokens = [];
      }
      const stepsPerBar = metrics.totalSteps;
      const requiredBars = Math.max(1, drumGridState.numBars);
      if (drumGridState.barTokens.length > requiredBars) {
        drumGridState.barTokens.length = requiredBars;
      }
      while (drumGridState.barTokens.length < requiredBars) {
        drumGridState.barTokens.push(new Array(stepsPerBar).fill('~'));
      }
      drumGridState.barTokens = drumGridState.barTokens.map((bar) => {
        const normalized = Array.isArray(bar) ? bar.slice(0, stepsPerBar) : [];
        while (normalized.length < stepsPerBar) {
          normalized.push('~');
        }
        return normalized;
      });
    }

    function initializeBarTokensFromSequence(metrics, sequenceTokens) {
      const stepsPerBar = metrics.totalSteps;
      const totalBars = Math.max(1, drumGridState.numBars);
      const totalStepsNeeded = stepsPerBar * totalBars;
      let working = Array.isArray(sequenceTokens) ? sequenceTokens.slice(0, totalStepsNeeded) : [];
      if (working.length < totalStepsNeeded) {
        working = working.concat(new Array(totalStepsNeeded - working.length).fill('~'));
      }
      drumGridState.barTokens = [];
      for (let bar = 0; bar < totalBars; bar++) {
        const start = bar * stepsPerBar;
        drumGridState.barTokens.push(working.slice(start, start + stepsPerBar));
      }
      rebalanceBarTokens(metrics);
    }

    function saveCurrentBarTokens(metrics) {
      if (!drumGridState.active || drumGridState.updatingFromPattern || !drumGridState.checkboxes) return;
      const barIndex = drumGridState.currentBar - 1;
      if (barIndex < 0) return;
      rebalanceBarTokens(metrics);
      const stepsPerBar = metrics.totalSteps;
      const rows = drumGridState.currentBankRows || DRUM_GRID_ROWS;
      const tokens = new Array(stepsPerBar).fill('~');
      for (let step = 0; step < stepsPerBar; step += 1) {
        const samples = [];
        rows.forEach(({ key, sample }) => {
          const checkboxes = drumGridState.checkboxes[key];
          const checkbox = checkboxes ? checkboxes[step] : null;
          if (checkbox && checkbox.checked) {
            samples.push(sample);
          }
        });
        if (samples.length === 1) {
          tokens[step] = samples[0];
        } else if (samples.length > 1) {
          tokens[step] = `[${samples.join(' ')}]`;
        }
      }
      drumGridState.barTokens[barIndex] = tokens;
    }

    function applyBarTokensToGrid(metrics) {
      if (!drumGridState.checkboxes) return;
      rebalanceBarTokens(metrics);
      const barIndex = drumGridState.currentBar - 1;
      const barTokens = drumGridState.barTokens[barIndex];
      if (!barTokens) return;
      const rows = drumGridState.currentBankRows || DRUM_GRID_ROWS;
      rows.forEach(({ key, sample }) => {
        const checkboxes = drumGridState.checkboxes[key];
        if (!checkboxes) return;
        checkboxes.forEach((checkbox, step) => {
          if (!checkbox) return;
          const samples = parseTokenToSamples(barTokens[step]);
          checkbox.checked = samples.includes(sample);
        });
      });
    }

    function getFlattenedBarTokens() {
      if (!Array.isArray(drumGridState.barTokens)) {
        return [];
      }
      return drumGridState.barTokens.flat();
    }
    
    const populateDrumGridFromPattern = (pattern, metrics) => {
      if (!drumGridSection || !drumGridState.active) return;
      const tokens = tokenizePattern(pattern);
      const stepsPerBar = metrics.totalSteps;
      if (tokens && tokens.length) {
        const requiredBars = Math.max(1, Math.ceil(tokens.length / stepsPerBar));
        if (drumGridState.numBars !== requiredBars) {
          drumGridState.numBars = requiredBars;
          if (drumGridState.currentBar > drumGridState.numBars) {
            drumGridState.currentBar = drumGridState.numBars;
          }
          updateBarSelector();
        }
        initializeBarTokensFromSequence(metrics, tokens);
      } else if (!drumGridState.barTokens.length) {
        initializeBarTokensFromSequence(metrics, []);
      } else {
        rebalanceBarTokens(metrics);
      }
      
      drumGridState.updatingFromPattern = true;
      applyBarTokensToGrid(metrics);
      drumGridState.updatingFromPattern = false;
    };
    
    const generateTokensFromGrid = (metrics) => {
      rebalanceBarTokens(metrics);
      return getFlattenedBarTokens();
    };
    
    const updatePatternFromGrid = () => {
      if (!drumGridSection || !drumGridState.active || !bankSelect) return;
      const modalTimeSigSelect = document.getElementById('modal-time-signature-select');
      const timeSig = modalTimeSigSelect?.value || this.currentTimeSignature || '4/4';
      const metrics = getTimeSignatureMetrics(timeSig);
      saveCurrentBarTokens(metrics);
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

      // Show drum grid for drum banks (even if pattern can't be tokenized - user chose step editor)
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

    const applyPresetPattern = (preset) => {
      if (!preset) return;
      const elementId = this.currentEditingElementId;
      if (elementId) {
        const titleInput = document.getElementById('modal-title');
        if (titleInput) {
          titleInput.value = preset.label;
        }
        const modalElementId = document.getElementById('modal-element-id');
        if (modalElementId) {
          modalElementId.textContent = getChannelDisplayLabel(elementId);
        }
        updateElementTitleDisplay(elementId, preset.label);
        if (typeof this.saveElementConfig === 'function') {
          const existingConfig = this.loadElementConfig?.(elementId) || {};
          const mergedConfig = { ...existingConfig, title: preset.label };
          this.saveElementConfig(elementId, mergedConfig, true);
        }
      }

      const targetBank = typeof preset.bank === 'string' ? preset.bank : '';
      const resolveNoteMode = () => {
        if (typeof preset.useNoteNames === 'boolean') {
          return preset.useNoteNames;
        }
        const patternText = preset.pattern || '';
        return patternText.includes('note(') || patternText.includes('note("');
      };

      const applyPattern = () => {
        if (preset.pattern) {
          const keepNotesCheckbox = document.getElementById('modal-keep-notes-as-written');
          if (keepNotesCheckbox) {
            keepNotesCheckbox.checked = resolveNoteMode();
          }
          setStrudelEditorValue('modal-pattern', preset.pattern.trim());
          updatePreviewButtonState();
        }
        if (targetBank && isDrumBankValue(targetBank)) {
          setPatternEditorEnabled(false);
          refreshDrumGridForCurrentState();
        } else {
          setPatternEditorEnabled(true);
          hideDrumGrid();
          applyPatternEditorState();
        }
        if (modalPatternTextarea) {
          modalPatternTextarea.focus();
        }
      };

      const keepNotesCheckbox = document.getElementById('modal-keep-notes-as-written');
      if (keepNotesCheckbox) {
        keepNotesCheckbox.checked = resolveNoteMode();
      }

      if (bankSelect) {
        const normalizedBank = targetBank || '';
        if (bankSelect.value !== normalizedBank) {
          bankSelect.value = normalizedBank;
          bankSelect.dispatchEvent(new Event('change', { bubbles: true }));
          setTimeout(applyPattern, 60);
          return;
        }
      }
      applyPattern();
    };

    resetPresetsSection();

    const updatePresetTooltipAlignment = (button) => {
      if (!button || !button.classList.contains('has-tooltip')) return;
      const rect = button.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        requestAnimationFrame(() => updatePresetTooltipAlignment(button));
        return;
      }
      const modalContainer = modal?.querySelector('.modal-presets-content') || modal;
      const containerRect = modalContainer
        ? modalContainer.getBoundingClientRect()
        : { left: 0, width: window.innerWidth };
      const containerCenter = containerRect.left + containerRect.width / 2;
      const buttonCenter = rect.left + rect.width / 2;
      const alignRight = buttonCenter > containerCenter;
      button.classList.toggle('tooltip-align-right', alignRight);
      button.classList.toggle('tooltip-align-left', !alignRight);
    };

    let pendingTooltipAlignFrame = null;
    const schedulePresetTooltipAlignment = () => {
      if (pendingTooltipAlignFrame) return;
      pendingTooltipAlignFrame = requestAnimationFrame(() => {
        pendingTooltipAlignFrame = null;
        const buttons = modal?.querySelectorAll('.modal-preset-button.has-tooltip');
        buttons?.forEach((btn) => updatePresetTooltipAlignment(btn));
      });
    };
    window.addEventListener('resize', schedulePresetTooltipAlignment);

    const renderPresetButtons = (container, presets) => {
      if (!container || !Array.isArray(presets)) return;
      container.innerHTML = '';
      presets.forEach((preset) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'modal-preset-button';
        const badge = preset.editorBadge 
          ? `<span class="modal-preset-badge${preset.editorBadge.toLowerCase().includes('code') ? ' is-code' : preset.editorBadge.toLowerCase().includes('step') ? ' is-step' : ''}">${preset.editorBadge}</span>` 
          : '';
        const secondaryRow = preset.secondaryLabel
          ? `<div class="modal-preset-secondary-row">${preset.secondaryLabel}</div>`
          : '';
        button.innerHTML = `
          <div class="modal-preset-heading-row">
            <strong>${preset.label}</strong>
            ${badge}
          </div>
          ${secondaryRow}
          ${preset.description ? `<span class="modal-preset-description">${preset.description}</span>` : ''}
        `;
        if (preset.tooltip) {
          button.classList.add('has-tooltip');
          button.setAttribute('data-tooltip', preset.tooltip);
          button.addEventListener('mouseenter', () => updatePresetTooltipAlignment(button));
          button.addEventListener('focus', () => updatePresetTooltipAlignment(button));
          requestAnimationFrame(() => updatePresetTooltipAlignment(button));
        }
        button.addEventListener('click', () => applyPresetPattern(preset));
        container.appendChild(button);
      });
      schedulePresetTooltipAlignment();
    };

    const initializePresetSubtoggles = () => {
      const toggles = modal.querySelectorAll('.modal-presets-subtoggle');
      toggles.forEach((toggle) => {
        const targetId = toggle.getAttribute('data-target');
        const panel = targetId ? document.getElementById(targetId) : toggle.nextElementSibling;
        if (!panel) return;

        const setState = (isOpen) => {
          toggle.setAttribute('aria-expanded', String(isOpen));
          panel.classList.toggle('is-open', isOpen);
          // Update collapsed class for arrow rotation (like tags)
          const group = toggle.closest('.modal-presets-group');
          if (group) {
            group.classList.toggle('collapsed', !isOpen);
          }
        };

        const initialOpen = panel.classList.contains('is-open');
        setState(initialOpen);

        toggle.addEventListener('click', () => {
          const nextState = toggle.getAttribute('aria-expanded') !== 'true';
          setState(nextState);
        });
      });
    };

    if (presetsToggle && presetsContent) {
      presetsToggle.addEventListener('click', () => {
        const expanded = presetsToggle.getAttribute('aria-expanded') === 'true';
        const nextExpanded = !expanded;
        updatePresetsSectionState(nextExpanded);
      });
    }

    // Note: Samples and pattern snippets toggle handlers are set up dynamically
    // when their containers are created (see ensurePatternSnippetContainer function)

    renderPresetButtons(drumPresetsContainer, DRUM_PATTERN_PRESETS);
    renderPresetButtons(tonalPresetsContainer, TONAL_PATTERN_PRESETS);
    renderPresetButtons(samplerPresetsContainer, SAMPLER_EFFECT_PRESETS);
    initializePresetSubtoggles();

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
    const scaleChordSuggestionEls = {
      container: document.getElementById('modal-scale-chord-suggestions'),
      title: document.getElementById('modal-scale-chord-title'),
      characteristic: document.getElementById('modal-scale-characteristic'),
      dropdown: document.getElementById('modal-chord-progression-select')
    };

    // Helper function to convert Roman numerals to chord names
    const romanToChords = (key, romanNumerals) => {
      try {
        // Normalize key format (e.g., "C#" -> "C#", "Db" -> "Db")
        const normalizedKey = key.trim();
        // Map special cases to Tonal.js compatible format
        const normalizedRomans = romanNumerals.map((rn) => {
          // Handle special cases that Tonal.js might not support directly
          // Convert "bII" to "bII", "vii°" to "vii°", etc.
          // Tonal.js should handle most of these, but we'll try to normalize
          let normalized = rn;
          // Remove special characters that might cause issues, but keep the core structure
          // Tonal.js Progression should handle: bII, vii°, V7alt, imMaj7, etc.
          return normalized;
        });
        
        // Use Tonal.js Progression to convert Roman numerals to chord names
        const chords = Progression.fromRomanNumerals(normalizedKey, normalizedRomans);
        return chords.filter(Boolean).map((chord, idx) => {
          // If conversion failed for a specific chord, fall back to showing the Roman numeral
          if (!chord || chord === '') {
            return romanNumerals[idx];
          }
          return chord;
        });
      } catch (error) {
        console.warn('Error converting Roman numerals to chords:', error, 'Romans:', romanNumerals);
        // Fallback: return Roman numerals formatted nicely
        return romanNumerals.map((rn) => {
          // Format Roman numerals for display (e.g., "bII" -> "♭II")
          return rn.replace(/b/g, '♭').replace(/#/g, '♯');
        });
      }
    };

    const SCALE_CHORD_PROGRESSIONS = {
      ionian: {
        displayName: 'Ionian (Major)',
        colorTone: '7 (natural)',
        progressions: {
          '2-chord': [
            { label: 'I – IV', romans: ['I', 'IV'] },
            { label: 'I – V', romans: ['I', 'V'] },
            { label: 'I – vi', romans: ['I', 'vi'] }
          ],
          '3-chord': [
            { label: 'I – IV – V', romans: ['I', 'IV', 'V'] },
            { label: 'I – V – vi', romans: ['I', 'V', 'vi'] },
            { label: 'I – iii – vi', romans: ['I', 'iii', 'vi'] }
          ],
          '4-chord': [
            { label: 'I – IV – V – I', romans: ['I', 'IV', 'V', 'I'] },
            { label: 'I – vi – IV – V', romans: ['I', 'vi', 'IV', 'V'] },
            { label: 'I – V – vi – IV (pop classic)', romans: ['I', 'V', 'vi', 'IV'] }
          ]
        }
      },
      dorian: {
        displayName: 'Dorian',
        colorTone: 'natural 6 in a minor scale',
        progressions: {
          '2-chord': [
            { label: 'i – IV', romans: ['i', 'IV'] },
            { label: 'i – ii', romans: ['i', 'ii'] }
          ],
          '3-chord': [
            { label: 'i – IV – v', romans: ['i', 'IV', 'v'] },
            { label: 'i – ii – IV', romans: ['i', 'ii', 'IV'] },
            { label: 'i – IV – VII', romans: ['i', 'IV', 'VII'] }
          ],
          '4-chord': [
            { label: 'i – IV – i – v', romans: ['i', 'IV', 'i', 'v'] },
            { label: 'i – ii – IV – i', romans: ['i', 'ii', 'IV', 'i'] },
            { label: 'i – IV – vii° – i', romans: ['i', 'IV', 'vii°', 'i'] }
          ]
        }
      },
      phrygian: {
        displayName: 'Phrygian',
        colorTone: '♭2 (very dark/tense)',
        progressions: {
          '2-chord': [
            { label: 'i – ♭II', romans: ['i', 'bII'] },
            { label: 'i – v', romans: ['i', 'v'] }
          ],
          '3-chord': [
            { label: 'i – ♭II – i', romans: ['i', 'bII', 'i'] },
            { label: 'i – v – ♭II', romans: ['i', 'v', 'bII'] }
          ],
          '4-chord': [
            { label: 'i – ♭II – vii – i', romans: ['i', 'bII', 'vii', 'i'] },
            { label: 'i – v – ♭II – i', romans: ['i', 'v', 'bII', 'i'] }
          ]
        }
      },
      lydian: {
        displayName: 'Lydian',
        colorTone: '♯4 (bright, dreamy, floaty)',
        progressions: {
          '2-chord': [
            { label: 'I – II', romans: ['I', 'II'] },
            { label: 'I – Vmaj7', romans: ['I', 'Vmaj7'] }
          ],
          '3-chord': [
            { label: 'I – II – I', romans: ['I', 'II', 'I'] },
            { label: 'I – V – II', romans: ['I', 'V', 'II'] }
          ],
          '4-chord': [
            { label: 'I – II – V – I', romans: ['I', 'II', 'V', 'I'] },
            { label: 'I – vii – II – I', romans: ['I', 'vii', 'II', 'I'] }
          ]
        }
      },
      mixolydian: {
        displayName: 'Mixolydian',
        colorTone: '♭7 (rock-dominant sound)',
        progressions: {
          '2-chord': [
            { label: 'I – ♭VII', romans: ['I', 'bVII'] },
            { label: 'I – v', romans: ['I', 'v'] }
          ],
          '3-chord': [
            { label: 'I – ♭VII – IV', romans: ['I', 'bVII', 'IV'] },
            { label: 'I – IV – ♭VII', romans: ['I', 'IV', 'bVII'] }
          ],
          '4-chord': [
            { label: 'I – ♭VII – IV – I', romans: ['I', 'bVII', 'IV', 'I'] },
            { label: 'I – v – ♭VII – IV', romans: ['I', 'v', 'bVII', 'IV'] }
          ]
        }
      },
      aeolian: {
        displayName: 'Aeolian (Natural Minor)',
        colorTone: '♭6',
        progressions: {
          '2-chord': [
            { label: 'i – ♭VI', romans: ['i', 'bVI'] },
            { label: 'i – ♭VII', romans: ['i', 'bVII'] }
          ],
          '3-chord': [
            { label: 'i – ♭VII – ♭VI', romans: ['i', 'bVII', 'bVI'] },
            { label: 'i – iv – ♭VI', romans: ['i', 'iv', 'bVI'] }
          ],
          '4-chord': [
            { label: 'i – ♭VII – ♭VI – v', romans: ['i', 'bVII', 'bVI', 'v'] },
            { label: 'i – iv – ♭VII – ♭VI', romans: ['i', 'iv', 'bVII', 'bVI'] }
          ]
        }
      },
      locrian: {
        displayName: 'Locrian',
        colorTone: '♭2, ♭5 (very unstable)',
        progressions: {
          '2-chord': [
            { label: 'iø – ♭II', romans: ['iø', 'bII'] },
            { label: 'iø – v', romans: ['iø', 'v'] }
          ],
          '3-chord': [
            { label: 'iø – ♭II – iø', romans: ['iø', 'bII', 'iø'] },
            { label: 'iø – v – ♭II', romans: ['iø', 'v', 'bII'] }
          ],
          '4-chord': [
            { label: 'iø – ♭II – v – iø', romans: ['iø', 'bII', 'v', 'iø'] }
          ]
        }
      },
      'melodic minor': {
        displayName: 'Melodic Minor (Jazz Minor)',
        colorTone: 'i−maj7',
        progressions: {
          '2-chord': [
            { label: 'i−maj7 – IV7', romans: ['imMaj7', 'IV7'] }
          ],
          '3-chord': [
            { label: 'i−maj7 – IV7 – v', romans: ['imMaj7', 'IV7', 'v'] }
          ],
          '4-chord': [
            { label: 'i−maj7 – ii – IV7 – i−maj7', romans: ['imMaj7', 'ii', 'IV7', 'imMaj7'] }
          ]
        }
      },
      'lydian dominant': {
        displayName: 'Lydian Dominant',
        colorTone: '♯11',
        progressions: {
          '2-chord': [
            { label: 'I7 – II', romans: ['I7', 'II'] }
          ],
          '3-chord': [
            { label: 'I7 – ♭VII – II', romans: ['I7', 'bVII', 'II'] }
          ],
          '4-chord': [
            { label: 'I7 – iiø – ♭VII – I7', romans: ['I7', 'iiø', 'bVII', 'I7'] }
          ]
        }
      },
      altered: {
        displayName: 'Altered (Super-Locrian)',
        colorTone: 'V7alt',
        progressions: {
          '2-chord': [
            { label: 'V7alt → i', romans: ['V7alt', 'i'] },
            { label: 'V7alt → Imaj7', romans: ['V7alt', 'Imaj7'] }
          ],
          '3-chord': [
            { label: 'iiø – V7alt – i', romans: ['iiø', 'V7alt', 'i'] }
          ]
        }
      },
      'harmonic minor': {
        displayName: 'Harmonic Minor',
        colorTone: 'i−maj7',
        progressions: {
          '2-chord': [
            { label: 'i – V', romans: ['i', 'V'] }
          ],
          '3-chord': [
            { label: 'i – iv – V', romans: ['i', 'iv', 'V'] }
          ],
          '4-chord': [
            { label: 'i – iv – V – i', romans: ['i', 'iv', 'V', 'i'] }
          ]
        }
      },
      'phrygian dominant': {
        displayName: 'Phrygian Dominant',
        colorTone: 'Major chord on ♭II + dominant on V',
        progressions: {
          '2-chord': [
            { label: 'i – ♭II', romans: ['i', 'bII'] },
            { label: 'V – i', romans: ['V', 'i'] }
          ],
          '3-chord': [
            { label: 'V – ♭II – i', romans: ['V', 'bII', 'i'] }
          ],
          '4-chord': [
            { label: 'i – ♭II – V – i', romans: ['i', 'bII', 'V', 'i'] }
          ]
        }
      },
      'dorian #4': {
        displayName: 'Ukrainian Dorian (Dorian ♯4)',
        colorTone: 'Dorian ♯4',
        progressions: {
          '2-chord': [
            { label: 'i – IV', romans: ['i', 'IV'] }
          ],
          '3-chord': [
            { label: 'i – ♭VII – IV', romans: ['i', 'bVII', 'IV'] }
          ],
          '4-chord': [
            { label: 'i – iv – ♭VII – IV', romans: ['i', 'iv', 'bVII', 'IV'] }
          ]
        }
      },
      'whole tone': {
        displayName: 'Whole Tone',
        colorTone: 'V7♯5',
        progressions: {
          '2-chord': [
            { label: 'V7♯5 – V7♯5', romans: ['V7#5', 'V7#5'] },
            { label: 'V7♯5 – I', romans: ['V7#5', 'I'] }
          ],
          '3-chord': [
            { label: 'V7♯5 – ♭III+ – V7♯5', romans: ['V7#5', 'bIII+', 'V7#5'] }
          ]
        }
      },
      'half-whole diminished': {
        displayName: 'Half–Whole Diminished',
        colorTone: 'V7♭9♯11♭13',
        progressions: {
          '2-chord': [
            { label: 'V7♭9 – V7♭9', romans: ['V7b9', 'V7b9'] }
          ],
          '3-chord': [
            { label: 'iiø – V7♭9 – i', romans: ['iiø', 'V7b9', 'i'] }
          ]
        }
      },
      'whole-half diminished': {
        displayName: 'Whole–Half Diminished',
        colorTone: '°7',
        progressions: {
          '2-chord': [
            { label: '°7 – °7', romans: ['°7', '°7'] }
          ],
          '3-chord': [
            { label: '°7 – °7 – °7', romans: ['°7', '°7', '°7'] }
          ],
          '4-chord': [
            { label: '°7 – ♭III – vi – °7', romans: ['°7', 'bIII', 'vi', '°7'] }
          ]
        }
      }
    };

    const prettifyScaleLabel = (raw) => {
      if (!raw || typeof raw !== 'string') {
        return '';
      }
      const accidentalFixed = raw
        .replace(/bb(?=\d)/gi, '♭♭')
        .replace(/b(?=\d)/gi, '♭')
        .replace(/#(?=\d)/g, '♯');
      return accidentalFixed
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    };

    const updateScaleNotesDisplay = () => {
      const scaleNotesDisplay = document.getElementById('modal-scale-notes-display');
      if (!scaleNotesDisplay) return;
      
      const selectedKey = modalKeySelect ? (modalKeySelect.value || '').trim() : '';
      const selectedScale = modalScaleSelect ? (modalScaleSelect.value || '').trim() : '';
      
      if (!selectedScale || selectedScale === 'chromatic') {
        scaleNotesDisplay.textContent = '';
        return;
      }
      
      try {
        // Map scale names to Tonal.js scale names (same as in convertNumericPatternToNoteNames)
        const SCALE_NAME_TONAL_MAP = {
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
          ionian: 'major',
          aeolian: 'minor',
          'melodic minor': 'melodic minor',
          'dorian b2': 'dorian b2',
          'lydian augmented': 'lydian augmented',
          'lydian dominant': 'lydian dominant',
          'mixolydian b6': 'mixolydian b6',
          'locrian #2': 'locrian #2',
          altered: 'altered',
          'harmonic minor': 'harmonic minor',
          'locrian #6': 'locrian #6',
          'ionian #5': 'ionian #5',
          'dorian #4': 'dorian #4',
          'phrygian dominant': 'phrygian dominant',
          'lydian #2': 'lydian #2',
          ultralocrian: 'ultralocrian',
          'harmonic major': 'harmonic major',
          'dorian b5': 'dorian b5',
          'phrygian b4': 'phrygian b4',
          'lydian b3': 'lydian b3',
          'mixolydian b2': 'mixolydian b2',
          'lydian augmented #2': 'lydian augmented #2',
          'locrian bb7': 'locrian bb7',
          'major pentatonic': 'major pentatonic',
          'suspended pentatonic': 'suspended pentatonic',
          'man gong': 'man gong',
          ritusen: 'ritusen',
          'minor pentatonic': 'minor pentatonic',
          'blues minor pentatonic': 'minor pentatonic',
          'major pentatonic mode 3': 'major pentatonic',
          egyptian: 'egyptian',
          'whole tone': 'whole tone',
          'half-whole diminished': 'dominant diminished',
          'whole-half diminished': 'diminished',
          'minor blues': 'blues'
        };
        
        const tonalScaleName = SCALE_NAME_TONAL_MAP[selectedScale.toLowerCase()] || selectedScale.toLowerCase();
        
        // Normalize key root
        let rootNote = 'C';
        if (selectedKey) {
          const match = selectedKey.trim().match(/^([a-gA-G])([#b]?)/);
          if (match) {
            rootNote = `${match[1].toUpperCase()}${match[2] || ''}`;
          } else {
            rootNote = selectedKey.trim();
          }
        }
        
        const scaleName = `${rootNote} ${tonalScaleName}`;
        const scaleObj = Scale.get(scaleName);
        
        if (!scaleObj || !scaleObj.notes || scaleObj.notes.length === 0) {
          scaleNotesDisplay.textContent = '';
          return;
        }
        
        // Format as "C = 0, D = 1, E = 2, ..."
        const scaleNotes = scaleObj.notes;
        const noteNumberPairs = scaleNotes.map((note, index) => {
          // Remove octave if present
          const noteName = note.replace(/-?\d+$/, '');
          return `${noteName} = ${index}`;
        });
        
        // Make key and scale bold
        const displayText = `<strong>${rootNote.toLowerCase()}:${tonalScaleName}</strong> ${noteNumberPairs.join(', ')}`;
        scaleNotesDisplay.innerHTML = displayText;
      } catch (error) {
        console.warn('Error displaying scale notes:', error);
        scaleNotesDisplay.textContent = '';
      }
    };

    const updateScaleChordSuggestionsUI = () => {
      if (!scaleChordSuggestionEls.container || !scaleChordSuggestionEls.dropdown) {
        return;
      }
      const selectedKey = modalKeySelect ? (modalKeySelect.value || '').trim() : '';
      const selectedScale = modalScaleSelect ? (modalScaleSelect.value || '').trim() : '';
      
      // Clear dropdown
      scaleChordSuggestionEls.dropdown.innerHTML = '<option value="">Select a progression...</option>';
      
      if (!selectedKey || !selectedScale) {
        scaleChordSuggestionEls.container.style.display = 'none';
        scaleChordSuggestionEls.container.dataset.state = 'idle';
        if (scaleChordSuggestionEls.title) {
          scaleChordSuggestionEls.title.textContent = 'Select a key and scale to view chord progressions.';
        }
        if (scaleChordSuggestionEls.characteristic) {
          scaleChordSuggestionEls.characteristic.textContent = '';
        }
        return;
      }
      
      const normalizedScale = selectedScale.toLowerCase();
      const scaleData = SCALE_CHORD_PROGRESSIONS[normalizedScale];
      const friendlyScaleName = scaleData?.displayName || prettifyScaleLabel(selectedScale);
      
      scaleChordSuggestionEls.container.style.display = 'block';
      
      if (scaleChordSuggestionEls.title) {
        scaleChordSuggestionEls.title.textContent = `${selectedKey} ${friendlyScaleName} Chord Progressions`;
      }
      
      if (!scaleData || !scaleData.progressions) {
        scaleChordSuggestionEls.container.dataset.state = 'placeholder';
        if (scaleChordSuggestionEls.characteristic) {
          scaleChordSuggestionEls.characteristic.textContent = 'No chord progressions available for this scale yet.';
        }
        return;
      }
      
      scaleChordSuggestionEls.container.dataset.state = 'ready';
      
      if (scaleChordSuggestionEls.characteristic) {
        scaleChordSuggestionEls.characteristic.textContent = `Color tone: ${scaleData.colorTone || 'N/A'}`;
      }
      
      // Populate dropdown with progressions
      const progressionTypes = ['2-chord', '3-chord', '4-chord'];
      progressionTypes.forEach((type) => {
        const progressions = scaleData.progressions[type];
        if (progressions && progressions.length > 0) {
          const optgroup = document.createElement('optgroup');
          optgroup.label = type.charAt(0).toUpperCase() + type.slice(1).replace('-', ' ');
          
          progressions.forEach((prog) => {
            const option = document.createElement('option');
            const chordNames = romanToChords(selectedKey, prog.romans);
            const displayText = chordNames.length > 0 
              ? `${prog.label} (${chordNames.join(' – ')})`
              : prog.label;
            option.value = JSON.stringify({ romans: prog.romans, label: prog.label });
            option.textContent = displayText;
            optgroup.appendChild(option);
          });
          
          scaleChordSuggestionEls.dropdown.appendChild(optgroup);
        }
      });
    };

    updateScaleChordSuggestionsUI();
    updateScaleNotesDisplay();
    
    // Add event listener for chord progression dropdown
    if (scaleChordSuggestionEls.dropdown) {
      scaleChordSuggestionEls.dropdown.addEventListener('change', (e) => {
        const selectedValue = e.target.value;
        if (!selectedValue || selectedValue === '') {
          return;
        }
        
        try {
          const progressionData = JSON.parse(selectedValue);
          const selectedKey = modalKeySelect ? (modalKeySelect.value || '').trim() : '';
          
          if (!selectedKey) {
            console.warn('No key selected for chord progression');
            return;
          }
          
          // Get chord names from Roman numerals
          const chordNames = romanToChords(selectedKey, progressionData.romans);
          
          if (chordNames.length > 0) {
            // Get current pattern from editor
            const currentPattern = getStrudelEditorValue('modal-pattern') || '';
            
            // Remove the entire n(...).scale(...) pattern and any chained modifiers after it
            let cleanedPattern = currentPattern;
            // Match n(...).scale(...) followed by any chained modifiers (like .s(...), .gain(...), etc.)
            // This regex matches the entire chain: n(...).scale(...).modifier1(...).modifier2(...) etc.
            cleanedPattern = cleanedPattern.replace(/\bn\s*\([^)]*\)\s*\.\s*scale\s*\([^)]*\)(?:\s*\.\s*[a-zA-Z]+\s*\([^)]*\))*/gi, '');
            // Also handle quoted versions
            cleanedPattern = cleanedPattern.replace(/\bn\s*\(["'][^"']*["']\)\s*\.\s*scale\s*\(["'][^"']*["']\)(?:\s*\.\s*[a-zA-Z]+\s*\([^)]*\))*/gi, '');
            // Clean up any leading dots, whitespace, and trailing dots
            cleanedPattern = cleanedPattern.replace(/^\s*\.\s*/, '').replace(/\s*\.\s*$/, '').trim();
            
            // Join chord names with spaces and wrap in angle brackets
            const chordString = chordNames.join(' ');
            // Build pattern: n().chord("<selected chords>").voicing() - no other modifiers
            const patternToInsert = `n().chord("<${chordString}>").voicing()`;
            
            // Replace the entire pattern with just the chord pattern
            setStrudelEditorValue('modal-pattern', patternToInsert);
          }
        } catch (error) {
          console.warn('Error parsing chord progression data:', error);
        }
      });
    }
    
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
    
    // Simple helper to ONLY update .bank() or .s() modifier without touching anything else
    const updateBankOrSoundModifier = (pattern, bankOrSound, isDrumBank = false) => {
      if (!pattern || !pattern.trim()) {
        return pattern; // Don't modify empty patterns
      }
      
      let updated = pattern.trim();
      
      if (isDrumBank) {
        // For drum banks: update/replace .bank() modifier only
        const bankRegex = /\.\s*bank\s*\(\s*["'][^"']*["']\s*\)/gi;
        if (bankRegex.test(updated)) {
          // Replace existing .bank() modifier
          updated = updated.replace(bankRegex, `.bank("${bankOrSound}")`);
        } else {
          // Add .bank() modifier at the end (before any closing parens if pattern is wrapped)
          // Find the last method call or end of pattern
          updated = `${updated}.bank("${bankOrSound}")`;
        }
      } else {
        // For synth sounds: update/replace .s() modifier only
        const soundRegex = /\.\s*(s|sound)\s*\(\s*["'][^"']*["']\s*\)/gi;
        if (soundRegex.test(updated)) {
          // Replace existing .s() or .sound() modifier
          updated = updated.replace(soundRegex, `.s("${bankOrSound}")`);
        } else {
          // Add .s() modifier at the end
          updated = `${updated}.s("${bankOrSound}")`;
        }
      }
      
      return updated;
    };
    
    const normalizeEditorPattern = (value) => {
      if (!value || !value.trim()) {
        return '';
      }
      const trimmed = value.trim();
      const strudelPatternRegex = /(\.\s*(bank|s|sound)\s*\()|(\b(note|n|stack|sound)\s*\()/i;
      if (strudelPatternRegex.test(trimmed)) {
        return trimmed;
      }
      const converted = drumDisplayToPattern(trimmed);
      return converted ? converted.trim() : '';
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
      updateScaleChordSuggestionsUI();
      updateScaleNotesDisplay();
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

      if (hasExplicitNotes && !isNumericPattern) {
        console.log('ℹ️ Pattern uses explicit note names – skipping key/scale rewrite');
        return;
      }
      
      if (hasNoteFunction && containsNumericNotePattern(patternValue) && !hasExplicitNotes && !hasChordModifier) {
        const scaleModifier = buildScaleModifier(keyToPass, scaleToPass);
        if (!scaleModifier) {
          console.log('ℹ️ Numeric pattern: no scale selected, skipping rewrite');
          return;
        }
        // Remove any existing .scale() modifier first (handle both quoted and unquoted)
        let upserted = patternValue.replace(/\.\s*scale\s*\((['"])(?:(?=(\\?))\2.)*?\1\)/gi, '');
        upserted = upserted.replace(/\.\s*scale\s*\([^)]*\)/gi, '');
        // Clean up any double dots or trailing dots
        upserted = upserted.replace(/\.+/g, '.').replace(/\.\s*\./g, '.').trim();
        upserted = upserted.replace(/\.+$/, '').trim();
        // Now insert the new scale modifier
        upserted = insertScaleModifier(upserted, scaleModifier);
        setStrudelEditorValue('modal-pattern', upserted);
        syncLastSemitonePattern(upserted, true);
        console.log(`ℹ️ Numeric pattern updated with scale modifier ${scaleModifier}`);
        return;
      }

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
            const cleanedPattern = (normalizedPattern || patternValue).replace(/\.\s*scale\s*\([^)]*\)/gi, '');
            const upserted = insertScaleModifier(cleanedPattern, buildScaleModifier(keyToPass, scaleToPass));
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
        updateScaleNotesDisplay(); // Update display immediately
        applyKeyScaleToPattern(false);
      });
      modalKeySelect.dataset.listenerAttached = 'true';
    }
    
    if (modalScaleSelect && !modalScaleSelect.dataset.listenerAttached) {
      modalScaleSelect.addEventListener('change', () => {
        updateScaleNotesDisplay(); // Update display immediately
        // Respect the Semitones/Note names toggle (do not force note names)
        applyKeyScaleToPattern(false);
      });
      modalScaleSelect.dataset.listenerAttached = 'true';
    }
    
    // Initial display update
    updateScaleNotesDisplay();
    
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
    let lastNoteToNumericSnapshot = null;
    let lastNoteToNumericConverted = null;

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

    const getFirstNoteNameFromPattern = (pattern) => {
      if (!pattern || typeof pattern !== 'string') return null;
      const match = pattern.match(/\bnote\s*\(\s*["']([^"']+)["']/i);
      if (!match || !match[1]) return null;
      const content = match[1];
      const tokenMatch = content.match(/([a-gA-G])([#b]?)/);
      if (!tokenMatch) return null;
      const letter = tokenMatch[1].toUpperCase();
      const accidental = tokenMatch[2] ? tokenMatch[2] : '';
      return `${letter}${accidental}`;
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
            const firstNote = getFirstNoteNameFromPattern(pattern);
            if (firstNote) {
              keyValue = firstNote;
              scaleValue = 'chromatic';
            } else {
              const modalKeySelect = document.getElementById('modal-key-select');
              const modalScaleSelect = document.getElementById('modal-scale-select');
              keyValue = modalKeySelect ? (modalKeySelect.value || 'C') : 'C';
              scaleValue = modalScaleSelect ? (modalScaleSelect.value || 'chromatic') : 'chromatic';
            }
          }
          let converted = soundManager.convertNoteNamesToScaleDegrees(pattern, keyValue || 'C', scaleValue || 'chromatic');
          if (converted && converted !== pattern) {
            const inferredScale = buildScaleModifier(keyValue || 'C', scaleValue || 'chromatic');
            if (inferredScale) {
              converted = insertScaleModifier(converted, inferredScale);
            }
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
        if (useNoteNames && lastNoteToNumericSnapshot && lastNoteToNumericConverted && patternValue === lastNoteToNumericConverted) {
          convertedPattern = lastNoteToNumericSnapshot;
          console.log('🔁 Restoring original note-name pattern from snapshot');
        } else if (!useNoteNames && lastNoteNamesSnapshot && patternValue === lastNoteNamesSnapshot && lastCanonicalNumericPattern) {
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
            lastNoteToNumericSnapshot = null;
            lastNoteToNumericConverted = null;
          } else {
            lastNoteNamesSnapshot = null;
            semitoneSnapshotLocked = false;
            if (patternValue && containsNoteCall(patternValue)) {
              lastNoteToNumericSnapshot = patternValue;
              lastNoteToNumericConverted = convertedPattern;
            } else {
              lastNoteToNumericSnapshot = null;
              lastNoteToNumericConverted = null;
            }
            syncLastSemitonePattern(convertedPattern, true);
          }
          console.log(`🔄 Converted pattern ${useNoteNames ? 'to note names' : 'to semitones'}: ${convertedPattern.substring(0, 100)}...`);
        } else if (!useNoteNames) {
          lastNoteNamesSnapshot = null;
          semitoneSnapshotLocked = false;
          lastNoteToNumericSnapshot = null;
          lastNoteToNumericConverted = null;
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

    const escapeRegexValue = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const stripMasterInjectedModifiers = (pattern, trackData) => {
      if (!pattern || !trackData) {
        return pattern;
      }
      let result = pattern.trim();

      const removeModifier = (text, name, valueStr) => {
        if (!valueStr) {
          return text;
        }
        const modifierRegex = new RegExp(`\\s*\\.\\s*${name}\\s*\\(\\s*${escapeRegexValue(valueStr)}\\s*\\)\\s*$`, 'i');
        let updated = text;
        while (modifierRegex.test(updated)) {
          updated = updated.replace(modifierRegex, '').trim();
        }
        return updated;
      };

      if (typeof trackData.gain === 'number' && Math.abs(trackData.gain - 1) > 1e-6) {
        result = removeModifier(result, 'gain', trackData.gain.toFixed(2));
      }

      if (typeof trackData.pan === 'number' && Math.abs(trackData.pan) > 1e-6) {
        result = removeModifier(result, 'pan', trackData.pan.toFixed(2));
      }

      const unwrapBalancedParens = (text) => {
        let unwrapped = text;
        while (unwrapped.startsWith('(') && unwrapped.endsWith(')')) {
          let depth = 0;
          let balanced = true;
          for (let i = 0; i < unwrapped.length; i++) {
            const ch = unwrapped[i];
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
            if (depth === 0 && i < unwrapped.length - 1) {
              balanced = false;
              break;
            }
          }
          if (balanced && depth === 0) {
            unwrapped = unwrapped.slice(1, -1).trim();
      } else {
            break;
          }
        }
        return unwrapped;
      };

      result = unwrapBalancedParens(result.trim());
      return result;
    };
    
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

          const channelBlock = match[0]?.trim() || patternBody;
          
          const elementId = `element-${channelNumber}`;
          const existingTrackData = soundManager.trackedPatterns?.get(elementId);
          const strippedPatternBody = stripMasterInjectedModifiers(patternBody, existingTrackData);
          const normalizedChannelPattern = strippedPatternBody || patternBody;
          
          const existingConfig = this.loadElementConfig(elementId) || {};
          const newConfig = {
            ...existingConfig,
            pattern: normalizedChannelPattern
          };
          
          this.saveElementConfig(elementId, newConfig, true);
          
          if (soundManager.trackedPatterns) {
            const gain = existingTrackData?.gain ??
              (typeof soundManager.getElementGain === 'function'
                ? soundManager.getElementGain(elementId)
                : 0.8);
            const pan = existingTrackData?.pan ??
              (typeof soundManager.getElementPan === 'function'
                ? soundManager.getElementPan(elementId)
                : 0);
            const muted = existingTrackData?.muted ?? false;
            const soloed = existingTrackData?.soloed ?? false;
            
            soundManager.trackedPatterns.set(elementId, {
              rawPattern: channelBlock,
              pattern: normalizedChannelPattern,
              gain,
              pan,
              muted,
              soloed
            });
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
        const rawSelectionValue = e.target.value;
        const parsedSelection = parseBankSelectionValue(rawSelectionValue);
        const bankValue = parsedSelection.bankValue;
        console.log('📦 Bank select changed to:', rawSelectionValue);
        // Don't rebuild options on change - they're already there, just preserve selection
        if (bankSelect.value !== rawSelectionValue) {
          bankSelect.value = rawSelectionValue;
        }
        const elementId = this.currentEditingElementId;
        const saveConfigWithSelection = (overrides = {}, skipMasterSave = true) => {
          if (!elementId) return;
          const currentConfig = this.loadElementConfig(elementId) || {};
          const updatedConfig = {
            ...currentConfig,
            ...overrides
          };
          if (parsedSelection.isVcslInstrument) {
            updatedConfig.vcslInstrument = parsedSelection.vcslInstrument;
          } else if ('vcslInstrument' in updatedConfig) {
            delete updatedConfig.vcslInstrument;
          }
          this.saveElementConfig(elementId, updatedConfig, skipMasterSave);
        };
        
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
          
          // Set selected tag to 'bank' to show suggestions
          this.selectedTagKey = 'bank';
          // Refresh snippet buttons to show suggestions
          if (typeof this.refreshSnippetButtons === 'function') {
            setTimeout(() => {
              this.refreshSnippetButtons().catch(err => console.warn('⚠️ Unable to refresh snippet tags:', err));
            }, 100);
          }
        } else {
          // Hide Key/Scale if no bank selected or toggle state requires it
          updateKeyScaleVisibility();
          
          // Clear selected tag when no bank is selected
          this.selectedTagKey = null;
          // Refresh snippet buttons to hide suggestions
          if (typeof this.refreshSnippetButtons === 'function') {
            setTimeout(() => {
              this.refreshSnippetButtons().catch(err => console.warn('⚠️ Unable to refresh snippet tags:', err));
            }, 100);
          }
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
        const sampleNameGroup = document.getElementById('modal-sample-name-group');
        const hasBankSelected = bankValue && bankValue !== '';
        if (sampleUrlGroup) {
          sampleUrlGroup.style.display = hasBankSelected ? 'none' : 'block';
        }
        if (sampleFileGroup) {
          sampleFileGroup.style.display = hasBankSelected ? 'none' : 'block';
        }
        if (sampleNameGroup) {
          sampleNameGroup.style.display = hasBankSelected ? 'none' : 'block';
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
          
          const modalElementId = document.getElementById('modal-element-id');
          if (modalElementId) {
            modalElementId.textContent = getChannelDisplayLabel(elementId);
          }
          
          updateElementTitleDisplay(elementId, 'Default');
          
          // Save title immediately when Default is selected
          saveConfigWithSelection({
            title: 'Default',
            bank: undefined
          }, false);
          console.log(`📝 Saved title "Default" for ${elementId}`);
          
          // Remove any existing .bank() modifier ONLY, preserve everything else
          let currentPattern = getStrudelEditorValue('modal-pattern').trim();
          // Convert display to Strudel format for processing
          let strudelPattern = normalizeEditorPattern(currentPattern);
          
          if (strudelPattern && strudelPattern.trim() !== '') {
            // Remove only .bank() modifier, preserve everything else
            strudelPattern = strudelPattern.replace(/\.\s*bank\s*\(\s*["'][^"']*["']\s*\)/gi, '');
            // Clean up any double dots
            strudelPattern = strudelPattern.replace(/\.+/g, '.').replace(/\.\s*\./g, '.').trim();
            strudelPattern = strudelPattern.replace(/\.+$/, '').trim();
            // Keep in Strudel format (don't convert to drum display)
            setStrudelEditorValue('modal-pattern', strudelPattern);
            patternTextarea.placeholder = '';
            console.log(`📝 Removed .bank() modifier only, preserving pattern: ${strudelPattern.substring(0, 80)}...`);
          } else {
            // If no pattern, don't modify it
            patternTextarea.placeholder = '';
          }
        } else {
          const appendSegment = (pattern, segment) => {
            if (!pattern || pattern.trim() === '') {
              return segment;
            }
            let updated = pattern.trim();
            if (!updated.endsWith('.') && !segment.startsWith('.')) {
              updated += '.';
            }
            updated += segment;
            return updated.replace(/\.\.+/g, '.').replace(/\.\s+\./g, '.').trim();
          };

          if (parsedSelection.isVcslInstrument) {
            const instrumentName = parsedSelection.vcslInstrument;
            const instrumentLabel = formatVcslInstrumentLabel(instrumentName);
            const titleInput = document.getElementById('modal-title');
            if (statusText) {
              statusText.textContent = `🎙️ VCSL Instrument: ${instrumentLabel}`;
            }
            if (titleInput) {
              titleInput.value = instrumentLabel;
            }
            const modalElementId = document.getElementById('modal-element-id');
            if (modalElementId) {
              modalElementId.textContent = getChannelDisplayLabel(elementId);
            }
            updateElementTitleDisplay(elementId, instrumentLabel);
            saveConfigWithSelection({
              title: instrumentLabel,
              bank: 'vcsl'
            }, true);
            
            let currentPattern = getStrudelEditorValue('modal-pattern').trim();
            let strudelPattern = normalizeEditorPattern(currentPattern);
            const soundRegex = /sound\s*\(\s*["'][^"']*["']\s*\)/i;
            const normalizedPattern = strudelPattern && strudelPattern.trim() !== '' ? strudelPattern : '';
            if (normalizedPattern) {
              if (soundRegex.test(normalizedPattern)) {
                strudelPattern = normalizedPattern.replace(soundRegex, `sound("${instrumentName}")`);
              } else if (normalizedPattern.includes('.s(')) {
                strudelPattern = normalizedPattern.replace(/\.s\s*\(\s*["'][^"']*["']\s*\)/i, `.sound("${instrumentName}")`);
              } else {
                strudelPattern = appendSegment(normalizedPattern, `sound("${instrumentName}")`);
              }
            } else {
              strudelPattern = `sound("${instrumentName}")`;
            }
            strudelPattern = updateBankOrSoundModifier(strudelPattern, 'vcsl', true);
            setStrudelEditorValue('modal-pattern', strudelPattern);
            patternTextarea.placeholder = '';
            setTimeout(() => {
              updateNoteConversionCheckboxVisibility();
            }, 50);
            return;
          }
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
              modalElementId.textContent = getChannelDisplayLabel(elementId);
            }
            
            updateElementTitleDisplay(elementId, displayName);
            
            // Save title immediately when synth is selected
            saveConfigWithSelection({
              title: displayName,
              bank: bankValue
            });
            console.log(`📝 Saved title "${displayName}" for ${elementId}`);
            
            // Update pattern to use synth waveform - add/replace .s() modifier
            let currentPattern = getStrudelEditorValue('modal-pattern').trim();
            // Convert display to Strudel format for processing
            let strudelPattern = normalizeEditorPattern(currentPattern);
            
            // Always add/replace the .s() modifier, even if pattern is empty (create minimal pattern)
            if (strudelPattern && strudelPattern.trim() !== '') {
              // Pattern exists - update it
              console.log(`🎹 BANK CHANGE: Updating .s() modifier only, preserving pattern: ${strudelPattern.substring(0, 80)}...`);
              strudelPattern = updateBankOrSoundModifier(strudelPattern, canonicalBankValue, false);
              console.log(`🎹 BANK CHANGE: Updated pattern: ${strudelPattern.substring(0, 80)}...`);
            } else {
              // No pattern - create minimal pattern with .s()
              strudelPattern = `note("c3").s("${canonicalBankValue}")`;
              console.log(`🎹 BANK CHANGE: Created minimal pattern with .s("${canonicalBankValue}")`);
            }
            setStrudelEditorValue('modal-pattern', strudelPattern);
            patternTextarea.placeholder = '';
            
            // Set toggle switch to "note names" mode for synths/waveforms
            const keepNotesCheckbox = document.getElementById('modal-keep-notes-as-written');
            if (keepNotesCheckbox) {
              keepNotesCheckbox.checked = true;
              console.log(`🎹 Set note names toggle to ON for synth/waveform`);
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
              'AkaiLinn', 'ViscoSpaceDrum', 'CasioRZ1'
            ];
            const builtInSynthSounds = [
              ...OSCILLATOR_SYNTHS,
              ...SAMPLE_SYNTHS,
              'insect', 'wind', 'east', 'crow', 'space', 'numbers',
              'superpiano', 'jazz'
            ];
            const lowerBankValue = bankValue?.toLowerCase() || '';
            const isSpecialSampleBank = SPECIAL_SAMPLE_BANK_VALUES.has(lowerBankValue);
            const isBuiltInBank = builtInDrumBanks.includes(bankValue) || builtInSynthSounds.includes(lowerBankValue);
            
            let bankLoaded = false;
            // Built-in banks are embedded and work directly - just mark as loaded
            // Non-built-in banks need to be loaded via loadBank()
            if (isSpecialSampleBank) {
              try {
                bankLoaded = await soundManager.loadBank(lowerBankValue);
                if (bankLoaded) {
                  console.log(`✅ Specialty sample bank loaded: ${lowerBankValue}`);
                  if (statusText) {
                    statusText.textContent = `✅ Bank loaded: ${lowerBankValue}`;
                  }
                } else {
                  console.log(`⚠️ Specialty sample bank "${lowerBankValue}" may not be fully loaded`);
                  if (statusText) {
                    statusText.textContent = `⚠️ Bank "${lowerBankValue}" may not be available`;
                  }
                }
              } catch (error) {
                console.error(`Error loading specialty bank ${lowerBankValue}:`, error);
                bankLoaded = false;
                if (statusText) {
                  statusText.textContent = `⚠️ Error loading bank: ${lowerBankValue}`;
                }
              }
            } else if (isBuiltInBank) {
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
              const specialtyMatch = SPECIAL_SAMPLE_BANKS.find(sampleBank => sampleBank.value === lowerBankValue);
              if (bankValue.startsWith('github:')) {
                bankDisplayName = bankValue.replace('github:tidalcycles/', '');
              } else if (DRUM_BANK_VALUES.has(bankValue)) {
                // Use proper display name for drum banks
                bankDisplayName = getDrumBankDisplayName(bankValue);
              } else if (specialtyMatch) {
                bankDisplayName = specialtyMatch.label;
              } else {
                bankDisplayName = bankValue;
              }
              
              // Always update title when bank is selected
              titleInput.value = bankDisplayName;
              
              const modalElementId = document.getElementById('modal-element-id');
              if (modalElementId) {
                modalElementId.textContent = getChannelDisplayLabel(elementId);
              }
              
              updateElementTitleDisplay(elementId, bankDisplayName);
              
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
              console.log(`📝 Bank change: currentPattern="${currentPattern.substring(0, 100)}..."`);
              let strudelPattern = normalizeEditorPattern(currentPattern);
              console.log(`📝 Bank change: normalizedPattern="${strudelPattern.substring(0, 100)}..."`);
              
              // Determine if this is a drum bank or synth/waveform
              const isDrumBank = DRUM_BANK_VALUES.has(bankValue);
              const isSynthOrWaveform = OSCILLATOR_SYNTHS.includes(lowerBankValue) || 
                                        SAMPLE_SYNTHS.includes(lowerBankValue) ||
                                        ['sawtooth', 'square', 'triangle', 'sine'].includes(lowerBankValue);
              
              console.log(`📝 Bank change: isDrumBank=${isDrumBank}, isSynthOrWaveform=${isSynthOrWaveform}, isSpecialSampleBank=${isSpecialSampleBank}, bankValue="${bankValue}"`);
              
              // Always add/replace the modifier, even if pattern is empty (create minimal pattern)
              if (isDrumBank || isSpecialSampleBank) {
                const appliedBankValue = isSpecialSampleBank ? lowerBankValue : bankValue;
                // For drum banks: add/replace .bank() modifier
                if (strudelPattern && strudelPattern.trim() !== '') {
                  // Pattern exists - update it
                  const beforeUpdate = strudelPattern;
                  strudelPattern = updateBankOrSoundModifier(strudelPattern, appliedBankValue, true);
                  console.log(`📝 Updated .bank("${appliedBankValue}") modifier`);
                  console.log(`   Before: ${beforeUpdate.substring(0, 80)}...`);
                  console.log(`   After: ${strudelPattern.substring(0, 80)}...`);
                  } else {
                  // No pattern - create minimal pattern with .bank()
                  if (isSpecialSampleBank) {
                    const defaultWorldPattern = appliedBankValue === 'mridangam'
                      ? 'sound("tha dhi thom nam")'
                      : 'sound("ahh ~ ohh")';
                    strudelPattern = `${defaultWorldPattern}.bank("${appliedBankValue}")`;
                  } else {
                    strudelPattern = `s("bd").bank("${appliedBankValue}")`;
                  }
                  console.log(`📝 Created minimal pattern with .bank("${appliedBankValue}")`);
                }
                  setStrudelEditorValue('modal-pattern', strudelPattern);
                  patternTextarea.placeholder = '';
              } else if (isSynthOrWaveform) {
                // For synths/waveforms: add/replace .s() modifier
                const canonicalBankValue = normalizeSynthBankName(bankValue);
                if (strudelPattern && strudelPattern.trim() !== '') {
                  // Pattern exists - update it
                  const beforeUpdate = strudelPattern;
                  strudelPattern = updateBankOrSoundModifier(strudelPattern, canonicalBankValue, false);
                  console.log(`📝 Updated .s("${canonicalBankValue}") modifier`);
                  console.log(`   Before: ${beforeUpdate.substring(0, 80)}...`);
                  console.log(`   After: ${strudelPattern.substring(0, 80)}...`);
                } else {
                  // No pattern - create minimal pattern with .s()
                  strudelPattern = `note("c3").s("${canonicalBankValue}")`;
                  console.log(`📝 Created minimal pattern with .s("${canonicalBankValue}")`);
                }
                  setStrudelEditorValue('modal-pattern', strudelPattern);
                  patternTextarea.placeholder = '';
                
                // Set toggle switch to "note names" mode for synths/waveforms
                const keepNotesCheckbox = document.getElementById('modal-keep-notes-as-written');
                if (keepNotesCheckbox) {
                  keepNotesCheckbox.checked = true;
                  console.log(`📝 Set note names toggle to ON for synth/waveform`);
                }
                } else {
                // Not a drum bank or synth - just show placeholder
                patternTextarea.placeholder = 'Add a pattern, e.g., sound("bd").bank("CustomBank")';
              }
              
              console.log(`📝 Final pattern in editor: ${getStrudelEditorValue('modal-pattern').substring(0, 100)}...`);
              
              // Update checkbox visibility after pattern update
              setTimeout(() => {
                updateNoteConversionCheckboxVisibility();
              }, 50);
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
          finalPattern = normalizeEditorPattern(displayPattern);
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

        // When switching to a drum bank, only show drum grid if user already opted into it (e.g., via presets)
        const isDrum = bankValue && DRUM_BANK_VALUES.has(bankValue);
        console.log('📦 Bank change: isDrum=', isDrum, 'bankValue=', bankValue);
        if (isDrum) {
          console.log('📦 Drum bank selected – preserving current editor mode');
          if (!drumGridState.patternEditorEnabled) {
            // User is already in step mode (e.g., from a preset/demo) – rebuild grid
          drumGridState.built = false;
          setTimeout(() => {
            refreshDrumGridForCurrentState();
          }, 0);
          } else {
            // Stay in code editor and just refresh UI state
            refreshDrumGridForCurrentState();
          }
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
          pattern = normalizeEditorPattern(displayPattern);
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
        
        // Remove master-injected modifiers (postgain, pan, fast, slow, cpm) before saving
        // These are added dynamically during playback but shouldn't be persisted
        if (pattern) {
          let cleanedPattern = pattern;
          // Remove ALL instances of postgain() - loop until no more are found to handle nested/duplicated cases
          let previousPattern = '';
          while (previousPattern !== cleanedPattern) {
            previousPattern = cleanedPattern;
            cleanedPattern = cleanedPattern.replace(/\.postgain\s*\([^)]*\)/gi, '');
          }
          cleanedPattern = cleanedPattern.replace(/\.pan\s*\([^)]*\)/gi, '');
          cleanedPattern = cleanedPattern.replace(/\.fast\s*\([^)]*\)/gi, '');
          cleanedPattern = cleanedPattern.replace(/\.slow\s*\([^)]*\)/gi, '');
          cleanedPattern = cleanedPattern.replace(/\.cpm\s*\([^)]*\)/gi, '');
          // Clean up any double dots, trailing dots, or extra whitespace that might result
          cleanedPattern = cleanedPattern.replace(/\.\.+/g, '.').trim();
          cleanedPattern = cleanedPattern.replace(/\.+$/, '').trim();
          cleanedPattern = cleanedPattern.replace(/\s+\./g, '.');
          pattern = cleanedPattern;
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
        
        <div class="element-action-buttons">
        <button class="config-button">Configure Sound</button>
          <div class="history-button-row">
            <button class="history-button" type="button" data-history-target="channel">Load</button>
            <button class="history-button history-button--primary" type="button" data-history-save="channel">Save</button>
          </div>
        </div>
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
      
      updateElementTitleDisplay(newElementId, '');
      
      // Initialize visualizations (this may update button text if pattern exists)
      this.initializeElementVisualizations(newElement, newElementId);
      
      // Ensure config button shows "Configure Sound" if no pattern is saved
      if (configBtn) {
        const saved = this.loadElementConfig(newElementId);
        if (!saved || !saved.pattern || saved.pattern.trim() === '') {
          configBtn.textContent = 'Configure Sound';
        }
      }
      
      // Update load/save button visibility based on login state
      const historyButtonRow = newElement.querySelector('.history-button-row');
      if (historyButtonRow) {
        historyButtonRow.style.display = currentUser ? '' : 'none';
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

// User authentication and menu management
let currentUser = null;
let loginModal = null;
let userProfile = null;
let userProfilesListing = null;
let savePatternDialog = null;
let profileOnboardingModal = null;
let adminUserManager = null;

async function initUserAuth() {
  loginModal = new LoginModal();
  loginModal.init();
  loginModal.setOnLoginSuccess((user) => {
    handleAuthenticatedUser(user);
  });

  // Check if user is already logged in
  try {
    const user = await getCurrentUser();
    if (user) {
      handleAuthenticatedUser(user);
    } else {
      showLoginButton();
    }
  profileOnboardingModal = new ProfileOnboardingModal();
  profileOnboardingModal.init();
  profileOnboardingModal.setOnComplete((updatedUser) => {
    // Ensure overflow is restored when onboarding completes
    document.body.style.overflow = '';
    handleAuthenticatedUser(updatedUser);
  });

  adminUserManager = new AdminUserManager();
  adminUserManager.init();

  } catch (error) {
    showLoginButton();
  }

  // Setup login button
  const loginBtn = document.getElementById('header-login-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      if (loginModal) {
        loginModal.show();
      }
    });
  }

  // Setup user menu
  const userMenuButton = document.getElementById('user-menu-button');
  const userMenuDropdown = document.getElementById('user-menu-dropdown');
  if (userMenuButton && userMenuDropdown) {
    userMenuButton.addEventListener('click', (e) => {
      e.stopPropagation();
      userMenuDropdown.classList.toggle('active');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!userMenuButton.contains(e.target) && !userMenuDropdown.contains(e.target)) {
        userMenuDropdown.classList.remove('active');
      }
    });
  }

  // Setup logout
  const logoutBtn = document.getElementById('user-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await authAPI.logout();
        currentUser = null;
        showLoginButton();
        userMenuDropdown?.classList.remove('active');
      } catch (error) {
        console.error('Logout error:', error);
      }
    });
  }

  // Setup profile link
  const profileLink = document.getElementById('user-profile-link');
  if (profileLink) {
    profileLink.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!currentUser) {
        alert('Please log in to view your profile.');
        if (loginModal) {
          loginModal.show();
        } else {
          showLoginButton();
        }
        userMenuDropdown?.classList.remove('active');
        return;
      }
      if (userProfile) {
        await userProfile.show(currentUser);
      }
      userMenuDropdown?.classList.remove('active');
    });
  }

  // Initialize user profile
  userProfile = new UserProfile();
  userProfile.init();
  userProfile.setOnUpdate((updatedUser) => {
    handleAuthenticatedUser(updatedUser);
  });

  // Initialize user profiles listing
  userProfilesListing = new UserProfilesListing();
  userProfilesListing.init();

  // Setup profiles link
  const profilesLink = document.getElementById('user-profiles-link');
  if (profilesLink) {
    profilesLink.addEventListener('click', async (e) => {
      e.preventDefault();
      if (userProfilesListing) {
        await userProfilesListing.show();
      }
      userMenuDropdown?.classList.remove('active');
    });
  }

  const adminLink = document.getElementById('user-admin-link');
  if (adminLink) {
    adminLink.addEventListener('click', async (e) => {
      e.preventDefault();
      if (adminUserManager) {
        await adminUserManager.show();
      }
      userMenuDropdown?.classList.remove('active');
    });
  }

  // Initialize save pattern dialog
  savePatternDialog = new SavePatternDialog();
  savePatternDialog.init();
  window.savePatternDialog = savePatternDialog; // Make globally accessible
}

function updateLoadSaveButtonsVisibility(isLoggedIn) {
  // Hide/show master load/save buttons
  const loadMasterBtn = document.getElementById('load-master-history-btn');
  const saveMasterBtn = document.getElementById('save-master-history-btn');
  
  if (loadMasterBtn) loadMasterBtn.style.display = isLoggedIn ? '' : 'none';
  if (saveMasterBtn) saveMasterBtn.style.display = isLoggedIn ? '' : 'none';
  
  // Hide/show element load/save buttons
  const historyButtonRows = document.querySelectorAll('.sound-element .history-button-row');
  historyButtonRows.forEach(row => {
    row.style.display = isLoggedIn ? '' : 'none';
  });
}

function updateUserUI(user) {
  const loginBtn = document.getElementById('header-login-btn');
  const userMenu = document.getElementById('user-menu');
  const userName = document.getElementById('user-name');
  const userAvatar = document.getElementById('user-avatar');
  const adminLink = document.getElementById('user-admin-link');

  if (loginBtn) loginBtn.style.display = 'none';
  if (userMenu) userMenu.style.display = 'block';
  if (userName) userName.textContent = user.name || user.email;
  if (userAvatar && user.avatarUrl) {
    userAvatar.src = user.avatarUrl;
    userAvatar.style.display = 'block';
  } else if (userAvatar) {
    userAvatar.style.display = 'none';
  }
  if (adminLink) {
    adminLink.style.display = user.role === 'admin' ? 'block' : 'none';
  }
  
  // Show load/save buttons when logged in
  updateLoadSaveButtonsVisibility(true);
}

function showLoginButton() {
  const loginBtn = document.getElementById('header-login-btn');
  const userMenu = document.getElementById('user-menu');
  const adminLink = document.getElementById('user-admin-link');
  if (loginBtn) loginBtn.style.display = 'block';
  if (userMenu) userMenu.style.display = 'none';
  if (adminLink) adminLink.style.display = 'none';
  
  // Hide load/save buttons when not logged in
  updateLoadSaveButtonsVisibility(false);
}

function handleAuthenticatedUser(user) {
  if (!user) return;
  currentUser = user;
  updateUserUI(user);
  if (!user.profileCompleted && profileOnboardingModal) {
    profileOnboardingModal.show(user);
  } else {
    // Ensure scrolling is restored if profile onboarding doesn't show
    // This fixes the case where login modal hides but overflow wasn't restored
    document.body.style.overflow = '';
  }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const app = new InteractiveSoundApp();
    app.init();
    initializePatternHistoryUI();
    initUserAuth();
  });
} else {
  const app = new InteractiveSoundApp();
  app.init();
  initializePatternHistoryUI();
  initUserAuth();
}

