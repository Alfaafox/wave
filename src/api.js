// src/api.js
// Small wrapper around fetch() for talking to the REST parts of the server
// (signup, login, chat history). Real-time messages go over Socket.io
// instead - see socket.js.

import { API_URL } from './config';

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export async function signup(username, password) {
  const res = await fetch(`${API_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return handleResponse(res); // { token, username }
}

export async function login(username, password) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return handleResponse(res); // { token, username }
}

export async function fetchMessages(token) {
  const res = await fetch(`${API_URL}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse(res); // array of messages
}
