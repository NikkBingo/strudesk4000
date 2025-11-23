import express from 'express';
import passport from 'passport';
import '../config/passport.js';
import { isTestMode } from '../utils/config.js';

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
router.get('/me', async (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    res.json(req.user);
  } else if (isTestMode()) {
    // In test mode, return a test user if not authenticated
    try {
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();

      // Find or create test user
      let testUser = await prisma.user.findUnique({
        where: {
          oauthProvider_oauthId: {
            oauthProvider: 'test',
            oauthId: 'test-user-1'
          }
        }
      });

      if (!testUser) {
        testUser = await prisma.user.create({
          data: {
            email: 'test@strudel.test',
            name: 'Test User',
            oauthProvider: 'test',
            oauthId: 'test-user-1',
            artistName: 'Test Artist'
          }
        });
      }

      res.json({
        id: testUser.id,
        email: testUser.email,
        name: testUser.name,
        artistName: testUser.artistName,
        avatarUrl: testUser.avatarUrl
      });
    } catch (error) {
      // If database is unavailable in test mode, return a mock test user
      const isDbConnectionError = 
        error.name === 'PrismaClientInitializationError' ||
        error.constructor?.name === 'PrismaClientInitializationError' ||
        error.message?.includes("Can't reach database") ||
        error.message?.includes('database server') ||
        String(error).includes("Can't reach database");
      
      if (isDbConnectionError) {
        console.warn('⚠️  Database unavailable in test mode, using mock test user');
        res.json({
          id: 'test-user-mock-1',
          email: 'test@strudel.test',
          name: 'Test User',
          artistName: 'Test Artist',
          avatarUrl: null
        });
      } else {
        console.error('Error getting test user:', error);
        res.status(500).json({ error: 'Failed to get test user' });
      }
    }
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

// Test mode: Create a test user and log them in (only in development/test mode)
router.post('/test-login', async (req, res) => {
  // Only allow in development or when TEST_MODE is enabled
  if (process.env.NODE_ENV === 'production' && !isTestMode()) {
    return res.status(403).json({ error: 'Test login is disabled in production' });
  }

  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    // Find or create test user
    let testUser = await prisma.user.findUnique({
      where: {
        oauthProvider_oauthId: {
          oauthProvider: 'test',
          oauthId: 'test-user-1'
        }
      }
    });

    if (!testUser) {
      testUser = await prisma.user.create({
        data: {
          email: 'test@strudel.test',
          name: 'Test User',
          oauthProvider: 'test',
          oauthId: 'test-user-1',
          artistName: 'Test Artist'
        }
      });
    }

    // Log the user in
    req.login(testUser, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Login failed' });
      }
      res.json({
        message: 'Test login successful',
        user: {
          id: testUser.id,
          email: testUser.email,
          name: testUser.name,
          artistName: testUser.artistName,
          avatarUrl: testUser.avatarUrl
        }
      });
    });
  } catch (error) {
    // If database is unavailable in test mode, use a mock test user
    const isDbConnectionError = 
      error.name === 'PrismaClientInitializationError' ||
      error.constructor?.name === 'PrismaClientInitializationError' ||
      error.message?.includes("Can't reach database") ||
      error.message?.includes('database server') ||
      String(error).includes("Can't reach database");
    
    if (isDbConnectionError) {
      console.warn('⚠️  Database unavailable in test mode, using mock test user for test-login');
      const mockUser = {
        id: 'test-user-mock-1',
        email: 'test@strudel.test',
        name: 'Test User',
        artistName: 'Test Artist',
        avatarUrl: null
      };
      
      // Log the mock user in
      req.login(mockUser, (err) => {
        if (err) {
          return res.status(500).json({ error: 'Login failed' });
        }
        res.json({
          message: 'Test login successful (mock user - database unavailable)',
          user: mockUser
        });
      });
    } else {
      console.error('Test login error:', error);
      res.status(500).json({ error: 'Test login failed', details: error.message });
    }
  }
});

export default router;

