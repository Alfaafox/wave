type AudioRoute = 'bluetooth' | 'earpiece' | 'speaker';

// No-op on web - call audio routing is a native-only concern.
export default {
  startCallAudio(_isVideo: boolean) {},
  stopCallAudio() {},
  setSpeakerphoneOn(_enabled: boolean) {},
  getAudioRoute(): AudioRoute {
    return 'earpiece';
  },
  getAvailableRoutes(): AudioRoute[] {
    return ['earpiece', 'speaker'];
  },
  setAudioRoute(_route: AudioRoute) {},
  setSecureScreen(_enabled: boolean) {},
  addListener(
    _eventName: 'onAudioRouteChanged',
    _listener: (event: { route: AudioRoute }) => void
  ) {
    return { remove() {} };
  },
};
