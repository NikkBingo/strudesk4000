/**
 * Configuration utilities
 * Helper functions for checking environment variables
 */

/**
 * Check if test mode is enabled
 * Returns true if TEST_MODE is set to a truthy value (not "false", "0", or empty)
 */
export function isTestMode() {
  const testMode = process.env.TEST_MODE;
  if (!testMode) return false;
  // Explicitly check for false values
  const lower = testMode.toLowerCase().trim();
  return lower !== 'false' && lower !== '0' && lower !== '';
}

