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
          email: profile.emails[0].value,
          name: profile.displayName,
          oauthProvider: 'google',
          oauthId: profile.id,
          avatarUrl: profile.photos[0]?.value,
          emailVerifiedAt: new Date()
        }
      });
    } else {
      // Update user info in case it changed
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name: profile.displayName,
          avatarUrl: profile.photos[0]?.value,
          email: profile.emails[0].value,
          emailVerifiedAt: user.emailVerifiedAt || new Date()
        }
      });
    }

    return done(null, user);
  } catch (error) {
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
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

