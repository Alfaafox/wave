// src/utils/contactPrefs.js
//
// Per-contact notification preferences.
//
//   wave_mute_conv_{conversationId} -> 'true' | 'false'
//       Mute is now SERVER-BACKED (conversation_members.mute_notifications,
//       enforced in the push service). This AsyncStorage key is only a
//       device-local CACHE so the toggle renders instantly on modal open with
//       no loading state - the server value is the source of truth and is
//       reconciled on open. Written by ChatScreen alongside the API call.
//   wave_notifications_{userId} -> JSON of the shape below
//       Still purely device-local (tone/vibrate/popup are not synced yet).

import AsyncStorage from '@react-native-async-storage/async-storage';

export const muteCacheKey = (conversationId) => `wave_mute_conv_${conversationId}`;
export const notifKey = (userId) => `wave_notifications_${userId}`;

export const VIBRATE_OPTIONS = ['Default', 'Always', 'Only when silent', 'Never'];

// App defaults - what "Use default settings" falls back to.
export const DEFAULT_NOTIFICATION_PREFS = {
  useDefault: true, // when true, everything below is ignored in favour of app defaults
  tone: 'Default',
  vibrate: 'Default', // one of VIBRATE_OPTIONS
  popup: true, // true = show the message text in the notification; false = just "New message"
};

// Read/write the device-local mute cache for a conversation. The server
// (routes/conversations.js mute endpoints) is authoritative; these just make
// the toggle instant on open.
export async function getMuteCache(conversationId) {
  try {
    return (await AsyncStorage.getItem(muteCacheKey(conversationId))) === 'true';
  } catch {
    return false;
  }
}

export async function setMuteCache(conversationId, value) {
  try {
    await AsyncStorage.setItem(muteCacheKey(conversationId), value ? 'true' : 'false');
  } catch {
    /* best effort */
  }
}

export async function getNotificationPrefs(userId) {
  try {
    const raw = await AsyncStorage.getItem(notifKey(userId));
    if (!raw) return { ...DEFAULT_NOTIFICATION_PREFS };
    const parsed = JSON.parse(raw);
    // Merge over defaults so a prefs blob written by an older build still
    // has every field this build expects.
    return { ...DEFAULT_NOTIFICATION_PREFS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }
}

export async function setNotificationPrefs(userId, prefs) {
  try {
    await AsyncStorage.setItem(notifKey(userId), JSON.stringify(prefs));
  } catch {
    /* best effort */
  }
}
