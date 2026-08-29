// src/utils/socket.js
import { io } from 'socket.io-client';
import { SERVER_URL } from './api';

let socket = null;

export function connectSocket(token) {
  if (socket) return socket;
  socket = io(SERVER_URL, { auth: { token } });
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
