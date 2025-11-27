import { EventEmitter } from 'events';
import crypto from 'crypto';
import os from 'os';
import prisma from '../db.js';

const LIVE_STATUSES = new Set(['live', 'published']);
const CACHE_TTL_MS = 5_000;

const MIN_DELAY_MS = 0;
const MAX_DELAY_MS = 5_000;

function sanitizeTitle(title) {
  if (!title || typeof title !== 'string') {
    return 'Untitled Session';
  }
  return title.trim().slice(0, 80) || 'Untitled Session';
}

function slugifyTitle(title) {
  const base = sanitizeTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const randomSuffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${randomSuffix}`;
}

function buildMergedPatterns(channels) {
  const liveChannels = channels.filter(channel => LIVE_STATUSES.has(channel.status));
  if (!liveChannels.length) {
    return { masterCode: '', mergedStack: '' };
  }

  const trimmedChannels = liveChannels
    .map((channel, index) => {
      const safeCode = (channel.code || '').trim();
      if (!safeCode) {
        return null;
      }
      const label =
        channel.name ||
        channel.elementId ||
        `channel-${index + 1}`;
      const prefix = `// ${label} — ${channel.user?.artistName || channel.user?.name || 'anonymous'}`;
      return {
        code: safeCode,
        annotated: `${prefix}\n${safeCode}`
      };
    })
    .filter(Boolean);

  if (!trimmedChannels.length) {
    return { masterCode: '', mergedStack: '' };
  }

  const masterCode = trimmedChannels.map(item => item.annotated).join('\n\n');
  const mergedStack = `stack([\n  ${trimmedChannels.map(item => item.code).join(',\n  ')}\n])`;
  return { masterCode, mergedStack };
}

function toParticipantPayload(participant) {
  return {
    id: participant.id,
    role: participant.role,
    joinedAt: participant.joinedAt,
    user: participant.user && {
      id: participant.user.id,
      name: participant.user.name,
      artistName: participant.user.artistName,
      avatarUrl: participant.user.avatarUrl
    }
  };
}

function toChannelPayload(channel) {
  return {
    id: channel.id,
    sessionId: channel.sessionId,
    userId: channel.userId,
    elementId: channel.elementId,
    name: channel.name,
    status: channel.status,
    code: channel.code,
    volume: channel.volume,
    pan: channel.pan,
    metadata: channel.metadata,
    lastEvaluatedAt: channel.lastEvaluatedAt,
    updatedAt: channel.updatedAt,
    createdAt: channel.createdAt,
    user: channel.user && {
      id: channel.user.id,
      name: channel.user.name,
      artistName: channel.user.artistName,
      avatarUrl: channel.user.avatarUrl
    }
  };
}

function toInvitePayload(invite) {
  if (!invite) return null;
  return {
    id: invite.id,
    status: invite.status,
    createdAt: invite.createdAt,
    respondedAt: invite.respondedAt,
    sessionId: invite.sessionId,
    inviter: invite.inviter && {
      id: invite.inviter.id,
      name: invite.inviter.name,
      artistName: invite.inviter.artistName,
      avatarUrl: invite.inviter.avatarUrl
    },
    session: invite.session && {
      id: invite.session.id,
      title: invite.session.title,
      slug: invite.session.slug,
      ownerId: invite.session.ownerId
    }
  };
}

function shapeSession(session) {
  if (!session) {
    return null;
  }
  return {
    id: session.id,
    slug: session.slug,
    title: session.title,
    status: session.status,
    masterCode: session.masterCode || '',
    mergedStack: session.mergedStack || '',
    applyDelayMs: session.applyDelayMs,
    cpuStats: session.cpuStats || {},
    settings: session.settings || {},
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    owner: session.owner && {
      id: session.owner.id,
      name: session.owner.name,
      artistName: session.owner.artistName,
      avatarUrl: session.owner.avatarUrl
    },
    participants: Array.isArray(session.participants)
      ? session.participants.map(toParticipantPayload)
      : [],
    channels: Array.isArray(session.channels)
      ? session.channels.map(toChannelPayload)
      : []
  };
}

