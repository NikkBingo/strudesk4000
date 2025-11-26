// MINIMAL TEST - If you see this, Node.js is running
console.error('=== NODE.JS STARTING ===');
console.log('=== NODE.JS STARTING ===');
process.stdout.write('=== NODE.JS STARTING ===\n');
process.stderr.write('=== NODE.JS STARTING ===\n');

// Write to both stdout and stderr
const log = (...args) => {
  console.log(...args);
  console.error(...args);
};

log('📦 [1/5] Loading dependencies...');

import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs';
import { createRequire } from 'module';

log('✅ [2/5] Dependencies loaded');

log('📦 [3/5] Loading routes...');
import './config/passport.js'; // Initialize passport strategies
import prisma from './db.js'; // Import shared Prisma client instance
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import patternRoutes from './routes/patterns.js';
import { isTestMode } from './utils/config.js';
log('✅ [4/5] Routes loaded');

dotenv.config();
log('✅ [5/5] Environment variables loaded');
log('🚀 Starting Express app setup...');

const app = express();

// Test database connection (non-blocking)
// Note: prismaReady from db.js handles retries, this is just an initial test
prisma.$connect().then(() => {
  log('✅ Initial database connection test successful');
}).catch((err) => {
  console.error('⚠️  Initial database connection test failed (retries will continue in background):', err.message);
  if (err.code === 'P1001') {
    console.error('   → Database server is unreachable - check Railway service dependencies');
  }
});

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
// Allow Railway app URL or custom frontend URL
const frontendUrl = process.env.FRONTEND_URL || (process.env.RAILWAY_PUBLIC_DOMAIN 
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
  : 'http://localhost:3000');

console.log('🔧 CORS configured for origin:', frontendUrl);
console.log('🔧 NODE_ENV:', process.env.NODE_ENV);
console.log('🔧 RAILWAY_PUBLIC_DOMAIN:', process.env.RAILWAY_PUBLIC_DOMAIN);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow frontend URL
    if (origin === frontendUrl) {
      return callback(null, true);
    }
    
    // In development, allow localhost
    if (process.env.NODE_ENV !== 'production' && origin.startsWith('http://localhost')) {
      return callback(null, true);
    }
    
    callback(null, true); // Allow all origins for now - can restrict later
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Set-Cookie'],
  exposedHeaders: ['Set-Cookie']
}));

// Trust proxy (Railway uses reverse proxy that terminates SSL)
// This is critical for express-session to correctly set secure cookies
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_PUBLIC_DOMAIN;
// Since frontend and backend are served from the same domain (via static files),
// we use 'lax' for same-site cookies (works with same origin)
// Only use 'none' if frontend and backend are on different domains
// Note: Don't set domain attribute - let browser use current domain automatically

// Configure PostgreSQL session store for persistent sessions
// connect-pg-simple is CommonJS - use createRequire for ES modules
let sessionStore;
if (process.env.DATABASE_URL) {
  try {
    // Use createRequire for CommonJS module in ES module context
    const require = createRequire(import.meta.url);
    const pgSession = require('connect-pg-simple');
    const PgSessionStore = pgSession(session);
    sessionStore = new PgSessionStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true, // Automatically create sessions table if it doesn't exist
      tableName: 'user_sessions' // Custom table name
    });
    console.log('✅ PostgreSQL session store configured');
  } catch (error) {
    console.error('❌ Failed to configure PostgreSQL session store:', error.message);
    console.log('⚠️ Falling back to MemoryStore (sessions will not persist across restarts)');
    sessionStore = undefined;
  }
}

const sessionConfig = {
  name: 'strudel.session',
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  store: sessionStore, // Use PostgreSQL store instead of MemoryStore
  resave: false, // Don't save session if unmodified (PostgreSQL handles this better)
  saveUninitialized: true, // Save new sessions even if they haven't been modified (needed for cookies)
  rolling: true, // Reset expiration on every request
  cookie: {
    // Don't set domain - browser will use current domain automatically (better for same-origin)
    secure: isProduction, // HTTPS only in production
    httpOnly: true,
    sameSite: 'lax', // Use 'lax' for same-origin (frontend/backend on same domain)
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
    overwrite: true // Overwrite existing cookies with the same name
  }
};

console.log('🍪 Session config:', {
  name: sessionConfig.name,
  store: sessionStore ? 'PostgreSQL (persistent)' : 'MemoryStore (temporary)',
  secure: sessionConfig.cookie.secure,
  sameSite: sessionConfig.cookie.sameSite,
  httpOnly: sessionConfig.cookie.httpOnly,
  maxAge: sessionConfig.cookie.maxAge
});

app.use(session(sessionConfig));

