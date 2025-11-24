import { usersAPI } from '../api.js';

export class AdminUserManager {
  constructor() {
    this.modal = null;
    this.tableBody = null;
    this.statusEl = null;
    this.users = [];
  }

  init() {
    this.createModal();
    this.attachEventListeners();
  }

  createModal() {
    const modalHTML = `
      <div class="admin-modal-overlay" id="admin-modal-overlay" style="display:none;">
        <div class="admin-modal">
          <div class="admin-modal-header">
            <h2>User Management</h2>
            <button class="admin-modal-close" id="admin-modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="admin-modal-body">
            <div class="admin-status" id="admin-status"></div>
            <div class="admin-table-wrapper">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="admin-users-body">
                  <tr><td colspan="6">Loading users...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modal = document.getElementById('admin-modal-overlay');
    this.tableBody = document.getElementById('admin-users-body');
    this.statusEl = document.getElementById('admin-status');
  }

  attachEventListeners() {
    const closeBtn = document.getElementById('admin-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide());
    }
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) {
          this.hide();
        }
      });
    }
    if (this.tableBody) {
      this.tableBody.addEventListener('click', async (e) => {
        const actionBtn = e.target.closest('[data-admin-action]');
        if (!actionBtn) return;
        const action = actionBtn.dataset.adminAction;
        const userId = actionBtn.dataset.userId;
        if (!userId) return;
        if (action === 'block') {
          await this.blockUser(userId);
        } else if (action === 'unblock') {
          await this.unblockUser(userId);
        } else if (action === 'delete') {
          if (confirm('Delete this user and all their data?')) {
            await this.deleteUser(userId);
          }
        }
      });
    }
  }

  async blockUser(userId) {
    await usersAPI.blockUser(userId);
    this.setStatus('User blocked');
    await this.loadUsers();
  }

  async unblockUser(userId) {
    await usersAPI.unblockUser(userId);
    this.setStatus('User unblocked');
    await this.loadUsers();
  }

  async deleteUser(userId) {
    await usersAPI.deleteUser(userId);
    this.setStatus('User deleted');
    await this.loadUsers();
  }

  setStatus(message, type = 'info') {
    if (!this.statusEl) return;
    this.statusEl.textContent = message;
    this.statusEl.dataset.statusType = type;
  }

  renderRow(user) {
    const date = new Date(user.createdAt).toLocaleDateString();
    const isBlocked = user.status === 'blocked';
    return `
      <tr>
        <td>${this.escape(user.name || '')}</td>
        <td>${this.escape(user.email)}</td>
        <td>${user.role}</td>
        <td class="status-${user.status}">${user.status}</td>
        <td>${date}</td>
        <td class="admin-actions">
          ${isBlocked
            ? `<button data-admin-action="unblock" data-user-id="${user.id}">Unblock</button>`
            : `<button data-admin-action="block" data-user-id="${user.id}">Block</button>`}
          <button data-admin-action="delete" data-user-id="${user.id}" class="danger">Delete</button>
        </td>
      </tr>
    `;
  }

  escape(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async loadUsers() {
    if (!this.tableBody) return;
    this.tableBody.innerHTML = '<tr><td colspan="6">Loading users...</td></tr>';
    try {
      const users = await usersAPI.listAdminUsers();
      this.users = users;
      if (!users.length) {
        this.tableBody.innerHTML = '<tr><td colspan="6">No users found.</td></tr>';
        return;
      }
      this.tableBody.innerHTML = users.map((u) => this.renderRow(u)).join('');
    } catch (error) {
      console.error('Admin load users error:', error);
      this.tableBody.innerHTML = '<tr><td colspan="6">Failed to load users.</td></tr>';
    }
  }

  async show() {
    if (!this.modal) return;
    this.modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    await this.loadUsers();
  }

  hide() {
    if (!this.modal) return;
    this.modal.style.display = 'none';
    document.body.style.overflow = '';
    this.setStatus('');
  }
}

