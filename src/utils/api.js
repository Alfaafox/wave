export const SERVER_URL = 'http://13.232.16.85:3000';

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${SERVER_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    clearTimeout(timeoutId);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Something went wrong');
    }
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out - check your internet connection.');
    }
    throw err;
  }
}

export function signup(name, email, password, phoneNumber) {
  return request('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ name, email, password, phoneNumber })
  });
}

export function login(email, password) {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
}

export function resendVerification(email) {
  return request('/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email })
  });
}

export function startConversation(token, phoneNumber) {
  return request('/conversations/start', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ phoneNumber })
  });
}

export function createGroup(token, name, phoneNumbers) {
  return request('/conversations/group', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, phoneNumbers })
  });
}

export function getConversations(token) {
  return request('/conversations', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function getMessages(token, conversationId) {
  return request(`/conversations/${conversationId}/messages`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function deleteConversation(token, conversationId) {
  return request(`/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function updateProfilePicture(token, base64Image) {
  return request('/users/me/picture', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ profilePicture: base64Image })
  });
}

export function getCurrentUser(token) {
  return request('/users/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}
export function updateProfile(token, name, email) {
  return request('/users/me', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, email })
  });
}
export function changePassword(token, currentPassword, newPassword) {
  return request('/users/me/password', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword, newPassword })
  });
}
export function getPrivacySettings(token) {
  return request('/privacy', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}
export function updatePrivacySettings(token, updates) {
  return request('/privacy', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(updates)
  });
}
export function blockUser(token, userId) {
  return request('/privacy/block', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId })
  });
}
export function unblockUser(token, userId) {
  return request('/privacy/unblock', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId })
  });
}
export function matchContacts(token, hashes) {
  return request('/users/match-contacts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ hashes })
  });
}

export function getCallHistory(token, { before, limit = 20 } = {}) {
  const params = new URLSearchParams();
  if (before) params.set('before', before);
  params.set('limit', limit);
  return request(`/calls?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function deleteCall(token, callId) {
  return request(`/calls/${callId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function clearCallHistory(token) {
  return request('/calls', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

