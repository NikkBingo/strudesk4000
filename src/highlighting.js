import { setStrudelEditorHighlights, getStrudelEditorValue } from './strudelReplEditor.js';

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
  
  // Get the editor content (displayed code with comments)
  // Use helper function to get value from either strudel-editor or CodeMirror editor
  const displayedCode = getStrudelEditorValue(MASTER_EDITOR_ID) || '';
  if (!displayedCode) {
    return ranges;
  }
  
  // Get the evaluated code (strip comments like Strudel does)
  // This matches what's actually evaluated: comments are stripped
  const evaluatedCode = stripCommentsForEvaluation(displayedCode);
  
  haps.forEach((hap, hapIndex) => {
    const locations = hap?.context?.locations;
    if (!Array.isArray(locations)) {
      // Debug: Log why locations aren't being used (only occasionally)
      if (Math.random() < 0.01 && hapIndex === 0) {
        console.log('🔍 Debug: Hap has no locations array', {
          hasContext: !!hap?.context,
          contextKeys: hap?.context ? Object.keys(hap.context) : [],
          locationsType: typeof locations,
          locationsValue: locations
        });
      }
      return;
    }
    locations.forEach((loc, locIndex) => {
      // Check if location has start/end properties (might be different structure)
      if (typeof loc?.start !== 'number' && typeof loc?.from !== 'number') {
        // Debug: Log location structure if it's unexpected (only occasionally)
        if (Math.random() < 0.01 && hapIndex === 0 && locIndex === 0) {
          console.log('🔍 Debug: Location has unexpected structure', {
            location: loc,
            locationKeys: loc ? Object.keys(loc) : [],
            hasStart: typeof loc?.start === 'number',
            hasFrom: typeof loc?.from === 'number',
            hasEnd: typeof loc?.end === 'number',
            hasTo: typeof loc?.to === 'number'
          });
        }
        return;
      }
      
      // Support both {start, end} and {from, to} formats
      const start = loc.start ?? loc.from;
      const end = loc.end ?? loc.to;
      
      if (typeof start !== 'number' || typeof end !== 'number') {
        return;
      }
      
      // Locations are relative to evaluated code (without comments)
      let from = Math.max(0, Math.min(start, end));
      let to = Math.max(from, Math.max(start, end));
      
      // Clamp positions to evaluated code length
      const evaluatedLength = evaluatedCode.length;
      if (from > evaluatedLength) {
        // Position is beyond evaluated code, skip
        return;
      }
      to = Math.min(to, evaluatedLength);
      
      // Map positions from evaluated code to displayed code
      const mapped = mapPositionToDisplayedCode(from, to, evaluatedCode, displayedCode);
      
      const key = `${mapped.from}:${mapped.to}`;
      if (!seen.has(key)) {
        seen.add(key);
        ranges.push({ from: mapped.from, to: mapped.to });
      }
    });
  });
  return ranges;
}

/**
 * Strip comments from code to match what Strudel evaluates
 * This should match the stripping logic used before evaluation
 */
function stripCommentsForEvaluation(code) {
  if (!code) return '';
  
  // Remove tempo comments
  const tempoPrefix = '// Controls Selected Tempo:';
  let result = code.split('\n')
    .filter(line => !line.trim().startsWith(tempoPrefix))
    .join('\n');
  
  // Remove single-line comments (// ...)
  result = result.replace(/\/\/.*$/gm, '');
  
  // Remove multi-line comments (/* ... */) but preserve channel markers
  result = result.replace(/\/\*[\s\S]*?\*\//g, (comment) => {
    // Keep channel markers like /* Channel 1 */
    return /\/\*\s*Channel\s+\d+\s*\*\//i.test(comment) ? comment : '';
  });
  
  // Clean up extra whitespace and newlines
  result = result.replace(/\n\s*\n\s*\n/g, '\n\n').trim();
  
  return result;
}

/**
 * Map position from evaluated code (without comments) to displayed code (with comments)
 * Builds accurate position mapping by simulating the comment stripping process
 */
