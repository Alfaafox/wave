// src/utils/callManager.js
//
// Manages the WebRTC peer connection lifecycle for a single call.
// Waits for TURN credentials from the server BEFORE building the peer
// connection, and queues any offer/ICE candidates that arrive before the
// connection is ready OR before the remote description has been set
// (network can outrace the user tapping Accept, or outrace the async
// setRemoteDescription call itself).

import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, mediaDevices } from 'react-native-webrtc';
import ExpoCallAudioModule from '../../modules/expo-call-audio/src/ExpoCallAudioModule';

export function createCallManager(socket, { onLocalStream, onRemoteStream, onCallEnded, onCallState }) {
  let pc = null;
  let localStream = null;
  let callId = null;
  let otherUserId = null;
  let pendingOffer = null;
  let pendingIce = [];

  function buildPeerConnection(turnCreds) {
    const iceServers = turnCreds
      ? [{ urls: turnCreds.urls, username: turnCreds.username, credential: turnCreds.credential }]
      : [{ urls: 'stun:stun.l.google.com:19302' }];

    const connection = new RTCPeerConnection({ iceServers });

    connection.oniceconnectionstatechange = () => {
      console.log('[CALL] ICE state:', connection.iceConnectionState);
    };
    connection.onicecandidate = (event) => {
      if (event.candidate && callId && otherUserId) {
        socket.emit('call:ice-candidate', {
          callId,
          targetUserId: otherUserId,
          candidate: event.candidate,
        });
      }
    };

    connection.ontrack = (event) => {
      console.log('[CALL] ontrack fired - kind:', event.track.kind, 'streams:', event.streams.length);
      if (event.streams && event.streams[0]) {
        onRemoteStream(event.streams[0]);
      }
    };

    connection.onconnectionstatechange = () => {
      console.log('[CALL] connection state:', connection.connectionState);
      if (onCallState) onCallState(connection.connectionState);
      if (connection.connectionState === 'disconnected' || connection.connectionState === 'failed') {
        cleanup();
        if (onCallEnded) onCallEnded();
      }
    };

    return connection;
  }

  // FIX ATTEMPT #1 (did not work): expo-audio's setAudioModeAsync ran
  // without error but had zero effect - it configures a completely
  // different Android audio subsystem than the one WebRTC actually uses.
  //
  // FIX ATTEMPT #2 (did not work): react-native-incall-manager resolved
  // as null at runtime - confirmed via npx expo-doctor as "untested" on
  // this project's New Architecture setup, and its native module never
  // linked despite a clean rebuild.
  //
  // FIX ATTEMPT #3 (this one): a small custom Expo Module
  // (modules/expo-call-audio), built with the Expo Modules API - which is
  // designed for New Architecture from the ground up, unlike community
  // bridge-style libraries. Directly sets Android's AudioManager into
  // MODE_IN_COMMUNICATION and requests proper audio focus.
  function claimCallAudioSession(callType) {
    try {
      ExpoCallAudioModule.startCallAudio(callType === 'video');
      console.log('[CALL] ExpoCallAudio started for', callType, 'call.');
    } catch (err) {
      console.log('[CALL] WARNING - ExpoCallAudio.startCallAudio failed:', err.message);
    }
  }

  async function getLocalMedia(callType) {
    try {
      claimCallAudioSession(callType);
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: callType === 'video' ? { facingMode: 'user' } : false,
      });
      console.log('[CALL] local media acquired - tracks:', stream.getTracks().map(t => t.kind + ':' + t.readyState));
      localStream = stream;
      onLocalStream(stream);
      return stream;
    } catch (err) {
      console.log('[CALL] getUserMedia FAILED:', err.message);
      throw err;
    }
  }

  // Drains any ICE candidates that arrived before we had a remote
  // description to apply them against. This MUST be called right after
  // every successful setRemoteDescription - whether that happened via
  // applyOffer (callee path) or handleAnswer (caller path) - because with
  // the offer now deliberately delayed until after call:accepted (see
  // startOutgoingCall below), there is no longer a single synchronous
  // "flushPending" moment that reliably follows the offer being applied.
  // Previously this draining only happened inside flushPending(), which
  // assumed the offer had just been applied in the same call - that
  // assumption broke once the offer moved to a separate, later code path,
  // silently reintroducing "remote description was null" failures.
  async function drainPendingIce() {
    if (!pc || !pc.remoteDescription || pendingIce.length === 0) return;
    const candidates = pendingIce;
    pendingIce = [];
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[CALL] Failed to add queued ICE candidate', err);
      }
    }
  }

  async function flushPending() {
    if (pendingOffer) {
      const offer = pendingOffer;
      pendingOffer = null;
      await applyOffer(offer);
      // applyOffer already drains pendingIce internally now, no need to repeat here.
    }
  }

  async function applyOffer(offer) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call:answer', { callId, targetUserId: otherUserId, answer });
      await drainPendingIce();
    } catch (err) {
      console.log('[CALL] ERROR in applyOffer:', err?.message, err?.stack);
      throw err;
    }
  }

  async function startOutgoingCall(targetUserId, callType) {
    otherUserId = targetUserId;
    await getLocalMedia(callType);

    return new Promise((resolve, reject) => {
      socket.emit('call:invite', { targetUserId, callType }, async (response) => {
        if (!response?.ok) {
          cleanup();
          reject(new Error(response?.error || 'Call failed'));
          return;
        }
        callId = response.callId;
        pc = buildPeerConnection(response.turnCreds);
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

        // NOTE: the offer is deliberately NOT created/sent here. Sending it
        // immediately raced against the receiver's CallScreen mounting and
        // registering its 'call:offer' listener - if the offer arrived on
        // the wire before that listener existed, it was silently dropped
        // forever. The offer is now sent from sendOffer(), called once
        // 'call:accepted' arrives, guaranteeing the receiver's listener
        // already exists.
        resolve({ callId });
      });
    });
  }

  async function sendOffer() {
    if (!pc) return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('call:offer', { callId, targetUserId: otherUserId, offer });
    } catch (err) {
      console.log('[CALL] ERROR in sendOffer:', err?.message, err?.stack);
      throw err;
    }
  }

  async function acceptIncomingCall(incomingCallId, fromUserId, callType) {
    callId = incomingCallId;
    otherUserId = fromUserId;
    await getLocalMedia(callType);

    return new Promise((resolve, reject) => {
      socket.emit('call:accept', { callId, fromUserId }, async (response) => {
        if (!response?.ok) {
          cleanup();
          reject(new Error(response?.error || 'Could not accept call'));
          return;
        }
        pc = buildPeerConnection(response.turnCreds);
        localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

        // Only relevant if an offer somehow already arrived and was queued
        // (e.g. a retry/edge case) - the normal path is the offer arriving
        // shortly after this, via the standalone handleOffer() below, which
        // now drains ICE itself via applyOffer.
        await flushPending();
        resolve();
      });
    });
  }

  async function handleOffer(offer) {
    if (!pc) {
      pendingOffer = offer;
      return;
    }
    await applyOffer(offer);
  }

  async function handleAnswer(answer) {
    if (!pc) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      await drainPendingIce();
    } catch (err) {
      console.log('[CALL] ERROR in handleAnswer:', err?.message, err?.stack);
      throw err;
    }
  }

  async function handleIceCandidate(candidate) {
    if (!pc || !pc.remoteDescription) {
      pendingIce.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[CALL] Failed to add ICE candidate', err);
    }
  }

  function toggleMute() {
    if (!localStream) return false;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled;
    }
    return false;
  }

  function toggleCamera() {
    if (!localStream) return false;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return !videoTrack.enabled;
    }
    return false;
  }

  function switchCamera() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack && videoTrack._switchCamera) {
      videoTrack._switchCamera();
    }
  }

  function cleanup() {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      localStream = null;
    }
    if (pc) {
      pc.close();
      pc = null;
    }
    pendingOffer = null;
    pendingIce = [];
    // Release the call-specific audio routing so it doesn't linger and
    // affect anything after the call ends (speaker mode, audio focus, etc).
    try {
      ExpoCallAudioModule.stopCallAudio();
    } catch (err) {
      console.log('[CALL] WARNING - ExpoCallAudio.stopCallAudio failed:', err.message);
    }
  }

  function hangUp() {
    if (callId && otherUserId) {
      socket.emit('call:end', { callId, otherUserId });
    }
    cleanup();
  }

  return {
    startOutgoingCall,
    sendOffer,
    acceptIncomingCall,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    toggleMute,
    toggleCamera,
    switchCamera,
    hangUp,
    cleanup,
  };
}

