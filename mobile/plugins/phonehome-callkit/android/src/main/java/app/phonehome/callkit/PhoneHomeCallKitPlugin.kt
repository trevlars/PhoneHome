package app.phonehome.callkit

import android.content.ClipData
import android.content.ClipboardManager
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "PhoneHomeCallKit")
class PhoneHomeCallKitPlugin : Plugin() {
    override fun load() {
        PhoneHomeEvents.attach { name, data ->
            notifyListeners(name, data, true)
        }
        PhoneHomeCalls.ensureAccount(context)
    }

    override fun handleOnDestroy() {
        PhoneHomeEvents.detach()
    }

    @PluginMethod
    fun registerVoIP(call: PluginCall) {
        PhoneHomeFcm.register(context) { token ->
            if (!token.isNullOrEmpty()) {
                notifyListeners("voipToken", JSObject().put("token", token), true)
            }
        }
        call.resolve()
    }

    @PluginMethod
    fun registerAlertPush(call: PluginCall) {
        activity?.let { PhoneHomeLaunch.requestRuntimePermissions(it) }
        call.resolve(JSObject().put("granted", true))
    }

    @PluginMethod
    fun setCallKitEnabled(call: PluginCall) {
        call.resolve(JSObject().put("enabled", true))
    }

    @PluginMethod
    fun isCallKitEnabled(call: PluginCall) {
        call.resolve(JSObject().put("enabled", true))
    }

    @PluginMethod
    fun reportIncoming(call: PluginCall) {
        PhoneHomeCalls.reportIncoming(
            context,
            callId = call.getString("callId") ?: "",
            handle = call.getString("handle") ?: "PhoneHome",
            callerName = call.getString("callerName") ?: "Family",
            fromLineId = call.getString("fromLineId") ?: "",
            toLineId = call.getString("toLineId") ?: ""
        )
        call.resolve()
    }

    @PluginMethod
    fun startOutgoing(call: PluginCall) {
        val id = PhoneHomeCalls.startOutgoing(
            context,
            callId = call.getString("callId") ?: "",
            handle = call.getString("handle") ?: "PhoneHome",
            callerName = call.getString("callerName") ?: "Family"
        )
        call.resolve(JSObject().put("callId", id))
    }

    @PluginMethod
    fun endCall(call: PluginCall) {
        PhoneHomeCalls.endFromJs(context)
        call.resolve()
    }

    @PluginMethod
    fun setConnected(call: PluginCall) {
        val at = PhoneHomeCalls.setConnected(context, call.getString("callId"), call.getDouble("connectedAtMs"))
        if (at != null) call.resolve(JSObject().put("connectedAtMs", at))
        else call.resolve()
    }

    @PluginMethod
    fun setSpeaker(call: PluginCall) {
        val enabled = PhoneHomeCalls.setSpeaker(context, call.getBoolean("enabled", false) == true)
        call.resolve(JSObject().put("enabled", enabled))
    }

    @PluginMethod
    fun startOutboundProgress(call: PluginCall) {
        PhoneHomeProgressAudio.start(context, call.getString("digits") ?: "")
        call.resolve()
    }

    @PluginMethod
    fun stopOutboundProgress(call: PluginCall) {
        PhoneHomeProgressAudio.stop()
        call.resolve()
    }

    @PluginMethod
    fun setHeld(call: PluginCall) {
        val onHold = call.getBoolean("onHold", false) == true
        PhoneHomeCalls.setHeld(onHold)
        call.resolve(JSObject().put("onHold", onHold))
    }

    @PluginMethod
    fun setRemoteHeld(call: PluginCall) {
        val onHold = call.getBoolean("onHold", false) == true
        PhoneHomeCalls.setRemoteHeld(onHold)
        call.resolve(JSObject().put("onHold", onHold))
    }

    @PluginMethod
    fun setNativeMuted(call: PluginCall) {
        val muted = call.getBoolean("muted", false) == true
        PhoneHomeNativePeer.setMuted(muted)
        call.resolve(JSObject().put("muted", muted))
    }

    @PluginMethod
    fun getCallState(call: PluginCall) {
        call.resolve(PhoneHomeCalls.state())
    }

    @PluginMethod
    fun consumePendingOutgoing(call: PluginCall) {
        call.resolve(PhoneHomeCalls.consumePendingOutgoing())
    }

    @PluginMethod
    fun createNativeOffer(call: PluginCall) {
        val callId = call.getString("callId").orEmpty()
        PhoneHomeNativePeer.createOffer(context, callId, call.getArray("iceServers")) { result ->
            result.onSuccess { sdp ->
                call.resolve(JSObject().put("type", "offer").put("sdp", sdp))
            }
            result.onFailure { err ->
                call.reject(err.message ?: "native offer failed")
            }
        }
    }

