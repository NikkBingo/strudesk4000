/**
 * Authentication middleware
 * Verifies that the user is authenticated via session
 */

export const requireAuth = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
};

export const optionalAuth = (req, res, next) => {
  // This middleware allows the request to proceed whether or not user is authenticated
  // Useful for endpoints that show different data based on auth status
  next();
};