function mapPositionToDisplayedCode(from, to, evaluatedCode, displayedCode) {
  // If codes are the same, no mapping needed
  if (evaluatedCode === displayedCode) {
    return { from, to };
  }
  
  // Build position map: evalPos -> displayPos
  // Process displayed code and simulate stripping to see which characters survive
  const positionMap = new Map();
  let evalPos = 0;
  let displayPos = 0;
  let i = 0;
  
  while (i < displayedCode.length && evalPos < evaluatedCode.length) {
    const remaining = displayedCode.substring(i);
    
    // Check for single-line comment
    if (remaining.startsWith('//')) {
      // Skip to end of line
      const newlineIndex = remaining.indexOf('\n');
      if (newlineIndex !== -1) {
        i += newlineIndex + 1;
        displayPos += newlineIndex + 1;
      } else {
        // End of file
        break;
      }
      continue;
    }
    
    // Check for multi-line comment
    if (remaining.startsWith('/*')) {
      const endIndex = remaining.indexOf('*/');
      if (endIndex !== -1) {
        const comment = remaining.substring(0, endIndex + 2);
        const isChannelMarker = /\/\*\s*Channel\s+\d+\s*\*\//i.test(comment);
        
        if (isChannelMarker) {
          // Channel marker is preserved - map characters that match evaluated code
          for (let j = 0; j < comment.length && evalPos < evaluatedCode.length; j++) {
            if (evaluatedCode[evalPos] === comment[j]) {
              positionMap.set(evalPos, displayPos + j);
              evalPos++;
            }
          }
          i += comment.length;
          displayPos += comment.length;
        } else {
          // Regular comment - skip it
          i += endIndex + 2;
          displayPos += endIndex + 2;
        }
        continue;
      } else {
        // Unclosed comment
        break;
      }
    }
    
    // Regular character - check if it matches evaluated code
    const displayChar = displayedCode[i];
    const evalChar = evaluatedCode[evalPos];
    
    if (displayChar === evalChar) {
      // Characters match - map this position
      positionMap.set(evalPos, displayPos);
      evalPos++;
      displayPos++;
      i++;
    } else if (/\s/.test(displayChar) && /\s/.test(evalChar)) {
      // Both are whitespace - map and advance both
      positionMap.set(evalPos, displayPos);
      evalPos++;
      displayPos++;
      i++;
    } else if (/\s/.test(displayChar)) {
      // Display has whitespace but eval doesn't - skip display whitespace
      displayPos++;
      i++;
    } else if (/\s/.test(evalChar)) {
      // Eval has whitespace but display doesn't - advance eval
      evalPos++;
    } else {
      // Characters don't match - this shouldn't happen if stripping is correct
      // Advance both to avoid infinite loop
      evalPos++;
      displayPos++;
      i++;
    }
  }
  
  // Use position map to translate positions
  const mappedFrom = positionMap.get(from);
  const mappedTo = positionMap.get(to);
  
  if (mappedFrom !== undefined && mappedTo !== undefined) {
    return { from: mappedFrom, to: mappedTo };
  }
  
  // Fallback: find closest mapped positions and interpolate
  if (positionMap.size > 0) {
    // Find positions before and after
    let beforeEval = -1;
    let beforeDisplay = -1;
    let afterEval = Infinity;
    let afterDisplay = Infinity;
    
    for (const [ePos, dPos] of positionMap.entries()) {
      if (ePos <= from && ePos > beforeEval) {
        beforeEval = ePos;
        beforeDisplay = dPos;
      }
      if (ePos >= from && ePos < afterEval) {
        afterEval = ePos;
        afterDisplay = dPos;
      }
    }
    
    if (beforeEval >= 0) {
      const offset = beforeDisplay - beforeEval;
      return { from: from + offset, to: to + offset };
    }
    if (afterEval < Infinity) {
      const offset = afterDisplay - afterEval;
      return { from: from + offset, to: to + offset };
    }
  }
  
  // Final fallback: calculate offset from comment lines at start
  const displayedLines = displayedCode.split('\n');
  let commentOffset = 0;
  let foundCode = false;
  
  for (let i = 0; i < displayedLines.length && !foundCode; i++) {
    const line = displayedLines[i];
    const trimmed = line.trim();
    const stripped = stripCommentsForEvaluation(line);
    
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || 
        (trimmed === '' && !foundCode) || (stripped.trim() === '' && trimmed !== '')) {
      commentOffset += line.length + 1;
    } else if (stripped.trim() !== '') {
      foundCode = true;
    }
  }
  
  return { from: from + commentOffset, to: to + commentOffset };
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
    
    // Debug: Check if haps have location data
    if (haps.length > 0 && haps.length <= 5) {
      const hasLocations = haps.some(hap => hap?.context?.locations?.length > 0);
      if (!hasLocations) {
        console.warn('⚠️ Haps found but no location data. Pattern may not have withLoc enabled or locations not preserved.');
        console.log('Sample hap:', haps[0]);
      }
    }
    
    const ranges = collectActiveRanges(haps);
    
    // Debug logging - only log occasionally to avoid spam
    if (ranges.length > 0) {
      console.log(`🎯 Highlighting ${ranges.length} active range(s) at time ${now.toFixed(3)}`, ranges);
    } else if (haps.length > 0 && Math.random() < 0.01) {
      // Haps exist but no ranges - likely missing location data
      // Only log 1% of the time to avoid console spam
      console.log(`ℹ️ Found ${haps.length} hap(s) but no highlight ranges (missing location data?)`);
      // Log a sample hap structure for debugging
      if (haps[0]) {
        console.log('Sample hap structure:', {
          hasContext: !!haps[0].context,
          hasLocations: !!(haps[0].context?.locations),
          locationCount: haps[0].context?.locations?.length || 0,
          contextKeys: haps[0].context ? Object.keys(haps[0].context) : []
        });
      }
    }
    
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
  console.log('✅ Starting master pattern highlighting');
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


