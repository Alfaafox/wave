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

---

## SECTION A — FULL PRODUCT ROADMAP

### Phase 0 — Finish What Is Started (right now)
- Call timeout — auto-cancel unanswered ring after 60s — DONE (server-authoritative, deployed). Server `call_signaling.js`: `armRingTimeout` on `call:invite`, `clearRingTimeout` on accept/reject/end/disconnect, fires the shared `endCallByServer(io, callId, { reason, status })` primitive which emits the existing `call:ended` with a `reason`. Client `CallScreen.js`: shows "No answer" to the caller, plus a 65s failsafe timer. Still needs a real 2-device confirmation test.
- Ringtone playback — WIRED in CallScreen.js (useAudioPlayer + 4s seekTo(0)/play() loop; `stopRinging()` runs before accept so it releases the audio output before expo-call-audio takes MODE_IN_COMMUNICATION). Android JS bundle verified. STILL NEEDS a real 2-device test: (a) ringtone actually plays + loops on the callee, (b) clean handoff to call audio on accept with no dead air / mic failure, (c) ring stops on reject / remote cancel / 60s timeout. `expo-audio` in this SDK actually does expose `player.loop` — the interval approach is the documented project convention (Section D) but could be revisited.
- Account deletion — schema mapped, blocked on product decision (see Section C)
- GIPHY attribution — "Powered by GIPHY" badge not added to MediaPickerSheet.js
- Diagnostic console.logs in ChatScreen.js — still present from unresolved camera bug, need cleanup
- LoginScreen.js / SignupScreen.js — still on old green WhatsApp theme, not restyled

### Phase 1 — Foundation (store requirements + security)
- HTTPS — needs a domain name first, Let's Encrypt will not issue for bare IP
- Push notifications — needs expo-notifications + backend Expo push API
- Rate limiting on login/signup
- Password reset flow
- Username system — currently phone-number only, affects all future social features

### Phase 2 — Complete Calling
- Call timeout — DONE (see Phase 0)
- Call glare handling — two people calling each other simultaneously, not yet tested. NEXT. Reuse the `endCallByServer(io, callId, { reason: 'glare', status: 'missed' })` primitive already in `call_signaling.js` — pick a deterministic loser (e.g. lower userId wins), end the loser's call through that one path. Do NOT add a parallel code path. Note: the two `call:invite` handlers cannot actually interleave (Node single-threaded, handlers are synchronous), so today the first-processed invite wins fully and the other gets `{ ok: false, busy: true }` + a `call:incoming` — the work is making that outcome clean on the client.
- Bluetooth audio routing — speaker toggle exists, device selection does not
- ICE reconnect on network drop — currently just ends the call
- Group calling — needs SFU architecture (LiveKit/mediasoup/Janus researched, not started)

### Phase 3 — Complete Settings
- Appearance / Dark mode — needs theme.js converted to React Context first, touches 15+ files, must be one dedicated pass
- Notifications settings
- Export chat — belongs in ChatScreen menu NOT Settings
- Two-step verification — needs real session model first

### Phase 4 — Modern Chat (all free tier, no external APIs)
- Reply Later inbox
- Send Later / scheduled messages
- Temporary chat mode
- Disappearing messages
- Message to Event/Task/Reminder conversion
- Expense splitting in groups
- Shared group pinboard
- Group Decisions
- Polls
- Meeting Point / live location
- View-once media
- File sharing

### Phase 5 — AI Features
- One-tap translation — FREE, Android ML Kit on-device
- Voice message to transcript — FREE, ML Kit on-device
- Ask this chat — needs LLM API, costs money per call
- Catch me up summaries — needs LLM API
- Message smart extraction (flight ticket to calendar) — needs LLM API
- Semantic search — needs embeddings
- Remember this — free first pass with local storage
- Follow-up detection — needs LLM API

### Phase 6 — Social
- Stories, Close friends, Public profiles, Discover

### Phase 7 — Communities
- Communities, Channels, Topics, Roles, Moderation

### Phase 8 — Events and Real Life
- Event mode (RSVP + chat + album + expenses in one)
- Shared trip albums
- Group memories timeline

### Phase 9 — Scale (only when needed)
- PostgreSQL, Redis, S3 object storage, CDN, TURN scaling, Observability

