import { requireNativeModule } from 'expo-modules-core';

type ExpoCallAudioModuleType = {
  startCallAudio(isVideo: boolean): void;
  stopCallAudio(): void;
  setSpeakerphoneOn(enabled: boolean): void;
};

export default requireNativeModule<ExpoCallAudioModuleType>('ExpoCallAudio');

