import express from 'express';
import passport from 'passport';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import '../config/passport.js';
import { isTestMode } from '../utils/config.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const prisma = new PrismaClient();

const VERIFICATION_EXPIRY_HOURS = 24;
const RESET_EXPIRY_HOURS = 1;

const sanitizeUser = (user) => {
  if (!user) return null;
  const {
    passwordHash,
    verificationToken,
    verificationTokenExpires,
    resetToken,
    resetTokenExpires,
    ...rest
  } = user;
  return rest;
};

const generateToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

async function setVerificationToken(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);
  await prisma.user.update({
    where: { id: userId },
    data: {
      verificationToken: token,
      verificationTokenExpires: expiresAt
    }
  });
  console.log(`📧 Email verification token for user ${userId}: ${token}`);
  return token;
}

async function setResetToken(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + RESET_EXPIRY_HOURS * 60 * 60 * 1000);
  await prisma.user.update({
    where: { id: userId },
    data: {
      resetToken: token,
      resetTokenExpires: expiresAt
    }
  });
  console.log(`🔐 Password reset token for user ${userId}: ${token}`);
  return token;
}

// Google OAuth routes (only if configured)
if (process.env.OAUTH_GOOGLE_CLIENT_ID && process.env.OAUTH_GOOGLE_CLIENT_SECRET) {
  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

  router.get(
    '/google/callback',
    passport.authenticate('google', { failureRedirect: process.env.FRONTEND_URL || 'http://localhost:3000' }),
    (req, res) => {
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

// Email/password registration
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return res.status(409).json({ error: 'Email is already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: name?.trim() || normalizedEmail.split('@')[0],
        oauthProvider: 'local',
        oauthId: normalizedEmail,
        passwordHash,
        artistName: null,
        profileCompleted: false
      }
    });

    const verificationToken = await setVerificationToken(user.id);

    // Return token in response (for development - emails not implemented yet)
    const isDev = process.env.NODE_ENV !== 'production' || isTestMode();
    res.json({
      message: 'Account created. Please verify your email before logging in.',
      requiresVerification: true,
      ...(isDev && { verificationToken, note: 'Email sending not configured. Use the token below to verify your account.' })
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Email verification
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    const user = await prisma.user.findFirst({
      where: {
        verificationToken: token,
        verificationTokenExpires: {
          gt: new Date()
        }
      }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        verificationToken: null,
        verificationTokenExpires: null
      }
    });

    res.json({ message: 'Email verified successfully', user: sanitizeUser(updated) });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (user.emailVerifiedAt) {
      return res.status(400).json({ error: 'Email is already verified' });
    }
    const verificationToken = await setVerificationToken(user.id);
    
    // Return token in response (for development - emails not implemented yet)
    const isDev = process.env.NODE_ENV !== 'production' || isTestMode();
    res.json({
      message: 'Verification email sent',
      ...(isDev && { verificationToken, note: 'Email sending not configured. Use the token below to verify your account.' })
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

// Email/password login
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.status(401).json({ error: info?.message || 'Invalid email or password' });
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        return next(loginErr);
      }
      res.json({ message: 'Login successful', user: sanitizeUser(user) });
    });
  })(req, res, next);
});

// Password reset request
router.post('/request-password-reset', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (user && user.passwordHash) {
      await setResetToken(user.id);
    }
    res.json({ message: 'If the account exists, a password reset link has been sent.' });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// Password reset
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpires: { gt: new Date() }
      }
    });
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExpires: null
      }
    });
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.json(sanitizeUser(req.user));
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

      return res.json(sanitizeUser(testUser));
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
        return res.json({
          id: 'test-user-mock-1',
          email: 'test@strudel.test',
          name: 'Test User',
          artistName: 'Test Artist',
          avatarUrl: null,
          role: 'user',
          status: 'active',
          profileCompleted: false
        });
      } else {
        console.error('Error getting test user:', error);
        res.status(500).json({ error: 'Failed to get test user' });
      }
    }
  } else {
    // Return 200 with null instead of 401 to avoid console errors
    return res.json(null);
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

// Delete own account
router.post('/delete-account', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    await prisma.user.delete({ where: { id: userId } });
    req.logout(() => {});
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
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
        user: sanitizeUser(testUser)
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

