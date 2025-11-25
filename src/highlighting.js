import { highlightMiniLocations, updateMiniLocations } from '@strudel/codemirror/highlight.mjs';
import { Drawer } from '@strudel/draw';
import { getStrudelEditor } from './strudelReplEditor.js';

let transpilerPromise;
const pendingRefreshTimers = new Map();
const lastAppliedCode = new Map();

async function getTranspiler() {
  if (!transpilerPromise) {
    transpilerPromise = import('@strudel/transpiler')
      .then((module) => module?.transpiler)
      .catch((err) => {
        console.warn('⚠️ Unable to load Strudel transpiler for highlighting:', err);
        return null;
      });
  }
  return transpilerPromise;
}

async function applyMiniLocations(editorId, code) {
  const editor = getStrudelEditor(editorId);
  if (!editor) {
    return;
  }

  const normalized = typeof code === 'string' ? code : '';
  lastAppliedCode.set(editorId, normalized);

  if (!normalized.trim()) {
    updateMiniLocations(editor, []);
    return;
  }

  try {
    const transpiler = await getTranspiler();
    if (!transpiler) {
      return;
    }
    const { miniLocations = [] } =
      transpiler(normalized, {
        wrapAsync: false,
        addReturn: false,
        emitMiniLocations: true,
        emitWidgets: false,
      }) || {};
    updateMiniLocations(editor, miniLocations);
  } catch (error) {
    console.warn('⚠️ Unable to compute mini locations for highlighting:', error);
  }
}

export function scheduleMiniLocationRefresh(editorId, codeSource, delay = 250) {
  if (!editorId) return;
  const getter = typeof codeSource === 'function' ? codeSource : () => codeSource;
  if (pendingRefreshTimers.has(editorId)) {
    clearTimeout(pendingRefreshTimers.get(editorId));
  }
  pendingRefreshTimers.set(
    editorId,
    setTimeout(() => {
      pendingRefreshTimers.delete(editorId);
      try {
        const code = getter() ?? '';
        if (lastAppliedCode.get(editorId) === code) {
          return;
        }
        applyMiniLocations(editorId, code);
      } catch (err) {
        console.warn('⚠️ Failed to refresh mini locations:', err);
      }
    }, delay),
  );
}

let masterDrawer = null;

function ensureMasterDrawer() {
  if (masterDrawer) {
    return masterDrawer;
  }
  masterDrawer = new Drawer((haps, time) => {
    const editor = getStrudelEditor('master-pattern');
    if (!editor) {
      return;
    }
    highlightMiniLocations(editor, time, haps);
  }, [-0.2, 0.05]);
  return masterDrawer;
}

export function startMasterHighlighting() {
  const scheduler = window?.strudel?.scheduler;
  if (!scheduler) {
    console.warn('⚠️ Cannot start master highlighting without Strudel scheduler');
    return;
  }
  const drawer = ensureMasterDrawer();
  try {
    drawer.start(scheduler);
  } catch (error) {
    console.warn('⚠️ Unable to start master highlighting drawer:', error);
  }
}

export function stopMasterHighlighting() {
  if (masterDrawer) {
    masterDrawer.stop();
  }
  const editor = getStrudelEditor('master-pattern');
  if (editor) {
    highlightMiniLocations(editor, 0, []);
  }
}

