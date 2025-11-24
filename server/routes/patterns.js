import express from 'express';
import prisma from '../db.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { formatPatternWithMetadata } from '../utils/patternFormatter.js';

const router = express.Router();

// Create pattern
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      type,
      elementId,
      patternCode,
      title,
      artistName,
      versionName,
      genre,
      isPublic,
      metadata
    } = req.body;

    if (!type || !patternCode) {
      return res.status(400).json({ error: 'Type and pattern code are required' });
    }

    if (!['channel', 'master'].includes(type)) {
      return res.status(400).json({ error: 'Type must be "channel" or "master"' });
    }

    // Get user's default artist name if not provided
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { artistName: true }
    });

    const finalArtistName = artistName || user?.artistName || req.user.name;

    // Determine version number (get latest version for this pattern)
    const latestPattern = await prisma.pattern.findFirst({
      where: {
        userId: req.user.id,
        type,
        ...(elementId && { elementId })
      },
      orderBy: { version: 'desc' }
    });

    const version = latestPattern ? latestPattern.version + 1 : 1;

    // Format pattern code with metadata
    const formattedCode = formatPatternWithMetadata({
      patternCode,
      title,
      artistName: finalArtistName,
      version,
      versionName
    });

    // Create pattern
    const pattern = await prisma.pattern.create({
      data: {
        userId: req.user.id,
        type,
        elementId: elementId || null,
        patternCode: formattedCode,
        title: title || null,
        artistName: finalArtistName,
        genre: genre || null,
        version,
        versionName: versionName || null,
        isPublic: isPublic || false,
        metadata: metadata || {}
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            artistName: true,
            avatarUrl: true
          }
        }
      }
    });

    res.status(201).json(pattern);
  } catch (error) {
    console.error('Error creating pattern:', error);
    res.status(500).json({ error: 'Failed to create pattern' });
  }
});

// List patterns
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { type, isPublic: publicOnly, shared } = req.query;
    const userId = req.isAuthenticated && req.isAuthenticated() ? req.user.id : null;

    let where = {};

    if (type && ['channel', 'master'].includes(type)) {
      where.type = type;
    }

    if (shared === 'true' && userId) {
      // Get patterns shared with user
      const sharedPatterns = await prisma.patternShare.findMany({
        where: { sharedWithUserId: userId },
        include: {
          pattern: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  artistName: true,
                  avatarUrl: true
                }
              }
            }
          }
        }
      });

      return res.json(sharedPatterns.map(share => share.pattern));
    }

    if (publicOnly === 'true') {
      where.isPublic = true;
    } else if (userId) {
      // Show user's own patterns + public patterns
      where.OR = [
        { userId },
        { isPublic: true }
      ];
    } else {
      // Not authenticated - only public patterns
      where.isPublic = true;
    }

    const patterns = await prisma.pattern.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            artistName: true,
            avatarUrl: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    res.json(patterns);
  } catch (error) {
    console.error('Error fetching patterns:', error);
    res.status(500).json({ error: 'Failed to fetch patterns' });
  }
});

// Get pattern by ID
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const userId = req.isAuthenticated && req.isAuthenticated() ? req.user.id : null;

    const pattern = await prisma.pattern.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            artistName: true,
            avatarUrl: true
          }
        }
      }
    });

    if (!pattern) {
      return res.status(404).json({ error: 'Pattern not found' });
    }

    // Check access
    if (!pattern.isPublic && pattern.userId !== userId) {
      // Check if shared with user
      if (userId) {
        const share = await prisma.patternShare.findUnique({
          where: {
            patternId_sharedWithUserId: {
              patternId: pattern.id,
              sharedWithUserId: userId
            }
          }
        });

        if (!share) {
          return res.status(403).json({ error: 'Access denied' });
        }
      } else {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json(pattern);
  } catch (error) {
    console.error('Error fetching pattern:', error);
    res.status(500).json({ error: 'Failed to fetch pattern' });
  }
});

