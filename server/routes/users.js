import express from 'express';
import prisma from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { isTestMode } from '../utils/config.js';

const router = express.Router();

const requireAdmin = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated() && req.user?.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Admin privileges required' });
};

// Update user profile (requires auth, and must be own profile)
// In test mode, allows updating test user profile without strict auth check
router.put('/:id', requireAuth, async (req, res) => {
  try {
    // In test mode, allow updating the test user profile
    if (isTestMode() && req.params.id === req.user.id) {
      // Allow update
    } else if (req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Cannot update another user\'s profile' });
    }

    const {
      avatarUrl,
      artistName,
      socialLinks,
      profileCompleted,
      name,
      firstName,
      lastName,
      birthDate,
      city,
      country
    } = req.body;

    let parsedBirthDate;
    if (birthDate !== undefined) {
      if (birthDate === null || birthDate === '') {
        parsedBirthDate = null;
      } else {
        const dateValue = new Date(birthDate);
        if (Number.isNaN(dateValue.getTime())) {
          return res.status(400).json({ error: 'Invalid birth date format' });
        }
        parsedBirthDate = dateValue;
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(artistName !== undefined && { artistName }),
        ...(socialLinks !== undefined && { socialLinks }),
        ...(profileCompleted !== undefined && { profileCompleted: !!profileCompleted }),
        ...(name !== undefined && { name }),
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(birthDate !== undefined && { birthDate: parsedBirthDate }),
        ...(city !== undefined && { city }),
        ...(country !== undefined && { country })
      },
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        city: true,
        country: true,
        oauthProvider: true,
        avatarUrl: true,
        artistName: true,
        socialLinks: true,
        profileCompleted: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// List all users (for profiles page)
router.get('/', async (req, res) => {
  try {
    const { search, limit = 50 } = req.query;
    
    const where = {};
    if (search && search.length >= 2) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { artistName: { contains: search, mode: 'insensitive' } }
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        city: true,
        country: true,
        email: true,
        avatarUrl: true,
        artistName: true,
        role: true,
        status: true,
        profileCompleted: true,
        socialLinks: true,
        createdAt: true,
        _count: {
          select: {
            patterns: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit)
    });

    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Search users (for sharing patterns)
router.get('/search/:query', requireAuth, async (req, res) => {
  try {
    const query = req.params.query.toLowerCase();
    
    if (query.length < 2) {
      return res.json([]);
    }

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { artistName: { contains: query, mode: 'insensitive' } }
        ],
        NOT: {
          id: req.user.id // Exclude current user
        }
      },
      select: {
        id: true,
        name: true,
        email: true,
        avatarUrl: true,
        artistName: true
      },
      take: 10
    });

    res.json(users);
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// Admin: list users with moderation info
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        city: true,
        country: true,
        email: true,
        avatarUrl: true,
        artistName: true,
        role: true,
        status: true,
        profileCompleted: true,
        createdAt: true,
        emailVerifiedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(users);
  } catch (error) {
    console.error('Admin list users error:', error);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

router.post('/:id/block', requireAdmin, async (req, res) => {
  try {
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { status: 'blocked' }
    });
    res.json({ message: 'User blocked', user: sanitizeAdminUser(updated) });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ error: 'Failed to block user' });
  }
});

router.post('/:id/unblock', requireAdmin, async (req, res) => {
  try {
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { status: 'active' }
    });
    res.json({ message: 'User unblocked', user: sanitizeAdminUser(updated) });
  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

const sanitizeAdminUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  status: user.status,
  role: user.role
});

// Get user profile (keep last so admin routes take precedence)
router.get('/:id', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        birthDate: true,
        city: true,
        country: true,
        oauthProvider: true,
        avatarUrl: true,
        artistName: true,
        socialLinks: true,
        role: true,
        status: true,
        profileCompleted: true,
        createdAt: true,
        _count: {
          select: {
            patterns: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;

