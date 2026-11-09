package app.phonehome.callkit

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.pm.ServiceInfo
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.util.Log
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.DisconnectCause
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import com.getcapacitor.JSObject

/**
 * Self-managed Telecom call. Android 12+ asks the system Phone app to show the
 * incoming UI and to write the call into Recents. Audio is in-process WebRTC.
 * Do not log SDP, keys, or passwords.
 */
object PhoneHomeCalls {
    const val ACTION_ANSWER = "app.phonehome.callkit.ANSWER"
    const val ACTION_DECLINE = "app.phonehome.callkit.DECLINE"
    const val ACTION_HANGUP = "app.phonehome.callkit.HANGUP"
    const val ACTION_VOICEMAIL = "app.phonehome.callkit.VOICEMAIL"
    private const val CHANNEL_CALLS = "phonehome_calls"
    private const val CHANNEL_BADGE = "phonehome_badge"
    private const val CHANNEL_VM = "phonehome_voicemail"
    private const val NOTIF_INCOMING = 41
    private const val NOTIF_ONGOING = 42
    private const val NOTIF_BADGE = 43
    private const val NOTIF_VM = 44
    private const val ACCOUNT_ID = "phonehome"

    data class LiveCall(
        val callId: String,
        val handle: String,
        val callerName: String,
        val outgoing: Boolean,
        var answered: Boolean = false,
        var connectedAtMs: Long = 0,
        var speakerOn: Boolean = false,
        var localHeld: Boolean = false,
        var remoteHeld: Boolean = false,
        var fromLineId: String = "",
        var toLineId: String = ""
    )

    @Volatile var live: LiveCall? = null
    @Volatile var connection: PhoneHomeConnection? = null
    @Volatile var pendingOutgoingHandle: String = ""
    @Volatile var pendingOutgoingAt: Long = 0
    private var suppressEndEvent = false
    private var audioFocus: AudioFocusRequest? = null

    fun accountHandle(context: Context): PhoneAccountHandle =
        PhoneAccountHandle(
            android.content.ComponentName(context, PhoneHomeConnectionService::class.java),
            ACCOUNT_ID
        )

    /** Android 12+ can put this self-managed call on the system Phone UI and in Recents. */
    private fun systemInCallUi(): Boolean = Build.VERSION.SDK_INT >= 31

    fun ensureAccount(context: Context): Boolean {
        return try {
            val telecom = context.getSystemService(TelecomManager::class.java) ?: return false
            val handle = accountHandle(context)
            val extras = Bundle().apply {
                putBoolean(PhoneAccount.EXTRA_LOG_SELF_MANAGED_CALLS, true)
                putBoolean(PhoneAccount.EXTRA_ADD_SELF_MANAGED_CALLS_TO_INCALLSERVICE, true)
                putBoolean(PhoneAccount.EXTRA_ALWAYS_USE_VOIP_AUDIO_MODE, true)
            }
            val account = PhoneAccount.builder(handle, "PhoneHome")
                .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
                .setSupportedUriSchemes(listOf("sip"))
                .setExtras(extras)
                .build()
            telecom.registerPhoneAccount(account)
            true
        } catch (_: Exception) {
            false
        }
    }

