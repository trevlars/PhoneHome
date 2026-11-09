package app.phonehome.callkit

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper

/**
 * Outbound dial tone / DTMF / US ringback on STREAM_VOICE_CALL so progress audio
 * uses the earpiece. WebView Web Audio always routes to the loudspeaker.
 */
object PhoneHomeProgressAudio {
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var active = false
    private var toneGen: ToneGenerator? = null
    private var seq = 0

    fun stop() {
        active = false
        seq++
        handler.removeCallbacksAndMessages(null)
        try {
            toneGen?.stopTone()
        } catch (_: Exception) {
        }
        try {
            toneGen?.release()
        } catch (_: Exception) {
        }
        toneGen = null
    }

    fun start(context: Context, digits: String) {
        stop()
        active = true
        val mine = ++seq
        PhoneHomeAudioRoute.startEnforcing(context, false)
        PhoneHomeCalls.setSpeaker(context, false)
        handler.post {
            if (!active || mine != seq) return@post
            toneGen = try {
                ToneGenerator(AudioManager.STREAM_VOICE_CALL, 85)
            } catch (_: Exception) {
                null
            } ?: return@post
            toneGen?.startTone(ToneGenerator.TONE_CDMA_DIAL_TONE_LITE, 1600)
            handler.postDelayed({
                if (!active || mine != seq) return@postDelayed
                playDtmf(digits, mine, 220, 120) {
                    if (!active || mine != seq) return@playDtmf
                    ringbackLoop(mine)
                }
            }, 1600L)
        }
    }

    private fun playDtmf(digits: String, mine: Int, digitMs: Int, gapMs: Int, done: () -> Unit) {
        val chars = digits.filter { it in "0123456789*#" }.ifEmpty { "1" }
        var at = 0L
        for (c in chars) {
            val tone = dtmfFor(c) ?: continue
            handler.postDelayed({
                if (!active || mine != seq) return@postDelayed
                toneGen?.startTone(tone, digitMs)
            }, at)
            at += digitMs + gapMs
        }
        handler.postDelayed({
            if (active && mine == seq) done()
        }, at + 480L)
    }

    private fun ringbackLoop(mine: Int) {
        val tick = object : Runnable {
            override fun run() {
                if (!active || mine != seq) return
                toneGen?.startTone(ToneGenerator.TONE_CDMA_NETWORK_USA_RINGBACK, 2000)
                handler.postDelayed(this, 6000L)
            }
        }
        handler.post(tick)
    }

    private fun dtmfFor(c: Char): Int? = when (c) {
        '0' -> ToneGenerator.TONE_DTMF_0
        '1' -> ToneGenerator.TONE_DTMF_1
        '2' -> ToneGenerator.TONE_DTMF_2
        '3' -> ToneGenerator.TONE_DTMF_3
        '4' -> ToneGenerator.TONE_DTMF_4
        '5' -> ToneGenerator.TONE_DTMF_5
        '6' -> ToneGenerator.TONE_DTMF_6
        '7' -> ToneGenerator.TONE_DTMF_7
        '8' -> ToneGenerator.TONE_DTMF_8
        '9' -> ToneGenerator.TONE_DTMF_9
        '*' -> ToneGenerator.TONE_DTMF_S
        '#' -> ToneGenerator.TONE_DTMF_P
        else -> null
    }
}
