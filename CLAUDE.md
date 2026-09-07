# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A WhatsApp/Signal-style 1:1 and group chat mobile app: **Expo SDK 57 / React Native 0.86 / React 19, New Architecture enabled**. It is a pure client — it talks to a separately-deployed self-hosted backend (`chat-server`, not in this repo) for auth, chat history, real-time messaging, and WebRTC call signaling.

The app is written in plain `.js` (no TypeScript source despite `tsconfig.json` extending `expo/tsconfig.base`). There is **no test suite and no linter configured**.

## Commands

```bash
npm install

# Metro bundler / dev server (needs a custom dev client installed on the device — see below)
npx expo start
npx expo start -c            # clear Metro cache (do this after native/config changes)

# Build & run native (regenerates android/ via prebuild if needed)
npx expo run:android
npx expo run:ios

# Cloud builds (EAS project id in app.json)
eas build --profile development --platform android   # dev client, internal distribution
eas build --profile preview --platform android
eas build --profile production --platform android    # APK
```

**Expo Go will not work.** This app depends on `react-native-webrtc` and a local custom native module (`modules/expo-call-audio`), so it requires a **custom dev client** build. Use the `development` EAS profile or `expo run:android`/`run:ios`.

## Backend connection

The server URL is **hardcoded** in `src/utils/api.js` as `SERVER_URL` (currently `http://13.232.16.85:3000`, plain HTTP — `usesCleartextTraffic` is enabled in `app.json`). Update it there if the server IP changes. Health check: `curl http://<ip>:3000/health` → `{"status":"ok"}`.

Note `android-config/network_security_config.xml` also lists a cleartext-permitted LAN IP for local-server testing.

### Dead legacy modules — do not use

`src/config.js`, `src/api.js`, and `src/socket.js` are an earlier flat implementation that nothing imports anymore. All live code uses `src/utils/api.js` and `src/utils/socket.js`. If you touch server config, only `src/utils/api.js` matters.

## Architecture

### Navigation is a hand-rolled state machine

There is no navigation library. `App.js` holds all top-level state — `screen` (a string), `token`, `currentUser`, `activeChat`, `incomingCall`, `outgoingCall` — and conditionally renders one screen component per `screen` value. `BottomTabBar` is shown only for the three tab screens (`chatList`, `calls`, `updates`). Settings sub-screens are their own `screen` values (`settingsAccount`, `settingsPrivacy`, etc.), mapped in `openSettingsSection`.

Adding a screen = import it in `App.js`, add a `screen === '...'` branch, and thread a navigation callback prop into whatever opens it.

### Auth & session

JWT-based. On login, `token` + normalized `user` JSON are persisted to `AsyncStorage` under keys `token` and `user`, and restored on launch (`App.js` bootstrap effect, which also re-fetches `/users/me` to pick up profile changes made on other devices). Signup requires **email verification** before login succeeds (`resendVerification` in `src/utils/api.js`). All REST calls attach `Authorization: Bearer <token>`; the socket authenticates with `auth: { token }`.

### Real-time layer

One shared Socket.IO connection, created as a **module-level singleton** in `src/utils/socket.js` (`connectSocket` / `getSocket` / `disconnectSocket`). `App.js` owns its lifecycle (connects when `token` is set, disconnects on logout). Screens call `connectSocket(token)` to get the same instance and attach/detach their own listeners in `useEffect` cleanup.

Message history comes over **REST** (`getMessages`, `getConversations`); everything live is **socket events**:

- Messaging: `message`, `typing`, `presence`, `delivered`, `read`, `messageEdited`, `messageDeletedForEveryone`, `reactionUpdate`, `conversationActivity`
- Client→server actions: `joinConversation`, `message`, `editMessage`, `deleteForMe`, `deleteForEveryone`, `toggleReaction`, `typing`
- Calls (see below): `call:invite`, `call:accept`, `call:reject`, `call:offer`, `call:answer`, `call:ice-candidate`, `call:end` out; `call:incoming`, `call:accepted`, `call:rejected`, `call:offer`, `call:answer`, `call:ice-candidate`, `call:ended`, `call:historyUpdated` in

Edit / delete-for-everyone are only allowed within `EDIT_DELETE_WINDOW_MS` (15 min), enforced client-side in `ChatScreen.js` and again by the server.

### Media in messages