    @PluginMethod
    fun updateNativeCallId(call: PluginCall) {
        PhoneHomeNativePeer.updateCallId(call.getString("callId").orEmpty())
        call.resolve()
    }

    @PluginMethod
    fun setNativeRemoteAnswer(call: PluginCall) {
        val sdpObj = call.getObject("sdp")
        val answer = sdpObj?.getString("sdp").orEmpty()
        if (answer.isBlank()) {
            call.reject("sdp required")
            return
        }
        PhoneHomeNativePeer.setRemoteAnswer(answer) { result ->
            result.onSuccess { call.resolve() }
            result.onFailure { err -> call.reject(err.message ?: "native answer failed") }
        }
    }

    @PluginMethod
    fun setNativeRemoteOffer(call: PluginCall) {
        val callId = call.getString("callId").orEmpty()
        if (callId.isBlank()) {
            call.reject("callId required")
            return
        }
        val sdpObj = call.getObject("sdp")
        val offer = sdpObj?.getString("sdp").orEmpty().ifBlank { call.getString("offerSdp").orEmpty() }
        if (offer.isBlank()) {
            call.reject("sdp required")
            return
        }
        PhoneHomeNativePeer.answer(context, callId, offer, call.getArray("iceServers")) { result ->
            result.onSuccess { sdp ->
                call.resolve(JSObject().put("type", "answer").put("sdp", sdp))
            }
            result.onFailure { err ->
                call.reject(err.message ?: "native answer failed")
            }
        }
    }

    @PluginMethod
    fun addNativeIceCandidate(call: PluginCall) {
        val obj = call.getObject("candidate")
        val sdp = obj?.getString("candidate").orEmpty()
        val mid = obj?.getString("sdpMid")
        val index = obj?.optInt("sdpMLineIndex", 0) ?: 0
        PhoneHomeNativePeer.addIce(sdp, mid, index)
        call.resolve()
    }

    @PluginMethod
    fun endNativeCall(call: PluginCall) {
        PhoneHomeNativePeer.end()
        call.resolve()
    }

    @PluginMethod
    fun requestBadgePermission(call: PluginCall) {
        activity?.let { PhoneHomeLaunch.requestRuntimePermissions(it) }
        call.resolve(JSObject().put("granted", true))
    }

    @PluginMethod
    fun setBadge(call: PluginCall) {
        PhoneHomeCalls.setBadge(context, call.getInt("count", 0) ?: 0)
        call.resolve()
    }

    @PluginMethod
    fun clearBadge(call: PluginCall) {
        PhoneHomeCalls.setBadge(context, 0)
        call.resolve()
    }

    @PluginMethod
    fun saveLogin(call: PluginCall) {
        val username = call.getString("username")?.trim().orEmpty()
        val password = call.getString("password").orEmpty()
        if (username.isEmpty() || password.isEmpty()) {
            call.resolve(JSObject().put("saved", false))
            return
        }
        try {
            PhoneHomeStore.saveLogin(context, username, password)
            call.resolve(JSObject().put("saved", true))
        } catch (_: Exception) {
            call.resolve(JSObject().put("saved", false))
        }
    }

    @PluginMethod
    fun hasSavedLogin(call: PluginCall) {
        val saved = try {
            PhoneHomeStore.hasLogin(context)
        } catch (_: Exception) {
            false
        }
        call.resolve(JSObject().apply {
            put("saved", saved)
            put("username", if (saved) PhoneHomeStore.loginUsername(context) else "")
            put("biometry", PhoneHomeLaunch.biometryKind(context))
        })
    }

    @PluginMethod
    fun getLogin(call: PluginCall) {
        val activity = activity
        if (activity == null) {
            call.reject("No activity")
            return
        }
        if (!PhoneHomeStore.hasLogin(context)) {
            call.reject("No saved sign-in")
            return
        }
        PhoneHomeLaunch.unlock(activity, call.getString("reason") ?: "Sign in to PhoneHome", {
            call.resolve(JSObject().apply {
                put("username", PhoneHomeStore.loginUsername(context))
                put("password", PhoneHomeStore.loginPassword(context))
            })
        }, { err ->
            call.reject(err)
        })
    }

    @PluginMethod
    fun clearLogin(call: PluginCall) {
        PhoneHomeStore.clearLogin(context)
        call.resolve(JSObject().put("cleared", true))
    }

