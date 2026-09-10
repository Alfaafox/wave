// src/screens/CallScreen.js
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Animated, Easing, StatusBar, Platform, Dimensions, Vibration } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { Ionicons } from '@expo/vector-icons';
import { createCallManager } from '../utils/callManager';
import ExpoCallAudioModule from '../../modules/expo-call-audio/src/ExpoCallAudioModule';
import AudioOutputSheet from '../components/AudioOutputSheet';
import { useAudioPlayer } from 'expo-audio';

// Server ends an unanswered call at 60s (RING_TIMEOUT_MS in call_signaling.js).
// This client-side backstop runs slightly later so the server stays authoritative.
const RING_FAILSAFE_MS = 65 * 1000;

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function CallScreen({ socket, callInfo, onEndCall }) {
  // ringing -> connecting -> active   (active ONLY once real remote media arrives)
  const [status, setStatus] = useState(callInfo.mode === 'incoming' ? 'ringing' : 'calling');
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  // Tracks how many video tracks the remote stream has at the moment onRemoteStream
  // last fired. react-native-webrtc's RTCView binds to a stream by identity, and
  // ontrack can fire multiple times for the SAME stream object (once per track,
  // e.g. audio then video a few ms later). Passing the same object reference to
  // setState twice makes React skip re-rendering the second time, so RTCView
  // never learns a video track was added after it already mounted audio-only.
  // Keying RTCView on this count forces a clean remount the moment video shows up.
  const [remoteVideoTrackCount, setRemoteVideoTrackCount] = useState(0);
  const [muted, setMuted] = useState(false);
  // Audio route: 'bluetooth' | 'earpiece' | 'speaker'. Seeded from the native
  // module once the call is up and kept live by its onAudioRouteChanged event.
  const [audioRoute, setAudioRoute] = useState('earpiece');
  const [availableRoutes, setAvailableRoutes] = useState(['earpiece', 'speaker']);
  // Route-picker bottom sheet - only used when a Bluetooth headset makes 3
  // routes available. With just earpiece + speaker the button toggles directly.
  const [routeSheetOpen, setRouteSheetOpen] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const callManagerRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const durationTimerRef = useRef(null);
  // Incoming-call ringtone. expo-audio has no gapless loop we rely on here
  // (see CLAUDE.md "expo-audio does not auto-loop"), so the ringing effect
  // below re-triggers playback on an interval.
  const ringtonePlayer = useAudioPlayer(require('../../assets/ringtone.mp3'));

  // Stop the ringtone + vibration immediately and synchronously. Must run
  // BEFORE expo-call-audio claims MODE_IN_COMMUNICATION (on accept), so the
  // media-stream ringtone fully releases the audio output first - the two
  // otherwise briefly share one Android audio session. The ringing effect's
  // cleanup also calls this, but that only runs a React commit later (after
  // setStatus), which races acceptIncomingCall().
  const stopRinging = () => {
    Vibration.cancel();
    try {
      ringtonePlayer.pause();
      // seekTo returns a promise - swallow rejection if the player is already released
      Promise.resolve(ringtonePlayer.seekTo(0)).catch(() => {});
    } catch (e) {}
  };

  useEffect(() => {
    const call = createCallManager(socket, {
      onLocalStream: setLocalStream,
      onRemoteStream: (stream) => {
        const videoTracks = stream.getVideoTracks();
        const audioTracks = stream.getAudioTracks();
        console.log('[CALL] Remote stream received. Video tracks:', videoTracks.length, 'Audio tracks:', audioTracks.length);
        videoTracks.forEach(t => console.log('[CALL] video track state:', t.readyState, 'enabled:', t.enabled));
        setRemoteStream(stream);
        setRemoteVideoTrackCount(videoTracks.length);
        setStatus('active'); // ONLY place status becomes 'active' now
      },
      onCallEnded: () => {
        onEndCall();
      },
      onCallState: (state) => {
        console.log('[CALL] peer connection state:', state);
      },
    });
    callManagerRef.current = call;

    // Accept/Accepted no longer fake "active" - just move to "connecting".
    // For the CALLER, this is also the trigger to finally send the SDP
    // offer - see the comment in callManager.js's startOutgoingCall for why
    // it's deliberately not sent any earlier than this.
    const handleAccepted = () => {
      setStatus('connecting');
      if (callInfo.mode === 'outgoing') {
        call.sendOffer().catch((err) => {
          console.log('[CALL] ERROR in sendOffer:', err?.message, err?.stack);
        });
      }
    };
    const handleAnswer = async ({ answer }) => {
      try {
        await call.handleAnswer(answer);
      } catch (err) {
        console.log('[CALL] ERROR in handleAnswer:', err?.message, err?.stack);
      }
    };
    const handleOffer = async ({ offer }) => {
      try {
        await call.handleOffer(offer);
      } catch (err) {
        console.log('[CALL] ERROR in handleOffer:', err?.message, err?.stack);
      }
    };
    const handleIceCandidate = async ({ candidate }) => {
      try {
        await call.handleIceCandidate(candidate);
      } catch (err) {
        console.log('[CALL] ERROR in handleIceCandidate:', err?.message, err?.stack);
      }
    };
    const handleRejected = () => { Alert.alert('Call declined'); onEndCall(); };
    const handleEnded = (payload) => {
      stopRinging(); // in case the call ends (cancel / 60s timeout) while still ringing
      call.cleanup();
      // The server ends the call for both sides after RING_TIMEOUT (60s) of
      // no answer; it reuses this same 'call:ended' event with reason set.
      // Only the caller gets told - the callee just sees the screen dismiss,
      // matching how every other call app handles a missed incoming call.
      if (payload?.reason === 'timeout' && callInfo.mode === 'outgoing') {
        Alert.alert('No answer', `${otherName || 'They'} didn't answer.`);
      }
      onEndCall();
    };

    socket.on('call:accepted', handleAccepted);
    socket.on('call:answer', handleAnswer);
    socket.on('call:offer', handleOffer);
    socket.on('call:ice-candidate', handleIceCandidate);
    socket.on('call:rejected', handleRejected);
    socket.on('call:ended', handleEnded);

    if (callInfo.mode === 'outgoing') {
      call.startOutgoingCall(callInfo.targetUserId, callInfo.callType).catch((err) => {
        console.log('[CALL] ERROR in startOutgoingCall:', err?.message, err?.stack);
        Alert.alert('Call failed', err.message);
        onEndCall();
      });
    }

    return () => {
      socket.off('call:accepted', handleAccepted);
      socket.off('call:answer', handleAnswer);
      socket.off('call:offer', handleOffer);
      socket.off('call:ice-candidate', handleIceCandidate);
      socket.off('call:rejected', handleRejected);
      socket.off('call:ended', handleEnded);
      clearInterval(durationTimerRef.current);
      // Always release the peer connection, local media and the global
      // call-audio session when this screen goes away - some dismissal paths
      // (a declined outgoing call, and call glare where App.js drops the
      // outgoing call the instant the crossing 'call:incoming' arrives) unmount
      // us without having gone through hangUp()/handleEnded(). cleanup() is
      // idempotent, so the paths that already call it are unaffected. Running
      // it here also guarantees the losing glare screen has released
      // ExpoCallAudio before the incoming call's accept claims it.
      callManagerRef.current?.cleanup();
    };
  }, []);

  useEffect(() => {
    if (status === 'ringing' || status === 'calling' || status === 'connecting') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [status]);

  useEffect(() => {
    if (status === 'active') {
      durationTimerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } else {
      clearInterval(durationTimerRef.current);
      setDuration(0);
    }
    return () => clearInterval(durationTimerRef.current);
  }, [status]);

  // Live audio-route updates from the native module (headset connect/disconnect,
  // or our own setAudioRoute). Subscribed for the life of the screen.
  useEffect(() => {
    let sub;
    try {
      sub = ExpoCallAudioModule.addListener?.('onAudioRouteChanged', (e) => {
        if (e?.route) setAudioRoute(e.route);
        // A headset connecting / disconnecting changes the active route AND the
        // available-routes list, so re-read the list on every route change.
        try {
          const routes = ExpoCallAudioModule.getAvailableRoutes?.();
          if (Array.isArray(routes) && routes.length) setAvailableRoutes(routes);
        } catch (e2) {}
      });
    } catch (err) {
      console.log('[CALL] WARNING - audio route listener failed:', err?.message);
    }
    return () => {
      try { sub?.remove?.(); } catch (e) {}
    };
  }, []);

  // Seed the route + available routes once the call audio session exists
  // (startCallAudio runs inside acceptIncomingCall/startOutgoingCall, so it has
  // happened by the time status leaves 'ringing'/'calling').
  useEffect(() => {
    if (status !== 'connecting' && status !== 'active') return;
    try {
      const routes = ExpoCallAudioModule.getAvailableRoutes?.();
      if (Array.isArray(routes) && routes.length) setAvailableRoutes(routes);
      const route = ExpoCallAudioModule.getAudioRoute?.();
      if (route) setAudioRoute(route);
    } catch (err) {
      console.log('[CALL] WARNING - could not read audio route:', err?.message);
    }
  }, [status]);

  // Failsafe for the ring timeout. The server is authoritative and ends an
  // unanswered call for both sides at 60s via 'call:ended' - this only fires
  // if that event never reaches us (our socket silently dropped while
  // ringing). Deliberately longer than the server's 60s so the server wins
  // in the normal case and this is a pure backstop, never the primary path.
  useEffect(() => {
    if (status !== 'ringing' && status !== 'calling') return;
    const t = setTimeout(() => {
      if (callInfo.mode === 'outgoing') {
        // Tell the server too (records the call as missed), then dismiss.
        callManagerRef.current?.hangUp();
        Alert.alert('No answer', `${otherName || 'They'} didn't answer.`);
      }
      onEndCall();
    }, RING_FAILSAFE_MS);
    return () => clearTimeout(t);
  }, [status]);

  // Ringtone + vibration, incoming calls only (status is only ever 'ringing'
  // on the receiving side, and only until the user accepts/rejects or the
  // call ends). While ringing the audio session is still MODE_NORMAL -
  // expo-call-audio's startCallAudio() (MODE_IN_COMMUNICATION) runs only
  // from acceptIncomingCall()/startOutgoingCall(), i.e. after the ring - so
  // the two never overlap as long as stopRinging() runs before we accept.
  useEffect(() => {
    if (status !== 'ringing') return;

    const playFromStart = () => {
      try {
        Promise.resolve(ringtonePlayer.seekTo(0)).catch(() => {});
        ringtonePlayer.play();
      } catch (e) {
        console.log('[CALL] ringtone play failed:', e?.message);
      }
    };

    Vibration.vibrate([0, 500, 500], true);
    playFromStart();
    // expo-audio does not auto-loop: after the clip ends the player just
    // sits paused at the end. Re-seek to 0 and replay every 4s to loop it
    // like a phone ring (short gap between repeats is intentional).
    const replayInterval = setInterval(playFromStart, 4000);

    return () => {
      clearInterval(replayInterval);
      stopRinging();
    };
  }, [status]);

  const handleAccept = async () => {
    stopRinging(); // release the audio output BEFORE expo-call-audio takes the session
    setStatus('connecting'); // NOT 'active' - real media hasn't arrived yet
    try {
      await callManagerRef.current.acceptIncomingCall(callInfo.callId, callInfo.fromUserId, callInfo.callType);
    } catch (err) {
      console.log('[CALL] ERROR in acceptIncomingCall:', err?.message, err?.stack);
      Alert.alert('Could not accept call', err.message);
      onEndCall();
    }
  };

  const handleReject = () => {
    stopRinging();
    socket.emit('call:reject', { callId: callInfo.callId, fromUserId: callInfo.fromUserId });
    onEndCall();
  };

  const handleHangUp = () => {
    callManagerRef.current?.hangUp();
    onEndCall();
  };

  const handleToggleMute = () => setMuted(!!callManagerRef.current?.toggleMute());
  const handleToggleCamera = () => setCameraOff(!!callManagerRef.current?.toggleCamera());

  const applyAudioRoute = (next) => {
    try {
      ExpoCallAudioModule.setAudioRoute(next);
      setAudioRoute(next); // optimistic; the onAudioRouteChanged event confirms
    } catch (err) {
      console.log('[CALL] WARNING - setAudioRoute failed:', err?.message);
    }
  };

  // Smart audio button:
  //  - 2 routes (earpiece + speaker, no headset): tap toggles between them.
  //  - 3 routes (Bluetooth connected): tap opens the route-picker bottom sheet.
  const handleAudioButtonPress = () => {
    const order = availableRoutes.length ? availableRoutes : ['earpiece', 'speaker'];
    if (order.length >= 3) {
      setRouteSheetOpen(true);
      return;
    }
    const idx = order.indexOf(audioRoute);
    applyAudioRoute(order[(idx + 1) % order.length]);
  };

  const handlePickRoute = (route) => {
    applyAudioRoute(route);
    setRouteSheetOpen(false);
  };

  // If the headset drops while the sheet is open, there are only 2 routes left -
  // close the sheet (the button reverts to a direct toggle).
  useEffect(() => {
    if (routeSheetOpen && availableRoutes.length < 3) setRouteSheetOpen(false);
  }, [routeSheetOpen, availableRoutes]);
  const handleSwitchCamera = () => callManagerRef.current?.switchCamera();

  const otherName = callInfo.mode === 'incoming' ? callInfo.fromName : callInfo.targetName;
  const isVideo = callInfo.callType === 'video';
  const showingRemoteVideo = isVideo && remoteStream && status === 'active' && remoteVideoTrackCount > 0;

  const routeIcon =
    audioRoute === 'bluetooth' ? 'bluetooth' :
    audioRoute === 'speaker' ? 'volume-high-outline' :
    'ear-outline';
  const routeLabel =
    audioRoute === 'bluetooth' ? 'Bluetooth' :
    audioRoute === 'speaker' ? 'Speaker' :
    'Earpiece';
  const routeIconColor = audioRoute === 'bluetooth' ? '#4DA3FF' : '#fff';

  console.log('[CALL][RENDER] status:', status, '| isVideo:', isVideo, '| remoteStream exists:', !!remoteStream, '| remoteVideoTrackCount:', remoteVideoTrackCount, '| showingRemoteVideo:', showingRemoteVideo);
  const showControls = status !== 'ringing';

  const statusLabel =
    status === 'ringing' ? 'Incoming call' :
    status === 'calling' ? 'Calling...' :
    status === 'connecting' ? 'Connecting...' :
    formatDuration(duration);

  return (
    <View style={styles.fullScreenOverlay}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={styles.container}>
        {/* Remote video fills the screen ONLY once truly active AND a video track is present.
            key forces a clean remount whenever the video track count changes, since
            RTCView otherwise won't notice tracks added to a stream it already bound to. */}
        {showingRemoteVideo && (
          <RTCView
            key={`remote-video-${remoteVideoTrackCount}`}
            streamURL={remoteStream.toURL()}
            style={styles.remoteVideo}
            objectFit="cover"
            zOrder={0}
          />
        )}

        {/* Center avatar/status - shown whenever we do NOT have real remote video yet */}
        {!showingRemoteVideo && (
          <View style={styles.centerInfo}>
            <Animated.View style={[styles.avatarRing, { transform: [{ scale: pulseAnim }] }]}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>{(otherName || '?').charAt(0).toUpperCase()}</Text>
              </View>
            </Animated.View>
            <Text style={styles.nameText}>{otherName || 'Unknown'}</Text>
            <Text style={styles.statusText}>{statusLabel}</Text>
          </View>
        )}

        {/* Your own camera - ALWAYS a small corner preview, never full-screen */}
        {isVideo && localStream && !cameraOff && (
          <View style={styles.localVideoWrap}>
            <RTCView streamURL={localStream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" zOrder={1} />
          </View>
        )}

        {showingRemoteVideo && (
          <View style={styles.videoHeader}>
            <Text style={styles.videoHeaderName}>{otherName}</Text>
            <Text style={styles.videoHeaderDuration}>{formatDuration(duration)}</Text>
          </View>
        )}

        <View style={styles.controls}>
          {status === 'ringing' ? (
            <>
              <View style={styles.controlColumn}>
                <TouchableOpacity style={[styles.callButton, styles.rejectButton]} onPress={handleReject}>
                  <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.controlLabel}>Decline</Text>
              </View>
              <View style={styles.controlColumn}>
                <TouchableOpacity style={[styles.callButton, styles.acceptButton]} onPress={handleAccept}>
                  <Ionicons name="checkmark" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.controlLabel}>Accept</Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.controlColumn}>
                <TouchableOpacity style={styles.smallButton} onPress={handleToggleMute}>
                  <Ionicons name={muted ? 'mic-off' : 'mic'} size={22} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.controlLabel}>{muted ? 'Unmute' : 'Mute'}</Text>
              </View>
              {/* Audio-output button - always visible on audio AND video calls
                  (research confirmed hiding it on video frustrates users). */}
              <View style={styles.controlColumn}>
                <TouchableOpacity style={styles.smallButton} onPress={handleAudioButtonPress}>
                  <Ionicons name={routeIcon} size={22} color={routeIconColor} />
                </TouchableOpacity>
                <Text style={styles.controlLabel}>{routeLabel}</Text>
              </View>
              {isVideo && (
                <View style={styles.controlColumn}>
                  <TouchableOpacity style={styles.smallButton} onPress={handleToggleCamera}>
                    <Ionicons name={cameraOff ? 'videocam-off' : 'videocam'} size={22} color="#fff" />
                  </TouchableOpacity>
                  <Text style={styles.controlLabel}>{cameraOff ? 'Start video' : 'Stop video'}</Text>
                </View>
              )}
              {isVideo && (
                <View style={styles.controlColumn}>
                  <TouchableOpacity style={styles.smallButton} onPress={handleSwitchCamera}>
                    <Ionicons name="camera-reverse" size={22} color="#fff" />
                  </TouchableOpacity>
                  <Text style={styles.controlLabel}>Flip</Text>
                </View>
              )}
              <View style={styles.controlColumn}>
                <TouchableOpacity style={[styles.callButton, styles.rejectButton]} onPress={handleHangUp}>
                  <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.controlLabel}>End</Text>
              </View>
            </>
          )}
        </View>

        <AudioOutputSheet
          visible={routeSheetOpen}
          routes={availableRoutes}
          activeRoute={audioRoute}
          onSelect={handlePickRoute}
          onClose={() => setRouteSheetOpen(false)}
        />
      </View>
    </View>
  );
}