// Update pattern
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const pattern = await prisma.pattern.findUnique({
      where: { id: req.params.id }
    });

    if (!pattern) {
      return res.status(404).json({ error: 'Pattern not found' });
    }

    if (pattern.userId !== req.user.id) {
      return res.status(403).json({ error: 'Cannot update another user\'s pattern' });
    }

    const {
      patternCode,
      title,
      artistName,
      versionName,
      genre,
      isPublic,
      metadata
    } = req.body;

    // Get user's default artist name if not provided
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { artistName: true }
    });

    const finalArtistName = artistName || user?.artistName || req.user.name;

    // Format pattern code with metadata
    const formattedCode = formatPatternWithMetadata({
      patternCode: patternCode || pattern.patternCode,
      title: title !== undefined ? title : pattern.title,
      artistName: finalArtistName,
      version: pattern.version,
      versionName: versionName !== undefined ? versionName : pattern.versionName
    });

    const updated = await prisma.pattern.update({
      where: { id: req.params.id },
      data: {
        ...(patternCode !== undefined && { patternCode: formattedCode }),
        ...(title !== undefined && { title }),
        ...(artistName !== undefined && { artistName: finalArtistName }),
        ...(genre !== undefined && { genre }),
        ...(versionName !== undefined && { versionName }),
        ...(isPublic !== undefined && { isPublic }),
        ...(metadata !== undefined && { metadata })
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            artistName: true,
            avatarUrl: true
          }
        }
      }
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating pattern:', error);
    res.status(500).json({ error: 'Failed to update pattern' });
  }
});

// Delete pattern
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const pattern = await prisma.pattern.findUnique({
      where: { id: req.params.id }
    });

    if (!pattern) {
      return res.status(404).json({ error: 'Pattern not found' });
    }

    if (pattern.userId !== req.user.id) {
      return res.status(403).json({ error: 'Cannot delete another user\'s pattern' });
    }

    await prisma.pattern.delete({
      where: { id: req.params.id }
    });

    res.json({ message: 'Pattern deleted successfully' });
  } catch (error) {
    console.error('Error deleting pattern:', error);
    res.status(500).json({ error: 'Failed to delete pattern' });
  }
});

// Share pattern with users
router.post('/:id/share', requireAuth, async (req, res) => {
  try {
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds array is required' });
    }

    const pattern = await prisma.pattern.findUnique({
      where: { id: req.params.id }
    });

    if (!pattern) {
      return res.status(404).json({ error: 'Pattern not found' });
    }

    if (pattern.userId !== req.user.id) {
      return res.status(403).json({ error: 'Cannot share another user\'s pattern' });
    }

    // Create shares
    const shares = await Promise.all(
      userIds.map(userId =>
        prisma.patternShare.upsert({
          where: {
            patternId_sharedWithUserId: {
              patternId: pattern.id,
              sharedWithUserId: userId
            }
          },
          create: {
            patternId: pattern.id,
            sharedWithUserId: userId
          },
          update: {}
        })
      )
    );

    res.json({ message: 'Pattern shared successfully', shares });
  } catch (error) {
    console.error('Error sharing pattern:', error);
    res.status(500).json({ error: 'Failed to share pattern' });
  }
});

// Get users who saved/use this pattern
router.get('/:id/users', async (req, res) => {
  try {
    const pattern = await prisma.pattern.findUnique({
      where: { id: req.params.id },
      select: { userCount: true }
    });

    if (!pattern) {
      return res.status(404).json({ error: 'Pattern not found' });
    }

    // Get users who have this pattern shared with them
    const shares = await prisma.patternShare.findMany({
      where: { patternId: req.params.id },
      include: {
        sharedWithUser: {
          select: {
            id: true,
            name: true,
            artistName: true,
            avatarUrl: true
          }
        }
      }
    });

    res.json({
      userCount: pattern.userCount,
      sharedWith: shares.map(s => s.sharedWithUser)
    });
  } catch (error) {
    console.error('Error fetching pattern users:', error);
    res.status(500).json({ error: 'Failed to fetch pattern users' });
  }
});

export default router;

