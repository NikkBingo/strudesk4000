import { setStrudelEditorHighlights } from './strudelReplEditor.js';

const MASTER_EDITOR_ID = 'master-pattern';
let highlightLoopId = null;
let highlightActive = false;
let schedulerWarningShown = false;

function collectActiveRanges(haps) {
  const ranges = [];
  const seen = new Set();
  if (!Array.isArray(haps)) {
    return ranges;
  }
  
  // Get the editor to check its content length
  const editor = document.getElementById(MASTER_EDITOR_ID)?._strudelEditor;
  const editorContent = editor ? editor.getValue() : '';
  
  // Remove tempo comments to get the evaluated code length
  // Locations from Strudel are relative to the evaluated code (without tempo comments)
  const tempoPrefix = '// Controls Selected Tempo:';
  const editorLines = editorContent.split('\n');
  const codeLines = editorLines.filter(line => !line.trim().startsWith(tempoPrefix));
  const evaluatedCode = codeLines.join('\n');
  
  haps.forEach((hap) => {
    const locations = hap?.context?.locations;
    if (!Array.isArray(locations)) {
      return;
    }
    locations.forEach((loc) => {
      if (typeof loc?.start !== 'number' || typeof loc?.end !== 'number') {
        return;
      }
      // Locations are relative to evaluated code (without tempo comments)
      let from = Math.max(0, Math.min(loc.start, loc.end));
      let to = Math.max(from, Math.max(loc.start, loc.end));
      
      // Clamp positions to evaluated code length (tempo comments are at the end)
      const evaluatedLength = evaluatedCode.length;
      if (from > evaluatedLength) {
        // Position is beyond evaluated code (in tempo comment area), skip
        return;
      }
      to = Math.min(to, evaluatedLength);
      
      // Positions should match directly since tempo comments are appended at the end
      const key = `${from}:${to}`;
      if (!seen.has(key)) {
        seen.add(key);
        ranges.push({ from, to });
      }
    });
  });
  return ranges;
}

function runHighlightLoop() {
  if (!highlightActive) {
    highlightLoopId = null;
    return;
  }

  const scheduler = window?.strudel?.scheduler;
  const pattern = scheduler?.pattern;

  if (!scheduler || typeof scheduler.now !== 'function' || !pattern || typeof pattern.queryArc !== 'function') {
    if (!schedulerWarningShown) {
      console.warn('⚠️ Unable to update highlights - Strudel scheduler not ready.');
      schedulerWarningShown = true;
    }
    highlightLoopId = requestAnimationFrame(runHighlightLoop);
    return;
  }

  schedulerWarningShown = false;

  try {
    const lookAhead = 0.05;
    const lookBehind = 0.05;
    const now = scheduler.now();
    const begin = Math.max(0, now - lookBehind);
    const end = now + lookAhead;
    const haps = pattern.queryArc(begin, end) || [];
    const ranges = collectActiveRanges(haps);
    setStrudelEditorHighlights(MASTER_EDITOR_ID, ranges);
  } catch (error) {
    console.warn('⚠️ Unable to update code highlights:', error);
  }

  highlightLoopId = requestAnimationFrame(runHighlightLoop);
}

export function startMasterHighlighting() {
  if (highlightActive) {
    return;
  }
  highlightActive = true;
  if (!highlightLoopId) {
    highlightLoopId = requestAnimationFrame(runHighlightLoop);
  }
}

export function stopMasterHighlighting() {
  highlightActive = false;
  if (highlightLoopId) {
    cancelAnimationFrame(highlightLoopId);
    highlightLoopId = null;
  }
  setStrudelEditorHighlights(MASTER_EDITOR_ID, []);
}