// Middleware to log cookie setting for debugging
app.use((req, res, next) => {
  const originalEnd = res.end;
  const originalWriteHead = res.writeHead;
  
  // Log when headers are written (cookies should be set by then)
  res.writeHead = function(statusCode, statusMessage, headers) {
    const setCookieHeaders = res.getHeader('Set-Cookie') || (headers && headers['Set-Cookie']);
    if (setCookieHeaders) {
      console.log('🍪 [RESPONSE WRITEHEAD] Set-Cookie header:', Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders]);
    } else {
      // Check all headers
      const allHeaders = res.getHeaders();
      if (Object.keys(allHeaders).length > 0) {
        console.log('🍪 [RESPONSE WRITEHEAD] All headers:', Object.keys(allHeaders));
      }
    }
    if (typeof statusCode === 'number') {
      return originalWriteHead.call(this, statusCode, statusMessage, headers);
    } else {
      return originalWriteHead.call(this, statusCode, statusMessage);
    }
  };
  
  res.end = function(...args) {
    // Log Set-Cookie headers being sent
    const setCookieHeaders = res.getHeader('Set-Cookie');
    if (setCookieHeaders) {
      console.log('🍪 [RESPONSE END] Set-Cookie header:', Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders]);
    } else {
      console.log('🍪 [RESPONSE END] No Set-Cookie header found');
    }
    originalEnd.apply(this, args);
  };
  next();
});

app.use(passport.initialize());
app.use(passport.session());

// Debug middleware to log session retrieval and handle stale cookies
app.use((req, res, next) => {
  // Log session info after passport.session() middleware
  if (req.session) {
    const cookieHeader = req.headers.cookie || '';
    const sessionCookieMatch = cookieHeader.match(/strudel\.session=([^;]+)/);
    const cookieSessionId = sessionCookieMatch ? sessionCookieMatch[1] : null;
    
    console.log('[session-middleware] Session ID:', req.sessionID);
    console.log('[session-middleware] Cookie session ID:', cookieSessionId || 'none');
    console.log('[session-middleware] Session passport:', req.session.passport);
    console.log('[session-middleware] Request user:', req.user ? req.user.id : 'none');
    
    // Check if cookie session ID doesn't match the loaded session ID
    // This happens when the cookie references a session that doesn't exist in the store
    // (e.g., old MemoryStore sessions that don't exist in PostgreSQL)
    if (cookieSessionId && cookieSessionId !== req.sessionID && !req.session.passport) {
      console.log('[session-middleware] WARNING: Stale cookie detected!');
      console.log('[session-middleware] Cookie ID:', cookieSessionId, 'does not match session ID:', req.sessionID);
      console.log('[session-middleware] This old session likely came from MemoryStore before the PostgreSQL switch.');
      console.log('[session-middleware] Clearing stale cookie - a new session cookie will be set on the next request.');
      
      // Clear the stale cookie - express-session will create a new session and cookie automatically
      res.clearCookie('strudel.session', {
        path: '/',
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax'
      });
    }
  }
  next();
});

// API Routes (must come before static file serving)
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/patterns', patternRoutes);

// Health check with database status
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      server: 'running',
      database: 'unknown'
    }
  };
  
  // Check database connection
  try {
    await prisma.$queryRaw`SELECT 1`;
    health.services.database = 'connected';
    health.database = {
      connected: true,
      host: process.env.DATABASE_URL ? (() => {
        try {
          const url = new URL(process.env.DATABASE_URL);
          return `${url.hostname}:${url.port || '5432'}`;
        } catch {
          return 'unknown';
        }
      })() : 'not configured'
    };
  } catch (error) {
    health.services.database = 'disconnected';
    health.database = {
      connected: false,
      error: error.code || 'unknown',
      message: error.message || 'Connection failed'
    };
    health.status = 'degraded';
  }
  
  const statusCode = health.services.database === 'connected' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Database diagnostics endpoint (for debugging)
app.get('/api/diagnostics/database', (req, res) => {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    environment: {
      nodeEnv: process.env.NODE_ENV || 'not set',
      railwayDomain: process.env.RAILWAY_PUBLIC_DOMAIN || 'not set',
      hasDatabaseUrl: !!process.env.DATABASE_URL
    },
    database: null,
    troubleshooting: []
  };
  
  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      diagnostics.database = {
        protocol: url.protocol,
        host: url.hostname,
        port: url.port || '5432',
        database: url.pathname?.slice(1) || 'unknown',
        user: url.username || 'unknown',
        hasPassword: !!url.password,
        isRailwayInternal: url.hostname.includes('railway.internal'),
        isRailwayPublic: url.hostname.includes('railway.app')
      };
      
      // Add troubleshooting tips based on connection type
      if (diagnostics.database.isRailwayInternal) {
        diagnostics.troubleshooting.push(
          'Using Railway internal network (postgres.railway.internal)',
          'Ensure Postgres service is running and linked as dependency',
          'Check: App Service → Settings → Dependencies → Postgres should be listed',
          'Try restarting Postgres service first, then app service'
        );
      } else if (diagnostics.database.isRailwayPublic) {
        diagnostics.troubleshooting.push(
          'Using Railway public domain (may require SSL)',
          'Check if database requires SSL connection',
          'Verify DATABASE_URL includes ?sslmode=require if needed'
        );
      }
    } catch (error) {
      diagnostics.database = {
        error: 'Invalid DATABASE_URL format',
        message: error.message
      };
      diagnostics.troubleshooting.push('DATABASE_URL format is invalid - check Railway variables');
    }
  } else {
    diagnostics.database = {
      error: 'DATABASE_URL not set',
      message: 'Environment variable DATABASE_URL is missing'
    };
    diagnostics.troubleshooting.push(
      'DATABASE_URL should be set automatically when Postgres service is linked',
      'Check: App Service → Variables → DATABASE_URL',
      'If missing, ensure Postgres service is added as a dependency'
    );
  }
  
  res.json(diagnostics);
});

