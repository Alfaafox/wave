package expo.modules.callaudio

import android.content.Context
import android.media.AudioManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoCallAudioModule : Module() {
  private var previousAudioMode: Int? = null

  override fun definition() = ModuleDefinition {
    Name("ExpoCallAudio")

    // Call this when a call starts (right when local media is acquired).
    // isVideo controls default routing: video calls default to speaker on,
    // audio calls default to earpiece - matching standard call-app behavior.
    Function("startCallAudio") { isVideo: Boolean ->
      val context = appContext.reactContext ?: return@Function Unit
      val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

      previousAudioMode = audioManager.mode

      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(
        null,
        AudioManager.STREAM_VOICE_CALL,
        AudioManager.AUDIOFOCUS_GAIN
      )

      audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
      audioManager.isSpeakerphoneOn = isVideo
      Unit
    }

    // Call this when a call ends (in cleanup()), to release the audio
    // session and restore whatever mode the device was in before the call.
    Function("stopCallAudio") {
      val context = appContext.reactContext ?: return@Function Unit
      val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

      audioManager.isSpeakerphoneOn = false
      audioManager.mode = previousAudioMode ?: AudioManager.MODE_NORMAL

      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(null)
      Unit
    }

    // Optional: lets the call UI's speaker toggle button actually work,
    // in case that's added later.
    Function("setSpeakerphoneOn") { enabled: Boolean ->
      val context = appContext.reactContext ?: return@Function Unit
      val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      audioManager.isSpeakerphoneOn = enabled
      Unit
    }
  }
}

