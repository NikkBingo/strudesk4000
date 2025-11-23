/**
 * Authentication middleware
 * Verifies that the user is authenticated via session
 * In test mode, automatically creates/uses a test user if not authenticated
 */

import { isTestMode } from '../utils/config.js';

export const requireAuth = async (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  
  // In test mode, create/use a test user automatically
  if (isTestMode()) {
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

      // Set the test user as the authenticated user
      req.user = testUser;
      return next();
    } catch (error) {
      // If database is unavailable in test mode, use a mock test user
      const isDbConnectionError = 
        error.name === 'PrismaClientInitializationError' ||
        error.constructor?.name === 'PrismaClientInitializationError' ||
        error.message?.includes("Can't reach database") ||
        error.message?.includes('database server') ||
        String(error).includes("Can't reach database");
      
      if (isDbConnectionError) {
        console.warn('⚠️  Database unavailable in test mode, using mock test user for requireAuth');
        req.user = {
          id: 'test-user-mock-1',
          email: 'test@strudel.test',
          name: 'Test User',
          artistName: 'Test Artist',
          avatarUrl: null
        };
        return next();
      } else {
        console.error('Error creating test user in requireAuth:', error);
        return res.status(500).json({ error: 'Failed to create test user' });
      }
    }
  }
  
  return res.status(401).json({ error: 'Authentication required' });
};

export const optionalAuth = (req, res, next) => {
  // This middleware allows the request to proceed whether or not user is authenticated
  // Useful for endpoints that show different data based on auth status
  next();
};

