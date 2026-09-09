// src/utils/socket.js
import { io } from 'socket.io-client';
import { SERVER_URL } from './api';

let socket = null;

export function connectSocket(token) {
  if (socket) return socket;
  socket = io(SERVER_URL, {
    auth: { token },
    // Prefer a raw WebSocket (instant, survives RN backgrounding better than
    // XHR polling) but keep polling as a fallback for hostile networks.
    transports: ['websocket', 'polling'],
    // Reconnect fast when the app returns to the foreground - the default
    // 1s->5s backoff can leave the socket down for seconds after AppState
    // goes active, which is exactly when a ringing call needs it back.
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
    timeout: 10000,
  });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
