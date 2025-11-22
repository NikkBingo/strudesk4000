// Write to both stdout and stderr
const log = (...args) => {
  console.log(...args);
  console.error(...args);
};

// Force immediate output
process.stdout.write('📦 [1/5] Loading dependencies...\n');
process.stderr.write('📦 [1/5] Loading dependencies...\n');
log('📦 [1/5] Loading dependencies...');

import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs';
import { PrismaClient } from '@prisma/client';

log('✅ [2/5] Dependencies loaded');

log('📦 [3/5] Loading routes...');
import './config/passport.js'; // Initialize passport strategies
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import patternRoutes from './routes/patterns.js';
log('✅ [4/5] Routes loaded');

dotenv.config();
log('✅ [5/5] Environment variables loaded');
log('🚀 Starting Express app setup...');

const app = express();

// Initialize Prisma client with error handling and connection timeout
let prisma;
try {
  prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL
      }
    }
  });
  log('✅ Prisma client initialized');
  
  // Test database connection (non-blocking)
  prisma.$connect().then(() => {
    log('✅ Database connection successful');
  }).catch((err) => {
    console.error('⚠️  Database connection warning (server will continue):', err.message);
  });
} catch (error) {
  console.error('❌ Failed to initialize Prisma client:', error);
  // Create a stub that will fail gracefully on use
  prisma = null;
}

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
// Allow Railway app URL or custom frontend URL
const frontendUrl = process.env.FRONTEND_URL || process.env.RAILWAY_PUBLIC_DOMAIN 
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
  : 'http://localhost:3000';

app.use(cors({
  origin: frontendUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_PUBLIC_DOMAIN,
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_PUBLIC_DOMAIN ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// API Routes (must come before static file serving)
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/patterns', patternRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
    log(`Test mode: ${process.env.TEST_MODE ? 'enabled' : 'disabled'}`);
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

