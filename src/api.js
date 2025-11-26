/**
 * API Client for backend communication
 * Handles authentication, patterns, and user management
 */

// Use relative URL in production (same origin), or env var, or localhost for dev
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3001/api');

class APIError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/**
 * Make an API request with credentials
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const config = {
    ...options,
    credentials: 'include', // Include cookies for session
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  };

  try {
    const response = await fetch(url, config);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new APIError(data.error || 'Request failed', response.status, data);
    }

    return data;
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw new APIError(error.message || 'Network error', 0, null);
  }
}

/**
 * Authentication API
 */
export const authAPI = {
  /**
   * Get current authenticated user
   */
  async getCurrentUser() {
    return apiRequest('/auth/me');
  },

  /**
   * Logout current user
   */
  async logout() {
    return apiRequest('/auth/logout', { method: 'POST' });
  },

  /**
   * Get OAuth login URLs
   */
  getGoogleLoginUrl() {
    return `${API_URL}/auth/google`;
  },

  async login(email, password) {
    return apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  },

  async register({ email, password, name }) {
    return apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name })
    });
  },

  async verifyEmail(token) {
    return apiRequest('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token })
    });
  },

  async resendVerification(email) {
    return apiRequest('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  },

  async requestPasswordReset(email) {
    return apiRequest('/auth/request-password-reset', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  },

  async resetPassword(token, password) {
    return apiRequest('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password })
    });
  },

  async deleteAccount() {
    return apiRequest('/auth/delete-account', {
      method: 'POST'
    });
  }
};

/**
 * Users API
 */
export const usersAPI = {
  /**
   * List all users (with optional search)
   */
  async listUsers(search = '', limit = 50) {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    params.append('limit', limit);
    return apiRequest(`/users?${params.toString()}`);
  },

  /**
   * Get user profile by ID
   */
  async getUser(userId) {
    return apiRequest(`/users/${userId}`);
  },

  /**
   * Update user profile
   */
  async updateUser(userId, data) {
    return apiRequest(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  /**
   * Search users
   */
  async searchUsers(query) {
    return apiRequest(`/users/search/${encodeURIComponent(query)}`);
  },

  async listAdminUsers() {
    return apiRequest('/users/admin/all');
  },

  async blockUser(userId) {
    return apiRequest(`/users/${userId}/block`, {
      method: 'POST'
    });
  },

  async unblockUser(userId) {
    return apiRequest(`/users/${userId}/unblock`, {
      method: 'POST'
    });
  },

  async deleteUser(userId) {
    return apiRequest(`/users/${userId}`, {
      method: 'DELETE'
    });
  }
};

/**
 * Patterns API
 */
export const patternsAPI = {
  /**
   * Create a new pattern
   */
  async createPattern(data) {
    return apiRequest('/patterns', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  /**
   * Get patterns
   * @param {Object} filters - { type, isPublic, shared }
   */
  async getPatterns(filters = {}) {
    const params = new URLSearchParams();
    if (filters.type) params.append('type', filters.type);
    if (filters.isPublic !== undefined) params.append('isPublic', filters.isPublic);
    if (filters.shared !== undefined) params.append('shared', filters.shared);

    const query = params.toString();
    return apiRequest(`/patterns${query ? `?${query}` : ''}`);
  },

  /**
   * Get pattern by ID
   */
  async getPattern(patternId) {
    return apiRequest(`/patterns/${patternId}`);
  },

  /**
   * Update pattern
   */
  async updatePattern(patternId, data) {
    return apiRequest(`/patterns/${patternId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  /**
   * Delete pattern
   */
  async deletePattern(patternId) {
    return apiRequest(`/patterns/${patternId}`, {
      method: 'DELETE'
    });
  },

  /**
   * Share pattern with users
   */
  async sharePattern(patternId, userIds) {
    return apiRequest(`/patterns/${patternId}/share`, {
      method: 'POST',
      body: JSON.stringify({ userIds })
    });
  },

  /**
   * Get users who have access to pattern
   */
  async getPatternUsers(patternId) {
    return apiRequest(`/patterns/${patternId}/users`);
  }
};

/**
 * Collaboration Sessions API
 */
export const collabAPI = {
  async createSession(title) {
    return apiRequest('/collab-sessions', {
      method: 'POST',
      body: JSON.stringify({ title })
    });
  },

  async getSession(sessionId, { refresh = false } = {}) {
    const params = refresh ? '?refresh=true' : '';
    return apiRequest(`/collab-sessions/${encodeURIComponent(sessionId)}${params}`);
  },

  async getCpuStats(sessionId) {
    return apiRequest(`/collab-sessions/${encodeURIComponent(sessionId)}/cpu`);
  },

  async joinSession(sessionId) {
    return apiRequest(`/collab-sessions/${encodeURIComponent(sessionId)}/join`, {
      method: 'POST'
    });
  },

  async leaveSession(sessionId) {
    return apiRequest(`/collab-sessions/${encodeURIComponent(sessionId)}/leave`, {
      method: 'POST'
    });
  },

  async saveChannel(sessionId, channelPayload) {
    return apiRequest(`/collab-sessions/${encodeURIComponent(sessionId)}/channels`, {
      method: 'POST',
      body: JSON.stringify(channelPayload)
    });
  },

  async publishChannel(sessionId, channelId, status = 'live') {
    return apiRequest(`/collab-sessions/${encodeURIComponent(sessionId)}/channels/${encodeURIComponent(channelId)}/publish`, {
      method: 'POST',
      body: JSON.stringify({ status })
    });
  },

  async overrideMaster(sessionId, masterCode) {
    return apiRequest(`/collab-sessions/${encodeURIComponent(sessionId)}/master`, {
      method: 'POST',
      body: JSON.stringify({ masterCode })
    });
  },

  async updateDelay(sessionId, applyDelayMs) {
    return apiRequest(`/collab-sessions/${encodeURIComponent(sessionId)}/delay`, {
      method: 'POST',
      body: JSON.stringify({ applyDelayMs })
    });
  }
};

/**
 * Check if user is authenticated
 */
export async function isAuthenticated() {
  try {
    await authAPI.getCurrentUser();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current user or null
 */
export async function getCurrentUser() {
  try {
    return await authAPI.getCurrentUser();
  } catch {
    return null;
  }
}

export default {
  auth: authAPI,
  users: usersAPI,
  patterns: patternsAPI,
  collab: collabAPI,
  isAuthenticated,
  getCurrentUser
};

