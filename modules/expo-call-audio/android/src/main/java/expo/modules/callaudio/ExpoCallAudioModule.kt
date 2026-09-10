package expo.modules.callaudio

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Route identifiers shared verbatim with the JS side (CallScreen.js).
private const val ROUTE_BLUETOOTH = "bluetooth"
private const val ROUTE_EARPIECE = "earpiece"
private const val ROUTE_SPEAKER = "speaker"
private const val EVENT_ROUTE_CHANGED = "onAudioRouteChanged"

class ExpoCallAudioModule : Module() {
  private var previousAudioMode: Int? = null

  @Volatile private var inCall = false
  @Volatile private var currentRoute = ROUTE_EARPIECE
  // Set in startCallAudio for the life of the call. Decides the fallback route
  // when a Bluetooth headset drops mid-call: a video call falls back to speaker,
  // an audio call to earpiece (matches WhatsApp / Signal).
  @Volatile private var isVideoCall = false

  private var deviceCallback: AudioDeviceCallback? = null
  private val mainHandler = Handler(Looper.getMainLooper())

  private fun audioManager(): AudioManager? =
    appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("ExpoCallAudio")

    Events(EVENT_ROUTE_CHANGED)

    // Screenshot / screen-recording blocking for the whole Activity window.
    // Used by the view-once photo viewer (ViewOnceViewer.js) - unrelated to
    // calls, but this is the only local native module. FLAG_SECURE also blanks
    // the app in the recent-apps switcher while set. No-op if there is no
    // current Activity.
    Function("setSecureScreen") { enabled: Boolean ->
      val activity = appContext.activityProvider?.currentActivity ?: return@Function Unit
      activity.runOnUiThread {
        if (enabled) {
          activity.window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
          )
        } else {
          activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
      }
      Unit
    }

    // Call this when a call starts (right when local media is acquired).
    // Priority order matches WhatsApp / Signal: a connected Bluetooth SCO / LE
    // headset always wins (audio AND video); otherwise the default is speaker
    // for video calls and earpiece for audio calls.
    Function("startCallAudio") { isVideo: Boolean ->
      val am = audioManager() ?: return@Function Unit
      if (!inCall) previousAudioMode = am.mode

      @Suppress("DEPRECATION")
      am.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN)
      am.mode = AudioManager.MODE_IN_COMMUNICATION
      inCall = true
      isVideoCall = isVideo

      // Bluetooth detection runs first for BOTH audio and video calls - a
      // connected SCO / LE headset always wins. Only when there is no headset
      // does the call type decide: video -> speaker, audio -> earpiece.
      val initial = when {
        hasBluetoothRoute(am) -> ROUTE_BLUETOOTH
        isVideo -> ROUTE_SPEAKER
        else -> ROUTE_EARPIECE
      }
      applyRoute(initial, forceEmit = true)

