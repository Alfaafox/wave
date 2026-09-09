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

**Email is case-insensitive (Session 8).** Server: emails are stored lower-cased and every lookup lower-cases first — `signup`, `resend-verification`, `findUserByIdentifier` (login / forgot-password / verify-otp) in `routes/auth.js`, and `PUT /me` in `routes/users.js` (profile email edit). `users.email` is still `TEXT UNIQUE` (BINARY collation) but every write path normalizes, so it's effectively case-insensitive. All 5 existing rows were already lowercase → no backfill was needed; if a mixed-case row ever appears, `UPDATE users SET email = LOWER(email)` (after checking `GROUP BY LOWER(email) HAVING COUNT(*)>1` for collisions). Client: `LoginScreen.js` / `SignupScreen.js` regex-check the email (`isValidEmail` / `EMAIL_REGEX` `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` in `src/components/AuthUI.js`) before submit — invalid → inline "Please enter a valid email address" under the field (`AuthField` `error` prop), no network call. LoginScreen only format-checks input containing `@` (the field also takes a phone number).

### Real-time layer

One shared Socket.IO connection, created as a **module-level singleton** in `src/utils/socket.js` (`connectSocket` / `getSocket` / `disconnectSocket`). `App.js` owns its lifecycle (connects when `token` is set, disconnects on logout). Screens call `connectSocket(token)` to get the same instance and attach/detach their own listeners in `useEffect` cleanup.

Message history comes over **REST** (`getMessages`, `getConversations`); everything live is **socket events**:

- Messaging: `message`, `typing:start` / `typing:pause` / `typing:stop` (3-state typing indicator — see below), `presence:online` / `presence:offline` / `presence:sync` (online/offline — see below; distinct from the `presence:foreground` / `presence:background` the client *sends* for push), `delivered`, `read`, `messageEdited`, `messageDeletedForEveryone`, `reactionUpdate`, `conversationActivity`
- Client→server actions: `joinConversation`, `message`, `editMessage`, `deleteForMe`, `deleteForEveryone`, `toggleReaction`, `typing:start` / `typing:pause` / `typing:stop`
- Calls (see below): `call:invite`, `call:accept`, `call:reject`, `call:offer`, `call:answer`, `call:ice-candidate`, `call:end` out; `call:incoming`, `call:accepted`, `call:rejected`, `call:offer`, `call:answer`, `call:ice-candidate`, `call:ended`, `call:historyUpdated` in

Edit / delete-for-everyone are only allowed within `EDIT_DELETE_WINDOW_MS` (15 min), enforced client-side in `ChatScreen.js` and again by the server.

### Online/offline presence (Session 8)

Replaced the old global `presence` broadcast. **Server** (`server.js`, deployed, `server.js.bak-1788866830`): `conversationPeers(userId)` = distinct users sharing any conversation. On the 0→1 socket transition, `presence:online {userId}` is emitted to each peer's `user:<id>` room (all their screens listen there — the chat list never joins conversation rooms); on the last-socket disconnect, `users.last_seen` is written and `presence:offline {userId, lastSeen}` goes to each peer. Every fresh socket also gets one `presence:sync {online:[ids]}` (authoritative current set — makes reconnects self-correct). **All three respect the sender's `last_seen_visible`** (suppressed entirely if off), and `presence:sync` also filters each peer by *their* toggle. `routes/conversations.js` `GET /` now nulls `with.last_seen` when the other party has it off (`CASE WHEN COALESCE(ps.last_seen_visible,1)=0 ...`). **Client**: `App.js` owns `presenceMap` (`userId → {online, lastSeen}`), fed by the three events, cleared on logout, passed to `ChatListScreen` (10px `#4CAF50` dot, white 2px ring, bottom-right of avatar; nothing when offline) and `ChatScreen` (header subtitle "online" in `#4CAF50` / "last seen …" grey, live). `ChatScreen`/`ChatListScreen` no longer hold their own presence state. Reciprocity ("hide mine → I can't see others'") is still **not** implemented — pre-existing gap.

### 3-state typing indicator (Session 8)

Replaces the old single `typing` event. **`src/components/TypingIndicator.js`** renders one of: `typing` (three RN-`Animated` dots, staggered 150ms bounce wave, 400ms/dot), `paused` (one dot, 2s opacity breathe), `gone` (null) — as a received-style bubble in the `FlatList` `ListFooterComponent`, with the typer's avatar/initials on the left and (groups only) their name above. **Server** (`server.js`, deployed, `server.js.bak-1788866049`): `typing:start` / `typing:pause` / `typing:stop` each membership-checked (`isMemberOf`) then relayed via `socket.to(\`conversation:${id}\`)` with `{conversationId, userId, name}` (never echoed to sender). **`ChatScreen.js` sender**: `typing:start` per keystroke (throttled 1/sec via `typingStartSentRef`), `typing:pause` 1.5s after the last keystroke (`pauseEmitRef`), `typing:stop` on send / edit-submit / edit-cancel (`emitTypingStop`) and in the mount effect's cleanup (covers navigating back / unmount). **Receiver**: tracks one typer (`shownTyperId`, a `let` in the socket effect); safety timers (`typingTimeoutRef`) auto-demote `typing→paused` after 4s and `paused→gone` after 30s; an incoming message from the shown typer also clears it. Header subtitle still shows "typing..." for the `typing` state only.

### Media in messages

Images and voice notes are sent **inline as base64 `data:` URIs inside the socket `message` payload** (`message_type` of `image` / `audio`), with client-side size caps (~3 MB images, ~4 MB audio). GIFs/stickers from `MediaPickerSheet` are remote `http(s)` URLs sent with `message_type: 'image'` — the renderer and schema treat them identically to photos. Saving to gallery has to materialize a real local file first (`ChatScreen.saveImage`) because `MediaLibrary` rejects data URIs and remote URLs.

Several Expo media APIs are imported from their **`/legacy` subpath** (`expo-contacts/legacy`, `expo-media-library/legacy`, `expo-file-system/legacy`) — SDK 57 changed these APIs and the app hasn't migrated. Keep using the legacy imports unless you're deliberately migrating.

### Profile pictures