function sampleCpuStats() {
  const memoryUsage = process.memoryUsage();
  const loadAvg = os.loadavg();
  const warnings = [];
  if (Array.isArray(loadAvg) && loadAvg[0] > 2.5) {
    warnings.push(`High 1m load (${loadAvg[0].toFixed(2)})`);
  }
  const heapUsedMb = memoryUsage.heapUsed / (1024 * 1024);
  if (heapUsedMb > 700) {
    warnings.push(`Heap usage ${heapUsedMb.toFixed(0)} MB`);
  }

  return {
    timestamp: new Date().toISOString(),
    loadAvg,
    memory: {
      rss: memoryUsage.rss,
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal
    },
    cpu: process.cpuUsage(),
    warning: warnings.length ? warnings.join('; ') : null
  };
}

class CollabSessionManager extends EventEmitter {
  constructor() {
    super();
    this.sessionCache = new Map();
    this.pendingMasterTimers = new Map();
    this.slugToId = new Map();
  }

  async resolveSessionId(identifier) {
    if (!identifier) {
      return null;
    }
    if (this.sessionCache.has(identifier)) {
      return identifier;
    }
    if (this.slugToId.has(identifier)) {
      return this.slugToId.get(identifier);
    }
    const session = await prisma.collabSession.findFirst({
      where: {
        OR: [
          { id: identifier },
          { slug: identifier }
        ]
      },
      select: {
        id: true,
        slug: true
      }
    });
    if (!session) {
      return null;
    }
    if (session.slug) {
      this.slugToId.set(session.slug, session.id);
    }
    return session.id;
  }

  async requireSessionId(identifier) {
    const sessionId = await this.resolveSessionId(identifier);
    if (!sessionId) {
      throw new Error('Session not found');
    }
    return sessionId;
  }

  async createSession({ ownerId, title }) {
    const safeTitle = sanitizeTitle(title);
    const slug = slugifyTitle(safeTitle);

    const session = await prisma.collabSession.create({
      data: {
        ownerId,
        title: safeTitle,
        slug
      }
    });

    await prisma.sessionParticipant.create({
      data: {
        sessionId: session.id,
        userId: ownerId,
        role: 'owner'
      }
    });

    return this.refreshSessionCache(session.id);
  }

  async getSessionSnapshot(sessionId, { forceRefresh = false } = {}) {
    sessionId = await this.resolveSessionId(sessionId);
    if (!sessionId) {
      return null;
    }
    const cached = this.sessionCache.get(sessionId);
    if (cached && !forceRefresh && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.snapshot;
    }
    return this.refreshSessionCache(sessionId);
  }