Images and voice notes are sent **inline as base64 `data:` URIs inside the socket `message` payload** (`message_type` of `image` / `audio`), with client-side size caps (~3 MB images, ~4 MB audio). GIFs/stickers from `MediaPickerSheet` are remote `http(s)` URLs sent with `message_type: 'image'` — the renderer and schema treat them identically to photos. Saving to gallery has to materialize a real local file first (`ChatScreen.saveImage`) because `MediaLibrary` rejects data URIs and remote URLs.

Several Expo media APIs are imported from their **`/legacy` subpath** (`expo-contacts/legacy`, `expo-media-library/legacy`, `expo-file-system/legacy`) — SDK 57 changed these APIs and the app hasn't migrated. Keep using the legacy imports unless you're deliberately migrating.

### Contacts matching

`src/utils/contactsMatcher.js` normalizes each contact's phone number (`normalizePhone.js`, **default country code `91` / India**), SHA-256-hashes it (`expo-crypto`), and sends only the hashes to `/users/match-contacts` — the server never receives raw numbers.

### Calls (WebRTC)

- **`src/utils/callManager.js`** owns exactly one `RTCPeerConnection` for one call. **`src/screens/CallScreen.js`** is the UI + socket-signaling glue. `src/utils/callManager.js` (not `callManager` under screens) is the single source of truth for the peer lifecycle.
- **Signaling ordering is deliberate and fragile — read the long comments in `callManager.js` before changing call flow.** Key invariants:
  - The SDP **offer is not created/sent until `call:accepted` arrives** (`sendOffer`), so the callee's `call:offer` listener is guaranteed to exist first.
  - TURN credentials arrive in the ack of `call:invite` / `call:accept`; the peer connection is not built until then (falls back to a public STUN server if absent).
  - Offers and ICE candidates that arrive early are queued (`pendingOffer`, `pendingIce`) and drained after `setRemoteDescription`. `drainPendingIce()` must be called after **every** successful `setRemoteDescription`.
- `CallScreen` renders as a **plain absolutely-positioned `View` with high `zIndex`/`elevation`, not a `<Modal>`** — Android renders Modals in a native Dialog window where WebRTC's `SurfaceView` composites unreliably.
- `RTCView` for the remote stream is **keyed on `remoteVideoTrackCount`** to force a remount when a video track is added to an already-mounted (audio-only) stream, which `RTCView` otherwise ignores.

### Custom native module: `modules/expo-call-audio`

A local Expo Module (Android Kotlin / iOS Swift / web no-op) that forces the OS into in-call audio mode (`AudioManager.MODE_IN_COMMUNICATION` + audio focus on Android) and drives the speakerphone toggle. It exists because `react-native-incall-manager` and `expo-audio`'s `setAudioModeAsync` do **not** affect the audio subsystem WebRTC actually uses on the New Architecture. `callManager.js` calls `startCallAudio` when local media is acquired and `stopCallAudio` in `cleanup()`. Changing this module requires a native rebuild.

### Theming

`src/theme.js` exports `colors`, `spacing`, `radii`, `typography`, `shadow` design tokens. Import from there rather than hardcoding values. `AppearanceSettingsScreen` / `NotificationsSettingsScreen` are placeholder stubs.

### Device-local preferences

`src/utils/chatPreferences.js` — chat wallpaper and media auto-save are stored **per-device in AsyncStorage** (keys `wave:chatWallpaper`, `wave:autoSaveMedia`), not synced to the account. Set in `ChatsSettingsScreen.js`, read in `ChatScreen.js`.

## Gotchas

- **`/android` and `/ios` are gitignored** (`app.json` treats them as prebuild output) but `android/` is currently checked out locally as a prebuilt project. Native/config-plugin changes require re-running prebuild or a fresh EAS build; they won't hot-reload.
- **`metro.config.js`** has a custom `resolveRequest` that redirects `event-target-shim` to its CJS entry specifically for `react-native-webrtc`. Don't drop it.
- **`.env` in the repo root contains server-side secrets** (`JWT_SECRET`, `SMTP_*`) left over from the backend. It is gitignored and **not read by this app** — the client has no `.env` loading.
- `add_conversation_activity_client.js` is a one-off codemod (already applied to `ChatListScreen.js`); it's not part of the build.
- `assets/ringtone.mp3` now exists, but the ringtone playback in `CallScreen.js` is still commented out (`useAudioPlayer(require(...))` + `.play()` calls) — only vibration is active for incoming calls.