    fun reportIncoming(
        context: Context,
        callId: String,
        handle: String,
        callerName: String,
        fromLineId: String = "",
        toLineId: String = "",
        fromPush: Boolean = false
    ) {
        val id = callId.ifBlank { "call" }
        val existing = live
        if (existing != null && existing.callId == id && !existing.outgoing) return
        val name = callerName.ifBlank { "Family" }.take(64)
        val addr = handle.ifBlank { "PhoneHome" }
        live = LiveCall(
            callId = id,
            handle = addr,
            callerName = name,
            outgoing = false,
            fromLineId = fromLineId,
            toLineId = toLineId
        )
        ensureChannels(context)
        // Android 12+ throws if a CallStyle notification is posted with notify()
        // and has no fullScreenIntent. That throw is what killed the process
        // before Telecom or the incoming screen could run.
        val incoming = incomingNotification(context, name)
        PhoneHomeCallService.pendingNotification = incoming
        try {
            context.startForegroundService(Intent(context, PhoneHomeCallService::class.java))
        } catch (_: Exception) {
            notify(context, NOTIF_INCOMING, incoming)
        }
        // API 31+ skips this when relying on Telecom alone — but self-managed calls
        // often show no incoming chrome over an open WebView. Always surface our UI.
        if (PhoneHomeLaunch.foreground) {
            val ui = Intent(context, IncomingCallActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            try {
                context.startActivity(ui)
            } catch (_: Exception) {
            }
        }
        ensureAccount(context)
        try {
            val extras = Bundle().apply {
                putString("callId", id)
                putString("handle", addr)
                putString("callerName", name)
            }
            context.getSystemService(TelecomManager::class.java)
                ?.addNewIncomingCall(accountHandle(context), extras)
        } catch (_: Exception) {
        }
        PhoneHomeEvents.emit("incomingPush", JSObject().apply {
            put("callId", id)
            put("handle", addr)
            put("callerName", name)
            put("fromLineId", fromLineId)
            put("toLineId", toLineId)
            put("source", if (fromPush) "fcm" else "local")
        })
    }

    fun startOutgoing(context: Context, callId: String, handle: String, callerName: String): String {
        val id = callId.ifBlank { "out" }
        val existing = live
        // call.ringing is delivered twice (direct, then the relay). A second
        // placeCall while the first is still dialing is the system confirmation
        // popup, and confirming it hangs up the real call.
        if (existing != null && existing.outgoing && existing.callId == id) return id
        val addr = handle.ifBlank { "PhoneHome" }
        val name = callerName.ifBlank { "Family" }.take(64)
        pendingOutgoingHandle = addr
        pendingOutgoingAt = System.currentTimeMillis()
        live = LiveCall(callId = id, handle = addr, callerName = name, outgoing = true, answered = true)
        // Route audio in setConnected — applyAudio here races WebView getUserMedia.
        ensureChannels(context)
        ensureAccount(context)
        try {
            val uri = Uri.fromParts("sip", addr, null)
            val extras = Bundle().apply {
                putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, accountHandle(context))
                putString("callId", id)
                putString("handle", addr)
                putString("callerName", name)
            }
            context.getSystemService(TelecomManager::class.java)?.placeCall(uri, extras)
        } catch (_: Exception) {
        }
        startForeground(context)
        return id
    }

    fun answer(context: Context) {
        val call = live ?: return
        call.answered = true
        if (call.connectedAtMs == 0L) call.connectedAtMs = System.currentTimeMillis()
        connection?.setActive()
        applyAudio(context, call.speakerOn)
        cancel(context, NOTIF_INCOMING)
        startForeground(context)
        PhoneHomeEvents.emit("callAnswered", JSObject().apply {
            put("callId", call.callId)
            put("nativeMedia", true)
            put("connectedAtMs", call.connectedAtMs)
            put("handle", call.handle)
            put("fromLineId", call.fromLineId)
            put("toLineId", call.toLineId)
        })
        PhoneHomeEvents.emit("audioActivated", JSObject().apply {
            put("nativeMedia", true)
            put("callId", call.callId)
        })
    }

    /** Open the app from a notification activity. A broadcast cannot do this on Android 12. */
    fun openMain(context: Context) {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        try {
            context.startActivity(launch)
        } catch (_: Exception) {
        }
    }

    fun decline(context: Context) {
        end(context, DisconnectCause.REJECTED, emit = true, reason = "decline")
    }

    fun endFromSystem(context: Context, reason: String) {
        end(context, DisconnectCause.LOCAL, emit = true, reason = reason)
    }

    fun endFromJs(context: Context) {
        PhoneHomeProgressAudio.stop()
        end(context, DisconnectCause.LOCAL, emit = false, reason = "js")
    }

    private fun end(context: Context, code: Int, emit: Boolean, reason: String) {
        PhoneHomeProgressAudio.stop()
        val call = live
        PhoneHomeNativePeer.end()
        suppressEndEvent = !emit
        try {
            connection?.setDisconnected(DisconnectCause(code))
            connection?.destroy()
        } catch (_: Exception) {
        }
        connection = null
        live = null
        pendingOutgoingHandle = ""
        stopForeground(context)
        cancel(context, NOTIF_INCOMING)
        releaseAudio(context)
        if (emit && call != null) {
            PhoneHomeEvents.emit("callEnded", JSObject().apply {
                put("callId", call.callId)
                put("reason", reason)
                put("fromLineId", call.fromLineId)
                put("toLineId", call.toLineId)
                put("handle", call.handle)
            })
        }
        suppressEndEvent = false
    }