### iOS — Separate Track
- Not started
- CRITICAL: iOS 26 enforces CallKit + PushKit at OS level at runtime
- If app receives VoIP push and does not report to CallKit immediately, OS kills the app
- Current Socket.io call architecture works on Android but will NOT survive iOS backgrounding
- When iOS begins, budget new native work for CallKit + PushKit from day one

---

## SECTION B — ENTERPRISE DEVELOPMENT RULES (MANDATORY)

### Core Principle
You are working on an existing production software product. Do NOT behave like a code generator.
Understand first, verify dependencies, design correctly, implement completely, integrate, test, verify, only then report completion.
Do not use the user as a debugger. Do not wait for the user to discover missing dependencies or broken integrations.

### Before Writing Any Code
- Read all relevant existing files, not just the obvious one
- Trace the complete execution path: UI → component → state → API → backend → DB → response → rendering
- Identify every file directly AND indirectly affected
- Check existing dependencies, routes, DB schema, auth logic, environment variables
- Never assume how anything works — inspect it first

### Never Do These
- Start coding without investigation
- Discover a missing dependency after writing code
- Implement only the happy path
- Make isolated fixes without checking where else the assumption exists
- Duplicate logic that already exists
- Say Done or Working without actually validating
- Fake completion

### Required Workflow for Every Non-Trivial Task
Phase 1 — Discover: inspect repo, identify complete implementation path
Phase 2 — Understand: how does current system work
Phase 3 — Impact analysis: what is affected directly and indirectly
Phase 4 — Design: choose implementation that fits existing architecture, do not code yet
Phase 5 — Dependency check: verify everything required exists
Phase 6 — Implement: complete change across all layers
Phase 7 — Integrate: verify all contracts match Frontend to API to Backend to DB
Phase 8 — Validate: build, type check, runtime check
Phase 9 — Debug: if anything fails, fix root cause, revalidate
Phase 10 — Final review: if deployed to millions today, what breaks? Fix those things.
Phase 11 — Report: what changed, what was integrated, what was validated, what remains

### Reporting Completed Work
Always provide:
- Changed: what was actually changed
- Integration: which existing systems were integrated
- Dependencies: what was required and whether handled
- Validation: what checks were performed
- Remaining issues: only genuine unresolved items

### Error Handling (every feature must consider)
Invalid input, missing input, malformed requests, unauthorized, unauthenticated, missing records, duplicate records, DB failures, network failures, timeout, race conditions, concurrent requests, partial failure

### Security (every feature must check)
Authentication, authorization, ownership, input validation, output validation, file/MIME validation, file size limits, injection risks, sensitive data exposure, rate limiting

---

## SECTION C — PENDING DECISIONS (user must decide)

### Account Deletion
DB schema is fully mapped. Three options — user must choose one:
1. Hard delete — user messages vanish from other people's history too
2. Anonymize — keep messages, replace name and id with "Deleted User"
3. Soft delete — mark account inactive, keep all data, block login and discovery
This is a store requirement — Google Play and Apple both mandate in-app account deletion.
Tables affected: conversation_members, messages, message_deletions, message_reactions, calls, call_deletions, privacy_settings, blocked_users

---

## SECTION D — KNOWN DEAD ENDS AND GOTCHAS

### Tenor API is permanently dead
Google shut down Tenor API on June 30 2026. Do not reference Tenor anywhere.
GIPHY is the real integration. Endpoints: /gifs/search and /stickers/search.

### react-native-incall-manager is broken in this project
Resolves as null at runtime on physical devices. Replaced by custom expo-call-audio module.
Do NOT use react-native-incall-manager. Pending cleanup: npm uninstall react-native-incall-manager.

### requireAuth is a plain default export
ALWAYS: const requireAuth = require('../middleware/auth')
NEVER: const { requireAuth } = require('../middleware/auth')
This caused a real production crash before.

### Mojibake emoji corruption
Raw emoji in source files gets corrupted by PowerShell 5.1 non-UTF-8 writes.
Use Ionicons for all icons. Use Unicode escape sequences for any emoji in strings.
Check any file: grep -P "[^\x00-\x7F]" filename — should return nothing.

