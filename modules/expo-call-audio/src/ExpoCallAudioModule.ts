import { requireNativeModule } from 'expo-modules-core';

export type AudioRoute = 'bluetooth' | 'earpiece' | 'speaker';

export type AudioRouteChangedEvent = { route: AudioRoute };

type ExpoCallAudioModuleType = {
  startCallAudio(isVideo: boolean): void;
  stopCallAudio(): void;
  setSpeakerphoneOn(enabled: boolean): void;
  getAudioRoute(): AudioRoute;
  getAvailableRoutes(): AudioRoute[];
  setAudioRoute(route: AudioRoute): void;
  // Block screenshots / screen recording for the whole app window while
  // enabled (used by the view-once photo viewer). Android: Activity
  // FLAG_SECURE. iOS: secure UITextField layer trick. Web: no-op.
  setSecureScreen(enabled: boolean): void;
  addListener(
    eventName: 'onAudioRouteChanged',
    listener: (event: AudioRouteChangedEvent) => void
  ): { remove(): void };
};

export default requireNativeModule<ExpoCallAudioModuleType>('ExpoCallAudio');