    fun setConnected(context: Context, callId: String?, connectedAtMs: Double?): Long? {
        val call = live
        val at = connectedAtMs?.toLong()?.takeIf { it > 0 }
            ?: call?.connectedAtMs?.takeIf { it > 0 }
            ?: System.currentTimeMillis()
        if (call != null) {
            if (!callId.isNullOrBlank() && call.callId != callId && call.callId.isNotBlank()) return call.connectedAtMs
            call.connectedAtMs = at
            call.answered = true
        }
        try {
            connection?.setActive()
        } catch (_: Exception) {
        }
        applyAudio(context, call?.speakerOn == true)
        PhoneHomeEvents.emit("callConnected", JSObject().apply {
            put("callId", call?.callId ?: callId ?: "")
            put("connectedAtMs", at)
        })
        return at
    }

    fun setSpeaker(context: Context, enabled: Boolean): Boolean {
        live?.speakerOn = enabled
        PhoneHomeAudioRoute.startEnforcing(context, enabled)
        applyAudio(context, enabled)
        try {
            val route = if (enabled) android.telecom.CallAudioState.ROUTE_SPEAKER
            else android.telecom.CallAudioState.ROUTE_EARPIECE
            connection?.setAudioRoute(route)
        } catch (_: Exception) {
        }
        return enabled
    }

    fun setHeld(onHold: Boolean) {
        val call = live ?: return
        call.localHeld = onHold
        PhoneHomeNativePeer.setHeld(onHold)
        try {
            if (onHold) connection?.setOnHold() else connection?.setActive()
        } catch (_: Exception) {
        }
    }

    fun setRemoteHeld(onHold: Boolean) {
        live?.remoteHeld = onHold
    }

    fun noteSystemHold(onHold: Boolean) {
        val call = live ?: return
        if (call.localHeld == onHold) return
        call.localHeld = onHold
        PhoneHomeEvents.emit("callHeld", JSObject().apply {
            put("callId", call.callId)
            put("onHold", onHold)
            put("local", true)
        })
    }

    fun onTelecomDisconnect() {
        if (suppressEndEvent) return
        val call = live ?: return
        live = null
        connection = null
        PhoneHomeEvents.emit("callEnded", JSObject().apply {
            put("callId", call.callId)
            put("reason", "telecom")
        })
    }

    fun state(): JSObject {
        val call = live
        return JSObject().apply {
            put("answered", call?.answered == true)
            put("audioActive", call?.answered == true)
            put("speakerOn", call?.speakerOn == true)
            put("localHeld", call?.localHeld == true)
            put("remoteHeld", call?.remoteHeld == true)
            put("ringing", call != null && call.answered.not() && !call.outgoing)
            put("systemHasCall", call != null)
            put("isOutgoing", call?.outgoing == true)
            put("handle", call?.handle ?: "")
            put("callId", call?.callId ?: "")
            put("connectedAtMs", call?.connectedAtMs ?: 0)
            put("pendingOutgoingHandle", pendingOutgoingHandle)
            put("pendingOutgoingAgeMs", if (pendingOutgoingAt > 0) System.currentTimeMillis() - pendingOutgoingAt else 0)
        }
    }

    fun consumePendingOutgoing(): JSObject {
        val handle = pendingOutgoingHandle
        val age = if (pendingOutgoingAt > 0) System.currentTimeMillis() - pendingOutgoingAt else 0
        pendingOutgoingHandle = ""
        pendingOutgoingAt = 0
        return JSObject().apply {
            put("handle", handle)
            put("ageMs", age)
        }
    }

    fun bind(conn: PhoneHomeConnection) {
        val previous = connection
        connection = conn
        if (previous != null && previous !== conn) {
            try {
                previous.setDisconnected(DisconnectCause(DisconnectCause.OTHER))
                previous.destroy()
            } catch (_: Exception) {
            }
        }
    }

