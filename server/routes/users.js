import express from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const prisma = new PrismaClient();

// Get user profile
router.get('/:id', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        artistName: true,
        socialLinks: true,
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

// Update user profile (requires auth, and must be own profile)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    // Check if user is updating their own profile
    if (req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Cannot update another user\'s profile' });
    }

    const { artistName, socialLinks } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(artistName !== undefined && { artistName }),
        ...(socialLinks !== undefined && { socialLinks })
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        artistName: true,
        socialLinks: true,
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

export default router;