### RTCView blank video
Never use StyleSheet.absoluteFillObject for RTCView.
Always use explicit pixel dimensions: width: Dimensions.get('window').width, height: Dimensions.get('window').height

### expo-media-library SDK 57
Import from expo-media-library/legacy not expo-media-library.
saveToLibraryAsync requires a real local file — not base64 string or https URL.
For base64: write to temp file via FileSystem.writeAsStringAsync first.
For https URLs: download via FileSystem.downloadAsync first.

### Ringtone require() crash
require() paths resolved at Metro bundle time. Missing asset crashes entire app on load.
Never reference a bundled asset via require() until the file actually exists on disk.

### expo-audio does not auto-loop (project convention)
After play() completes the player stays paused at the end. Convention here is setInterval calling seekTo(0) + play() every N seconds (used by the CallScreen ringtone). NOTE: `expo-audio ~57` actually does expose `player.loop = true` on AudioPlayer — if you switch to it, verify gapless behavior on a real device first and update this note + CLAUDE.md's Phase 0 line.

### Health check false positive
curl health returning ok does NOT mean routes work.
Always also run: pm2 logs chat-server --lines 30 --nostream

### Backend lives ONLY on EC2 — this repo does not contain it
The `chat-server` backend (auth, conversations, `call_signaling.js`, `routes/`, `db.js`, chat.db) is on the EC2 box and is NOT in git in any usable form — the server's own repo has a single "Initial server code" commit and the working tree has diverged massively (uncommitted `server.js`, all of `routes/`, `call_signaling.js`, dozens of `.bak` files). A local `~/Downloads/chat-server` may exist but is a stale pre-calling snapshot — do not trust it.
- SSH: `ssh -i ~/Downloads/my-chat-app/chatbox.pem ubuntu@13.232.16.85` (key is gitignored via `*.pem`; also at `chatbox.pem` in repo root)
- Deploy model: edit files in place on the server, back up first (`cp x.js x.js.bak-$(date +%s)` — matches existing convention), `node --check`, then `pm2 restart chat-server`. There is NO CI/CD and NO git-based deploy.
- After any restart: check `pm2 logs chat-server --lines 30 --nostream` (error.log should be empty) AND `curl http://13.232.16.85:3000/health`.
- To inspect server code from a dev machine: read it over SSH — it is the only source of truth.

### Machine identity
PC weekends: guru@Guru, path C:\Users\GuruD\wave, PowerShell 5.1
Laptop weekdays: guru@laptop, path ~/Downloads/my-chat-app, Linux bash
EC2 always: ubuntu@ip-172-31-46-32 (public 13.232.16.85), path /home/ubuntu/chat-server
Always confirm whoami && hostname && pwd if terminal context is ambiguous.

---

## SECTION E — KEY ARCHITECTURAL DECISIONS AFFECTING FUTURE FEATURES

### Theme Context refactor must happen before dark mode
theme.js is currently a static import. Dark mode requires React Context.
This touches every screen file (15+). Must be one complete dedicated pass.
Do not build more screens before this that will need retrofitting.

### Username system affects all social features
Build username system before any feature that assumes phone-based identity.

### Session model needed before security features
Currently stateless JWTs. Two-step verification, linked devices, log out all devices all require real session tracking first.

### Object storage needed before media-heavy features
Currently base64 in SQLite. Migrate to S3 before Stories, shared albums, any media-heavy feature.

### Group calling needs SFU
P2P mesh does not scale past 4 users. SFU is correct architecture.
Options: LiveKit, mediasoup, Janus Gateway. Verify New Architecture compatibility before adopting any.

### Server-decided call termination goes through ONE primitive
`call_signaling.js` has `endCallByServer(io, callId, { reason, status })` — the single path for any case where the SERVER (not a user tap) ends a call. Ring timeout uses it now; glare handling must use it too (`reason: 'glare'`), not a parallel path. It records the terminal `calls.status`, clears both `activeCalls` sides + the ring timer, and emits the existing `call:ended` (with `reason`) to both parties. Clients need no new event — they already handle `call:ended`.

---

*Last updated: Session 4 — Call ring timeout (60s, server-authoritative) built & deployed; CLAUDE.md created*
*Always read this entire file before touching any code.*
