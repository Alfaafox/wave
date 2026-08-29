# My chat app (mobile)

A simple group chat app built with React Native + Expo. It talks to your
own self-hosted server (the `chat-server` project) for accounts, chat
history, and real-time messaging.

## Before you start

Make sure your `chat-server` is already running on your AWS server and
reachable — test with (from your computer, not the server):

```bash
curl http://13.232.16.85:3000/health
```

You should get back `{"status":"ok"}`.

If your server's IP address ever changes, update it in `src/config.js`.

## 1. Install dependencies

On your computer, from inside this folder:

```bash
npm install
```

## 2. Install Expo Go on your phone

Get **Expo Go** from the App Store (iOS) or Google Play (Android). This is
the app that lets you run your project instantly without building a full
native app.

## 3. Start the dev server

```bash
npx expo start
```

This prints a QR code in your terminal.

- **iOS**: open your Camera app and point it at the QR code, then tap the
  notification that appears.
- **Android**: open Expo Go and use its built-in QR scanner.

Your phone and computer need to be on the **same Wi-Fi network** for this
to work out of the box.

## 4. Try it out

- Sign up with a username and password (this creates a real account on your
  AWS server).
- Send a message - it's saved to your server's database and broadcast to
  anyone else connected.
- Install Expo Go on a second phone (or ask a friend to), sign up with a
  different username, and you'll see messages appear on both in real time.

## What's inside

```
App.js                    - top-level screen switching + session persistence
src/config.js              - your server's address
src/api.js                  - signup / login / fetch history (REST calls)
src/socket.js               - real-time connection (Socket.io)
src/screens/LoginScreen.js  - sign up / log in form
src/screens/ChatScreen.js   - the actual chat UI
```

## Troubleshooting

- **"Network request failed" on login/signup**: double check `API_URL` in
  `src/config.js` matches your server, and that your phone can reach it
  (try opening `http://13.232.16.85:3000/health` in your phone's browser).
- **Messages don't appear in real time**: check the small dot next to
  "Group chat" at the top - green means connected, red means the socket
  connection dropped. Pull down or reopen the app to reconnect.
- **Nothing loads at all**: make sure `chat-server` is actually running on
  your AWS instance (`pm2 list` should show it as `online`).

## Next steps

- Right now everyone shares one group chat. Private 1:1 or smaller group
  conversations would be the natural next feature.
- Push notifications (so messages arrive even when the app is closed) are
  the next big usability improvement.
- Once you're ready to share this beyond casual testing, moving your server
  to HTTPS with a real domain name is worth doing.
