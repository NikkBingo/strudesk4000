import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

import './config/passport.js'; // Initialize passport strategies
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import patternRoutes from './routes/patterns.js';

dotenv.config();

const app = express();
const prisma = new PrismaClient();

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

// Serve static files from the frontend build
const publicPath = path.join(__dirname, 'public');
console.log('Serving static files from:', publicPath);

// Check if public directory exists
import { existsSync } from 'fs';
if (!existsSync(publicPath)) {
  console.warn(`⚠️  Public directory not found at ${publicPath}. Frontend may not be built.`);
} else {
  app.use(express.static(publicPath));
  
  // Serve index.html for all non-API routes (SPA routing)
  app.get('*', (req, res) => {
    // Don't serve index.html for API routes
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    const indexPath = path.join(publicPath, 'index.html');
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
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

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Frontend URL: ${frontendUrl}`);
  console.log(`Test mode: ${process.env.TEST_MODE ? 'enabled' : 'disabled'}`);
  if (!process.env.OAUTH_GOOGLE_CLIENT_ID && !process.env.OAUTH_GITHUB_CLIENT_ID) {
    console.log('⚠️  OAuth not configured - use /api/auth/test-login for testing');
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

