package app.phonehome.callkit

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log

/** WebRTC and ToneGenerator fight the route — re-apply handset routing while a call is active. */
object PhoneHomeAudioRoute {
    private const val TAG = "PhoneHomeAudio"
    private val handler = Handler(Looper.getMainLooper())
    private var tick: Runnable? = null
    @Volatile private var wantSpeaker = false
    @Volatile private var enforcing = false

    fun webRtcAudioAttributes(): AudioAttributes =
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()

    fun webRtcInputSource(): Int = MediaRecorder.AudioSource.VOICE_COMMUNICATION

    fun apply(context: Context, speaker: Boolean) {
        wantSpeaker = speaker
        val am = context.applicationContext.getSystemService(AudioManager::class.java) ?: return
        am.mode = AudioManager.MODE_IN_COMMUNICATION
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                if (speaker) {
                    val spk = am.availableCommunicationDevices.firstOrNull {
                        it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                    }
                    if (spk != null) am.setCommunicationDevice(spk)
                    else {
                        am.clearCommunicationDevice()
                        @Suppress("DEPRECATION")
                        am.isSpeakerphoneOn = true
                    }
                } else {
                    val ear = am.availableCommunicationDevices.firstOrNull {
                        it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
                    }
                    if (ear != null) {
                        am.setCommunicationDevice(ear)
                    } else {
                        am.clearCommunicationDevice()
                        @Suppress("DEPRECATION")
                        am.isSpeakerphoneOn = false
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "setCommunicationDevice failed: ${e.message}")
                @Suppress("DEPRECATION")
                am.isSpeakerphoneOn = speaker
            }
        } else {
            @Suppress("DEPRECATION")
            am.isSpeakerphoneOn = speaker
        }
        Log.i(TAG, "route speaker=$speaker mode=${am.mode}")
    }

    fun startEnforcing(context: Context, speaker: Boolean) {
        wantSpeaker = speaker
        enforcing = true
        val app = context.applicationContext
        apply(app, speaker)
        tick?.let { handler.removeCallbacks(it) }
        val r = object : Runnable {
            override fun run() {
                if (!enforcing) return
                apply(app, wantSpeaker)
                handler.postDelayed(this, 350)
            }
        }
        tick = r
        handler.post(r)
        Log.i(TAG, "enforcement started speaker=$speaker")
    }

    fun stopEnforcing() {
        enforcing = false
        tick?.let { handler.removeCallbacks(it) }
        tick = null
        Log.i(TAG, "enforcement stopped")
    }

    fun onWebRtcTrackStart(context: Context) {
        Log.i(TAG, "WebRTC audio track start — re-route earpiece=$wantSpeaker")
        apply(context.applicationContext, wantSpeaker)
    }
}
