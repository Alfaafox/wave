// src/utils/notifications.js
// Client-side push-notification plumbing: permission, Expo token acquisition,
// device-id, server (de)registration, Android channels, and the foreground
// display policy. Everything here fails soft - if notifications can't be set
// up the app must keep working exactly as before.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { registerPushToken, unregisterPushToken } from './api';
import { getNotifPrefs } from './notifPrefs';

// app.json -> expo.extra.eas.projectId. Needed by getExpoPushTokenAsync.
// Read from the runtime config, with the literal as a last-resort fallback.
const PROJECT_ID =
  Constants?.expoConfig?.extra?.eas?.projectId ||
  Constants?.easConfig?.projectId ||
  'fa1d91ce-5dbd-4e71-a187-c605f94f45e8';

const DEVICE_ID_KEY = 'wave:deviceId';
const PERMISSION_ASKED_KEY = 'wave:notifPermissionAsked';

// Foreground policy: while the app is open we do NOT show the OS banner -
// App.js renders its own in-app banner instead. The note still lands in the
// tray/list. (When the app is backgrounded this handler isn't consulted and
// the OS shows the notification normally.)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false, // deprecated alias, set for older runtimes
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let cachedDeviceId = null;

// A per-install UUID, generated once and kept in AsyncStorage so it survives
// logout/login. Falls back to an in-memory id if storage is unavailable.
export async function getDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = Crypto.randomUUID();
      await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    }
    cachedDeviceId = id;
  } catch {
    cachedDeviceId = cachedDeviceId || Crypto.randomUUID();
  }
  return cachedDeviceId;
}

// The 'messages' channel reflects the wave:notif:sound / wave:notif:vibrate
// prefs: sound on -> HIGH (heads-up + sound), sound off -> LOW (silent, shade
// only); vibrate off -> empty pattern. The 'calls' channel is always MAX and
// always vibrates - a call has to be felt.
function messagesChannelConfig(prefs) {
  return {
    name: 'Messages',
    importance: prefs.sound
      ? Notifications.AndroidImportance.HIGH
      : Notifications.AndroidImportance.LOW,
    vibrationPattern: prefs.vibrate ? [0, 250, 250, 250] : [],
    enableVibrate: prefs.vibrate,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  };
}

export async function setupAndroidChannels() {
  if (Platform.OS !== 'android') return;
  try {
    const prefs = await getNotifPrefs();
    await Notifications.setNotificationChannelAsync('messages', messagesChannelConfig(prefs));
    await Notifications.setNotificationChannelAsync('calls', {
      name: 'Calls',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 500, 500],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  } catch (err) {
    console.warn('notif channel setup failed:', err?.message);
  }
}

// Re-apply the 'messages' channel from the current sound / vibrate prefs.
// Android LOCKS a channel's importance and vibration once it exists -
// setNotificationChannelAsync silently keeps the old values for an existing
// channel - so this deletes and recreates it. Call it from the Notifications
// settings screen right after the user flips Sound or Vibration. No-op on iOS
// (channels don't exist there; iOS sound/vibration is OS-controlled).
export async function applyMessageChannelPrefs() {
  if (Platform.OS !== 'android') return;
  try {
    const prefs = await getNotifPrefs();
    await Notifications.deleteNotificationChannelAsync('messages');
    await Notifications.setNotificationChannelAsync('messages', messagesChannelConfig(prefs));
  } catch (err) {
    console.warn('notif channel prefs apply failed:', err?.message);
  }
}

// 'granted' | 'denied' | 'undetermined'
export async function getPermissionStatus() {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status;
  } catch {
    return 'undetermined';
  }
}

export async function hasAskedPermission() {
  try {
    return (await AsyncStorage.getItem(PERMISSION_ASKED_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function markAskedPermission() {
  try {
    await AsyncStorage.setItem(PERMISSION_ASKED_KEY, '1');
  } catch {
    /* non-fatal */
  }
}

// Shows the OS permission dialog. Records that we've asked either way, so we
// never nag on later launches.
export async function requestPermission() {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    await markAskedPermission();
    return status === 'granted';
  } catch {
    await markAskedPermission();
    return false;
  }
}

// Acquire the Expo push token and register this device with the server.
// Returns false (no throw) if permission isn't granted or anything fails.
export async function registerDeviceForPush(authToken) {
  try {
    if (!authToken) return false;
    if ((await getPermissionStatus()) !== 'granted') return false;

    await setupAndroidChannels();

    const result = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });
    const expoToken = result?.data;
    if (!expoToken) return false;

    await registerPushToken(authToken, {
      token: expoToken,
      deviceId: await getDeviceId(),
      platform: Platform.OS,
    });
    return true;
  } catch (err) {
    console.warn('push registration failed:', err?.message);
    return false;
  }
}

// Call on logout, BEFORE the auth token is cleared from storage.
export async function unregisterDeviceForPush(authToken) {
  try {
    if (!authToken) return;
    await unregisterPushToken(authToken, await getDeviceId());
  } catch (err) {
    console.warn('push unregistration failed:', err?.message);
  }
}