    fun showVoicemail(context: Context, who: String, id: String) {
        ensureChannels(context)
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
            putExtra("phonehome_voicemail", true)
            putExtra("fromLabel", who)
            putExtra("callId", id)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val pi = PendingIntent.getActivity(
            context, 7, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n = NotificationCompat.Builder(context, CHANNEL_VM)
            .setSmallIcon(R.drawable.ic_stat_phonehome)
            .setContentTitle("PhoneHome")
            .setContentText("$who left a message")
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        notify(context, NOTIF_VM, n)
    }

    fun setBadge(context: Context, count: Int) {
        ensureChannels(context)
        if (count <= 0) {
            cancel(context, NOTIF_BADGE)
            return
        }
        val n = NotificationCompat.Builder(context, CHANNEL_BADGE)
            .setSmallIcon(R.drawable.ic_stat_phonehome)
            .setContentTitle("PhoneHome")
            .setContentText(if (count == 1) "1 new" else "$count new")
            .setNumber(count)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .build()
        notify(context, NOTIF_BADGE, n)
    }

    fun createConnection(context: Context, request: ConnectionRequest, outgoing: Boolean): Connection {
        val extras = request.extras ?: Bundle()
        val call = live
        val callId = extras.getString("callId") ?: call?.callId ?: ""
        val handle = extras.getString("handle") ?: call?.handle ?: "PhoneHome"
        val name = extras.getString("callerName") ?: call?.callerName ?: "Family"
        val conn = PhoneHomeConnection(context.applicationContext, callId)
        conn.connectionProperties = Connection.PROPERTY_SELF_MANAGED
        conn.connectionCapabilities = Connection.CAPABILITY_HOLD or Connection.CAPABILITY_SUPPORT_HOLD or Connection.CAPABILITY_MUTE
        conn.audioModeIsVoip = true
        conn.setCallerDisplayName(name, TelecomManager.PRESENTATION_ALLOWED)
        conn.setAddress(Uri.fromParts("sip", handle, null), TelecomManager.PRESENTATION_ALLOWED)
        if (outgoing) conn.setDialing() else conn.setRinging()
        bind(conn)
        return conn
    }

    private fun applyAudio(context: Context, speaker: Boolean) {
        PhoneHomeAudioRoute.apply(context, speaker)
        val am = context.getSystemService(AudioManager::class.java) ?: return
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attrs)
            .build()
        audioFocus = req
        am.requestAudioFocus(req)
    }

    private fun releaseAudio(context: Context) {
        PhoneHomeAudioRoute.stopEnforcing()
        val am = context.getSystemService(AudioManager::class.java) ?: return
        audioFocus?.let { am.abandonAudioFocusRequest(it) }
        audioFocus = null
        am.mode = AudioManager.MODE_NORMAL
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = false
    }

