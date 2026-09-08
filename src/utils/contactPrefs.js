// src/utils/contactPrefs.js
//
// Per-contact, device-local notification preferences. Nothing here is synced
// to the account or the backend - same approach as src/utils/chatPreferences.js.
//
//   wave_mute_{userId}          -> 'true' | 'false'
//   wave_notifications_{userId} -> JSON of the shape below
//
// The mute flag is deliberately its own key (not folded into the JSON) so the
// UserProfileModal mute toggle and ContactNotificationSettings can both read
// and write it without having to parse the whole prefs blob.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const muteKey = (userId) => `wave_mute_${userId}`;
export const notifKey = (userId) => `wave_notifications_${userId}`;

export const VIBRATE_OPTIONS = ['Default', 'Always', 'Only when silent', 'Never'];

// App defaults - what "Use default settings" falls back to.
export const DEFAULT_NOTIFICATION_PREFS = {
  useDefault: true, // when true, everything below is ignored in favour of app defaults
  tone: 'Default',
  vibrate: 'Default', // one of VIBRATE_OPTIONS
  popup: true, // true = show the message text in the notification; false = just "New message"
};

export async function getMute(userId) {
  try {
    return (await AsyncStorage.getItem(muteKey(userId))) === 'true';
  } catch {
    return false;
  }
}

export async function setMute(userId, value) {
  try {
    await AsyncStorage.setItem(muteKey(userId), value ? 'true' : 'false');
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
