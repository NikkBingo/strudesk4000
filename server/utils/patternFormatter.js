/**
 * Pattern formatter utility
 * Formats pattern code with JSDoc-style comments including metadata
 */

/**
 * Format pattern code with metadata comments
 * @param {Object} options - Formatting options
 * @param {string} options.patternCode - The Strudel pattern code
 * @param {string} options.title - Song/track title
 * @param {string} options.artistName - Artist name (copyright holder)
 * @param {number} options.version - Version number
 * @param {string|null} options.versionName - Optional version name/label
 * @returns {string} Formatted pattern code with comments
 */
export function formatPatternWithMetadata({
  patternCode,
  title,
  artistName,
  version,
  versionName = null
}) {
  const trimmedCode = (patternCode || '').trim();
  if (!trimmedCode) return '';

  // Build version string
  let versionStr = `${version}`;
  if (versionName) {
    versionStr += ` (${versionName})`;
  }

  // Build comment header
  const comments = [];
  
  if (title) {
    comments.push(`// "${title}" @by ${artistName || 'Unknown'}`);
  } else if (artistName) {
    comments.push(`// @by ${artistName}`);
  }
  
  comments.push(`// @version ${versionStr}`);
  
  if (artistName) {
    comments.push(`// @copyright ${artistName}`);
  }

  // Combine comments, empty line, code, empty line, footer
  const formatted = [
    ...comments,
    '',
    trimmedCode,
    '',
    '// Made with Strudesk 4000 by eKommissar.'
  ].join('\n');

  return formatted;
}

/**
 * Extract metadata from formatted pattern code
 * @param {string} formattedCode - Pattern code with metadata comments
 * @returns {Object} Extracted metadata
 */
export function extractMetadataFromPattern(formattedCode) {
  const lines = formattedCode.split('\n');
  const metadata = {
    title: null,
    artistName: null,
    version: 1,
    versionName: null,
    patternCode: ''
  };

  let inComments = true;
  let codeLines = [];

  for (const line of lines) {
    if (inComments) {
      // Extract title
      const titleMatch = line.match(/\/\/\s*"([^"]+)"\s*@by\s*(.+)/);
      if (titleMatch) {
        metadata.title = titleMatch[1];
        metadata.artistName = titleMatch[2].trim();
        continue;
      }

      // Extract artist only
      const artistMatch = line.match(/\/\/\s*@by\s*(.+)/);
      if (artistMatch && !metadata.artistName) {
        metadata.artistName = artistMatch[1].trim();
        continue;
      }

      // Extract version
      const versionMatch = line.match(/\/\/\s*@version\s*(\d+)(?:\s*\(([^)]+)\))?/);
      if (versionMatch) {
        metadata.version = parseInt(versionMatch[1], 10);
        if (versionMatch[2]) {
          metadata.versionName = versionMatch[2].trim();
        }
        continue;
      }

      // Extract copyright
      const copyrightMatch = line.match(/\/\/\s*@copyright\s*(.+)/);
      if (copyrightMatch && !metadata.artistName) {
        metadata.artistName = copyrightMatch[1].trim();
        continue;
      }

      // Empty line means end of comments
      if (line.trim() === '' || line.trim().startsWith('// Made with')) {
        if (line.trim() === '') {
          inComments = false;
        }
        continue;
      }
    } else {
      // Skip footer
      if (line.includes('Made with Strudesk 4000')) {
        continue;
      }
      // Collect code lines
      codeLines.push(line);
    }
  }

  metadata.patternCode = codeLines.join('\n').trim();
  return metadata;
}

