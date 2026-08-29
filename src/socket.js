// src/socket.js
// Sets up the real-time connection to the server. One socket is created per
// logged-in session and reused for the lifetime of the chat screen.

import { io } from 'socket.io-client';
import { API_URL } from './config';

export function createSocket(token) {
  return io(API_URL, {
    auth: { token },
    transports: ['websocket'], // skip the slower polling fallback on mobile
  });
}
