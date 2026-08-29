// src/utils/api.js
// All calls to your chat-server backend go through here.
// Change SERVER_URL if your computer's IP changes.

export const SERVER_URL = 'http://192.168.1.7:3000';

async function request(path, options = {}) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong');
  }

  return data;
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