Stored as a base64 `data:` URI in `users.profile_picture` (TEXT), set via `PUT /users/me/picture` (`updateProfilePicture` in `src/utils/api.js`), returned by `/users/me` and carried in contact-match results. **`ProfileScreen.js`**: tapping the avatar opens it full-screen in the shared `ImageViewerModal` (view-only — that modal now hides its save-to-gallery button when no `onSave` prop is passed); a separate **"Change profile picture"** button runs `ImagePicker.launchImageLibraryAsync` (gallery only, no camera) with `allowsEditing: true` (expo-image-picker's built-in crop UI — no separate crop lib) + `aspect: [1,1]` + **`quality: 1`** (full-size cropped original, not a thumbnail). There's a client-side ~7 MB base64 guard because the server's `express.json` limit is 8 MB and there's no object storage yet (Phase 9). No image-manipulation library is installed or needed.

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

`src/utils/favourites.js` — favourited users, an array of numeric user ids under `wave_favourites`. `src/utils/contactPrefs.js`:
- **Mute is now server-backed (Session 8).** `conversation_members.mute_notifications` (per-user, per-conversation) is the source of truth; `server.js`'s message-push loop skips a member whose row has it set. Endpoints: `GET /conversations/:id/mute` → `{muted}`, `POST /conversations/:id/{mute,unmute}` (all `requireAuth` + membership-checked). `wave_mute_conv_{conversationId}` in AsyncStorage is only an **instant-render cache** (`getMuteCache`/`setMuteCache`) — `ChatScreen` reads it on mount for a no-spinner toggle, `UserProfileModal` reconciles against the server `GET` on open (`onMuteChange(v, {skipSync:true})`), and a real toggle in either the modal or `ContactNotificationSettings` calls `setConversationMute` and rolls the UI back on failure. `ChatScreen` owns the lifted `contactMuted` state + `handleMuteChange`; a `muteTouchedRef` stops a slow server reconcile from clobbering a fresh local toggle. 1:1 only for now (the column + endpoints + push-check already work for groups). Message push only — call push is unaffected. The old device-only `wave_mute_{userId}` keys are orphaned (existing client-only mutes reset once, harmless).
- `wave_notifications_{userId}` (JSON: `useDefault`, `tone`, `vibrate`, `popup`) — still purely device-local, not synced, not enforced.

### User profile modal (Session 8)

Tapping the `ChatScreen` header opens **`src/components/UserProfileModal.js`** — a bottom sheet (`Modal animationType="slide"` + a `PanResponder` drag handle, same manual-`Animated` pattern as `ImageViewerModal`). 1:1: photo (→ `ImageViewerModal`), name/phone/last-seen, audio+video call buttons (`onStartCall`), an animated favourites star (**`src/components/FavouriteStar.js`** — RN `Animated` scale bounce + grey→`#FFD700` colour interp + an 8-dot particle burst), a mute `Switch`, a row into **`src/screens/ContactNotificationSettings.js`**, and block/unblock (`/privacy/block`). Group: name + member count + scrollable member list + "Leave group" (which calls the existing `DELETE /conversations/:id` — same as ChatListScreen's delete-chat; it also drops your own messages in that group, the only leave mechanism the server has). Mute state is **lifted to `ChatScreen`** (`contactMuted` + `handleMuteChange`), passed to both the modal and `ContactNotificationSettings`, and **server-backed** (see "Device-local preferences" — `conversation_members.mute_notifications`, enforced in the push loop; the modal reconciles from `GET /conversations/:id/mute` on open). `ContactNotificationSettings` is rendered by `ChatScreen` as an absolute-fill overlay (no new `App.js` `screen` value). Favourites strip: a horizontal `ScrollView` above the `ChatListScreen` list, shown only when ≥1 favourite exists, derived from `conversations` ∩ `wave_favourites` (re-read on every mount / pull-to-refresh).

### Private Chat mode (Session 9)

A one-tap per-conversation privacy preset (1:1 only). It bundles three effects — it is **not** three separate toggles:
1. **7-day message expiry.** `server.js` runs `purgeExpiredPrivateMessages()` on an hourly `setInterval` **and once on boot** (no `node-cron` — not installed, and the "no new deps" rule stands): `DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE private_chat = 1) AND created_at < datetime('now','-7 days')`. Reactions on a purged row go via `message_reactions`'s `ON DELETE CASCADE`; `message_deletions` markers become inert orphans (harmless, matches existing `DELETE /conversations/:id` behaviour). `GET /conversations/:id/messages` **also** filters `AND (? = 0 OR m.created_at >= datetime('now','-7 days'))` (param = the conv's `private_chat` flag) so the cutoff is exact regardless of when the purge last ran. Open `ChatScreen`s keep already-rendered old messages until reload — no live "message vanished" event (acceptable for v1).
2. **Read receipts off for the thread.** `server.js` `joinConversation` skips the `read` emit when `conversations.private_chat = 1` (parallel to the existing per-user `read_receipts_enabled` gate — messages are still marked `read` in the DB, just not broadcast). `GET .../messages` masks `read` to `0` on the caller's own messages when `privateChat` (same place it already masks for `!otherPartyReadReceiptsEnabled`).
3. **Generic push body.** No code change — the message-push body is **already** hard-coded `'New message'` globally (see Section G). Private Chat conversations already satisfy this line of the brief.

**DB** (`db.js`, migration pattern): `conversations.private_chat INTEGER NOT NULL DEFAULT 0` + `conversations.private_chat_since TEXT` (set to `datetime('now')` on enable, `NULL` on disable). `GET /conversations` SELECT now carries both (they spread into each list item); its `unreadCount` query excludes `message_type = 'system'`.

**Endpoints** (`routes/conversations.js`, `requireAuth` + membership-checked, **`is_group` → 400**): `POST /conversations/:id/private-chat/enable` and `.../disable`. Each: flips the flag + timestamp, inserts a **persisted `message_type = 'system'` message** (`content` = `'Private Chat is on. Messages will disappear after 7 days.'` / `'Private Chat is off. Messages will no longer disappear.'`, `user_id` = the actor, `read`/`delivered` = 1), then via `req.app.get('io')` (new: `server.js` does `app.set('io', io)`) emits that message to `conversation:<id>` **and** `privateChatEnabled` / `privateChatDisabled` (`{ conversationId, since }`) + `conversationActivity` to each member's `user:<id>` room. Idempotent — enabling when already on returns the current state and inserts nothing. Response: `{ private_chat: 0|1, private_chat_since }`.

**No emoji anywhere** — the "lock" in the brief's system-message text is rendered as an **Ionicons `lock-closed`** in the `ChatScreen` system-message pill and header, not a `🔒` char (mojibake rule).

**Client**: `src/utils/api.js` `setPrivateChat(token, conversationId, enable)`. `ChatScreen.js`: `privateChat` state seeded from a `getConversations` fetch on mount (1:1 only), kept live by `privateChatEnabled` / `privateChatDisabled` socket listeners; a small `lock-closed` icon sits left of the header title when on; `renderItem` renders `message_type === 'system'` as a centered grey pill (`lock-closed` + `content`, no bubble/menu/reactions) — added before the `deleted_for_everyone` branch. `handlePrivateChatChange` is passed to `UserProfileModal` for an optimistic flip. `UserProfileModal.js`: the Session-8 greyed-out "Disappearing Messages" row is now the **"Private Chat"** row (`lock-closed-outline`, no more `opacity:0.4`, value shows `On` green / `Off`); tapping opens an `Alert.alert` (the codebase's standard "modal with explanation + action" pattern — `handleBlock`/`handleLeaveGroup` do the same) listing the three effects with a contextual **Enable Private Chat** / **Disable Private Chat** action; `applyPrivateChat` calls the API, optimistically flips via `onPrivateChatChange`, rolls back on failure. Deployed (`db.js.bak-1788927360`, `server.js.bak-1788927360`, `routes/conversations.js.bak-1788927360`); 25-assertion in-process e2e against the live DB passes (enable/disable, DB flag + timestamp, system message, both-socket events, GET reflection, read-receipt suppression, unread exclusion, idempotency, group 400, non-member 403, purge SQL incl. non-private-conv isolation). Client is JS-only, babel-parsed + mojibake-clean, **not yet run on a device**.

### In-conversation message search (Session 10)

Full-text search **within one conversation**, WhatsApp/Telegram-style, backed by **SQLite FTS5** (`better-sqlite3` bundles it).

**`db.js`**: `messages_fts` is an **external-content** FTS5 table (`content=messages, content_rowid=id`) — the index stores tokens only, not a copy of the text. Three `IF NOT EXISTS` triggers keep it in sync (`messages_fts_ai` / `_ad` / `_au`); the AFTER UPDATE one is guarded `WHEN old.message_type='text' AND old.content IS NOT new.content` so the *very frequent* `delivered`/`read` flag updates don't churn the index. **Only `message_type='text'` messages are indexed** — image/audio `content` is a multi-MB base64 `data:` URI and the endpoint filters to text anyway (this is a deliberate refinement of the brief, whose trigger snippets had no filter; the one-time backfill it specifies is already text-only). Backfill runs once, only when the vtable is first created (`[fts] messages_fts created and backfilled` in the pm2 log). All setup is in one `try/catch` — if FTS5 were ever unavailable the app still boots, searches just 400.

**`routes/conversations.js`** — `GET /conversations/:id/search?q=&limit=20&offset=0` (`requireAuth`). Checks in order: membership → 403; `q` trimmed length < 2 → 400 `{error:'Query too short'}`; `toFtsMatchQuery()` strips every FTS5 operator char (`" * ^ ( ) : -` and the bare words `AND OR NOT NEAR`) and re-quotes each surviving token so the raw text can't cause a MATCH parse error (implicit AND between tokens); private-chat 7-day `created_at` window (mirrors `GET /:id/messages`); `rateLimit('msg-search:<userId>', 30, 60_000)` → 429. The query `JOIN messages_fts fts ON m.id = fts.rowid`, `WHERE fts.content MATCH ? AND m.conversation_id = ? AND m.deleted_for_everyone = 0 AND m.message_type = 'text' [AND m.created_at >= datetime('now','-7 days')] ORDER BY rank LIMIT ? OFFSET ?`, all wrapped in `try/catch` → 400 on any residual FTS error. `LEFT JOIN users` + `COALESCE(u.name, m.username, 'Deleted User')` (not the brief's INNER JOIN — hard-deleted senders leave a dangling `messages.user_id` and must still be searchable). Returns `{ results: [{ id, content, created_at, sender_id, sender_name, profile_picture }], total, hasMore }`. **`sender_id` = `messages.user_id`** (the schema column is `user_id`, not the brief's `sender_id`). Conversation scoping (`m.conversation_id = ?` after the membership check) is the guarantee that no other conversation's content is ever returned. `profile_picture` is the base64 data URI (same Phase-9 base64-in-JSON debt).

**`ChatScreen.js`** — search is a header transformation, no new screen. A **search icon** was added to the header right-side cluster (it did **not** already exist despite the brief). `searchMode` swaps the header for back-arrow + autofocus `TextInput` ("Search messages...") + Cancel. 300ms debounce (`searchDebounceRef`), min 2 chars, stale-response guard (`searchReqIdRef`). Results render in an **absolute overlay** (`styles.searchOverlay`, `top: headerHeight` measured via `onLayout`, `bottom: 0`, `zIndex/elevation: 30`) above the message list, below the header, inside the `KeyboardAvoidingView` so the keyboard shrinks it rather than covering it. Overlay top bar: "N results" / "No messages found" + up/down chevrons. Each row: 36px sender avatar-or-initials + name + `renderSnippet()` (first match bolded, "..." for trimmed start) + date. Tapping a row or a chevron → `resultsCollapsed` (overlay hidden, a slim `searchNavBar` "3 of 12" + chevrons + list-icon stays under the header), `scrollToMessageId()` (`scrollToIndex` in try/catch, `viewPosition: 0.5`; `onScrollToIndexFailed` → `scrollToOffset` estimate then retry; Alert if the message is older than the loaded 50-message window), then `flashHighlight()` — a 1.5s `Animated` amber `backgroundColor` interpolation on that row (`highlightedMessageId` state + `extraData` on the list + a wrapper `Animated.View` in `renderItem`). Sending a message, Cancel, or the back-arrow all call `exitSearchMode()` (clears everything). `api.js`: `searchMessages(token, conversationId, q, {limit,offset})`.

**Known limits**: only the last 50 messages are client-loaded (`getMessages` default), so a hit older than that shows an Alert instead of scrolling — no scroll-back-and-retry yet. Live-removal of a message that ages out of a private chat's 7-day window while you're scrolled to it isn't pushed (next open/refresh is clean).

### Swipe-to-reply (Session 11)

Swipe a message bubble **right** to reply to it.

**No `react-native-gesture-handler`** — despite the task assuming it ships with SDK 57, it is **not** in this repo (only `react-native-reanimated` 4.5.1 + `react-native-worklets` 0.10.1 are). Adding it would need a native rebuild and violate the repeated "no new dependencies", so the gesture uses **RN core `PanResponder`** (the project's existing convention — `UserProfileModal.js` / `ImageViewerModal.js`) for detection, and **reanimated shared values** for the animation. `App.js` was checked: no `GestureHandlerRootView`, and none is added — `PanResponder` needs no root wrapper and importing RNGH would break the Metro bundle.

**`src/screens/ChatScreen.js`** — `SwipeableMessage` (module-level component) wraps every normal bubble in `renderItem`. A memoised `PanResponder` (`useMemo` on `[enabled]`): `onMoveShouldSetPanResponder` returns true only for `g.dx > 10 && |g.dy| < 10` single-finger (= RNGH's `activeOffsetX:[10,Inf]` + `failOffsetY:[-10,10]` + right-only); vertical drags fall through to the `FlatList` so scrolling is unaffected. `onPanResponderMove` writes `translateX.value` (a `useSharedValue`) clamped `0..80` — **no `setState`, no FlatList re-render per frame**. `onPanResponderRelease`: `withSpring(0, {stiffness:200,damping:20,mass:0.6})` back, and if `g.dx >= 60` calls the reply trigger. Two `useAnimatedStyle`s (UI thread): the bubble's `translateX`, and a reply icon (`Ionicons arrow-undo`, absolute at the row's left edge, `pointerEvents:none` so it never blocks touches or pushes layout) fading `opacity 0->1` + scaling `0.5->1` over `translateX 0->60`. **Haptics**: intentionally omitted — `expo-haptics` isn't installed and `require()` of a missing module fails at Metro bundle time (see the ringtone gotcha); a comment marks where `Haptics.impactAsync` would go.

**Disabled** when: `searchMode` (search active), `accountUnavailable` (deactivated/deleted other party — no input bar to send from), and for `deleted_for_everyone` / `message_type === 'system'` rows (those `return` before the wrap). Reuses the **existing** reply mechanism exactly — `setReplyTo(<message object>)`, same as the long-press action menu's "Reply"; `sendMessage` already does `payload.replyToId = replyTo.id`.

**Reply preview bar** (already existed) — now: `arrow-undo` icon + "Reply to {name}" ("yourself" + accent colour when it's your own message, otherwise the sender's name in `textPrimary` — works for 1:1 and groups) + a snippet `truncate`d to 80 chars ("Photo" / "Voice message" for media) + the existing X. Wrapped in `Animated.View` (RN `Animated`, native driver) that springs up (`translateY 10->0` + fade) when `replyTo` becomes non-null.

**Deleted-quote edge case** — server: `GET /:id/messages` reply-join now also selects `r.deleted_for_everyone AS reply_deleted`; the socket `message` payload's `replyInfo` carries `reply_deleted` too (`server.js` / `routes/conversations.js`, `.bak-1788932528`). Client: the in-bubble reply quote renders "This message was deleted" (ban icon, italic) when `item.reply_deleted`; `handleDeletedForEveryone` also flags any loaded message whose `reply_to_id` matches so it updates live.

## Gotchas

- **`/android` and `/ios` are gitignored** (`app.json` treats them as prebuild output) but `android/` is currently checked out locally as a prebuilt project. Native/config-plugin changes require re-running prebuild or a fresh EAS build; they won't hot-reload.
- **`metro.config.js`** has a custom `resolveRequest` that redirects `event-target-shim` to its CJS entry specifically for `react-native-webrtc`. Don't drop it.
- **`.env` in the repo root contains server-side secrets** (`JWT_SECRET`, `SMTP_*`) left over from the backend. It is gitignored and **not read by this app** — the client has no `.env` loading.
- `add_conversation_activity_client.js` is a one-off codemod (already applied to `ChatListScreen.js`); it's not part of the build.
- `assets/ringtone.mp3` exists and ringtone playback in `CallScreen.js` is WIRED and confirmed working on a real device (Session 8): `useAudioPlayer` + a 4s `seekTo(0)`/`play()` interval loop, `stopRinging()` before accept so it releases the audio output before `expo-call-audio` takes `MODE_IN_COMMUNICATION`. Vibration still runs alongside it.

---

## SECTION A — FULL PRODUCT ROADMAP

### Phase 0 — Finish What Is Started (right now)
- Call timeout — auto-cancel unanswered ring after 60s — DONE (server-authoritative, deployed). Server `call_signaling.js`: `armRingTimeout` on `call:invite`, `clearRingTimeout` on accept/reject/end/disconnect, fires the shared `endCallByServer(io, callId, { reason, status })` primitive which emits the existing `call:ended` with a `reason`. Client `CallScreen.js`: shows "No answer" to the caller, plus a 65s failsafe timer. 2-device confirmed (Session 8) — the ring stops on the 60s timeout and the caller sees "No answer".
- Ringtone playback — DONE & CONFIRMED WORKING on a real device (Session 8). WIRED in CallScreen.js (useAudioPlayer + 4s seekTo(0)/play() loop; `stopRinging()` runs before accept so it releases the audio output before expo-call-audio takes MODE_IN_COMMUNICATION). Verified: ringtone plays + loops on the callee, clean handoff to call audio on accept (no dead air / mic failure), ring stops on reject / remote cancel / 60s timeout. `expo-audio` in this SDK actually does expose `player.loop` — the interval approach is the documented project convention (Section D) but could be revisited.
- Account deactivate + hard delete — BUILT & DEPLOYED (see Section C). `users.status` migration ran on EC2. Still needs a real 2-device end-to-end test.
- GIPHY attribution — DONE (Session 8). `MediaPickerSheet.js`: a `GiphyAttribution` component ("Powered by GIPHY", plain text — no bundled GIPHY logo asset, no new deps) rendered inside `MediaGrid`, below the results and outside the loading/error/results switch. `MediaGrid` mounts only for the GIF and Sticker tabs (Emoji uses `EmojiKeyboard`), so the badge is on screen the whole time either GIPHY-sourced tab is active, in every state, and never on the Emoji tab. Client-only, no rebuild needed (JS).
- Diagnostic console.logs in ChatScreen.js — NONE FOUND (Session 8 audit). The file has only 3 `console.warn` calls, all legitimate production error/warning tracking (mic permission denied; `joinConversation` failed; gallery auto-save failed) — kept. The camera/gallery bug's debug noise was already removed in an earlier pass; those image functions surface errors via `Alert.alert`. NOTE: `CallScreen.js` still carries its `[CALL]` / `[CALL][RENDER]` diagnostic logs (see Section D) — a separate cleanup.
- LoginScreen.js / SignupScreen.js / ForgotPasswordScreen.js — RESTYLED (Session 5). `src/components/`: `AuthUI.js` (`AuthShell` + `AuthTabs` (pill) + `AuthField` (eye toggle) + `AuthLink`), `WaveMark.js`, `LoginBarButton.js`. White top to bottom, content top-aligned, **no bottom decoration, no swiper/pager** — plain `screen`-string switching in `App.js` like everything else.
  - **All 3 buttons = the loginbar art** via `LoginBarButton` (Image inside a `TouchableOpacity`). No `label` → `assets/loginbar.png` as-is ("Log In ->" baked in) = the login button. With `label` (e.g. "Create Account", "Send Reset Link") → `assets/loginbar_blank.png` (same art, "Log In ->" painted out) + the label drawn on top. Width/height are explicit px from `useWindowDimensions` — NOT `width:'100%' + aspectRatio`, which lays out at 0 height on the New Arch (blank-gap bug). No gradient-View button (`AuthButton.js` / `AuthWave.js` deleted).
  - `WaveMark` renders `assets/Wave_Chat_Gradient_Logo.png` at height 120. That PNG was **re-centered** (Session 5) — the original art sat ~22px left of centre in its 1254² frame; now cropped to content + padded to a centred 942² square (original saved as `Wave_Chat_Gradient_Logo.orig.png` in the session scratchpad). The tagline + "Wave Chat" wordmark are part of that artwork — they are **not** rendered as separate `<Text>` (no `<Tagline>` component; it was removed because it doubled the baked-in line).
  - Login field is a single phone-OR-email input.
- App icon — REPLACED (Session 5) from `assets/appicon.png` (1595×986 wave-on-white). Squared by padding with white (no distortion). `assets/icon.png` (1024, white), `assets/favicon.png` (48), `assets/android-icon-foreground.png` (512, outer-white knocked out → transparent, ~60% safe-zone). `android-icon-background.png` left as the light `#E6F4FE`. **`android-icon-monochrome.png` still the OLD art** — regenerate from the wave silhouette when convenient (themed-icon phones show the stale one). `app.json` unchanged (files replaced in place). Native rebuild / EAS build needed for icons to actually change on device.

### Phase 1 — Foundation (store requirements + security)
- HTTPS — needs a domain name first, Let's Encrypt will not issue for bare IP
- Push notifications — BUILT & DEPLOYED (Session 6), FCM wired + backgrounded-message-push fix (Session 7), see Section G. `google-services.json` wired into `android/` via prebuild; FCM V1 key on Expo; direct send verified (ticket+receipt `ok`). Session 7 also fixed message push never firing for backgrounded-but-connected clients (`foregroundUsers` + `presence:*` events, server deployed). **NEXT TASK (Session 8): on-device push test over USB — `npx expo run:android` with the phone connected via USB to build + install a dev client carrying the Session-7 changes, then run the full 2-device test in Section G** (message push after 8s grace, no push when foregrounded, incoming-call wake, missed-call push, tap-routing incl. cold start, logout de-registration). The client currently on devices predates all of this.
- Rate limiting on login/signup — DONE (Session 8): `express-rate-limit` (`^8.7.0`, already in server deps) mounted in `server.js` BEFORE `app.use('/auth', authRoutes)` — `app.use('/auth/login', authLimiter())` + `app.use('/auth/signup', authLimiter())`, **10 requests / 15 min / IP, independent bucket per path**, default in-memory store + IP key generator. 429 body is `{ error: 'Too many attempts. Wait a few minutes and try again.' }` (unchanged shape — client `src/utils/api.js` shows `data.error`). `standardHeaders: true` (emits `RateLimit-Policy: 10;w=900` etc.), `legacyHeaders: false`. The old hand-rolled `rateLimit(\`login:${req.ip}\`, 20, …)` line was removed from `routes/auth.js` (one source of truth for login). Verified live: login req 11+ → 429, signup counted on its own bucket.
  - `rateLimiter.js` (the in-memory sliding-window helper) is STILL used by `routes/auth.js` for `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-otp` and by `routes/notifications.js` for `/notifications/token` — not removed, just no longer used for login.
  - Both are per-process (single pm2 instance). No reverse proxy in front of `:3000`, so `req.ip` is the real client IP and Express `trust proxy` stays `false` (keeps express-rate-limit's proxy validation happy). If ever scaled multi-instance / put behind a proxy: move both to a shared store (Redis) and set `trust proxy`.
- Password reset flow — DONE (Session 5), see Section F.
- Username system — currently phone-number only, affects all future social features

### Phase 2 — Complete Calling
- Call timeout — DONE (see Phase 0)
- Call glare handling — BUILT (Session 8), needs a real 2-device test. As predicted, the two `call:invite` handlers cannot interleave (Node single-threaded, synchronous), so exactly one invite is processed first and wins fully — it creates the only call row and `activeCalls` pair. `endCallByServer` was therefore NOT used: there is no losing call row to end (the loser's invite is rejected before it creates one), and the winner's call is legitimately proceeding. Instead:
  - **`call_signaling.js` `call:invite`**: before the generic busy check, detect glare — `activeCalls.get(userId)` exists with `role: 'callee'` and `otherUserId === targetUserId` (i.e. the person we're inviting is already inviting us) — and ack `{ ok: false, glare: true, callId, fromUserId }` instead of `{ ok: false, busy: true }`.
  - **`src/utils/callManager.js` `startOutgoingCall`**: on `response.glare`, `cleanup()` + `onCallEnded()` + `resolve({ glare: true })` — no reject, so CallScreen's `.catch` (the "Call failed" Alert) never fires; `onCallEnded` closes the outgoing screen.
  - **`App.js` `handleIncomingCall`**: also clears `outgoingCall` if it targets the same `fromUserId`, so the incoming + outgoing full-screen `CallScreen`s never render stacked in the window before the invite ack arrives.
  - **`src/screens/CallScreen.js`**: the effect-cleanup now always calls `callManagerRef.current?.cleanup()` (idempotent). Previously several dismissal paths (declined outgoing call; now glare) unmounted `CallScreen` without releasing the peer connection / mic / the **global** `ExpoCallAudio` session. This guarantees the losing glare screen releases `ExpoCallAudio` before the incoming call's accept claims it — and incidentally fixes a pre-existing caller-mic leak on the "call declined" path.
  - Winner side is unchanged. Which party wins is whichever invite the server processes first (not userId-deterministic) — both outcomes are correct (one call connects, the other party sees it as incoming), and forcing a userId winner would mean tearing down an already-acked call on the winner, reintroducing the same race on that side.
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
- Temporary chat mode — **partially delivered by Private Chat mode (Session 9, see "Private Chat mode")** — a per-conversation preset that bundles 7-day auto-expiry + read receipts off + generic push body. A fully ephemeral / shorter-window "temporary chat" is still open.
- Disappearing messages — **7-day fixed window shipped as part of Private Chat mode (Session 9)**. A user-chosen interval (24h / 7d / 90d) and a group variant are still open.
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

### Account Deletion — DECIDED & BUILT (Session 4)
Chosen: **deactivate (reversible) + hard delete (irreversible, keeps others' history as "Deleted User")**. Both live in Settings → Account.
- **Deactivate**: `users.status` column ('active'|'inactive'). `POST /users/me/deactivate`. `requireAuth` (middleware/auth.js) + socket `io.use` (server.js) hard-block inactive accounts on every request; `POST /auth/login` flips inactive→active and returns `reactivated:true` (LoginScreen shows "Welcome back"). match-contacts and `call:invite` skip non-active users.
- **Hard delete**: `DELETE /users/me` — one `db.transaction`: rename the user's `messages.username` to 'Deleted User', delete their rows from conversation_members / privacy_settings / blocked_users (both directions) / call_deletions / message_deletions / message_reactions / password_reset_tokens / push_tokens, then delete the `users` row. Messages + calls stay for everyone else. `routes/calls.js` uses LEFT JOIN + `COALESCE(name,'Deleted User')`; `routes/conversations.js` GET / falls back to `{name:'Deleted User'}` when the other 1:1 member is gone.
- The dangling `messages.user_id` (points at a deleted id) is intentional — only ever compared for "is this mine?", never joined for identity after the rename. Same for `calls.caller_id` / `calls.callee_id`.
- **FK enforcement must be toggled off around the `users`-row delete.** better-sqlite3 enables `PRAGMA foreign_keys` by default, and the retained `messages` / `calls` rows still reference the user, so `DELETE FROM users` throws `SQLITE_CONSTRAINT_FOREIGNKEY`. The handler does `db.pragma('foreign_keys = OFF')` → `runDelete()` (the transaction) → `db.pragma('foreign_keys = ON')` in a `finally`. The pragma is a no-op while a transaction is open so it is toggled *outside* `db.transaction`; safe because Node is single-threaded and better-sqlite3 is synchronous. This was a real bug (Session 5) — the endpoint returned "Nothing was changed - try again." for every delete until the toggle was added. Fixed & deployed. Handler also guards `info.changes === 0` (concurrent double-delete) and rolls back.
- **ChatScreen UX**: `GET /conversations` `with.status` ('active' | 'inactive' | 'deleted') and `POST /conversations/start` `with.status` carry the other party's state. (Session 8: `GET /conversations` `with` and group `members`, plus `POST /start` `with`, now also carry `profilePicture` — base64 data URI or null — for the user profile modal. This embeds base64 images in the conversation-list response; fine at current scale, part of the base64→S3 debt in Phase 9.) ChatScreen reads `otherUser.status`: when not active it hides the input bar + call buttons + Reply/Edit menu items, suppresses the header subtitle, and shows a bottom banner ("This account has been deactivated/deleted"). Existing messages still render. It's an open-time snapshot — no live status push if they deactivate mid-conversation.

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

### better-sqlite3 enforces foreign keys by default
`PRAGMA foreign_keys` is ON on the app's connection (the `sqlite3` CLI shows 0 — different connection, ignore it). Any delete/reassign that leaves a child row (`messages`, `calls`, `conversation_members`, `privacy_settings`, `message_reactions`) pointing at a gone `users` row throws `SQLITE_CONSTRAINT_FOREIGNKEY`. If a feature deliberately keeps history for a deleted user, toggle `db.pragma('foreign_keys = OFF')` around the transaction (outside `db.transaction` — the pragma is ignored mid-transaction) and turn it back ON in a `finally`. See `DELETE /users/me` in `routes/users.js`.

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
`call_signaling.js` has `endCallByServer(io, callId, { reason, status })` — the single path for any case where the SERVER (not a user tap) ends an *established* call. Ring timeout uses it. It records the terminal `calls.status`, clears both `activeCalls` sides + the ring timer, and emits the existing `call:ended` (with `reason`) to both parties. Clients need no new event — they already handle `call:ended`.
NOTE: glare handling (Session 8) does **not** go through this — because `call:invite` handlers are synchronous the loser's invite is rejected before it ever creates a call row, so there is nothing to `endCallByServer`. Glare is resolved entirely in the `call:invite` ack (`{ glare: true }`). Any *future* server-decided termination of a call that actually exists still goes through `endCallByServer`.

---

## SECTION F — PASSWORD RESET (Session 5, built & deployed + e2e verified)

### DB
`password_reset_tokens` (in `db.js`): `id, user_id, token, channel, expires_at, used, attempts, created_at`. One table, several channels — the `channel` value is the row's purpose:
- `channel='email'` — password-reset link. `token` is 32 random bytes hex, 1h expiry.
- `channel='sms'` — password-reset OTP. `token` is `sha256(6-digit OTP)`, 10min, `attempts` caps guesses at 5.
- `channel='reset'` — short-lived (10min) hex token that `verify-otp` mints on success so the phone flow rejoins the shared reset-password path.
- `channel='chg-email-id' / 'chg-email-ok' / 'chg-email-new'` and `'chg-phone-id' / 'chg-phone-ok' / 'chg-phone-new'` — the email/phone **change flows** (Session 8, see below). `-id` = identity OTP, `-ok` = "identity passed" marker (random hex, existence-checked), `-new` = ownership OTP whose hash is `sha256(code:newValue)` so the code is bound to that exact new email/phone. These channels never collide with the password-reset queries (which filter `channel IN ('email','sms','reset')`).
(Spec asked for `id, user_id, token, expires_at, used`; `channel` + `attempts` + `created_at` were added — `channel` is required to tell OTP rows from link rows in one table, `attempts` is OTP brute-force protection.)
OTP generation + hashing is now in **`utils/otp.js`** (`newOtp(bindTo?)` / `hashOtp(code, bindTo?)`); `routes/auth.js` was refactored to use it (no behaviour change — `hashOtp(code)` with no `bindTo` is exactly `sha256(code)`). **`utils/mailer.js`** gained `sendOtpEmail(to, name, code, purpose)` (sends the code in the body, vs `sendPasswordResetEmail` which sends a link).
The hard-delete transaction (`DELETE /users/me`) now also deletes `password_reset_tokens` for the user.

### Endpoints (`routes/auth.js`, all rate-limited via the in-memory `rateLimit()` helper)
- `POST /auth/forgot-password {identifier}` — email or phone (decided by `@`). **Always returns the same generic 200** (`{channel, message}`) whether or not the account exists (no enumeration). Email → sends reset link via `sendPasswordResetEmail` (added to `utils/mailer.js`, uses the existing Gmail SMTP transport) pointing at `${CLIENT_URL}/auth/reset-password?token=…`. Phone → generates OTP, stores the hash, **`console.log`s `[PW-RESET OTP] …` to pm2 out log** (no SMS provider wired — swap the `console.log` for a real send to activate). Supersedes any earlier unused token on the same channel.
- `GET /auth/reset-password?token=` — server-rendered HTML form (same pattern as `GET /auth/verify`); posts JSON to the endpoint below via inline fetch (so it needs no `express.urlencoded`).
- `POST /auth/reset-password {token, newPassword}` — validates token (unused, unexpired, channel ≠ 'sms'), `bcrypt.hashSync(pw, 10)` (matches signup), updates `users.password_hash`, burns **every** outstanding token for that user. Shared by the web form and the (future) in-app phone flow.
- `POST /auth/verify-otp {identifier, otp}` — **fully functional but DORMANT**: nothing in the client calls it. Validates the OTP, consumes the sms row, returns `{resetToken}` (a fresh `channel='reset'` token). Activating the phone flow = (1) real SMS send in forgot-password, (2) an OTP-entry screen that calls this then `reset-password`.

### `POST /auth/login` change
Now accepts `{identifier}` (email **or** phone) as well as the legacy `{email}`. Non-email identifiers are matched via `phone_hash` (same `phoneToHash` normalisation as signup/contacts). Backward compatible — old `{email}` payloads still work. Email matching is **case-insensitive** (Session 8, see "Auth & session").

### Client
- `src/utils/api.js`: `login(identifier, password)` (param renamed, sends `identifier`), new `forgotPassword` / `resetPassword` / `verifyOtp`.
- `src/screens/ForgotPasswordScreen.js` — new; `screen === 'forgotPassword'` in `App.js`, reached from LoginScreen's "Forgot password?" link. Field takes email or phone. Email path shows a "check your email" confirmation. **Phone path**: submits to the backend (OTP logs to pm2) but the confirmation says SMS reset isn't switched on yet and to use email — there is deliberately no in-app OTP screen (SMS isn't wired). When SMS is activated, add the OTP screen and flip that messaging.

### Secure email / phone change (Session 8, deployed + server-tested)
Account Settings → **Change Email** / **Change Phone**. Each is two OTP steps: prove identity with a code to your *current* contact detail, then prove ownership of the *new* value with a second code.
- **`routes/users.js`** — `POST /users/me/change-email/{init,verify-identity,verify-new}` and `.../change-phone/{...}` (all `requireAuth`, all `rateLimit()`-guarded per user + per IP on `init`). `verify-new` is dual-mode: `{newEmail}` alone sends the ownership OTP; `{newEmail, otp}` verifies it and updates the DB. Identity OTP: email change → current **phone** (email fallback); phone change → current **email** (phone fallback, dead code since `users.email` is NOT NULL). On phone change the new number's `phone_hash` is updated alongside `phone_number`. Success emits `profileUpdated` (`pushProfileUpdate`) and burns all `chg-{email,phone}-%` rows for the user.
- **SMS still not wired**: any OTP that would go to a phone (email-change identity for phone users; every new-phone OTP) is `console.log`'d as `[CHANGE-OTP …]` to the pm2 out log instead. Response carries `smsNotWired: true`; the client shows a "code is in the server logs" note. So **change-phone is fully usable today** (identity via email works); **change-email is only fully usable for accounts with no phone number** until SMS lands.
- **`AccountSettingsScreen.js`** — one `ChangeContactFlow` component (`kind="email"|"phone"`) drives both. Steps: auto-`init` on mount → identity OTP → new value (with `isValidEmail` from `AuthUI` for email, 10-digit `+91` for phone) → ownership OTP → done. Server returns `{ method, hint }` (last-4 for phone, `g***@domain` for email); the UI shows "We sent a code to your phone ending in 3210" etc. Resend link on each OTP step. The old no-OTP `EditFieldScreen` email edit is gone; `updateProfile` still backs the Name edit.
- **Client `src/utils/api.js`**: `changeEmailInit` / `changeEmailVerifyIdentity` / `changeEmailSendNewOtp` / `changeEmailVerifyNew` (+ the four `changePhone*` equivalents).

---

## SECTION G — PUSH NOTIFICATIONS (Session 6 built & deployed; Session 7 FCM wired; server e2e verified)

### Config is complete — one build + a real device test remain
FCM V1 is fully set up:
- `google-services.json` (Firebase project `wave-chat-55078`, sender `673076448831`, package `com.mycompany.wave`) is in the repo root, referenced by `app.json` → `expo.android.googleServicesFile`.
- `npx expo prebuild -p android --clean` (Session 7) wired it into `android/`: `com.google.gms:google-services:4.4.4` classpath in `android/build.gradle`, `apply plugin: 'com.google.gms.google-services'` in `android/app/build.gradle`, `google-services.json` copied to `android/app/`, FCM + expo-notifications `default_notification_color` meta-data + `notification_icon_color` (`#2C6BED`) in the manifest/colors.
- FCM V1 service-account key uploaded to the Expo account (`eas credentials` → Android → *Google Service Account Key for Push Notifications V1*). `exp.host` sends will no longer return `InvalidCredentials`.
- `POST_NOTIFICATIONS` is no longer hand-added to the manifest — the `expo-notifications` library manifest declares it and Android's manifest merger pulls it into the APK. The Session 6 manual stopgap is gone (prebuild regenerated the manifest).

**Verified (Session 7):** `google-services.json` wired, FCM V1 key on Expo, a fresh Expo push token (user 28) got Expo ticket **and** receipt `status: ok` on a direct send — so the FCM path works end to end. The earlier `DeviceNotRegistered` log spam was pre-FCM tokens (users 22/25), now pruned.

**Still outstanding — the real 2-device test on a build that has the Session-7 foreground-presence changes:** (a) `getExpoPushTokenAsync` returns a token and `POST /notifications/token` stores it, (b) **app backgrounded** (not just fully closed) + message from another device → "New message" push after the 8s grace, (c) app foregrounded → NO push, message arrives live, (d) `call:invite` → "Incoming call from X" wakes a backgrounded app AND the call still connects, (e) missed call → "Missed call from X", (f) tap-routing (message/call/missedCall) lands on the right screen incl. cold start, (g) logout de-registers the token. **This is the Session 8 next task — run it over USB: connect the phone, `npx expo run:android` to build + install the dev client, then walk items (a)–(g).**

### Server (deployed to EC2, `.bak-1788809595`)
- **`db.js`**: `push_tokens (id, user_id, token, device_id, platform, created_at, updated_at)`, `UNIQUE(user_id, device_id)`, index on `user_id` and on `token`. FK to `users(id)`; the hard-delete txn deletes push_tokens before the user row.
- **`pushService.js`** (new, no deps — Node 18+ global `fetch`): `sendToUser(userId, { title, body, data, fromUserId })` — fire-and-forget, **never throws**, chunks to 100, POSTs `exp.host/--/api/v2/push/send`, schedules a receipt poll ~15 min later. `DeviceNotRegistered` / `MismatchSenderId` (ticket OR receipt) → delete that token. `InvalidCredentials` → loud log, **no** token deletion (that's a server config fault, must not wipe the fleet). Optional `EXPO_ACCESS_TOKEN` env. **Never logs a notification body** — only title / userId / counts / Expo error codes.
- **`blocks.js`** (new): shared `isBlockedEitherWay` — replaced the copy in `server.js`, also used by `call_signaling.js` and `pushService`. `sendToUser` re-checks it when `fromUserId` is passed (defence in depth).
- **`rateLimiter.js`** (new): the in-memory limiter extracted from `routes/auth.js` (which now `require`s it). NOTE (Session 8): login no longer uses this — it moved to `express-rate-limit` in `server.js`. `rateLimiter.js` still backs forgot/reset/verify-otp + `/notifications/token`.
- **`routes/notifications.js`** (new, all `requireAuth`): `POST /notifications/token` — validates the `ExponentPushToken[...]` format, caps deviceId length, rate-limited 20/10min/user, **steals the token from any other (user,device) row**, upserts by `(user_id, device_id)`. `DELETE /notifications/token { deviceId }` — logout. Mounted at `/notifications` in `server.js`.
- **`server.js`** `socket.on('message')`: after the fan-out, push to each other member who is **not foregrounded** (`!isUserForegrounded`), **has not muted this conversation** (`conversation_members.mute_notifications` — Session 8, see "Device-local preferences"), and is **not blocked**. Body is hard-coded `'New message'`, title = sender name — raw content never enters the push path. (The "read-receipts-off → generic body" line in the brief was resolved the stricter way: body is *always* generic.)
- **`server.js` foreground presence (Session 7)** — `isUserOnline` (any connected socket) was too coarse for message push: the client keeps its socket connected while backgrounded, so a backgrounded phone looked "online" and never got a push. Added `foregroundUsers` (a per-user count, mirroring `onlineUsers`) + `isUserForegrounded()` + `addForeground`/`removeForeground(socket, userId)` (per-socket `socket.data.foregrounded` guard so double events don't miscount). A socket counts as foregrounded on `connection`; the client's `App.js` AppState effect flips it via **`presence:foreground` / `presence:background`** socket events (8s grace before backgrounding, re-asserted on every `connect`). `removeForeground` also runs on `disconnect`. **Message push now keys on `isUserForegrounded` (offline ⇒ not foregrounded ⇒ still pushed).** `call_signaling.js` and the `delivered` flag deliberately still use raw `isUserOnline` — calls must reach a backgrounded-but-connected socket, and a message *is* delivered to such a socket.
- **`call_signaling.js`**: `call:invite` → "Incoming call from X" push to the callee **even though they're online** (a ringing call must wake a backgrounded app — the one deliberate exception to "don't push online users"; messages still skip them). `pushMissedCall(dbId)` fires "Missed call from X" to the callee whenever a call row lands in `status='missed'` (ring timeout via `endCallByServer`, caller hangs up while ringing, caller/callee disconnects while ringing). Never for `'declined'`.

### Client
- `expo-notifications ~57.0.17` added; `app.json` plugin `["expo-notifications", { "color": "#2C6BED" }]` + `expo.android.googleServicesFile: "./google-services.json"`. Native `android/` regenerated by prebuild (Session 7) — `POST_NOTIFICATIONS` now comes in via the library manifest merge, no manual manifest edit.
- **`src/utils/notifications.js`** (new): device_id = `Crypto.randomUUID()` in AsyncStorage (`wave:deviceId`); `wave:notifPermissionAsked` flag so we ask exactly once; Android channels `messages` (HIGH) / `calls` (MAX); `registerDeviceForPush` / `unregisterDeviceForPush`; foreground handler returns `shouldShowBanner:false` (App shows its own banner). All fail-soft.
- **`src/utils/api.js`**: `registerPushToken(authToken, {token,deviceId,platform})`, `unregisterPushToken(authToken, deviceId)`.
- **`src/components/NotificationBanner.js`** (new): in-app top banner for foreground notifications; tap routes, auto-dismiss 4.5s.
- **`App.js`**: permission effect (explanatory `Alert` → request → register) keyed on `token`; `routeFromNotification` (call → incoming CallScreen; missedCall → calls tab; message → fetch `/conversations`, open that chat); `addNotificationReceivedListener` → banner; `addNotificationResponseReceivedListener` + `getLastNotificationResponseAsync` (cold start) → route; **`handleLogout` calls `unregisterDeviceForPush(token)` before clearing storage**.
- **`App.js` AppState effect (Session 7)** — keyed on `[socket]`. Emits `presence:foreground` immediately / on `AppState` → `active`; emits `presence:background` **8s** after `AppState` → `background` (grace for quick app-switches); re-asserts current state on socket `connect` (covers socket.io auto-reconnect while backgrounded). `'inactive'` is ignored. The socket is **never disconnected** by this — only its foreground flag changes server-side. This is what makes offline/backgrounded message pushes fire; see the `server.js` foreground-presence note above.
- `NotificationsSettingsScreen.js` is still the stub — an in-app on/off toggle isn't wired (OS-level permission is the control for now).

---

*Last updated: Session 11 (2026-09-09).*

*Session 11 — **Swipe-to-reply** (see "Swipe-to-reply" in Architecture). Right-swipe a bubble past 60px to reply. Built with RN `PanResponder` + reanimated shared values (NOT react-native-gesture-handler — it's not installed and the task's "no new deps" stands; `App.js` needs no `GestureHandlerRootView`). `SwipeableMessage` wraps normal bubbles in `ChatScreen.js` `renderItem`; gesture frames write a shared value only (no re-renders); reuses `setReplyTo(message)`. Reply preview bar reworked (reply icon, "Reply to {name}" accent-if-own, 80-char truncation, Animated slide-up). Backend: `reply_deleted` added to the reply-join in `GET /:id/messages` + socket `message` payload so a quote of a since-deleted message shows "This message was deleted" (deployed `server.js` / `routes/conversations.js` `.bak-1788932528`, `node --check` + `/health` + 4-assertion e2e green, error.log clean). Client JS-only, babel-parsed + mojibake-clean, not device-tested.*

*Session 10 — **In-conversation message search** (FTS5). `db.js`: `messages_fts` external-content FTS5 vtable + 3 sync triggers (text messages only; UPDATE trigger fires only on real content change) + one-time backfill. `routes/conversations.js`: `GET /conversations/:id/search` (membership 403 -> len<2 400 -> operator-stripping sanitiser -> private-chat 7-day window -> 30/min/user rate limit -> `MATCH ... ORDER BY rank` in try/catch -> 400). `api.js`: `searchMessages()`. `ChatScreen.js`: header-transform search UI (added the search icon - it wasn't there), 300ms debounce, absolute results overlay below the header / above the keyboard, tap/arrow navigation with `scrollToIndex(viewPosition:0.5)` + `onScrollToIndexFailed` fallback + 1.5s `Animated` amber flash on the target message. Deployed (`db.js` / `routes/conversations.js` `.bak-1788929730`), `node --check` + `curl /health` + 31-assertion in-process e2e (trigger sync on send/edit/delete/delete-for-everyone, cross-conversation isolation, membership 403, FTS special-char safety, private-chat window, pagination, rate limit) all green, error.log clean. Client JS-only, babel-parsed + mojibake-clean, not device-tested.*

*Session 9 — **Private Chat mode** (Phase 4 partial — see "Private Chat mode" in Architecture). Per-conversation 1:1 privacy preset bundling 7-day message auto-expiry + read-receipts-off + generic push body. Server: `conversations.private_chat` / `private_chat_since` columns (`db.js`), `POST /conversations/:id/private-chat/{enable,disable}` (persist a `message_type='system'` message, emit `privateChatEnabled`/`Disabled` + the system `message` + `conversationActivity` via `app.set('io', io)`), hourly + on-boot `purgeExpiredPrivateMessages()` `setInterval` in `server.js` (no `node-cron` — not installed), read-receipt suppression in `joinConversation` + `GET .../messages` (which also hard-filters >7-day messages), `unreadCount` excludes system messages. **Push body was already always 'New message' globally — no pushService change.** Deployed (`db.js` / `server.js` / `routes/conversations.js` `.bak-1788927360`), `node --check` + `curl /health` + 25-assertion in-process e2e (2 socket clients) all green, error.log clean. Client: `setPrivateChat` in `api.js`; `ChatScreen.js` `privateChat` state (seeded via `getConversations`, live via socket events) + header `lock-closed` icon + `message_type==='system'` centered pill in `renderItem`; `UserProfileModal.js` Session-8 "Disappearing Messages" row reworked into the **"Private Chat"** row (lock icon, no opacity, `Alert` with the 3 effects + Enable/Disable). No emoji (Ionicons `lock-closed` for the "lock" in the brief). Client JS-only, babel-parsed + mojibake-clean, **not device-tested**.*

*Session 8 (2026-09-08). Large client-feature session plus a lot of server-side work. Every server change is deployed to EC2 (backup filenames noted per item), each with `node --check` + `curl /health` + a targeted live/e2e test. Every client change is **JS-only, parse-checked (`@babel/core`) + mojibake-clean, but NOT yet run on a device/emulator** — a full device pass over all of the below is outstanding. All work landed on `main` (commits `250d1cc`, `2873b8c`, `403bd18`, `a4e55ad`, `fa468ad`, `19be509`, `18188b0`, `f1878f9`, `e482735`).*

- **Call glare handling** (Phase 2 / Section E) — `call_signaling.js` `call:invite` acks `{ glare: true }` for crossing invites; `src/utils/callManager.js` + `App.js` silently tear down the losing outgoing call; `src/screens/CallScreen.js` now always runs `callManager.cleanup()` on unmount (also fixes a pre-existing caller-mic leak on the "call declined" path). Deployed (`call_signaling.js.bak-1788857358`). **Needs a real 2-device test.**
- **Rate limiting on login/signup** (Phase 1) — `express-rate-limit` mounted in `server.js` on `/auth/login` + `/auth/signup` (10 req / 15 min / IP, independent bucket per path); the old hand-rolled login limiter removed from `routes/auth.js`. Deployed (`server.js.bak-1788858324`, `routes/auth.js.bak-1788858324`), verified live (req 11 → 429). `rateLimiter.js` still backs forgot/reset/verify-otp + `/notifications/token`.
- **GIPHY attribution** (Phase 0) — "Powered by GIPHY" text badge in `MediaPickerSheet.js` (`GiphyAttribution` inside `MediaGrid`, so it shows on the GIF + Sticker tabs only, in every state). Client-only.
- **Email case-insensitivity** — `routes/auth.js` (signup / resend-verification / `findUserByIdentifier`) + `routes/users.js` `PUT /me` all store and look up emails lower-cased; client-side email-format regex on Login/Signup with inline error (`isValidEmail` + `AuthField` `error` prop in `src/components/AuthUI.js`). Deployed (`routes/auth.js.bak-1788859424`, `routes/users.js.bak-1788859488`), verified live. See "Auth & session".
- **ProfileScreen picture flow** (Phase 0) — tapping the avatar opens it full-screen in `ImageViewerModal` (which now hides its save-to-gallery button when passed no `onSave`); a separate "Change profile picture" button does a gallery-only pick + `allowsEditing` crop + `quality: 1` (was `0.4`) + ~7 MB base64 guard. Client-only (expo-image-picker already does the crop). See "Profile pictures".
- **User profile modal + favourites** — new `src/components/UserProfileModal.js` (bottom sheet from the ChatScreen header — 1:1 and group layouts), `src/components/FavouriteStar.js` (RN `Animated` star + particle burst), `src/screens/ContactNotificationSettings.js` (per-contact notification prefs), `src/utils/favourites.js` + `src/utils/contactPrefs.js` (`wave_favourites` / mute / `wave_notifications_{id}` in AsyncStorage), favourites strip in `ChatListScreen.js`, mute state lifted into `ChatScreen.js` (later made server-backed — see the "Mute enforcement" item). Server: `routes/conversations.js` `GET /` + `POST /start` now return `profilePicture` on `with` / `members` (`routes/conversations.js.bak-1788862250`). See "User profile modal".
- **3-state typing indicator** — new `src/components/TypingIndicator.js` (typing = 3 staggered bouncing dots / paused = 1 breathing dot / gone). `ChatScreen.js` sender (throttled `typing:start`, `typing:pause` 1.5s after last keystroke, `typing:stop` on send/edit/unmount) + receiver (single-typer tracking, 4s→pause / 30s→gone safety timers). `server.js` `typing:start` / `typing:pause` / `typing:stop` membership-checked relay handlers, replacing the old single `typing` event (`server.js.bak-1788866049`). See "3-state typing indicator".
- **Online/offline presence** — `App.js` owns `presenceMap` (`userId → {online, lastSeen}`) fed by `presence:online` / `presence:offline` / `presence:sync`, passed to `ChatListScreen` (green dot restyled to 10px `#4CAF50`, 2px white ring; nothing when offline) and `ChatScreen` (header subtitle live "online" `#4CAF50` / "last seen …" grey). `server.js` scopes presence to conversation peers' `user:<id>` rooms (replaces the old global `presence` broadcast), gated on the 0→1 / last-socket transitions and on `last_seen_visible`; `routes/conversations.js` nulls `with.last_seen` when the other party has it hidden (`server.js.bak-1788866830`, `conversations.js.bak-1788866830`). last-seen *reciprocity* still not implemented — pre-existing gap. See "Online/offline presence".
- **Secure email / phone change** — Account Settings → Change Email / Change Phone, both two-step OTP (identity to current contact detail, then ownership of the new value). `routes/users.js` `POST /users/me/change-{email,phone}/{init,verify-identity,verify-new}`; reuses `password_reset_tokens` on `chg-*` channels + `utils/otp.js` (extracted, `routes/auth.js` refactored to it) + new `sendOtpEmail` in `utils/mailer.js`; `AccountSettingsScreen.js` `ChangeContactFlow`. Deployed (`routes/users.js.bak-*`, `routes/auth.js.bak-*`, `utils/mailer.js.bak-*` + new `utils/otp.js`); password-reset regression + full change-email/phone e2e (18 assertions) pass in-process against the live DB. SMS still not wired → phone-bound OTPs log to pm2. See Section F.
- **Mute enforcement for push** — `conversation_members.mute_notifications` (new column, `db.js` migration); `server.js` message-push loop skips a member who has it set; `routes/conversations.js` `GET /:id/mute` + `POST /:id/{mute,unmute}` (membership-checked). Deployed (`db.js.bak-*`, `routes/conversations.js.bak-*`, `server.js.bak-*`); endpoint + push-skip/resume e2e (8 assertions, 2 socket clients + pm2-log inspection) pass. Client: mute now server-backed with `wave_mute_conv_{id}` as an instant-render cache — see "Device-local preferences". The task said "conversations table" but per-user state lives on `conversation_members`.
- **Status / cleanup (no functional code change)** — ringtone playback verified working on a real device (plays + loops on the callee, clean handoff to call audio on accept, stops on reject / remote-cancel / 60s timeout), and the 60s server-authoritative call-timeout ring behaviour confirmed 2-device alongside it. `ChatScreen.js` console.log audit: none to remove — its 3 `console.warn` calls are legit production error tracking; `CallScreen.js` still has its `[CALL]` diagnostic logs (separate item, Section D).
- **NEXT TASK** — build + install a dev client (`npx expo run:android` over USB) and run: (1) the full push-notification 2-device checklist in Section G, (2) the call-glare 2-device test, (3) the account deactivate/delete 2-device test, (4) a full device pass over every Session-8 client UI above — profile modal + favourites strip + star animation, typing indicator, presence dots/header, change-email/phone flows, and the mute toggle (verify a muted chat sends no push), (5) **Session-9 Private Chat mode** — toggle it from the profile modal, confirm both devices get the system message + header lock, read receipts stop, and (harder to test live) 7-day expiry / generic push body, (6) **Session-10 message search** — search icon in the chat header, debounced results overlay, tap/arrow to jump + amber flash, exit on send/cancel, (7) **Session-11 swipe-to-reply** — right-swipe a bubble to reply, icon fade/scale, spring-back, threshold trigger; verify FlatList scroll still works and swipe is off in search mode / for deleted+system messages.

*Session 7 — (a) FCM wired for push: `google-services.json` (project `wave-chat-55078`) in repo root + `app.json` `expo.android.googleServicesFile`; `npx expo prebuild -p android --clean` regenerated `android/` with the google-services gradle plugin + FCM manifest meta-data (`POST_NOTIFICATIONS` now via library manifest merge); FCM V1 service-account key uploaded to Expo; direct send to a fresh token got Expo ticket+receipt `ok`. (b) Fixed "no push on new message": `isUserOnline` (any connected socket) was suppressing message push for backgrounded-but-connected clients. Added server-side `foregroundUsers` count + `presence:foreground`/`presence:background` socket events driven by a new `App.js` AppState effect (8s bg grace, socket stays connected); message push now keys on `isUserForegrounded`, calls still use raw `isUserOnline`. Server deployed (`server.js.bak-1788851457`), `node --check` + health OK. Outstanding: 2-device test on a build with these changes (Section G).*
*Session 6 — Push notifications: `push_tokens` table, `pushService.js` (Expo API, receipt handling, stale-token pruning), `/notifications/token` endpoints, message + call + missed-call triggers, client permission/registration/tap-routing/foreground-banner + logout de-registration. Server deployed + e2e verified (24/24). Server backups `.bak-1788809595`.*
*Session 5 — (a) Fixed `DELETE /users/me` hard delete (FK enforcement; now toggles `foreign_keys` OFF around the txn). (b) Password reset flow — email link + dormant phone OTP — built, deployed, e2e verified (Section F). (c) Login/Signup/ForgotPassword screens redesigned — all buttons use the loginbar art (loginbar_blank.png for relabelled ones), full-logo + separate tagline, no bottom decoration. (d) App icons replaced from appicon.png (monochrome still stale). Backend deployed to EC2; server files backed up as `.bak-<ts>`.* (FK enforcement; now toggles `foreign_keys` OFF around the txn). (b) Password reset flow — email link + dormant phone OTP — built, deployed, e2e verified (Section F). (c) Login/Signup/ForgotPassword screens redesigned — all buttons use the loginbar art (loginbar_blank.png for relabelled ones), full-logo + separate tagline, no bottom decoration. (d) App icons replaced from appicon.png (monochrome still stale). Backend deployed to EC2; server files backed up as `.bak-<ts>`.*
*Session 4 — Call ring timeout (60s, server-authoritative) built & deployed; CLAUDE.md created*
*Always read this entire file before touching any code.*