// Root route - API information (fallback if frontend not available)
app.get('/', (req, res) => {
  const publicPath = path.join(__dirname, 'public');
  const indexPath = path.join(publicPath, 'index.html');
  
  // Try to serve frontend if available
  if (existsSync(indexPath)) {
    return res.sendFile(path.resolve(indexPath));
  }
  
  // Otherwise return API info
  res.json({
    name: 'Strudel Pattern Mixer API',
    version: '1.0.0',
    status: 'running',
    message: 'Frontend not built. Please check deployment logs.',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      users: '/api/users',
      patterns: '/api/patterns'
    }
  });
});

// Serve static files from the frontend build
const publicPath = path.join(__dirname, 'public');
log('__dirname:', __dirname);
log('Serving static files from:', publicPath);
log('Public path exists:', existsSync(publicPath));

// Check if public directory exists
if (!existsSync(publicPath)) {
  log(`⚠️  Public directory not found at ${publicPath}. Frontend may not be built.`);
  log('Current working directory:', process.cwd());
  try {
    const files = readdirSync(__dirname);
    log('Files in __dirname:', files.join(', '));
  } catch (e) {
    log('Could not read __dirname:', e.message);
  }
} else {
  log('✓ Public directory found. Serving static files.');
  const files = readdirSync(publicPath);
  log('Files in public directory:', files.join(', '));
  
  // Serve static files with proper headers
  app.use(express.static(publicPath, {
    maxAge: '1y',
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      // Set proper MIME types for JS and CSS
      if (filePath.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript');
      } else if (filePath.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css');
      }
    }
  }));
  
  // Serve index.html for all non-API routes (SPA routing)
  app.get('*', (req, res, next) => {
    // Don't serve index.html for API routes
    if (req.path.startsWith('/api')) {
      return next(); // Let API routes handle their own 404s
    }
    const indexPath = path.join(publicPath, 'index.html');
    if (existsSync(indexPath)) {
      res.sendFile(path.resolve(indexPath));
    } else {
      console.error('index.html not found at:', indexPath);
      res.status(404).json({ error: 'Frontend not built. index.html not found.' });
    }
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Railway sets PORT automatically, but fallback to 3001 for local dev
const PORT = process.env.PORT || process.env.RAILWAY_PORT || 3001;

// Force immediate output - Railway might be buffering
process.stdout.write('🚀 SERVER STARTING...\n');
process.stderr.write('🚀 SERVER STARTING...\n');

log(`🚀 Attempting to start server on port ${PORT}...`);
log(`Environment: ${process.env.NODE_ENV || 'development'}`);
log(`DATABASE_URL: ${process.env.DATABASE_URL ? 'set' : 'not set'}`);
log(`PORT: ${PORT}`);

// Start server with error handling
let server;
try {
  log(`Binding to 0.0.0.0:${PORT}...`);
  server = app.listen(PORT, '0.0.0.0', () => {
    // Force immediate output
    process.stdout.write(`✅✅✅ SERVER IS RUNNING ON PORT ${PORT} ✅✅✅\n`);
    process.stderr.write(`✅✅✅ SERVER IS RUNNING ON PORT ${PORT} ✅✅✅\n`);
    
    log(`✅✅✅ SERVER IS RUNNING ON PORT ${PORT} ✅✅✅`);
    log(`Frontend URL: ${frontendUrl}`);
    log(`Test mode: ${isTestMode() ? 'enabled' : 'disabled'}`);
    if (!process.env.OAUTH_GOOGLE_CLIENT_ID && !process.env.OAUTH_GITHUB_CLIENT_ID) {
      log('⚠️  OAuth not configured - use /api/auth/test-login for testing');
    }
    log(`Server ready to accept connections on http://0.0.0.0:${PORT}`);
  });
  log(`Server listen() called, waiting for callback...`);
} catch (error) {
  process.stdout.write(`❌ Failed to start server: ${error.message}\n`);
  process.stderr.write(`❌ Failed to start server: ${error.message}\n`);
  console.error('❌ Failed to start server:', error);
  console.error('Error stack:', error.stack);
  process.exit(1);
}

// Handle server errors
server.on('error', (err) => {
  console.error('❌ Server error:', err);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
  }
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  if (prisma) {
    await prisma.$disconnect();
  }
  process.exit(0);
});
