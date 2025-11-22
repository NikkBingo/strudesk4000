import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { PrismaClient } from '@prisma/client';

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
          avatarUrl: profile.photos[0]?.value
        }
      });
    } else {
      // Update user info in case it changed
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name: profile.displayName,
          avatarUrl: profile.photos[0]?.value,
          email: profile.emails[0].value
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

// Configure GitHub OAuth Strategy (only if credentials are provided)
if (process.env.OAUTH_GITHUB_CLIENT_ID && process.env.OAUTH_GITHUB_CLIENT_SECRET) {
  passport.use('github', new GitHubStrategy({
    clientID: process.env.OAUTH_GITHUB_CLIENT_ID,
    clientSecret: process.env.OAUTH_GITHUB_CLIENT_SECRET,
    callbackURL: process.env.OAUTH_GITHUB_CALLBACK_URL || '/api/auth/github/callback',
    scope: ['user:email']
  }, async (accessToken, refreshToken, profile, done) => {
  try {
    // Get email from GitHub profile
    const email = profile.emails?.[0]?.value || `${profile.username}@users.noreply.github.com`;

    // Find or create user
    let user = await prisma.user.findUnique({
      where: {
        oauthProvider_oauthId: {
          oauthProvider: 'github',
          oauthId: profile.id.toString()
        }
      }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name: profile.displayName || profile.username,
          oauthProvider: 'github',
          oauthId: profile.id.toString(),
          avatarUrl: profile.photos?.[0]?.value
        }
      });
    } else {
      // Update user info
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name: profile.displayName || profile.username,
          avatarUrl: profile.photos?.[0]?.value,
          email
        }
      });
    }

    return done(null, user);
  } catch (error) {
    return done(error, null);
  }
  }));
} else {
  console.warn('GitHub OAuth not configured: OAUTH_GITHUB_CLIENT_ID and OAUTH_GITHUB_CLIENT_SECRET are required');
}

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
        createdAt: true
      }
    });
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

