// plugins/withFullScreenCall.js
//
// Config plugin: persist the incoming-call full-screen behaviour through
// `expo prebuild` (which regenerates android/ from scratch and would
// otherwise drop hand edits to AndroidManifest.xml).
//
// Adds android:showWhenLocked="true" + android:turnScreenOn="true" to the
// MainActivity <activity> tag so that when a ringing call is raised via a
// fullScreenIntent notification (see the 'calls' channel in
// src/utils/notifications.js) the CallScreen shows over the lock screen and
// the display wakes.
//
// The matching USE_FULL_SCREEN_INTENT permission is declared separately in
// app.json -> expo.android.permissions.

const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const withFullScreenCall = (config) =>
  withAndroidManifest(config, (cfg) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    mainActivity.$['android:showWhenLocked'] = 'true';
    mainActivity.$['android:turnScreenOn'] = 'true';
    return cfg;
  });

module.exports = withFullScreenCall;
