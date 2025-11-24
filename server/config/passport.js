import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as LocalStrategy } from 'passport-local';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Initialize Prisma client with error handling
let prisma;
try {
  prisma = new PrismaClient({
    log: ['error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    }
  });
} catch (error) {
  console.error('❌ Failed to initialize Prisma client in passport config:', error);
  prisma = null;
}

// Configure Google OAuth Strategy (only if credentials are provided)
if (process.env.OAUTH_GOOGLE_CLIENT_ID && process.env.OAUTH_GOOGLE_CLIENT_SECRET) {
  passport.use('google', new GoogleStrategy({
    clientID: process.env.OAUTH_GOOGLE_CLIENT_ID,
    clientSecret: process.env.OAUTH_GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.OAUTH_GOOGLE_CALLBACK_URL || '/api/auth/google/callback'
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      if (!profile || !profile.id) {
        console.error('Google OAuth: Invalid profile received', profile);
        return done(new Error('Invalid profile from Google'), null);
      }

      if (!profile.emails || !profile.emails[0] || !profile.emails[0].value) {
        console.error('Google OAuth: Missing email in profile', profile);
        return done(new Error('Email not provided by Google'), null);
      }

      // Find or create user
      let user = await prisma.user.findUnique({
        where: {
          oauthProvider_oauthId: {
            oauthProvider: 'google',
            oauthId: profile.id
          }
        }
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            email: profile.emails[0].value.toLowerCase().trim(),
            name: profile.displayName || profile.emails[0].value.split('@')[0],
            oauthProvider: 'google',
            oauthId: profile.id,
            avatarUrl: profile.photos?.[0]?.value || null,
            emailVerifiedAt: new Date()
          }
        });
        console.log('Google OAuth: Created new user', user.email);
      } else {
        // Update user info in case it changed
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            name: profile.displayName || user.name,
            avatarUrl: profile.photos?.[0]?.value || user.avatarUrl,
            email: profile.emails[0].value.toLowerCase().trim(),
            emailVerifiedAt: user.emailVerifiedAt || new Date()
          }
        });
        console.log('Google OAuth: Updated existing user', user.email);
      }

      return done(null, user);
    } catch (error) {
      console.error('Google OAuth error:', error);
      return done(error, null);
    }
  }));
} else {
  console.warn('Google OAuth not configured: OAUTH_GOOGLE_CLIENT_ID and OAUTH_GOOGLE_CLIENT_SECRET are required');
}

// Local email/password strategy
passport.use(
  'local',
  new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
      passReqToCallback: false
    },
    async (email, password, done) => {
      try {
        const normalizedEmail = email?.toLowerCase().trim();
        if (!normalizedEmail) {
          return done(null, false, { message: 'Email is required' });
        }

        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail }
        });

        if (!user || !user.passwordHash) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        if (user.status === 'blocked') {
          return done(null, false, { message: 'Account is blocked' });
        }

        if (!user.emailVerifiedAt) {
          return done(null, false, { message: 'Please verify your email before logging in' });
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    console.log('[passport.deserializeUser] Attempting to deserialize user ID:', id);
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        artistName: true,
        socialLinks: true,
        role: true,
        status: true,
        profileCompleted: true,
        emailVerifiedAt: true,
        createdAt: true
      }
    });
    if (!user) {
      console.log('[passport.deserializeUser] User not found for ID:', id);
    } else {
      console.log('[passport.deserializeUser] Successfully deserialized user:', user.email);
    }
    done(null, user);
  } catch (error) {
    console.error('[passport.deserializeUser] Error deserializing user:', error);
    done(error, null);
  }
});

