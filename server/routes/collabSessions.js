import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { collabSessionManager } from '../services/collabSessionManager.js';

const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
  try {
    const { title } = req.body || {};
    const snapshot = await collabSessionManager.createSession({
      ownerId: req.user.id,
      title
    });
    res.status(201).json(snapshot);
  } catch (error) {
    console.error('Error creating collaboration session:', error);
    res.status(500).json({ error: 'Failed to create collaboration session' });
  }
});

router.get('/invites', requireAuth, async (req, res) => {
  try {
    const invites = await collabSessionManager.listUserInvites(req.user.id);
    res.json(invites);
  } catch (error) {
    console.error('Error fetching invites:', error);
    res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

router.post('/invites/:inviteId/accept', requireAuth, async (req, res) => {
  try {
    const result = await collabSessionManager.respondToInvite(
      req.params.inviteId,
      req.user.id,
      'accept'
    );
    res.json(result);
  } catch (error) {
    console.error('Error accepting invite:', error);
    res.status(400).json({ error: error.message || 'Failed to accept invite' });
  }
});

router.post('/invites/:inviteId/decline', requireAuth, async (req, res) => {
  try {
    const result = await collabSessionManager.respondToInvite(
      req.params.inviteId,
      req.user.id,
      'decline'
    );
    res.json(result);
  } catch (error) {
    console.error('Error declining invite:', error);
    res.status(400).json({ error: error.message || 'Failed to decline invite' });
  }
});

router.get('/recent', requireAuth, async (req, res) => {
  try {
    const sessions = await collabSessionManager.listRecentSessions(req.user.id);
    res.json(sessions);
  } catch (error) {
    console.error('Error fetching recent sessions:', error);
    res.status(500).json({ error: 'Failed to fetch recent sessions' });
  }
});

router.get('/:sessionId', requireAuth, async (req, res) => {
  try {
    const snapshot = await collabSessionManager.getSessionSnapshot(req.params.sessionId, {
      forceRefresh: req.query.refresh === 'true'
    });
    if (!snapshot) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(snapshot);
  } catch (error) {
    console.error('Error fetching session snapshot:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

router.post('/:sessionId/invite', requireAuth, async (req, res) => {
  try {
    const invites = await collabSessionManager.sendInvites(
      req.params.sessionId,
      req.user.id,
      req.body?.inviteeIds || []
    );
    res.status(201).json({ invites });
  } catch (error) {
    console.error('Error sending invite:', error);
    const message = error.message || 'Failed to send invite';
    const status = message.includes('not found') ? 404 : message.includes('owner') ? 403 : 400;
    res.status(status).json({ error: message });
  }
});

router.get('/:sessionId/cpu', requireAuth, async (req, res) => {
  try {
    const snapshot = await collabSessionManager.getSessionSnapshot(req.params.sessionId);
    if (!snapshot) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({ cpuStats: snapshot.cpuStats || {} });
  } catch (error) {
    console.error('Error fetching CPU stats:', error);
    res.status(500).json({ error: 'Failed to fetch CPU stats' });
  }
});

router.post('/:sessionId/join', requireAuth, async (req, res) => {
  try {
    const snapshot = await collabSessionManager.joinSession(req.params.sessionId, req.user.id);
    if (!snapshot) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(snapshot);
  } catch (error) {
    console.error('Error joining session:', error);
    res.status(500).json({ error: 'Failed to join session' });
  }
});

router.post('/:sessionId/leave', requireAuth, async (req, res) => {
  try {
    await collabSessionManager.leaveSession(req.params.sessionId, req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error leaving session:', error);
    res.status(500).json({ error: 'Failed to leave session' });
  }
});

router.post('/:sessionId/channels', requireAuth, async (req, res) => {
  try {
    const snapshot = await collabSessionManager.upsertChannel(
      req.params.sessionId,
      req.user.id,
      req.body || {}
    );
    res.status(201).json(snapshot);
  } catch (error) {
    console.error('Error saving channel:', error);
    res.status(400).json({ error: error.message || 'Failed to save channel' });
  }
});

router.post('/:sessionId/channels/:channelId/publish', requireAuth, async (req, res) => {
  try {
    const snapshot = await collabSessionManager.publishChannel(
      req.params.sessionId,
      req.params.channelId,
      req.body?.status || 'live'
    );
    res.json(snapshot);
  } catch (error) {
    console.error('Error publishing channel:', error);
    res.status(500).json({ error: 'Failed to publish channel' });
  }
});

router.post('/:sessionId/master', requireAuth, async (req, res) => {
  try {
    const snapshot = await collabSessionManager.overrideMasterCode(
      req.params.sessionId,
      req.user.id,
      req.body?.masterCode || ''
    );
    res.json(snapshot);
  } catch (error) {
    console.error('Error overriding master pattern:', error);
    res.status(500).json({ error: 'Failed to override master pattern' });
  }
});

router.post('/:sessionId/delay', requireAuth, async (req, res) => {
  try {
    const snapshot = await collabSessionManager.adjustDelay(
      req.params.sessionId,
      req.body?.applyDelayMs
    );
    res.json(snapshot);
  } catch (error) {
    console.error('Error updating session delay:', error);
    res.status(500).json({ error: 'Failed to update session delay' });
  }
});

export default router;

