// src/screens/CallScreen.js
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { createCallManager } from '../utils/callManager';

export default function CallScreen({ socket, callInfo, onEndCall }) {
  const [status, setStatus] = useState(callInfo.mode === 'incoming' ? 'ringing' : 'calling');
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const callManagerRef = useRef(null);

  useEffect(() => {
    const call = createCallManager(socket, {
      onLocalStream: setLocalStream,
      onRemoteStream: (stream) => {
        setRemoteStream(stream);
        setStatus('active');
      },
      onCallEnded: () => {
        Alert.alert('Call ended');
        onEndCall();
      },
    });
    callManagerRef.current = call;

    const handleAnswer = async ({ answer }) => { await call.handleAnswer(answer); };
    const handleOffer = async ({ offer }) => { await call.handleOffer(offer); };
    const handleIceCandidate = async ({ candidate }) => { await call.handleIceCandidate(candidate); };
    const handleRejected = () => { Alert.alert('Call declined'); onEndCall(); };
    const handleEnded = () => { call.cleanup(); onEndCall(); };

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
      socket.off('call:answer', handleAnswer);
      socket.off('call:offer', handleOffer);
      socket.off('call:ice-candidate', handleIceCandidate);
      socket.off('call:rejected', handleRejected);
      socket.off('call:ended', handleEnded);
    };
  }, []);

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

  const handleToggleMute = () => {
    const isMuted = callManagerRef.current?.toggleMute();
    setMuted(!!isMuted);
  };

  const handleToggleCamera = () => {
    const isOff = callManagerRef.current?.toggleCamera();
    setCameraOff(!!isOff);
  };

  const handleSwitchCamera = () => {
    callManagerRef.current?.switchCamera();
  };

  const otherName = callInfo.mode === 'incoming' ? callInfo.fromName : callInfo.targetName;
  const isVideo = callInfo.callType === 'video';

  return (
    <View style={styles.container}>
      {isVideo && remoteStream && (
        <RTCView streamURL={remoteStream.toURL()} style={styles.remoteVideo} objectFit="cover" />
      )}
      {isVideo && localStream && !cameraOff && (
        <RTCView streamURL={localStream.toURL()} style={styles.localVideo} objectFit="cover" zOrder={1} />
      )}
      {(!isVideo || !remoteStream) && (
        <View style={styles.centerInfo}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{(otherName || '?').charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.nameText}>{otherName || 'Unknown'}</Text>
          <Text style={styles.statusText}>
            {status === 'ringing' ? 'Incoming call...' : status === 'calling' ? 'Calling...' : 'Connected'}
          </Text>
        </View>
      )}
      <View style={styles.controls}>
        {status === 'ringing' ? (
          <>
            <TouchableOpacity style={[styles.callButton, styles.rejectButton]} onPress={handleReject}>
              <Text style={styles.callButtonText}>✕</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.callButton, styles.acceptButton]} onPress={handleAccept}>
              <Text style={styles.callButtonText}>✓</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.smallButton} onPress={handleToggleMute}>
              <Text style={styles.smallButtonText}>{muted ? '🔇' : '🎤'}</Text>
            </TouchableOpacity>
            {isVideo && (
              <TouchableOpacity style={styles.smallButton} onPress={handleToggleCamera}>
                <Text style={styles.smallButtonText}>{cameraOff ? '📷' : '📹'}</Text>
              </TouchableOpacity>
            )}
            {isVideo && (
              <TouchableOpacity style={styles.smallButton} onPress={handleSwitchCamera}>
                <Text style={styles.smallButtonText}>🔄</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.callButton, styles.rejectButton]} onPress={handleHangUp}>
              <Text style={styles.callButtonText}>✕</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#111', zIndex: 999
  },
  remoteVideo: { flex: 1 },
  localVideo: {
    position: 'absolute', top: 50, right: 16, width: 110, height: 150,
    borderRadius: 12, backgroundColor: '#333'
  },
  centerInfo: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  avatarCircle: {
    width: 110, height: 110, borderRadius: 55, backgroundColor: '#075E54',
    justifyContent: 'center', alignItems: 'center', marginBottom: 20
  },
  avatarText: { color: '#fff', fontSize: 42, fontWeight: '600' },
  nameText: { color: '#fff', fontSize: 24, fontWeight: '600', marginBottom: 8 },
  statusText: { color: '#aaa', fontSize: 15 },
  controls: {
    position: 'absolute', bottom: 50, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20
  },
  callButton: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center' },
  acceptButton: { backgroundColor: '#25D366' },
  rejectButton: { backgroundColor: '#d32f2f' },
  callButtonText: { color: '#fff', fontSize: 28 },
  smallButton: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center'
  },
  smallButtonText: { fontSize: 22 },
});
