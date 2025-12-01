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
  
  // Get the editor content (displayed code with comments)
  const editor = document.getElementById(MASTER_EDITOR_ID)?._strudelEditor;
  const displayedCode = editor ? editor.getValue() : '';
  if (!displayedCode) {
    return ranges;
  }
  
  // Get the evaluated code (strip comments like Strudel does)
  // This matches what's actually evaluated: comments are stripped
  const evaluatedCode = stripCommentsForEvaluation(displayedCode);
  
  haps.forEach((hap) => {
    const locations = hap?.context?.locations;
    if (!Array.isArray(locations)) {
      return;
    }
    locations.forEach((loc) => {
      if (typeof loc?.start !== 'number' || typeof loc?.end !== 'number') {
        return;
      }
      // Locations are relative to evaluated code (without comments)
      let from = Math.max(0, Math.min(loc.start, loc.end));
      let to = Math.max(from, Math.max(loc.start, loc.end));
      
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
 */
function mapPositionToDisplayedCode(from, to, evaluatedCode, displayedCode) {
  // If codes are the same, no mapping needed
  if (evaluatedCode === displayedCode) {
    return { from, to };
  }
  
  // Build a character-by-character mapping
  // Process displayed code line by line, tracking which characters map to evaluated code
  const displayedLines = displayedCode.split('\n');
  const evaluatedLines = evaluatedCode.split('\n');
  
  // Find which line and column in evaluated code contains the position
  let evalLineNum = 0;
  let evalCol = 0;
  let evalCharCount = 0;
  
  for (let i = 0; i < evaluatedLines.length; i++) {
    const lineLength = evaluatedLines[i].length;
    if (evalCharCount + lineLength >= from) {
      evalLineNum = i;
      evalCol = from - evalCharCount;
      break;
    }
    evalCharCount += lineLength + 1; // +1 for newline
  }
  
  // Now find the corresponding line in displayed code
  // We need to match evaluated lines to displayed lines, skipping comment lines
  let displayCharPos = 0;
  let matchedEvalLineNum = 0;
  
  for (let i = 0; i < displayedLines.length; i++) {
    const displayLine = displayedLines[i];
    const strippedDisplayLine = stripCommentsForEvaluation(displayLine);
    
    // Check if this is a comment-only line
    const trimmedDisplay = displayLine.trim();
    const isCommentLine = trimmedDisplay.startsWith('//') || 
                         trimmedDisplay.startsWith('/*') ||
                         trimmedDisplay.startsWith('*') ||
                         (strippedDisplayLine.trim() === '' && trimmedDisplay !== '');
    
    if (isCommentLine) {
      // Skip comment lines - they don't exist in evaluated code
      displayCharPos += displayLine.length + 1; // +1 for newline
      continue;
    }
    
    // This line should correspond to an evaluated line
    if (matchedEvalLineNum < evaluatedLines.length) {
      const evalLine = evaluatedLines[matchedEvalLineNum];
      
      // Check if stripped displayed line matches evaluated line
      // Handle case where displayed line might have trailing whitespace
      const strippedEvalLine = evalLine.trimEnd();
      const strippedDisplay = strippedDisplayLine.trimEnd();
      
      if (strippedDisplay === strippedEvalLine || strippedDisplayLine === evalLine) {
        // Lines match
        if (matchedEvalLineNum === evalLineNum) {
          // Found the target line - map the column position
          // Column should be the same since the line content matches (after stripping)
          const mappedFrom = displayCharPos + evalCol;
          const mappedTo = mappedFrom + (to - from);
          return { from: mappedFrom, to: mappedTo };
        }
        matchedEvalLineNum++;
      } else {
        // Lines don't match - might be a mismatch
        // This can happen if there are differences in whitespace or formatting
        // Continue to next displayed line to find the match
      }
    }
    
    displayCharPos += displayLine.length + 1; // +1 for newline
  }
  
  // Fallback: if we couldn't find the exact match, calculate offset from comment lines
  // Build a character map by processing both codes and finding where evaluated code starts
  let commentLinesOffset = 0;
  let foundFirstCodeLine = false;
  
  // Find where the actual code starts in displayed code (after all comments)
  for (let i = 0; i < displayedLines.length; i++) {
    const displayLine = displayedLines[i];
    const stripped = stripCommentsForEvaluation(displayLine);
    const trimmed = displayLine.trim();
    
    // Check if this is a comment line or empty line before code
    if (!foundFirstCodeLine) {
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        commentLinesOffset += displayLine.length + 1; // +1 for newline
        continue;
      } else if (trimmed === '') {
        // Empty line - count it as part of the offset
        commentLinesOffset += displayLine.length + 1;
        continue;
      } else if (stripped.trim() === '' && trimmed !== '') {
        // Line has content but strips to empty (might be a comment)
        commentLinesOffset += displayLine.length + 1;
        continue;
      } else {
        // Found first code line
        foundFirstCodeLine = true;
        // Don't add this line to offset - it's the start of the code
      }
    }
  }
  
  // Apply offset to positions
  const mappedFrom = from + commentLinesOffset;
  const mappedTo = to + commentLinesOffset;
  
  // Debug logging (only log if offset is significant)
  if (commentLinesOffset > 0) {
    console.log(`📍 Position mapping: ${from}-${to} -> ${mappedFrom}-${mappedTo} (offset: ${commentLinesOffset} chars from ${Math.floor(commentLinesOffset / 50)} comment lines)`);
  }
  
  return { from: mappedFrom, to: mappedTo };
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

