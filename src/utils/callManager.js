// src/utils/callManager.js
//
// Manages the WebRTC peer connection lifecycle for a single call.
// Waits for TURN credentials from the server BEFORE building the peer
// connection, and queues any offer/ICE candidates that arrive before the
// connection is ready (network can outrace the user tapping Accept).

import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, mediaDevices } from 'react-native-webrtc';

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
      if (event.streams && event.streams[0]) {
        onRemoteStream(event.streams[0]);
      }
    };

    connection.onconnectionstatechange = () => {
      if (onCallState) onCallState(connection.connectionState);
      if (connection.connectionState === 'disconnected' || connection.connectionState === 'failed') {
        cleanup();
        if (onCallEnded) onCallEnded();
      }
    };

    return connection;
  }

  async function getLocalMedia(callType) {
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: callType === 'video' ? { facingMode: 'user' } : false,
    });
    localStream = stream;
    onLocalStream(stream);
    return stream;
  }

  async function flushPending() {
    if (pendingOffer) {
      const offer = pendingOffer;
      pendingOffer = null;
      await applyOffer(offer);
    }
    if (pendingIce.length > 0) {
      const candidates = pendingIce;
      pendingIce = [];
      for (const candidate of candidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('Failed to add queued ICE candidate', err);
        }
      }
    }
  }

  async function applyOffer(offer) {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('call:answer', { callId, targetUserId: otherUserId, answer });
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

        await flushPending();

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('call:offer', { callId, targetUserId, offer });

        resolve({ callId });
      });
    });
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
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async function handleIceCandidate(candidate) {
    if (!pc) {
      pendingIce.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('Failed to add ICE candidate', err);
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
  }

  function hangUp() {
    if (callId && otherUserId) {
      socket.emit('call:end', { callId, otherUserId });
    }
    cleanup();
  }

  return {
    startOutgoingCall,
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