const TOP_INSET = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 10 : 54;

const styles = StyleSheet.create({
  // Replaces the old <Modal> wrapper. On Android, RN's Modal always renders
  // inside a native Dialog window regardless of presentationStyle - and
  // hardware-accelerated SurfaceViews (which is what RTCView is backed by)
  // are known to composite unreliably inside Android Dialogs. This plain
  // absolutely-positioned View achieves the same "overlay everything"
  // effect without that Dialog window in between.
  fullScreenOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 9999,
    elevation: 9999,
  },
  container: { flex: 1, backgroundColor: '#0B0C10' },
  // FIX: previously this only used StyleSheet.absoluteFillObject, which sets
  // top/left/right/bottom:0 but gives no EXPLICIT numeric width/height. A
  // diagnostic test (temporarily rendering the local stream in this exact
  // slot) proved that even a known-working stream would not render here,
  // while the small corner preview (which DOES use explicit pixel
  // width/height) always worked. That isolates the bug to this specific
  // style, not to the remote stream, network, or WebRTC layer at all -
  // Android's native video surface can fail to size itself correctly from
  // inset-only positioning with no concrete numeric dimensions to measure.
  remoteVideo: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  localVideoWrap: {
    position: 'absolute', top: TOP_INSET, right: 16, width: 100, height: 140,
    borderRadius: 16, overflow: 'hidden', backgroundColor: '#1c1c1e',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  centerInfo: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  avatarRing: {
    width: 148, height: 148, borderRadius: 74, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(37,211,102,0.12)', marginBottom: 24,
  },
  avatarCircle: {
    width: 116, height: 116, borderRadius: 58, backgroundColor: '#128C7E',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { color: '#fff', fontSize: 44, fontWeight: '600' },
  nameText: { color: '#fff', fontSize: 26, fontWeight: '700', marginBottom: 8, letterSpacing: 0.2 },
  statusText: { color: 'rgba(255,255,255,0.6)', fontSize: 15, letterSpacing: 0.3 },
  videoHeader: { position: 'absolute', top: TOP_INSET, left: 20, right: 130 },
  videoHeaderName: { color: '#fff', fontSize: 18, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  videoHeaderDuration: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  controls: {
    position: 'absolute', bottom: 56, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start',
    // wrap so the always-visible audio button never pushes a control off-screen
    // on a video call (mute + audio + camera + flip + end on a narrow phone).
    flexWrap: 'wrap', columnGap: 28, rowGap: 18, paddingHorizontal: 12,
  },
  controlColumn: { alignItems: 'center', width: 64 },
  controlLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 8 },
  callButton: {
    width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },
  acceptButton: { backgroundColor: '#25D366' },
  rejectButton: { backgroundColor: '#E53935' },
  callButtonText: { color: '#fff', fontSize: 26 },
  smallButton: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  smallButtonText: { fontSize: 22 },
});

