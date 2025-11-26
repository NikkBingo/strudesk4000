import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env?.VITE_SOCKET_URL
  || (import.meta.env?.PROD ? window.location.origin : 'http://localhost:3001');

class CollaborationClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.eventHandlers = new Map();
    this.currentSessionId = null;
    this.masterUpdateQueue = [];
    this.masterUpdateTimer = null;
  }

  ensureSocket() {
    if (this.socket) {
      if (!this.socket.connected && !this.socket.connecting) {
        this.socket.connect();
      }
      return this.socket;
    }

    this.socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket'],
      autoConnect: true,
      timeout: 8000
    });

    this.socket.on('connect', () => {
      this.connected = true;
      this.emitLocal('connect');
      if (this.currentSessionId) {
        this.joinSession(this.currentSessionId).catch(() => {
          // Swallow - UI will show error via event
        });
      }
    });

    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      this.emitLocal('disconnect', { reason });
    });

    this.socket.on('session:snapshot', (snapshot) => {
      if (snapshot?.id) {
        this.currentSessionId = snapshot.id;
      }
      this.emitLocal('session:snapshot', snapshot);
    });

    this.socket.on('session:participant-event', (payload) => {
      this.emitLocal('session:participant-event', payload);
    });

    this.socket.on('master:updated', (payload) => {
      this.queueMasterUpdate(payload);
    });

    this.socket.on('auth:error', (payload) => {
      this.emitLocal('auth:error', payload);
    });

    this.socket.on('connect_error', (error) => {
      this.emitLocal('error', { message: error.message });
    });

    return this.socket;
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.eventHandlers.delete(event);
    }
  }

  emitLocal(event, payload) {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;
    handlers.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        console.error(`CollaborationClient handler error for event ${event}:`, error);
      }
    });
  }

  queueMasterUpdate(payload) {
    if (!payload) return;
    this.masterUpdateQueue.push(payload);
    if (this.masterUpdateTimer) {
      return;
    }
    this.masterUpdateTimer = setTimeout(() => {
      const latest = this.masterUpdateQueue[this.masterUpdateQueue.length - 1];
      this.masterUpdateQueue = [];
      this.masterUpdateTimer = null;
      this.emitLocal('master:updated', latest);
    }, 120);
  }

  async joinSession(sessionId) {
    if (!sessionId) {
      throw new Error('Session identifier is required');
    }
    this.ensureSocket();
    return new Promise((resolve, reject) => {
      this.socket.emit('session:join', { sessionId }, (response) => {
        if (response?.success) {
          this.currentSessionId = response.snapshot?.id || sessionId;
          if (response.snapshot) {
            this.emitLocal('session:snapshot', response.snapshot);
          }
          resolve(response.snapshot);
        } else {
          reject(new Error(response?.error || 'Failed to join session'));
        }
      });
    });
  }

  async leaveSession(sessionId = this.currentSessionId) {
    if (!sessionId || !this.socket) {
      return;
    }
    return new Promise((resolve) => {
      this.socket.emit('session:leave', { sessionId }, () => {
        if (sessionId === this.currentSessionId) {
          this.currentSessionId = null;
        }
        resolve();
      });
    });
  }

  async pushChannelDraft(channelPayload = {}) {
    const sessionId = channelPayload.sessionId || this.currentSessionId;
    if (!sessionId) {
      throw new Error('Join a session before pushing a channel');
    }
    this.ensureSocket();
    return new Promise((resolve, reject) => {
      this.socket.emit('channel:update', { ...channelPayload, sessionId }, (response) => {
        if (response?.success) {
          resolve();
        } else {
          reject(new Error(response?.error || 'Failed to push channel'));
        }
      });
    });
  }

  async publishChannel({ channelId, status = 'live', sessionId } = {}) {
    const resolvedSessionId = sessionId || this.currentSessionId;
    if (!resolvedSessionId || !channelId) {
      throw new Error('sessionId and channelId are required');
    }
    this.ensureSocket();
    return new Promise((resolve, reject) => {
      this.socket.emit('channel:publish', { sessionId: resolvedSessionId, channelId, status }, (response) => {
        if (response?.success) {
          resolve();
        } else {
          reject(new Error(response?.error || 'Failed to publish channel'));
        }
      });
    });
  }

  async editMaster(masterCode, sessionId = this.currentSessionId) {
    if (!sessionId) {
      throw new Error('Join a session before editing master');
    }
    this.ensureSocket();
    return new Promise((resolve, reject) => {
      this.socket.emit('master:edit', { sessionId, masterCode }, (response) => {
        if (response?.success) {
          resolve();
        } else {
          reject(new Error(response?.error || 'Failed to update master'));
        }
      });
    });
  }
}

export const collaborationClient = new CollaborationClient();

