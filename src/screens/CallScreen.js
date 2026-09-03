// src/screens/CallScreen.js
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Animated, Easing, Modal, StatusBar, Platform } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { createCallManager } from '../utils/callManager';

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function CallScreen({ socket, callInfo, onEndCall }) {
  const [status, setStatus] = useState(callInfo.mode === 'incoming' ? 'ringing' : 'calling');
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const callManagerRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const durationTimerRef = useRef(null);

  useEffect(() => {
    const call = createCallManager(socket, {
      onLocalStream: setLocalStream,
      onRemoteStream: (stream) => {
        setRemoteStream(stream);
        setStatus('active');
      },
      onCallEnded: () => {
        onEndCall();
      },
    });
    callManagerRef.current = call;

    const handleAccepted = () => setStatus('active');
    const handleAnswer = async ({ answer }) => { await call.handleAnswer(answer); };
    const handleOffer = async ({ offer }) => { await call.handleOffer(offer); };
    const handleIceCandidate = async ({ candidate }) => { await call.handleIceCandidate(candidate); };
    const handleRejected = () => { Alert.alert('Call declined'); onEndCall(); };
    const handleEnded = () => { call.cleanup(); onEndCall(); };

    socket.on('call:accepted', handleAccepted);
    socket.on('call:answer', handleAnswer);
    socket.on('call:offer', handleOffer);
    socket.on('call:ice-candidate', handleIceCandidate);
    socket.on('call:rejected', handleRejected);
    socket.on('call:ended', handleEnded);

    if (callInfo.mode === 'outgoing') {
      call.startOutgoingCall(callInfo.targetUserId, callInfo.callType).catch((err) => {
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
    };
  }, []);

  useEffect(() => {
    if (status === 'ringing' || status === 'calling') {
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

  const handleAccept = async () => {
    setStatus('active');
    await callManagerRef.current.acceptIncomingCall(callInfo.callId, callInfo.fromUserId, callInfo.callType);
  };

  const handleReject = () => {
    socket.emit('call:reject', { callId: callInfo.callId, fromUserId: callInfo.fromUserId });
    onEndCall();
  };

  const handleHangUp = () => {
    callManagerRef.current?.hangUp();
    onEndCall();
  };

  const handleToggleMute = () => setMuted(!!callManagerRef.current?.toggleMute());
  const handleToggleCamera = () => setCameraOff(!!callManagerRef.current?.toggleCamera());
  const handleSwitchCamera = () => callManagerRef.current?.switchCamera();

  const otherName = callInfo.mode === 'incoming' ? callInfo.fromName : callInfo.targetName;
  const isVideo = callInfo.callType === 'video';
  const showingRemoteVideo = isVideo && remoteStream && status === 'active';

  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      presentationStyle="fullScreen"
      onRequestClose={() => {}}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={styles.container}>
        {showingRemoteVideo && (
          <RTCView streamURL={remoteStream.toURL()} style={styles.remoteVideo} objectFit="cover" />
        )}

        {isVideo && localStream && !cameraOff && (
          <View style={[styles.localVideoWrap, showingRemoteVideo ? styles.localVideoSmall : styles.localVideoFull]}>
            <RTCView streamURL={localStream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" zOrder={1} />
          </View>
        )}

        {!showingRemoteVideo && (
          <View style={styles.centerInfo}>
            <Animated.View style={[styles.avatarRing, { transform: [{ scale: pulseAnim }] }]}>
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarText}>{(otherName || '?').charAt(0).toUpperCase()}</Text>
              </View>
            </Animated.View>
            <Text style={styles.nameText}>{otherName || 'Unknown'}</Text>
            <Text style={styles.statusText}>
              {status === 'ringing' ? 'Incoming call' : status === 'calling' ? 'Calling…' : formatDuration(duration)}
            </Text>
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
                  <Text style={styles.callButtonText}>✕</Text>
                </TouchableOpacity>
                <Text style={styles.controlLabel}>Decline</Text>
              </View>
              <View style={styles.controlColumn}>
                <TouchableOpacity style={[styles.callButton, styles.acceptButton]} onPress={handleAccept}>
                  <Text style={styles.callButtonText}>✓</Text>
                </TouchableOpacity>
                <Text style={styles.controlLabel}>Accept</Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.controlColumn}>
                <TouchableOpacity style={styles.smallButton} onPress={handleToggleMute}>
                  <Text style={styles.smallButtonText}>{muted ? '🔇' : '🎤'}</Text>
                </TouchableOpacity>
                <Text style={styles.controlLabel}>{muted ? 'Unmute' : 'Mute'}</Text>
              </View>
              {isVideo && (
                <View style={styles.controlColumn}>
                  <TouchableOpacity style={styles.smallButton} onPress={handleToggleCamera}>
                    <Text style={styles.smallButtonText}>{cameraOff ? '📷' : '📹'}</Text>
                  </TouchableOpacity>
                  <Text style={styles.controlLabel}>{cameraOff ? 'Start video' : 'Stop video'}</Text>
                </View>
              )}
              {isVideo && (
                <View style={styles.controlColumn}>
                  <TouchableOpacity style={styles.smallButton} onPress={handleSwitchCamera}>
                    <Text style={styles.smallButtonText}>🔄</Text>
                  </TouchableOpacity>
                  <Text style={styles.controlLabel}>Flip</Text>
                </View>
              )}
              <View style={styles.controlColumn}>
                <TouchableOpacity style={[styles.callButton, styles.rejectButton]} onPress={handleHangUp}>
                  <Text style={styles.callButtonText}>✕</Text>
                </TouchableOpacity>
                <Text style={styles.controlLabel}>End</Text>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const TOP_INSET = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 10 : 54;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0C10' },
  remoteVideo: { ...StyleSheet.absoluteFillObject },
  localVideoWrap: {
    position: 'absolute', borderRadius: 16, overflow: 'hidden',
    backgroundColor: '#1c1c1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  localVideoSmall: { top: TOP_INSET, right: 16, width: 100, height: 140 },
  localVideoFull: { top: 0, left: 0, right: 0, bottom: 0, borderRadius: 0, borderWidth: 0 },
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
  videoHeader: {
    position: 'absolute', top: TOP_INSET, left: 20, right: 130,
  },
  videoHeaderName: { color: '#fff', fontSize: 18, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  videoHeaderDuration: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  controls: {
    position: 'absolute', bottom: 56, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 28,
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
