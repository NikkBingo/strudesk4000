import { collabAPI } from '../api.js';
import { getStrudelEditorValue } from '../strudelReplEditor.js';
import { collaborationClient } from '../collaboration/socketClient.js';
import { lockScroll, unlockScroll } from '../scrollLock.js';

const STATUS_VARIANTS = {
  info: 'info',
  success: 'success',
  error: 'error'
};

export class CollabPanel {
  constructor(socketClient = collaborationClient) {
    this.root = null;
    this.overlay = null;
    this.closeBtn = null;
    this.socketClient = socketClient;
    this.currentSnapshot = null;
    this.currentUser = null;
    this.statusTimer = null;
    this.boundHandlers = [];
    this.isOpen = false;
  }

  init() {
    this.ensureModal();
    if (!this.root) return;
    this.render();
    this.attachEvents();
    this.bindSocketEvents();
    this.updateAuthState();
  }

  ensureModal() {
    if (this.overlay && this.root) {
      return;
    }
    if (!document.getElementById('collab-modal-overlay')) {
      const template = `
        <div class="collab-modal-overlay" id="collab-modal-overlay" style="display: none;">
          <div class="collab-modal">
            <button type="button" class="collab-modal-close" id="collab-modal-close" aria-label="Close collaboration panel">&times;</button>
            <div class="collab-panel-wrapper">
              <div id="collab-panel-root"></div>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', template);
    }
    this.overlay = document.getElementById('collab-modal-overlay');
    this.root = this.overlay?.querySelector('#collab-panel-root') || null;
    this.closeBtn = this.overlay?.querySelector('#collab-modal-close') || null;
  }

  show() {
    if (!this.currentUser) {
      this.setStatus('Login to access live collaboration.', STATUS_VARIANTS.error, 2000);
      return;
    }
    this.ensureModal();
    if (!this.overlay) return;
    this.overlay.style.display = 'flex';
    lockScroll('collab-modal');
    this.isOpen = true;
  }

  hide() {
    if (!this.overlay) return;
    this.overlay.style.display = 'none';
    unlockScroll('collab-modal');
    this.isOpen = false;
  }

  destroy() {
    this.boundHandlers.forEach((unbind) => unbind());
    this.boundHandlers = [];
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
      this.root = null;
      this.closeBtn = null;
    }
  }

  setCurrentUser(user) {
    this.currentUser = user;
    this.updateAuthState();
  }

  updateAuthState() {
    const disabled = !this.currentUser;
    const authGate = this.root?.querySelector('[data-collab-auth-message]');
    const inputs = this.root?.querySelectorAll('[data-collab-requires-auth]');
    if (inputs) {
      inputs.forEach((input) => {
        input.disabled = disabled;
      });
    }
    if (authGate) {
      authGate.style.display = disabled ? 'block' : 'none';
    }
    if (disabled && this.isOpen) {
      this.hide();
    }
  }

  render() {
    this.root.innerHTML = `
      <div class="collab-panel-header">
        <div>
          <h3>Live Collaboration</h3>
          <p id="collab-session-label">Not connected</p>
        </div>
        <div class="collab-connection-indicator" id="collab-connection-indicator" title="Socket status"></div>
      </div>
      <div class="collab-panel-body">
        <div class="collab-auth-gate" data-collab-auth-message>
          <p>Login to create or join a collaboration session.</p>
        </div>
        <div class="collab-form-row">
          <label for="collab-title-input">Session title</label>
          <div class="collab-form-controls">
            <input type="text" id="collab-title-input" placeholder="Friday night jam" data-collab-requires-auth />
            <button id="collab-create-btn" class="btn-primary" data-collab-requires-auth>Create session</button>
          </div>
        </div>
        <div class="collab-form-row">
          <label for="collab-join-input">Join code or ID</label>
          <div class="collab-form-controls">
            <input type="text" id="collab-join-input" placeholder="slug-or-session-id" data-collab-requires-auth />
            <button id="collab-join-btn" class="btn-secondary" data-collab-requires-auth>Join</button>
          </div>
        </div>
        <div class="collab-status-message" id="collab-status-message" role="status" aria-live="polite"></div>
        <div class="collab-session-details" id="collab-session-details" hidden>
          <div class="collab-session-meta">
            <div><strong>Share code:</strong> <span id="collab-share-code">—</span></div>
            <div><strong>Delay to apply:</strong>
              <input type="range" min="0" max="5000" step="50" id="collab-delay-slider" data-collab-requires-auth />
              <span id="collab-delay-value">0 ms</span>
            </div>
            <div class="collab-cpu-row">
              <span><strong>CPU avg:</strong> <span id="collab-cpu-load">n/a</span></span>
              <span><strong>Last server update:</strong> <span id="collab-cpu-updated">—</span></span>
              <span class="collab-cpu-warning" id="collab-cpu-warning"></span>
              <button id="collab-refresh-cpu-btn" class="btn-link" type="button">Refresh stats</button>
            </div>
          </div>
          <div class="collab-participants">
            <div class="collab-list-header">
              <strong>Participants</strong>
              <button id="collab-leave-btn" class="btn-ghost danger" data-collab-requires-auth>Leave</button>
            </div>
            <ul id="collab-participants-list"></ul>
          </div>
          <div class="collab-channel-form">
            <div class="collab-list-header">
              <strong>Channel snippet</strong>
              <button id="collab-load-editor-btn" class="btn-link" type="button">Use master editor content</button>
            </div>
            <input type="text" id="collab-channel-name" placeholder="Label (optional)" />
            <textarea id="collab-channel-code" rows="5" placeholder="// Write the pattern you want to push"></textarea>
            <div class="collab-channel-actions">
              <button id="collab-push-draft-btn" class="btn-secondary" data-collab-requires-auth>Save draft</button>
              <button id="collab-publish-btn" class="btn-primary" data-collab-requires-auth>Publish to master</button>
            </div>
          </div>
          <div class="collab-channels-list">
            <div class="collab-list-header">
              <strong>Recent submissions</strong>
              <button id="collab-refresh-session-btn" class="btn-link" type="button">Refresh snapshot</button>
            </div>
            <div id="collab-channels-container"></div>
          </div>
        </div>
      </div>
    `;
  }

  attachEvents() {
    this.closeBtn?.addEventListener('click', () => {
      this.hide();
    });
    this.overlay?.addEventListener('click', (event) => {
      if (event.target === this.overlay) {
        this.hide();
      }
    });
    this.root?.querySelector('#collab-create-btn')?.addEventListener('click', () => {
      this.handleCreateSession();
    });
    this.root?.querySelector('#collab-join-btn')?.addEventListener('click', () => {
      this.handleJoinSession();
    });
    this.root?.querySelector('#collab-leave-btn')?.addEventListener('click', () => {
      this.handleLeaveSession();
    });
    this.root?.querySelector('#collab-load-editor-btn')?.addEventListener('click', () => {
      this.populateFromEditor();
    });
    this.root?.querySelector('#collab-push-draft-btn')?.addEventListener('click', () => {
      this.handleChannelSubmit('draft');
    });
    this.root?.querySelector('#collab-publish-btn')?.addEventListener('click', () => {
      this.handleChannelSubmit('live');
    });
    this.root?.querySelector('#collab-refresh-session-btn')?.addEventListener('click', () => {
      if (this.currentSnapshot?.slug) {
        this.fetchSnapshot(this.currentSnapshot.slug);
      }
    });
    this.root?.querySelector('#collab-refresh-cpu-btn')?.addEventListener('click', () => {
      if (this.currentSnapshot?.slug) {
        this.fetchCpuStats(this.currentSnapshot.id || this.currentSnapshot.slug);
      }
    });
    this.root?.querySelector('#collab-delay-slider')?.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      const valueEl = this.root.querySelector('#collab-delay-value');
      if (valueEl) {
        valueEl.textContent = `${value} ms`;
      }
    });
    this.root?.querySelector('#collab-delay-slider')?.addEventListener('change', (event) => {
      const value = Number(event.target.value);
      if (!this.currentSnapshot?.id) return;
      collabAPI.updateDelay(this.currentSnapshot.id, value).catch((error) => {
        console.error('Delay update failed', error);
        this.setStatus(error.message || 'Failed to update delay', STATUS_VARIANTS.error);
      });
    });
  }

  bindSocketEvents() {
    this.boundHandlers.push(this.socketClient.on('connect', () => {
      this.updateConnectionIndicator(true);
    }));
    this.boundHandlers.push(this.socketClient.on('disconnect', () => {
      this.updateConnectionIndicator(false);
    }));
    this.boundHandlers.push(this.socketClient.on('error', (payload) => {
      this.setStatus(payload?.message || 'Socket error', STATUS_VARIANTS.error);
    }));
    this.boundHandlers.push(this.socketClient.on('auth:error', (payload) => {
      this.setStatus(payload?.error || 'Authentication required', STATUS_VARIANTS.error);
    }));
    this.boundHandlers.push(this.socketClient.on('session:snapshot', (snapshot) => {
      this.updateSnapshot(snapshot);
    }));
    this.boundHandlers.push(this.socketClient.on('master:updated', (payload) => {
      if (payload?.masterCode) {
        this.setStatus('Master updated across collaborators', STATUS_VARIANTS.info, 2000);
      }
    }));
  }

  updateConnectionIndicator(isConnected) {
    const indicator = this.root?.querySelector('#collab-connection-indicator');
    if (indicator) {
      indicator.classList.toggle('connected', !!isConnected);
    }
  }

  async handleCreateSession() {
    const titleInput = this.root?.querySelector('#collab-title-input');
    const title = titleInput?.value?.trim();
    if (!title) {
      this.setStatus('Enter a session title first.', STATUS_VARIANTS.error);
      return;
    }
    try {
      this.setStatus('Creating session…', STATUS_VARIANTS.info);
      const snapshot = await collabAPI.createSession(title);
      this.updateSnapshot(snapshot);
      await this.socketClient.joinSession(snapshot.id);
      this.setStatus('Session created. Share the code with your friends!', STATUS_VARIANTS.success, 4000);
    } catch (error) {
      console.error('Create session failed', error);
      this.setStatus(error.message || 'Failed to create session', STATUS_VARIANTS.error);
    }
  }

  async handleJoinSession() {
    const joinInput = this.root?.querySelector('#collab-join-input');
    const code = joinInput?.value?.trim();
    if (!code) {
      this.setStatus('Enter a session code or ID.', STATUS_VARIANTS.error);
      return;
    }
    try {
      this.setStatus('Joining session…', STATUS_VARIANTS.info);
      const snapshot = await collabAPI.joinSession(code);
      this.updateSnapshot(snapshot);
      await this.socketClient.joinSession(code);
      this.setStatus('Joined session.', STATUS_VARIANTS.success, 3000);
    } catch (error) {
      console.error('Join session failed', error);
      this.setStatus(error.message || 'Failed to join session', STATUS_VARIANTS.error);
    }
  }

  async handleLeaveSession() {
    if (!this.currentSnapshot?.id) {
      return;
    }
    try {
      await collabAPI.leaveSession(this.currentSnapshot.id);
      await this.socketClient.leaveSession(this.currentSnapshot.id);
      this.currentSnapshot = null;
      this.renderEmptyState();
      this.setStatus('You left the session.', STATUS_VARIANTS.info, 2000);
    } catch (error) {
      console.error('Leave session failed', error);
      this.setStatus(error.message || 'Failed to leave session', STATUS_VARIANTS.error);
    }
  }

  async handleChannelSubmit(targetStatus = 'draft') {
    if (!this.currentSnapshot?.id) {
      this.setStatus('Join a session first.', STATUS_VARIANTS.error);
      return;
    }
    const textarea = this.root?.querySelector('#collab-channel-code');
    const nameInput = this.root?.querySelector('#collab-channel-name');
    const code = textarea?.value?.trim();
    if (!code) {
      this.setStatus('Write a pattern before pushing.', STATUS_VARIANTS.error);
      return;
    }
    try {
      this.setStatus(targetStatus === 'live' ? 'Publishing…' : 'Saving draft…', STATUS_VARIANTS.info);
      await this.socketClient.pushChannelDraft({
        sessionId: this.currentSnapshot.id,
        code,
        name: nameInput?.value?.trim() || null,
        status: targetStatus
      });
      if (targetStatus === 'live') {
        this.setStatus('Published to master.', STATUS_VARIANTS.success, 2500);
      } else {
        this.setStatus('Draft saved.', STATUS_VARIANTS.success, 2500);
      }
    } catch (error) {
      console.error('Channel submit failed', error);
      this.setStatus(error.message || 'Failed to push channel', STATUS_VARIANTS.error);
    }
  }

  populateFromEditor() {
    try {
      const value = getStrudelEditorValue('master-pattern');
      if (!value) {
        this.setStatus('Master editor is empty.', STATUS_VARIANTS.error, 2000);
        return;
      }
      const textarea = this.root?.querySelector('#collab-channel-code');
      if (textarea) {
        textarea.value = value.trim();
        textarea.focus();
      }
      this.setStatus('Copied master editor content into snippet box.', STATUS_VARIANTS.info, 2000);
    } catch (error) {
      console.warn('Unable to read master editor value', error);
      this.setStatus('Master editor is not ready yet.', STATUS_VARIANTS.error);
    }
  }

  async fetchSnapshot(identifier) {
    try {
      const snapshot = await collabAPI.getSession(identifier, { refresh: true });
      this.updateSnapshot(snapshot);
      this.setStatus('Snapshot refreshed.', STATUS_VARIANTS.info, 2000);
    } catch (error) {
      console.error('Fetch snapshot failed', error);
      this.setStatus(error.message || 'Failed to refresh snapshot', STATUS_VARIANTS.error);
    }
  }

  async fetchCpuStats(identifier) {
    try {
      const stats = await collabAPI.getCpuStats(identifier);
      const sample = stats?.cpuStats?.recentServerSamples?.slice(-1)?.[0];
      if (sample) {
        this.updateCpuStats(sample);
        this.setStatus('CPU stats refreshed.', STATUS_VARIANTS.info, 2000);
      }
    } catch (error) {
      console.error('Fetch CPU failed', error);
      this.setStatus(error.message || 'Failed to refresh CPU stats', STATUS_VARIANTS.error);
    }
  }

  updateSnapshot(snapshot) {
    if (!snapshot) return;
    this.currentSnapshot = snapshot;
    const details = this.root?.querySelector('#collab-session-details');
    if (details) {
      details.hidden = false;
    }
    const label = this.root?.querySelector('#collab-session-label');
    if (label) {
      label.textContent = `Session: ${snapshot.title} (${snapshot.slug})`;
    }
    const shareCode = this.root?.querySelector('#collab-share-code');
    if (shareCode) {
      shareCode.textContent = snapshot.slug;
    }
    const delaySlider = this.root?.querySelector('#collab-delay-slider');
    const delayValue = this.root?.querySelector('#collab-delay-value');
    if (delaySlider) {
      delaySlider.value = snapshot.applyDelayMs ?? 0;
    }
    if (delayValue) {
      delayValue.textContent = `${snapshot.applyDelayMs ?? 0} ms`;
    }
    if ((snapshot.applyDelayMs ?? 0) > 0) {
      this.setStatus(`Master updates apply after ${snapshot.applyDelayMs} ms to protect playback.`, STATUS_VARIANTS.info, 3000);
    }
    this.renderParticipants(snapshot.participants || []);
    this.renderChannels(snapshot.channels || []);
    const samples = snapshot.cpuStats?.recentServerSamples || [];
    if (samples.length) {
      this.updateCpuStats(samples[samples.length - 1]);
    }
  }

  renderParticipants(participants) {
    const list = this.root?.querySelector('#collab-participants-list');
    if (!list) return;
    if (!participants.length) {
      list.innerHTML = '<li class="empty">No collaborators yet.</li>';
      return;
    }
    list.innerHTML = participants.map((participant) => {
      const userName = participant.user?.artistName || participant.user?.name || 'Unknown';
      return `<li>
        <span>${userName}</span>
        <span class="role">${participant.role}</span>
      </li>`;
    }).join('');
  }

  renderChannels(channels) {
    const container = this.root?.querySelector('#collab-channels-container');
    if (!container) return;
    if (!channels.length) {
      container.innerHTML = '<div class="empty">No submissions yet. Push your first channel!</div>';
      return;
    }
    container.innerHTML = channels.slice(0, 5).map((channel) => {
      const updatedAt = channel.updatedAt ? new Date(channel.updatedAt).toLocaleTimeString() : '';
      const author = channel.user?.artistName || channel.user?.name || 'anonymous';
      return `
        <div class="collab-channel-card">
          <div class="collab-channel-card__header">
            <span>${channel.name || 'Untitled channel'}</span>
            <span class="badge ${channel.status}">${channel.status}</span>
          </div>
          <div class="collab-channel-card__meta">
            <span>By ${author}</span>
            <span>${updatedAt}</span>
          </div>
          <pre>${channel.code.slice(0, 220)}${channel.code.length > 220 ? '…' : ''}</pre>
        </div>
      `;
    }).join('');
  }

  updateCpuStats(sample) {
    const loadEl = this.root?.querySelector('#collab-cpu-load');
    const updatedEl = this.root?.querySelector('#collab-cpu-updated');
    const warningEl = this.root?.querySelector('#collab-cpu-warning');
    if (loadEl) {
      const avg = Array.isArray(sample.loadAvg) ? sample.loadAvg[0] : sample.loadAvg;
      loadEl.textContent = typeof avg === 'number' ? `${avg.toFixed(2)}` : 'n/a';
    }
    if (updatedEl) {
      updatedEl.textContent = sample.timestamp
        ? new Date(sample.timestamp).toLocaleTimeString()
        : '—';
    }
    if (warningEl) {
      warningEl.textContent = sample.warning || '';
      warningEl.style.display = sample.warning ? 'inline-flex' : 'none';
    }
    if (sample.warning) {
      this.setStatus(sample.warning, STATUS_VARIANTS.error, 4000);
    }
  }

  renderEmptyState() {
    const details = this.root?.querySelector('#collab-session-details');
    if (details) {
      details.hidden = true;
    }
    const label = this.root?.querySelector('#collab-session-label');
    if (label) {
      label.textContent = 'Not connected';
    }
  }

  setStatus(message, variant = STATUS_VARIANTS.info, timeout = 0) {
    const statusEl = this.root?.querySelector('#collab-status-message');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `collab-status-message ${variant}`;
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
    }
    if (timeout > 0) {
      this.statusTimer = setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'collab-status-message';
      }, timeout);
    }
  }
}