      // Registered AFTER the initial route so its one-time "devices added"
      // callback doesn't fight the routing we just did. From here on it
      // auto-switches to a headset that connects mid-call and falls back to
      // speaker (video) / earpiece (audio) when one disconnects.
      registerDeviceCallback(am)
      Unit
    }

    // Call this when a call ends (callManager.cleanup()). Releases the
    // Bluetooth SCO / communication device, restores the previous audio mode
    // and stops listening for headset connect / disconnect.
    Function("stopCallAudio") {
      val am = audioManager() ?: return@Function Unit
      inCall = false
      isVideoCall = false
      unregisterDeviceCallback(am)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        am.clearCommunicationDevice()
      } else {
        @Suppress("DEPRECATION")
        run {
          am.stopBluetoothSco()
          am.isBluetoothScoOn = false
        }
      }
      @Suppress("DEPRECATION")
      run { am.isSpeakerphoneOn = false }

      am.mode = previousAudioMode ?: AudioManager.MODE_NORMAL
      previousAudioMode = null
      currentRoute = ROUTE_EARPIECE

      @Suppress("DEPRECATION")
      am.abandonAudioFocus(null)
      Unit
    }

    // Current route: "bluetooth" | "earpiece" | "speaker".
    Function("getAudioRoute") {
      readCurrentRoute()
    }

    // Routes the user can pick right now, in cycle order. "bluetooth" is only
    // present while a headset is actually connected.
    Function("getAvailableRoutes") {
      val am = audioManager()
      val routes = mutableListOf(ROUTE_EARPIECE, ROUTE_SPEAKER)
      if (am != null && hasBluetoothRoute(am)) routes.add(0, ROUTE_BLUETOOTH)
      routes
    }

    // Manually pick a route. Unknown values fall back to earpiece; asking for
    // "bluetooth" with no headset connected also falls back to earpiece.
    Function("setAudioRoute") { route: String ->
      applyRoute(normalizeRoute(route))
    }

    // Backwards-compatible speaker toggle - routed through the same path so
    // state stays consistent for any caller that still uses it.
    Function("setSpeakerphoneOn") { enabled: Boolean ->
      applyRoute(if (enabled) ROUTE_SPEAKER else ROUTE_EARPIECE)
    }
  }

  private fun normalizeRoute(route: String): String = when (route) {
    ROUTE_BLUETOOTH -> ROUTE_BLUETOOTH
    ROUTE_SPEAKER -> ROUTE_SPEAKER
    else -> ROUTE_EARPIECE
  }

  // A Bluetooth type usable for a two-way call (SCO, or an LE Audio headset on
  // API 31+). A2DP is media-only and cannot carry the call mic, so it is not
  // treated as a call route.
  private fun isBluetoothType(type: Int): Boolean {
    if (type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return true
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_BLE_HEADSET) return true
    return false
  }

  private fun hasBluetoothRoute(am: AudioManager): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      am.availableCommunicationDevices.any { isBluetoothType(it.type) }
    } else {
      @Suppress("DEPRECATION")
      am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { isBluetoothType(it.type) }
    }
  }

  private fun readCurrentRoute(): String {
    val am = audioManager() ?: return currentRoute
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val dev = am.communicationDevice ?: return currentRoute
      return when {
        isBluetoothType(dev.type) -> ROUTE_BLUETOOTH
        dev.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> ROUTE_SPEAKER
        dev.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> ROUTE_EARPIECE
        else -> currentRoute
      }
    }
    return currentRoute
  }

  private fun applyRoute(route: String, forceEmit: Boolean = false) {
    val am = audioManager() ?: return
    val previous = currentRoute
    var resolved = route

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val devices = am.availableCommunicationDevices
      when (route) {
        ROUTE_BLUETOOTH -> {
          val bt = devices.firstOrNull { isBluetoothType(it.type) }
          if (bt == null || !am.setCommunicationDevice(bt)) {
            applyRoute(ROUTE_EARPIECE, forceEmit)
            return
          }
        }
        ROUTE_SPEAKER -> {
          val spk = devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
          if (spk != null) am.setCommunicationDevice(spk) else am.clearCommunicationDevice()
        }
        else -> {
          resolved = ROUTE_EARPIECE
          val ear = devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
          if (ear != null) am.setCommunicationDevice(ear) else am.clearCommunicationDevice()
        }
      }
    } else {
      @Suppress("DEPRECATION")
      when (route) {
        ROUTE_BLUETOOTH -> {
          if (hasBluetoothRoute(am)) {
            am.startBluetoothSco()
            am.isBluetoothScoOn = true
            am.isSpeakerphoneOn = false
          } else {
            resolved = ROUTE_EARPIECE
            am.stopBluetoothSco()
            am.isBluetoothScoOn = false
            am.isSpeakerphoneOn = false
          }
        }
        ROUTE_SPEAKER -> {
          am.stopBluetoothSco()
          am.isBluetoothScoOn = false
          am.isSpeakerphoneOn = true
        }
        else -> {
          resolved = ROUTE_EARPIECE
          am.stopBluetoothSco()
          am.isBluetoothScoOn = false
          am.isSpeakerphoneOn = false
        }
      }
    }

    currentRoute = resolved
    if (forceEmit || currentRoute != previous) {
      sendEvent(EVENT_ROUTE_CHANGED, mapOf("route" to currentRoute))
    }
  }

  private fun registerDeviceCallback(am: AudioManager) {
    if (deviceCallback != null) return
    val cb = object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
        if (!inCall) return
        val gotBluetooth = addedDevices?.any { isBluetoothType(it.type) } == true
        if (gotBluetooth && currentRoute != ROUTE_BLUETOOTH) {
          applyRoute(ROUTE_BLUETOOTH)
        }
      }

      override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
        if (!inCall) return
        val lostBluetooth = removedDevices?.any { isBluetoothType(it.type) } == true
        if (lostBluetooth && currentRoute == ROUTE_BLUETOOTH) {
          // Fall back the way a fresh call of this type would start: video ->
          // speaker, audio -> earpiece.
          applyRoute(if (isVideoCall) ROUTE_SPEAKER else ROUTE_EARPIECE)
        }
      }
    }
    deviceCallback = cb
    am.registerAudioDeviceCallback(cb, mainHandler)
  }

  private fun unregisterDeviceCallback(am: AudioManager) {
    deviceCallback?.let { am.unregisterAudioDeviceCallback(it) }
    deviceCallback = null
  }
}
