// src/utils/notifPrefs.js
//
// Device-local notification preferences, set from the Notifications settings
// screen. All under wave:notif:* keys, stored as 'true' | 'false' strings
// (same convention as the other AsyncStorage boolean flags in this app).
//
// These are NOT synced to the account and NOT enforced server-side - the OS
// push still arrives. They control:
//   - the in-app NotificationBanner + its routing (App.js)
//   - the Android 'messages' notification channel importance / vibration
//     (src/utils/notifications.js)
//
// Per-conversation mute is a separate, server-backed thing (see contactPrefs.js
// / the chat profile menu).

import AsyncStorage from '@react-native-async-storage/async-storage';

export const NOTIF_PREF_KEYS = {
  messages: 'wave:notif:messages',
  calls: 'wave:notif:calls',
  sound: 'wave:notif:sound',
  vibrate: 'wave:notif:vibrate',
};

// Everything defaults ON - a missing key means "never changed".
export const DEFAULT_NOTIF_PREFS = {
  messages: true,
  calls: true,
  sound: true,
  vibrate: true,
};

// Read all four at once. Fails soft to the defaults.
export async function getNotifPrefs() {
  const out = { ...DEFAULT_NOTIF_PREFS };
  try {
    const entries = await AsyncStorage.multiGet(Object.values(NOTIF_PREF_KEYS));
    const raw = {};
    entries.forEach(([key, value]) => { raw[key] = value; });
    Object.keys(NOTIF_PREF_KEYS).forEach((name) => {
      const v = raw[NOTIF_PREF_KEYS[name]];
      if (v === 'true' || v === 'false') out[name] = v === 'true';
    });
  } catch {
    /* keep defaults */
  }
  return out;
}

// Write one preference. Best effort.
export async function setNotifPref(name, value) {
  const key = NOTIF_PREF_KEYS[name];
  if (!key) return;
  try {
    await AsyncStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    /* best effort */
  }
}