    @PluginMethod
    fun saveSession(call: PluginCall) {
        val sessionId = call.getString("sessionId").orEmpty()
        if (sessionId.isEmpty()) {
            call.resolve(JSObject().put("saved", false))
            return
        }
        PhoneHomeStore.saveSession(context, sessionId)
        call.resolve(JSObject().put("saved", true))
    }

    @PluginMethod
    fun getSession(call: PluginCall) {
        call.resolve(JSObject().put("sessionId", PhoneHomeStore.sessionId(context)))
    }

    @PluginMethod
    fun clearSession(call: PluginCall) {
        PhoneHomeStore.clearSession(context)
        call.resolve(JSObject().put("cleared", true))
    }

    @PluginMethod
    fun readClipboard(call: PluginCall) {
        val cm = context.getSystemService(ClipboardManager::class.java)
        val text = cm?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString() ?: ""
        call.resolve(JSObject().put("text", text))
    }

    @PluginMethod
    fun clipboardHasUrl(call: PluginCall) {
        val cm = context.getSystemService(ClipboardManager::class.java)
        val desc = cm?.primaryClipDescription
        val has = desc?.hasMimeType("text/plain") == true || desc?.hasMimeType("text/html") == true
        call.resolve(JSObject().put("hasUrl", has))
    }

    @PluginMethod
    fun getStorefront(call: PluginCall) {
        call.resolve(JSObject().put("countryCode", ""))
    }

    @PluginMethod
    fun openInAppBrowser(call: PluginCall) {
        val raw = call.getString("url")?.trim().orEmpty()
        val uri = Uri.parse(raw)
        if (!uri.scheme.equals("https", ignoreCase = true)) {
            call.reject("Only https links can open in the app")
            return
        }
        try {
            CustomTabsIntent.Builder().build().launchUrl(context, uri)
            call.resolve()
        } catch (e: Exception) {
            call.reject(e.message ?: "Could not open link")
        }
    }

    @PluginMethod
    fun consumeInviteLink(call: PluginCall) {
        call.resolve(JSObject().put("url", PhoneHomeStore.consumeInvite(context)))
    }

    @PluginMethod
    fun getMothershipUrl(call: PluginCall) {
        call.resolve(JSObject().put("url", PhoneHomeStore.mothershipUrl(context)))
    }

    @PluginMethod
    fun setMothershipUrl(call: PluginCall) {
        val url = PhoneHomeStore.normalizeMothership(call.getString("url"))
        if (url == null) {
            call.reject("Mothership URL must be https")
            return
        }
        PhoneHomeStore.setMothershipUrl(context, url)
        val reload = call.getBoolean("reload", true) != false
        val openPath = call.getString("openPath")?.trim().orEmpty()
        if (reload) {
            val path = if (openPath.startsWith("/")) openPath else ""
            val target = url + path
            bridge.webView?.post {
                PhoneHomeCapBridge.inject(bridge, url)
                bridge.webView?.loadUrl(target)
            }
        }
        call.resolve(JSObject().put("url", url))
    }

    @PluginMethod
    fun clearMothershipUrl(call: PluginCall) {
        PhoneHomeStore.clearMothershipUrl(context)
        val reload = call.getBoolean("reload", true) != false
        if (reload) {
            val local = bridge.getLocalUrl().orEmpty()
            if (local.isNotBlank()) bridge.webView?.post { bridge.webView?.loadUrl(local) }
        }
        call.resolve(JSObject().put("cleared", true))
    }

    @PluginMethod
    fun hideLaunchCover(call: PluginCall) {
        PhoneHomeLaunch.hide()
        call.resolve(JSObject().put("hidden", true))
    }

    @PluginMethod
    fun getOnboarding(call: PluginCall) {
        call.resolve(JSObject().put("howItWorksDone", PhoneHomeStore.howItWorksDone(context)))
    }

    @PluginMethod
    fun setOnboarding(call: PluginCall) {
        if (call.getBoolean("howItWorksDone", false) == true) {
            PhoneHomeStore.setHowItWorksDone(context, true)
        }
        call.resolve(JSObject().put("howItWorksDone", PhoneHomeStore.howItWorksDone(context)))
    }

    @PluginMethod
    fun getMigrateTransfer(call: PluginCall) {
        call.resolve(JSObject().put("json", PhoneHomeStore.migrateJson(context)))
    }

    @PluginMethod
    fun setMigrateTransfer(call: PluginCall) {
        PhoneHomeStore.setMigrateJson(context, call.getString("json").orEmpty())
        call.resolve(JSObject().put("saved", true))
    }

    @PluginMethod
    fun clearMigrateTransfer(call: PluginCall) {
        PhoneHomeStore.clearMigrate(context)
        call.resolve(JSObject().put("cleared", true))
    }
}
