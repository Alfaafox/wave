// src/utils/useKeyboardHeight.js
//
// Tracks the real system keyboard height on this specific device, so our
// custom Emoji/GIF/Sticker sheet can open at EXACTLY the same height as the
// keyboard it's replacing (this is what makes it feel like WhatsApp/Telegram
// instead of a random-height popup).
//
// Why this needs its own hook instead of just reading Keyboard height once:
// keyboard height varies by device, by whether a third-party keyboard app is
// installed, and by orientation - it must be measured live on THIS device,
// not assumed from a constant. Per the project's own multi-device testing
// habit (S25 / Redmi / S10+), this value should genuinely be re-verified on
// each of those three during QA, not just trusted from one device.
//
// Requires: react-native-keyboard-controller AND react-native-reanimated
// both installed, and the app root wrapped in <KeyboardProvider> (see
// integration notes - this can't be done blind without seeing App.js).

import { useState } from 'react';
import { useSharedValue, runOnJS } from 'react-native-reanimated';
import { useKeyboardHandler } from 'react-native-keyboard-controller';

// Sensible fallback ONLY for the very first app launch, before the system
// keyboard has ever been shown in this session (so we have no measurement
// yet). Once the real keyboard shows even once, the real measured height
// takes over and this constant is never used again for this session.
const FALLBACK_KEYBOARD_HEIGHT = 300;

export function useKeyboardHeight() {
  const [state, setState] = useState({
    height: FALLBACK_KEYBOARD_HEIGHT,
    hasMeasuredRealHeight: false,
  });
  const heightShared = useSharedValue(FALLBACK_KEYBOARD_HEIGHT);

  const recordMeasuredHeight = (h) => setState({ height: h, hasMeasuredRealHeight: true });

  useKeyboardHandler(
    {
      onEnd: (e) => {
        'worklet';
        // Only update our "remembered" height when the keyboard is fully
        // OPEN (height > 0). We deliberately ignore the closing event's
        // height (which trends toward 0) so we don't overwrite our good
        // remembered height with 0 every time the keyboard is dismissed.
        if (e.height > 0) {
          heightShared.value = e.height;
          runOnJS(recordMeasuredHeight)(e.height);
        }
      },
    },
    []
  );

  return { keyboardHeight: state.height, hasMeasuredRealHeight: state.hasMeasuredRealHeight };
}
