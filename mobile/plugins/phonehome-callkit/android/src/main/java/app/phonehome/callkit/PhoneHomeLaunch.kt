package app.phonehome.callkit

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.getcapacitor.JSObject
import java.util.concurrent.CopyOnWriteArrayList

object PhoneHomeLaunch {
    fun interface LaunchCoverListener {
        fun hide()
    }

    private val covers = CopyOnWriteArrayList<LaunchCoverListener>()
    @Volatile var foreground: Boolean = false
    private var askedFullScreenThisProcess = false
    private var askedBatteryThisProcess = false

    fun attach(listener: LaunchCoverListener) {
        covers.add(listener)
    }

    fun detach(listener: LaunchCoverListener) {
        covers.remove(listener)
    }

    fun hide() {
        for (listener in covers) listener.hide()
    }

    fun onResume() {
        foreground = true
    }

    fun onPause() {
        foreground = false
    }

    fun requestRuntimePermissions(activity: FragmentActivity) {
        val need = ArrayList<String>()
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            need.add(Manifest.permission.RECORD_AUDIO)
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            need.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (need.isNotEmpty()) activity.requestPermissions(need.toTypedArray(), 42)
        if (!ensureFullScreenIntent(activity)) ensureBatteryUnrestricted(activity)
    }

    /**
     * Android 14+ can revoke the lock-screen incoming page. Ask again each
     * cold start until it is allowed. One process only asks once, so backing
     * out of Settings does not loop. The call notification still shows if denied.
     * Returns true when it opened Settings.
     */
    fun ensureFullScreenIntent(activity: FragmentActivity): Boolean {
        if (Build.VERSION.SDK_INT < 34) return false
        val nm = activity.getSystemService(NotificationManager::class.java) ?: return false
        if (nm.canUseFullScreenIntent()) return false
        if (askedFullScreenThisProcess) return false
        askedFullScreenThisProcess = true
        val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
            data = Uri.parse("package:${activity.packageName}")
        }
        return try {
            activity.startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Doze can delay FCM. Unrestricted battery use is the supported exemption.
     * It does not undo a user force-stop. Android blocks the next push until
     * the app is opened again, and no app can override that.
     */
    fun ensureBatteryUnrestricted(activity: FragmentActivity) {
        val pm = activity.getSystemService(PowerManager::class.java) ?: return
        if (pm.isIgnoringBatteryOptimizations(activity.packageName)) return
        if (askedBatteryThisProcess) return
        askedBatteryThisProcess = true
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:${activity.packageName}")
        }
        try {
            activity.startActivity(intent)
        } catch (_: Exception) {
        }
    }

    fun consumeInviteIntent(context: Context, intent: Intent?) {
        val data = intent?.data
        if (data != null && data.scheme == "phonehome" && data.host == "connect") {
            val url = PhoneHomeStore.normalizeMothership(data.getQueryParameter("url"))
            if (url != null) {
                PhoneHomeStore.stashInvite(context, url)
                PhoneHomeEvents.emit("inviteLink", JSObject().put("url", url))
            }
        }
        if (intent?.getBooleanExtra("phonehome_voicemail", false) == true) {
            val who = intent.getStringExtra("fromLabel").orEmpty().ifBlank { "Someone" }
            PhoneHomeEvents.emit("voicemailAlert", JSObject().apply {
                put("source", "notification")
                put("fromLabel", who)
                put("callId", intent.getStringExtra("callId").orEmpty())
            })
            intent.removeExtra("phonehome_voicemail")
        }
    }

    fun biometryKind(context: Context): String {
        val authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL
        val can = BiometricManager.from(context).canAuthenticate(authenticators)
        if (can != BiometricManager.BIOMETRIC_SUCCESS) return "none"
        val pm = context.packageManager
        if (pm.hasSystemFeature(PackageManager.FEATURE_FACE)) return "face"
        if (pm.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT)) return "fingerprint"
        if (BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            == BiometricManager.BIOMETRIC_SUCCESS
        ) {
            return "biometric"
        }
        return "passcode"
    }

    fun unlock(
        activity: FragmentActivity,
        reason: String,
        onOk: () -> Unit,
        onErr: (String) -> Unit
    ) {
        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(activity, executor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                onOk()
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                onErr(errString.toString())
            }
        })
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("PhoneHome")
            .setSubtitle(reason.ifBlank { "Sign in to PhoneHome" })
            .setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_STRONG or
                    BiometricManager.Authenticators.DEVICE_CREDENTIAL
            )
            .build()
        prompt.authenticate(info)
    }
}
