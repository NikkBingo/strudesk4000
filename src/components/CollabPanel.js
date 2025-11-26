import { collabAPI, usersAPI } from '../api.js';
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
    this.pendingInvites = [];
    this.recentSessions = [];
    this.inviteSearchResults = [];
    this.selectedInvitees = [];
    this.inviteSearchTimeout = null;
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
    this.refreshUserInvites();
    this.refreshRecentSessions();
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
    if (user) {
      this.refreshUserInvites();
      this.refreshRecentSessions();
      this.renderInviteSearchResults();
      this.renderSelectedInvitees();
    } else {
      this.pendingInvites = [];
      this.recentSessions = [];
      this.inviteSearchResults = [];
      this.selectedInvitees = [];
      this.renderPendingInvites();
      this.renderRecentSessions();
      this.renderInviteSearchResults();
      this.renderSelectedInvitees();
    }
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
        <div class="collab-status-message" id="collab-status-message" role="status" aria-live="polite"></div>
        <section class="collab-recents-section">
          <div class="collab-list-header">
            <strong>Recent sessions</strong>
            <button id="collab-refresh-recents-btn" class="btn-link" type="button">Refresh</button>
          </div>
          <div id="collab-recents-list" class="collab-chip-list collab-empty-state">Log in to see your recent collaborations.</div>
        </section>
        <section class="collab-invites-section">
          <div class="collab-list-header">
            <strong>Invitations for you</strong>
            <button id="collab-refresh-invites-btn" class="btn-link" type="button">Refresh</button>
          </div>
          <div id="collab-my-invites" class="collab-invites-list collab-empty-state">No pending invites.</div>
        </section>
        <div class="collab-session-details" id="collab-session-details" hidden>
          <div class="collab-session-meta">
            <div><strong>Session reference:</strong> <span id="collab-share-code">—</span></div>
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
          <div class="collab-owner-tools" id="collab-owner-tools" hidden>
            <div class="collab-list-header">
              <strong>Invite collaborators (max 5 at a time)</strong>
            </div>
            <div class="collab-invite-search">
              <input type="text" id="collab-invite-search" placeholder="Search users by display name or email..." data-collab-requires-auth />
              <div id="collab-invite-results" class="collab-invite-results collab-empty-state">Start typing to search users.</div>
              <div id="collab-selected-invitees" class="collab-selected-invitees collab-empty-state">No users selected yet.</div>
              <small class="collab-helper-text" id="collab-selected-count">Selected 0 of 5 slots.</small>
              <div class="collab-channel-actions">
                <button id="collab-send-invite-btn" class="btn-primary" data-collab-requires-auth>Send invites</button>
              </div>
            </div>
            <small class="collab-helper-text">Selected users will receive an invite in their Live Collaboration panel.</small>
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
    this.renderPendingInvites();
    this.renderRecentSessions();
    this.renderInviteSearchResults();
    this.renderSelectedInvitees();
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
    this.root?.querySelector('#collab-refresh-invites-btn')?.addEventListener('click', () => {
      this.refreshUserInvites();
    });
    this.root?.querySelector('#collab-refresh-recents-btn')?.addEventListener('click', () => {
      this.refreshRecentSessions();
    });
    this.root?.querySelector('#collab-invite-search')?.addEventListener('input', (event) => {
      const value = event.target.value.trim();
      this.scheduleInviteSearch(value);
    });
    this.root?.querySelector('#collab-invite-results')?.addEventListener('click', (event) => {
      const target = event.target.closest('[data-add-invitee]');
      if (!target) return;
      const userId = target.getAttribute('data-add-invitee');
      const user = this.inviteSearchResults.find((u) => u.id === userId);
      if (user) {
        this.addInvitee(user);
      }
    });
    this.root?.querySelector('#collab-selected-invitees')?.addEventListener('click', (event) => {
      const target = event.target.closest('[data-remove-invitee]');
      if (!target) return;
      const userId = target.getAttribute('data-remove-invitee');
      this.removeInvitee(userId);
    });
    this.root?.querySelector('#collab-send-invite-btn')?.addEventListener('click', () => {
      this.handleSendInvite();
    });
    this.root?.querySelector('#collab-my-invites')?.addEventListener('click', (event) => {
      const acceptTarget = event.target.closest('[data-accept-invite]');
      if (acceptTarget) {
        const inviteId = acceptTarget.getAttribute('data-accept-invite');
        if (inviteId) {
          this.handleRespondInvite(inviteId, true);
        }
        return;
      }
      const declineTarget = event.target.closest('[data-decline-invite]');
      if (declineTarget) {
        const inviteId = declineTarget.getAttribute('data-decline-invite');
        if (inviteId) {
          this.handleRespondInvite(inviteId, false);
        }
      }
    });
    this.root?.querySelector('#collab-recents-list')?.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-collab-session-id]');
      if (!chip) return;
      const sessionId = chip.getAttribute('data-collab-session-id');
      if (sessionId) {
        this.connectToSession(sessionId);
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
      await this.refreshRecentSessions();
      this.setStatus('Session created. Share the code with your friends!', STATUS_VARIANTS.success, 4000);
    } catch (error) {
      console.error('Create session failed', error);
      this.setStatus(error.message || 'Failed to create session', STATUS_VARIANTS.error);
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
      await this.refreshRecentSessions();
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
    const ownerTools = this.root?.querySelector('#collab-owner-tools');
    if (ownerTools) {
      ownerTools.hidden = !(this.currentUser && snapshot.owner && this.currentUser.id === snapshot.owner.id);
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

  async refreshUserInvites() {
    if (!this.currentUser) {
      this.pendingInvites = [];
      this.renderPendingInvites();
      return;
    }
    try {
      this.pendingInvites = await collabAPI.getPendingInvites();
      this.renderPendingInvites();
    } catch (error) {
      console.error('Failed to load invites:', error);
      this.setStatus(error.message || 'Failed to load invites', STATUS_VARIANTS.error, 3000);
    }
  }

  renderPendingInvites() {
    const container = this.root?.querySelector('#collab-my-invites');
    if (!container) return;
    if (!this.currentUser) {
      container.classList.add('collab-empty-state');
      container.innerHTML = 'Login to see your invitations.';
      return;
    }
    if (!this.pendingInvites.length) {
      container.classList.add('collab-empty-state');
      container.innerHTML = 'No pending invites.';
      return;
    }
    container.classList.remove('collab-empty-state');
    container.innerHTML = this.pendingInvites
      .map((invite) => {
        const inviter = invite.inviter?.name || 'Someone';
        const title = invite.session?.title || 'Untitled session';
        const createdAt = invite.createdAt ? new Date(invite.createdAt).toLocaleString() : '';
        return `
          <div class="collab-invite-card">
            <div class="collab-invite-card__details">
              <strong>${title}</strong>
              <span>Invited by ${inviter}</span>
              <span class="collab-invite-card__meta">${createdAt}</span>
            </div>
            <div class="collab-invite-card__actions">
              <button class="btn-primary btn-small" data-accept-invite="${invite.id}">Accept</button>
              <button class="btn-ghost btn-small" data-decline-invite="${invite.id}">Decline</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  async handleRespondInvite(inviteId, accept) {
    if (!inviteId) return;
    try {
      this.setStatus(accept ? 'Accepting invite…' : 'Declining invite…', STATUS_VARIANTS.info);
      const result = accept
        ? await collabAPI.acceptInvite(inviteId)
        : await collabAPI.declineInvite(inviteId);
      await this.refreshUserInvites();
      if (accept && result?.session) {
        this.updateSnapshot(result.session);
        await this.socketClient.joinSession(result.session.id);
        await this.refreshRecentSessions();
        this.setStatus('Invite accepted. Connected to session.', STATUS_VARIANTS.success, 3000);
      } else if (accept) {
        this.setStatus('Invite accepted.', STATUS_VARIANTS.success, 2000);
      } else {
        this.setStatus('Invite declined.', STATUS_VARIANTS.info, 2000);
      }
    } catch (error) {
      console.error('Failed to respond to invite:', error);
      this.setStatus(error.message || 'Failed to respond to invite', STATUS_VARIANTS.error, 3000);
    }
  }

  async handleSendInvite() {
    if (!this.currentSnapshot?.id) {
      this.setStatus('Start a session before inviting collaborators.', STATUS_VARIANTS.error, 3000);
      return;
    }
    if (!this.selectedInvitees.length) {
      this.setStatus('Select up to five users to invite.', STATUS_VARIANTS.error, 2500);
      return;
    }
    try {
      this.setStatus('Sending invites…', STATUS_VARIANTS.info);
      const ids = this.selectedInvitees.map((user) => user.id);
      await collabAPI.sendInvites(this.currentSnapshot.id, ids);
      this.selectedInvitees = [];
      this.renderSelectedInvitees();
      this.setStatus(`Invitations sent to ${ids.length} user${ids.length > 1 ? 's' : ''}.`, STATUS_VARIANTS.success, 2500);
      this.refreshUserInvites();
    } catch (error) {
      console.error('Failed to send invite:', error);
      this.setStatus(error.message || 'Failed to send invite', STATUS_VARIANTS.error, 3000);
    }
  }

  async refreshRecentSessions() {
    if (!this.currentUser) {
      this.recentSessions = [];
      this.renderRecentSessions();
      return;
    }
    try {
      this.recentSessions = await collabAPI.listRecentSessions();
      this.renderRecentSessions();
    } catch (error) {
      console.error('Failed to fetch recent sessions:', error);
      this.setStatus(error.message || 'Failed to load recent sessions', STATUS_VARIANTS.error, 3000);
    }
  }

  renderRecentSessions() {
    const list = this.root?.querySelector('#collab-recents-list');
    if (!list) return;
    if (!this.currentUser) {
      list.classList.add('collab-empty-state');
      list.innerHTML = 'Login to see your recent collaborations.';
      return;
    }
    if (!this.recentSessions.length) {
      list.classList.add('collab-empty-state');
      list.innerHTML = 'No recent sessions yet.';
      return;
    }
    list.classList.remove('collab-empty-state');
    list.innerHTML = this.recentSessions
      .map((session) => {
        const updated = session.updatedAt ? new Date(session.updatedAt).toLocaleDateString() : '';
        return `
          <button class="collab-chip" data-collab-session-id="${session.id}">
            <span>${session.title}</span>
            <span class="collab-chip__meta">${updated}</span>
          </button>
        `;
      })
      .join('');
  }

  scheduleInviteSearch(query) {
    if (this.inviteSearchTimeout) {
      clearTimeout(this.inviteSearchTimeout);
    }
    if (!query) {
      this.inviteSearchResults = [];
      this.renderInviteSearchResults();
      return;
    }
    this.inviteSearchTimeout = setTimeout(() => {
      this.performInviteSearch(query);
    }, 250);
  }

  async performInviteSearch(query) {
    try {
      const users = await usersAPI.listUsers(query, 10);
      this.inviteSearchResults = users.filter((user) => user.id !== this.currentUser?.id);
      this.renderInviteSearchResults();
    } catch (error) {
      console.error('Invite search failed:', error);
      this.inviteSearchResults = [];
      this.renderInviteSearchResults('Failed to search users. Try again.');
    }
  }

  renderInviteSearchResults(message) {
    const container = this.root?.querySelector('#collab-invite-results');
    if (!container) return;
    if (message) {
      container.classList.add('collab-empty-state');
      container.innerHTML = message;
      return;
    }
    if (!this.inviteSearchResults.length) {
      container.classList.add('collab-empty-state');
      container.innerHTML = 'Start typing to search users.';
      return;
    }
    container.classList.remove('collab-empty-state');
    container.innerHTML = this.inviteSearchResults
      .map((user) => {
        const disabled = this.selectedInvitees.some((selected) => selected.id === user.id) || this.selectedInvitees.length >= 5;
        const displayName = user.artistName?.trim() || user.name || user.email || 'Unnamed';
        return `
          <button class="collab-invite-result${disabled ? ' disabled' : ''}" data-add-invitee="${user.id}" ${disabled ? 'disabled' : ''}>
            <span>${displayName}</span>
            <span class="collab-invite-result__meta">${user.email || ''}</span>
          </button>
        `;
      })
      .join('');
  }

  addInvitee(user) {
    if (this.selectedInvitees.length >= 5) {
      this.setStatus('You can invite up to five users at a time.', STATUS_VARIANTS.error, 2500);
      return;
    }
    if (this.selectedInvitees.some((invitee) => invitee.id === user.id)) {
      return;
    }
    this.selectedInvitees.push(user);
    this.renderSelectedInvitees();
    this.renderInviteSearchResults();
  }

  removeInvitee(userId) {
    this.selectedInvitees = this.selectedInvitees.filter((invitee) => invitee.id !== userId);
    this.renderSelectedInvitees();
    this.renderInviteSearchResults();
  }

  renderSelectedInvitees() {
    const container = this.root?.querySelector('#collab-selected-invitees');
    const countLabel = this.root?.querySelector('#collab-selected-count');
    if (countLabel) {
      countLabel.textContent = `Selected ${this.selectedInvitees.length} of 5 slots.`;
    }
    if (!container) return;
    if (!this.selectedInvitees.length) {
      container.classList.add('collab-empty-state');
      container.innerHTML = 'No users selected yet.';
      return;
    }
    container.classList.remove('collab-empty-state');
    container.innerHTML = this.selectedInvitees
      .map((invitee) => {
        const displayName = invitee.artistName?.trim() || invitee.name || invitee.email || 'Unnamed';
        return `
          <span class="collab-selected-invitee">
            <span>${displayName}</span>
            <button type="button" data-remove-invitee="${invitee.id}" aria-label="Remove ${displayName}">&times;</button>
          </span>
        `;
      })
      .join('');
  }

  async connectToSession(sessionId) {
    if (!sessionId) return;
    try {
      this.setStatus('Connecting…', STATUS_VARIANTS.info);
      const snapshot = await collabAPI.joinSession(sessionId);
      if (snapshot) {
        this.updateSnapshot(snapshot);
        await this.socketClient.joinSession(sessionId);
        await this.refreshRecentSessions();
        this.setStatus('Connected to session.', STATUS_VARIANTS.success, 2500);
      }
    } catch (error) {
      console.error('Failed to connect to session:', error);
      this.setStatus(error.message || 'Failed to connect to session', STATUS_VARIANTS.error, 3000);
    }
  }

  renderEmptyState() {
    const details = this.root?.querySelector('#collab-session-details');
    if (details) {
      details.hidden = true;
    }
    const ownerTools = this.root?.querySelector('#collab-owner-tools');
    if (ownerTools) {
      ownerTools.hidden = true;
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

