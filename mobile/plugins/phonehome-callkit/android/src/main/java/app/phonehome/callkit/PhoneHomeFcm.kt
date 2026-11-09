package app.phonehome.callkit

import android.content.Context
import com.getcapacitor.JSObject
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

/** FCM is optional until google-services.json is present. Never log the token. */
object PhoneHomeFcm {
    private const val PREFS = "phonehome_fcm"
    private const val KEY = "token"

    fun available(context: Context): Boolean {
        val id = context.resources.getIdentifier("google_app_id", "string", context.packageName)
        return id != 0
    }

    fun ensure(context: Context): Boolean {
        if (!available(context)) return false
        return try {
            if (FirebaseApp.getApps(context).isEmpty()) {
                FirebaseApp.initializeApp(context)
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    fun cached(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "").orEmpty()

    fun cache(context: Context, token: String) {
        if (token.isBlank()) return
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY, token).apply()
    }

    fun register(context: Context, done: (String?) -> Unit) {
        if (!ensure(context)) {
            done(null)
            return
        }
        try {
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (!task.isSuccessful) {
                    done(cached(context).ifBlank { null })
                    return@addOnCompleteListener
                }
                val token = task.result?.trim().orEmpty()
                if (token.isNotEmpty()) cache(context, token)
                done(token.ifBlank { null })
            }
        } catch (_: Exception) {
            done(null)
        }
    }

    fun onMessage(context: Context, data: Map<String, String>) {
        val type = data["type"].orEmpty()
        if (type == "voicemail") {
            val who = data["callerName"].orEmpty().ifBlank { data["fromLabel"].orEmpty().ifBlank { "Someone" } }
            PhoneHomeCalls.showVoicemail(context, who, data["callId"].orEmpty())
            PhoneHomeEvents.emit("voicemailAlert", JSObject().apply {
                put("source", "fcm")
                put("fromLabel", who)
                put("callId", data["callId"].orEmpty())
                put("fromLineId", data["fromLineId"].orEmpty())
                put("toLineId", data["toLineId"].orEmpty())
            })
            return
        }
        PhoneHomeCalls.reportIncoming(
            context,
            callId = data["callId"].orEmpty(),
            handle = data["handle"].orEmpty().ifBlank { data["fromLineId"].orEmpty() },
            callerName = data["callerName"].orEmpty().ifBlank { "Family" },
            fromLineId = data["fromLineId"].orEmpty(),
            toLineId = data["toLineId"].orEmpty(),
            fromPush = true
        )
    }
}
