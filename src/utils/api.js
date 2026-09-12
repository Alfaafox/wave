export const SERVER_URL = 'https://waveitchat.com';

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

// `identifier` is an email or a phone number - the server decides which by
// the presence of "@" and matches phones via phone_hash.
export function login(identifier, password) {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password })
  });
}

export function resendVerification(email) {
  return request('/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email })
  });
}

// Password reset. `forgotPassword` takes an email or phone number; the
// response `channel` ('email' | 'sms') says how the reset was sent. The
// email path is completed on a server-rendered web page; `resetPassword`
// and `verifyOtp` back the (not-yet-shipped) in-app phone path.
export function forgotPassword(identifier) {
  return request('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ identifier })
  });
}

export function resetPassword(token, newPassword) {
  return request('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword })
  });
}

export function verifyOtp(identifier, otp) {
  return request('/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ identifier, otp })
  });
}

// Push notifications. `body` is { token, deviceId, platform }.
export function registerPushToken(authToken, body) {
  return request('/notifications/token', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: JSON.stringify(body)
  });
}
export function unregisterPushToken(authToken, deviceId) {
  return request('/notifications/token', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ deviceId })
  });
}

// Start a 1:1 chat by phone number (contacts) or by user id (username tab -
// a username-found user may have no phone number on record).
export function startConversation(token, phoneNumber, userId) {
  return request('/conversations/start', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(userId ? { userId } : { phoneNumber })
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

// Bump every conversation the caller is a member of to its newest message,
// clearing all unread badges at once. Server: PUT /conversations/mark-all-read.
export function markAllConversationsRead(token) {
  return request('/conversations/mark-all-read', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` }
  });
}

// Starred / bookmarked messages. star/unstar toggle messages.starred_by
// (server-side JSON array of user ids); getStarredMessages returns only the
// caller's own starred messages across every conversation.
export function starMessage(token, conversationId, messageId) {
  return request(`/conversations/${conversationId}/messages/${messageId}/star`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}
export function unstarMessage(token, conversationId, messageId) {
  return request(`/conversations/${conversationId}/messages/${messageId}/unstar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}
export function getStarredMessages(token, { limit = 20, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return request(`/users/me/starred-messages?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}

// Archived chats (per-user, conversation_members.archived). Archiving hides a
// conversation from GET /conversations and surfaces it in
// GET /conversations/archived; a new message auto-unarchives it server-side.
export function archiveConversation(token, conversationId) {
  return request(`/conversations/${conversationId}/archive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}
export function unarchiveConversation(token, conversationId) {
  return request(`/conversations/${conversationId}/unarchive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}
export function getArchivedConversations(token) {
  return request('/conversations/archived', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}

// Pinned messages (max 3 per conversation, enforced server-side). pin/unpin
// also broadcast pinnedMessage / unpinnedMessage over the conversation socket.
export function pinMessage(token, conversationId, messageId) {
  return request(`/conversations/${conversationId}/messages/${messageId}/pin`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}
export function unpinMessage(token, conversationId, messageId) {
  return request(`/conversations/${conversationId}/messages/${messageId}/unpin`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}
export function getPinnedMessages(token, conversationId) {
  return request(`/conversations/${conversationId}/pinned`, {
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

// View-once photo: the recipient calls this the moment they open it. The
// server marks it viewed and blanks the stored content in one transaction,
// then broadcasts `messageViewed` to the conversation room.
export function markViewOnceViewed(token, conversationId, messageId) {
  return request(`/conversations/${conversationId}/messages/${messageId}/view`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function deleteConversation(token, conversationId) {
  return request(`/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

// In-conversation full-text search (FTS5-backed). Returns
// { results: [{ id, content, created_at, sender_id, sender_name, profile_picture }], total, hasMore }.
export function searchMessages(token, conversationId, q, { limit = 20, offset = 0 } = {}) {
  const params = new URLSearchParams({ q, limit: String(limit), offset: String(offset) });
  return request(`/conversations/${conversationId}/search?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}

// Shared media / links for the Shared Media screen. `type` is 'images' or
// 'links'. images -> results: [{ id, content, created_at, user_id, sender_name }].
// links  -> results: [{ id, url, created_at, user_id, sender_name }] (one row
// per extracted URL). Both -> { results, total, hasMore }.
export function getSharedMedia(token, conversationId, type, { limit = 30, offset = 0 } = {}) {
  const params = new URLSearchParams({ type, limit: String(limit), offset: String(offset) });
  return request(`/conversations/${conversationId}/media?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}

// Per-user, per-conversation push-notification mute (server-backed).
export function getConversationMute(token, conversationId) {
  return request(`/conversations/${conversationId}/mute`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}
export function setConversationMute(token, conversationId, muted) {
  return request(`/conversations/${conversationId}/${muted ? 'mute' : 'unmute'}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}

// Private Chat mode: a per-conversation privacy preset (7-day message expiry,
// read receipts off, generic push body). 1:1 conversations only. Response:
// { private_chat: 0|1, private_chat_since: string|null }.
export function setPrivateChat(token, conversationId, enable) {
  return request(`/conversations/${conversationId}/private-chat/${enable ? 'enable' : 'disable'}`, {
    method: 'POST',
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

// File sharing. Files live on disk on the server (multer, 25MB cap; PDF/DOC/
// DOCX/XLS/XLSX/PPT/PPTX/TXT/ZIP/MP3/MP4 only) - never base64 in a JSON body,
// so this bypasses the shared `request()` helper (which always sets
// Content-Type: application/json) and uses XMLHttpRequest instead of fetch
// so `onProgress` can report real upload progress for a file that can take a
// while over this server's plain-HTTP connection. `asset` is whatever
// DocumentPicker.getDocumentAsync() returned: { uri, name, mimeType, size }.
// Resolves to the server's { ok, message } response (the same shape the
// socket 'message' event carries) - ChatScreen doesn't need to append it to
// state itself, since the server also broadcasts it back over the socket to
// everyone in the conversation room, including the uploader.
export function uploadFile(token, conversationId, asset, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SERVER_URL}/conversations/${conversationId}/files`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = 120000;

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) onProgress(evt.loaded / evt.total);
      };
    }
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* leave {} */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'Could not upload file'));
    };
    xhr.onerror = () => reject(new Error('Network error while uploading file'));
    xhr.ontimeout = () => reject(new Error('Upload timed out - check your connection'));

    const formData = new FormData();
    formData.append('file', {
      uri: asset.uri,
      name: asset.name || 'file',
      type: asset.mimeType || 'application/octet-stream',
    });
    xhr.send(formData);
  });
}

// Authenticated file download URL. Not directly fetchable with a plain
// <Image>/browser GET - the caller (ChatScreen) passes the auth header via
// FileSystem.downloadAsync's `headers` option.
export function getFileUrl(conversationId, fileId) {
  return `${SERVER_URL}/conversations/${conversationId}/files/${fileId}`;
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

// Username system. `username` may be '' / null to clear it.
export function updateUsername(token, username) {
  return request('/users/me', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ username: username || null })
  });
}
export function checkUsername(token, username) {
  return request(`/users/check-username/${encodeURIComponent(username)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}
export function getUserByUsername(token, username) {
  return request(`/users/by-username/${encodeURIComponent(username)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  });
}
export function changePassword(token, currentPassword, newPassword) {
  return request('/users/me/password', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword, newPassword })
  });
}
// Reversible - the account is restored by logging in again (see login()'s
// `reactivated` flag, surfaced as a "Welcome back" alert in LoginScreen).
export function deactivateAccount(token) {
  return request('/users/me/deactivate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}
// Irreversible. Server keeps messages/calls but relabels them "Deleted User".
export function deleteAccount(token) {
  return request('/users/me', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
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


// --- Secure email / phone change (two OTP steps each, see routes/users.js) ---
// changeEmailInit / changePhoneInit           -> { method: 'phone'|'email', hint, smsNotWired? }
// change*VerifyIdentity(token, otp)            -> { verified: true }
// change*SendNewOtp(token, newValue)          -> { sent: true, method, hint, smsNotWired? }
// change*VerifyNew(token, newValue, otp)       -> { message, user }
const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });

export function changeEmailInit(token) {
  return request('/users/me/change-email/init', { method: 'POST', headers: authHeaders(token) });
}
export function changeEmailVerifyIdentity(token, otp) {
  return request('/users/me/change-email/verify-identity', {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify({ otp })
  });
}
export function changeEmailSendNewOtp(token, newEmail) {
  return request('/users/me/change-email/verify-new', {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify({ newEmail })
  });
}
export function changeEmailVerifyNew(token, newEmail, otp) {
  return request('/users/me/change-email/verify-new', {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify({ newEmail, otp })
  });
}

export function changePhoneInit(token) {
  return request('/users/me/change-phone/init', { method: 'POST', headers: authHeaders(token) });
}
export function changePhoneVerifyIdentity(token, otp) {
  return request('/users/me/change-phone/verify-identity', {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify({ otp })
  });
}
export function changePhoneSendNewOtp(token, newPhone) {
  return request('/users/me/change-phone/verify-new', {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify({ newPhone })
  });
}
export function changePhoneVerifyNew(token, newPhone, otp) {
  return request('/users/me/change-phone/verify-new', {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify({ newPhone, otp })
  });
}
