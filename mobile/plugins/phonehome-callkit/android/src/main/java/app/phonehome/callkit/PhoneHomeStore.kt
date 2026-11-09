package app.phonehome.callkit

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Device-scoped hub URL, onboarding, and encrypted sign-in. Never log secrets. */
object PhoneHomeStore {
    private const val PREFS = "phonehome_device"
    private const val SECRETS = "phonehome_secrets"
    private const val KEY_URL = "ph_mothership_url"
    private const val KEY_HOW = "ph_how_it_works_done"
    private const val KEY_MIGRATE = "ph_migrate_transfer_v1"
    private const val KEY_INVITE = "ph_invite_url"
    private const val KEY_USER = "ph_login_user"
    private const val KEY_PASS = "ph_login_pass"
    private const val KEY_SESSION = "ph_session"

    fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun secrets(context: Context): SharedPreferences {
        val master = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            SECRETS,
            master,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    /** HTTPS origin only. Path, query, and non-https are dropped. */
    fun normalizeMothership(raw: String?): String? {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isEmpty()) return null
        val uri = try {
            Uri.parse(trimmed)
        } catch (_: Exception) {
            return null
        }
        if (!uri.scheme.equals("https", ignoreCase = true)) return null
        val host = uri.host?.trim().orEmpty()
        if (host.isEmpty()) return null
        val port = if (uri.port > 0) ":${uri.port}" else ""
        return "https://$host$port"
    }

    fun mothershipUrl(context: Context): String =
        prefs(context).getString(KEY_URL, "").orEmpty()

    fun setMothershipUrl(context: Context, url: String) {
        prefs(context).edit().putString(KEY_URL, url).apply()
    }

    fun clearMothershipUrl(context: Context) {
        prefs(context).edit().remove(KEY_URL).apply()
    }

    fun howItWorksDone(context: Context): Boolean =
        prefs(context).getBoolean(KEY_HOW, false)

    fun setHowItWorksDone(context: Context, done: Boolean) {
        prefs(context).edit().putBoolean(KEY_HOW, done).apply()
    }

    fun migrateJson(context: Context): String =
        prefs(context).getString(KEY_MIGRATE, "").orEmpty()

    fun setMigrateJson(context: Context, json: String) {
        prefs(context).edit().putString(KEY_MIGRATE, json).apply()
    }

    fun clearMigrate(context: Context) {
        prefs(context).edit().remove(KEY_MIGRATE).apply()
    }

    fun stashInvite(context: Context, url: String) {
        prefs(context).edit().putString(KEY_INVITE, url).apply()
    }

    fun consumeInvite(context: Context): String {
        val url = prefs(context).getString(KEY_INVITE, "").orEmpty()
        if (url.isNotEmpty()) prefs(context).edit().remove(KEY_INVITE).apply()
        return url
    }

    fun saveLogin(context: Context, username: String, password: String) {
        secrets(context).edit()
            .putString(KEY_USER, username)
            .putString(KEY_PASS, password)
            .apply()
    }

    fun hasLogin(context: Context): Boolean {
        val s = secrets(context)
        return !s.getString(KEY_USER, "").isNullOrEmpty() &&
            !s.getString(KEY_PASS, "").isNullOrEmpty()
    }

    fun loginUsername(context: Context): String =
        secrets(context).getString(KEY_USER, "").orEmpty()

    fun loginPassword(context: Context): String =
        secrets(context).getString(KEY_PASS, "").orEmpty()

    fun clearLogin(context: Context) {
        secrets(context).edit().remove(KEY_USER).remove(KEY_PASS).apply()
    }

    fun saveSession(context: Context, sessionId: String) {
        secrets(context).edit().putString(KEY_SESSION, sessionId).apply()
    }

    fun sessionId(context: Context): String =
        secrets(context).getString(KEY_SESSION, "").orEmpty()

    fun clearSession(context: Context) {
        secrets(context).edit().remove(KEY_SESSION).apply()
    }
}