    private fun ensureChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL_CALLS) == null) {
            val ch = NotificationChannel(CHANNEL_CALLS, "Calls", NotificationManager.IMPORTANCE_HIGH)
            ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            nm.createNotificationChannel(ch)
        }
        if (nm.getNotificationChannel(CHANNEL_BADGE) == null) {
            val ch = NotificationChannel(CHANNEL_BADGE, "Badge", NotificationManager.IMPORTANCE_LOW)
            ch.setSound(null, null)
            ch.setShowBadge(true)
            nm.createNotificationChannel(ch)
        }
        if (nm.getNotificationChannel(CHANNEL_VM) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL_VM, "Voicemail", NotificationManager.IMPORTANCE_DEFAULT))
        }
    }

    private fun incomingNotification(context: Context, name: String): Notification {
        // Android 12 blocks startActivity from a notification broadcast (trampoline).
        // The Answer tap itself has to be the activity that opens the app.
        val answer = incomingAction(context, ACTION_ANSWER, 11)
        val decline = incomingAction(context, ACTION_DECLINE, 12)
        val show = PendingIntent.getActivity(
            context,
            3,
            Intent(context, IncomingCallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val person = Person.Builder().setName(name).setImportant(true).build()
        return NotificationCompat.Builder(context, CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_stat_phonehome)
            .setContentTitle(name)
            .setContentText("Incoming PhoneHome call")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setFullScreenIntent(show, true)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, decline, answer))
            .build()
    }

    private fun ongoingNotification(context: Context, name: String): Notification {
        val hang = broadcast(context, ACTION_HANGUP, 4)
        val person = Person.Builder().setName(name).setImportant(true).build()
        return NotificationCompat.Builder(context, CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_stat_phonehome)
            .setContentTitle(name)
            .setContentText("PhoneHome call")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setStyle(NotificationCompat.CallStyle.forOngoingCall(person, hang))
            .build()
    }

    private fun incomingAction(context: Context, action: String, req: Int): PendingIntent =
        PendingIntent.getActivity(
            context,
            req,
            Intent(context, IncomingCallActivity::class.java)
                .setAction(action)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    private fun broadcast(context: Context, action: String, req: Int): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            req,
            Intent(context, PhoneHomeCallReceiver::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    private fun notify(context: Context, id: Int, notification: Notification) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        try {
            nm.notify(id, notification)
        } catch (e: Exception) {
            Log.e("PhoneHomeCalls", "notification $id not posted: ${e.message}")
        }
    }

    private fun cancel(context: Context, id: Int) {
        context.getSystemService(NotificationManager::class.java)?.cancel(id)
    }

    fun startForeground(context: Context) {
        val call = live
        val name = call?.callerName ?: "PhoneHome"
        val notification = try {
            ongoingNotification(context, name)
        } catch (_: Exception) {
            NotificationCompat.Builder(context, CHANNEL_CALLS)
                .setSmallIcon(R.drawable.ic_stat_phonehome)
                .setContentTitle(name)
                .setContentText("PhoneHome call")
                .setOngoing(true)
                .build()
        }
        PhoneHomeCallService.pendingNotification = notification
        val intent = Intent(context, PhoneHomeCallService::class.java)
        try {
            context.startForegroundService(intent)
        } catch (_: Exception) {
            notify(context, NOTIF_ONGOING, notification)
        }
    }

    fun stopForeground(context: Context) {
        context.stopService(Intent(context, PhoneHomeCallService::class.java))
        cancel(context, NOTIF_ONGOING)
    }
}

class PhoneHomeConnectionService : ConnectionService() {
    override fun onCreateIncomingConnection(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest
    ): Connection = PhoneHomeCalls.createConnection(this, request, outgoing = false)

    override fun onCreateOutgoingConnection(
        connectionManagerPhoneAccount: PhoneAccountHandle?,
        request: ConnectionRequest
    ): Connection = PhoneHomeCalls.createConnection(this, request, outgoing = true)
}

class PhoneHomeConnection(
    private val appContext: Context,
    private val callId: String
) : Connection() {
    override fun onAnswer() {
        PhoneHomeCalls.answer(appContext)
    }

    override fun onReject() {
        PhoneHomeCalls.decline(appContext)
    }

    override fun onDisconnect() {
        setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
        destroy()
        PhoneHomeCalls.onTelecomDisconnect()
    }

    override fun onAbort() {
        onDisconnect()
    }

    override fun onHold() {
        setOnHold()
        PhoneHomeCalls.noteSystemHold(true)
    }

    override fun onUnhold() {
        setActive()
        PhoneHomeCalls.noteSystemHold(false)
    }
}

class PhoneHomeCallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            PhoneHomeCalls.ACTION_ANSWER -> PhoneHomeCalls.answer(context)
            PhoneHomeCalls.ACTION_DECLINE -> PhoneHomeCalls.decline(context)
            PhoneHomeCalls.ACTION_HANGUP -> PhoneHomeCalls.endFromSystem(context, "hangup")
        }
    }
}

class PhoneHomeCallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = pendingNotification ?: NotificationCompat.Builder(this, "phonehome_calls")
            .setSmallIcon(R.drawable.ic_stat_phonehome)
            .setContentTitle("PhoneHome")
            .setContentText("Call")
            .setOngoing(true)
            .build()
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(42, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
            } else {
                startForeground(42, notification)
            }
        } catch (_: Exception) {
            // Background FGS starts are blocked on Android 12 unless the app was
            // just woken. The incoming notification carries a fullScreenIntent, so
            // a plain post still shows the call instead of dying here.
            try {
                getSystemService(NotificationManager::class.java)?.notify(41, notification)
            } catch (e: Exception) {
                Log.e("PhoneHomeCalls", "incoming notification not posted: ${e.message}")
            }
            stopSelf()
        }
        return START_NOT_STICKY
    }

    companion object {
        @Volatile var pendingNotification: Notification? = null
    }
}
