import express from 'express';
import passport from 'passport';
import '../config/passport.js';

const router = express.Router();

// Google OAuth routes (only if configured)
if (process.env.OAUTH_GOOGLE_CLIENT_ID && process.env.OAUTH_GOOGLE_CLIENT_SECRET) {
  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

  router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: process.env.FRONTEND_URL || 'http://localhost:3000' }),
    (req, res) => {
      // Successful authentication
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/?auth=success`);
    }
  );
} else {
  router.get('/google', (req, res) => {
    res.status(503).json({ error: 'Google OAuth is not configured' });
  });
  router.get('/google/callback', (req, res) => {
    res.status(503).json({ error: 'Google OAuth is not configured' });
  });
}

// GitHub OAuth routes (only if configured)
if (process.env.OAUTH_GITHUB_CLIENT_ID && process.env.OAUTH_GITHUB_CLIENT_SECRET) {
  router.get('/github', passport.authenticate('github', { scope: ['user:email'] }));

  router.get('/github/callback',
    passport.authenticate('github', { failureRedirect: process.env.FRONTEND_URL || 'http://localhost:3000' }),
    (req, res) => {
      // Successful authentication
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/?auth=success`);
    }
  );
} else {
  router.get('/github', (req, res) => {
    res.status(503).json({ error: 'GitHub OAuth is not configured' });
  });
  router.get('/github/callback', (req, res) => {
    res.status(503).json({ error: 'GitHub OAuth is not configured' });
  });
}

// Get current user
router.get('/me', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    res.json(req.user);
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

export default router;