  async refreshSessionCache(sessionId) {
    const session = await prisma.collabSession.findUnique({
      where: { id: sessionId },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            artistName: true,
            avatarUrl: true
          }
        },
        participants: {
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
        },
        channels: {
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
          orderBy: [
            { status: 'desc' },
            { updatedAt: 'desc' }
          ]
        }
      }
    });

    if (!session) {
      this.sessionCache.delete(sessionId);
      return null;
    }

    const snapshot = shapeSession(session);
    this.sessionCache.set(sessionId, {
      snapshot,
      cachedAt: Date.now()
    });
    if (snapshot?.slug) {
      this.slugToId.set(snapshot.slug, snapshot.id);
    }
    return snapshot;
  }

  async joinSession(sessionId, userId) {
    sessionId = await this.requireSessionId(sessionId);
    await prisma.sessionParticipant.upsert({
      where: {
        sessionId_userId: {
          sessionId,
          userId
        }
      },
      create: {
        sessionId,
        userId
      },
      update: {}
    });
    return this.refreshSessionCache(sessionId);
  }

  async leaveSession(sessionId, userId) {
    sessionId = await this.requireSessionId(sessionId);
    await prisma.sessionParticipant.deleteMany({
      where: {
        sessionId,
        userId
      }
    });
    return this.refreshSessionCache(sessionId);
  }

  async upsertChannel(sessionId, userId, payload) {
    sessionId = await this.requireSessionId(sessionId);
    const {
      channelId,
      code = '',
      status = 'draft',
      elementId = null,
      name = null,
      volume = null,
      pan = null,
      metadata = null
    } = payload;

    const trimmedCode = (code || '').trim();
    if (!trimmedCode) {
      throw new Error('Channel code cannot be empty');
    }

    let channel;
    if (channelId) {
      channel = await prisma.sessionChannel.update({
        where: { id: channelId },
        data: {
          code: trimmedCode,
          status,
          elementId,
          name,
          volume,
          pan,
          metadata,
          lastEvaluatedAt: new Date()
        }
      });
    } else {
      channel = await prisma.sessionChannel.create({
        data: {
          sessionId,
          userId,
          code: trimmedCode,
          status,
          elementId,
          name,
          volume,
          pan,
          metadata,
          lastEvaluatedAt: new Date()
        }
      });
    }

    await prisma.sessionChannelRevision.create({
      data: {
        channelId: channel.id,
        sessionId,
        userId,
        code: trimmedCode,
        appliedToMaster: LIVE_STATUSES.has(status)
      }
    });

    this.scheduleMasterRefresh(sessionId);
    return this.refreshSessionCache(sessionId);
  }

  async publishChannel(sessionId, channelId, status = 'live') {
    sessionId = await this.requireSessionId(sessionId);
    await prisma.sessionChannel.update({
      where: { id: channelId },
      data: {
        status,
        lastEvaluatedAt: new Date()
      }
    });
    this.scheduleMasterRefresh(sessionId);
    return this.refreshSessionCache(sessionId);
  }

  async overrideMasterCode(sessionId, userId, masterCode) {
    sessionId = await this.requireSessionId(sessionId);
    const payload = (masterCode || '').trim();
    await prisma.collabSession.update({
      where: { id: sessionId },
      data: {
        masterCode: payload,
        mergedStack: payload,
        updatedAt: new Date()
      }
    });

    return this.refreshSessionCache(sessionId);
  }

  scheduleMasterRefresh(sessionId) {
    if (this.pendingMasterTimers.has(sessionId)) {
      return;
    }
    const snapshot = this.sessionCache.get(sessionId)?.snapshot;
    const dynamicDelay = snapshot
      ? Math.min(Math.max(snapshot.applyDelayMs || 0, MIN_DELAY_MS), MAX_DELAY_MS)
      : 0;
    const timer = setTimeout(() => {
      this.pendingMasterTimers.delete(sessionId);
      this.applyMasterRefresh(sessionId).catch((err) => {
        console.error('Failed to rebuild master stack for session', sessionId, err);
      });
    }, 150 + dynamicDelay);
    this.pendingMasterTimers.set(sessionId, timer);
  }

  async applyMasterRefresh(sessionId) {
    const channels = await prisma.sessionChannel.findMany({
      where: { sessionId },
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
      orderBy: [
        { status: 'desc' },
        { updatedAt: 'desc' }
      ]
    });

    const { masterCode, mergedStack } = buildMergedPatterns(channels);
    const snapshot = await this.getSessionSnapshot(sessionId);
    const cpuHistory = Array.isArray(snapshot?.cpuStats?.recentServerSamples)
      ? snapshot.cpuStats.recentServerSamples
      : [];
    const cpuSample = sampleCpuStats();
    if (cpuSample.warning) {
      console.warn(`[collab][session:${sessionId}] ${cpuSample.warning}`);
    }
    const nextCpuStats = {
      recentServerSamples: [...cpuHistory.slice(-9), cpuSample]
    };

    await prisma.collabSession.update({
      where: { id: sessionId },
      data: {
        masterCode,
        mergedStack,
        cpuStats: nextCpuStats,
        updatedAt: new Date()
      }
    });

    const updatedSnapshot = await this.refreshSessionCache(sessionId);
    this.emit('sessionUpdated', sessionId, updatedSnapshot);
    if (masterCode) {
      this.emit('masterUpdated', sessionId, {
        masterCode: updatedSnapshot.masterCode,
        mergedStack: updatedSnapshot.mergedStack
      });
    }
  }

  async adjustDelay(sessionId, applyDelayMs) {
    sessionId = await this.requireSessionId(sessionId);
    const clamped = Math.min(Math.max(applyDelayMs ?? 0, MIN_DELAY_MS), MAX_DELAY_MS);
    await prisma.collabSession.update({
      where: { id: sessionId },
      data: { applyDelayMs: clamped }
    });
    return this.refreshSessionCache(sessionId);
  }

  async deleteSession(sessionId, userId) {
    sessionId = await this.requireSessionId(sessionId);
    const session = await prisma.collabSession.findUnique({
      where: { id: sessionId },
      select: { ownerId: true, slug: true }
    });
    if (!session) {
      throw new Error('Session not found');
    }
    if (session.ownerId !== userId) {
      throw new Error('Only the session owner can delete this session');
    }
    await prisma.collabSession.delete({
      where: { id: sessionId }
    });
    this.sessionCache.delete(sessionId);
    if (session.slug) {
      this.slugToId.delete(session.slug);
    }
    const timer = this.pendingMasterTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.pendingMasterTimers.delete(sessionId);
    }
    return true;
  }

  async listUserInvites(userId) {
    const invites = await prisma.collabInvite.findMany({
      where: {
        inviteeId: userId,
        status: 'pending'
      },
      include: {
        inviter: {
          select: {
            id: true,
            name: true,
            artistName: true,
            avatarUrl: true
          }
        },
        session: {
          select: {
            id: true,
            title: true,
            slug: true,
            ownerId: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 25
    });
    return invites.map(toInvitePayload);
  }

  async listRecentSessions(userId, limit = 10) {
    const sessions = await prisma.collabSession.findMany({
      where: {
        participants: {
          some: { userId }
        }
      },
      select: {
        id: true,
        slug: true,
        title: true,
        updatedAt: true,
        owner: {
          select: {
            id: true,
            name: true,
            artistName: true,
            avatarUrl: true
          }
        }
      },
      orderBy: { updatedAt: 'desc' },
      take: limit
    });
    return sessions;
  }

  async sendInvites(sessionId, inviterId, inviteeIds = []) {
    sessionId = await this.requireSessionId(sessionId);
    const session = await prisma.collabSession.findUnique({
      where: { id: sessionId },
      select: { ownerId: true }
    });
    if (!session) {
      throw new Error('Session not found');
    }
    if (session.ownerId !== inviterId) {
      throw new Error('Only the session owner can send invites');
    }

    const uniqueIds = Array.isArray(inviteeIds)
      ? [...new Set(inviteeIds.filter(Boolean))].slice(0, 5)
      : [];
    if (!uniqueIds.length) {
      throw new Error('Select at least one user to invite');
    }

    const users = await prisma.user.findMany({
      where: { id: { in: uniqueIds } },
      select: {
        id: true,
        name: true,
        artistName: true,
        avatarUrl: true
      }
    });
    if (!users.length) {
      throw new Error('No matching users found');
    }

    const invites = [];
    for (const invitee of users) {
      if (invitee.id === inviterId) {
        continue;
      }
      const participant = await prisma.sessionParticipant.findUnique({
        where: {
          sessionId_userId: {
            sessionId,
            userId: invitee.id
          }
        }
      });
      if (participant) {
        continue;
      }

      const invite = await prisma.collabInvite.upsert({
        where: {
          sessionId_inviteeId: {
            sessionId,
            inviteeId: invitee.id
          }
        },
        create: {
          sessionId,
          inviterId,
          inviteeId: invitee.id
        },
        update: {
          inviterId,
          status: 'pending',
          respondedAt: null
        },
        include: {
          inviter: {
            select: {
              id: true,
              name: true,
              artistName: true,
              avatarUrl: true
            }
          },
          session: {
            select: {
              id: true,
              title: true,
              slug: true,
              ownerId: true
            }
          }
        }
      });
      invites.push(toInvitePayload(invite));
    }

    if (!invites.length) {
      throw new Error('No eligible users to invite');
    }
    return invites;
  }

  async respondToInvite(inviteId, userId, action) {
    const invite = await prisma.collabInvite.findUnique({
      where: { id: inviteId },
      include: {
        session: {
          select: {
            id: true,
            slug: true,
            title: true
          }
        },
        inviter: {
          select: {
            id: true,
            name: true,
            artistName: true,
            avatarUrl: true
          }
        }
      }
    });
    if (!invite) {
      throw new Error('Invite not found');
    }
    if (invite.inviteeId !== userId) {
      throw new Error('Not authorized to respond to this invite');
    }
    if (invite.status !== 'pending') {
      return { invite: toInvitePayload(invite), session: null };
    }

    const status = action === 'accept' ? 'accepted' : 'declined';
    const updatedInvite = await prisma.collabInvite.update({
      where: { id: inviteId },
      data: {
        status,
        respondedAt: new Date()
      },
      include: {
        inviter: {
          select: {
            id: true,
            name: true,
            artistName: true,
            avatarUrl: true
          }
        },
        session: {
          select: {
            id: true,
            slug: true,
            title: true
          }
        }
      }
    });

    let snapshot = null;
    if (status === 'accepted') {
      snapshot = await this.joinSession(invite.sessionId, userId);
    }
    return {
      invite: toInvitePayload(updatedInvite),
      session: snapshot
    };
  }
}

export const collabSessionManager = new CollabSessionManager();

