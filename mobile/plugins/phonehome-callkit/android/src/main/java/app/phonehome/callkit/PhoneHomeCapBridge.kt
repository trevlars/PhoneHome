package app.phonehome.callkit

import android.content.Context
import android.net.Uri
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.getcapacitor.Bridge
import java.util.Collections

/**
 * Capacitor injects its JS bridge only for the bundled localhost origin.
 * After Connect, the WebView loads the family's HTTPS Mothership, and without
 * the bridge `Capacitor.isNativePlatform()` is false — so "Use a different
 * Mothership" (and the rest of the native shell) disappears. iOS WKUserScript
 * applies to every navigation; this registers the same script for that origin.
 *
 * The rule is the saved origin only, including a non-443 port. Not `*`.
 */
object PhoneHomeCapBridge {
    private val injected = Collections.synchronizedSet(HashSet<String>())

    fun injectSaved(bridge: Bridge?, context: Context) {
        inject(bridge, PhoneHomeStore.mothershipUrl(context))
    }

    fun inject(bridge: Bridge?, origin: String) {
        val webView = bridge?.webView ?: return
        val rule = originRule(origin) ?: return
        if (!injected.add(rule)) return
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            injected.remove(rule)
            return
        }
        val script = bridgeScript(bridge) ?: run {
            injected.remove(rule)
            return
        }
        try {
            WebViewCompat.addDocumentStartJavaScript(webView, script, setOf(rule))
        } catch (_: Exception) {
            injected.remove(rule)
        }
    }

    /** `https://host` or `https://host:8443`. Default 443 is omitted so the rule matches. */
    fun originRule(origin: String): String? {
        val uri = try {
            Uri.parse(origin.trim())
        } catch (_: Exception) {
            return null
        }
        if (!uri.scheme.equals("https", ignoreCase = true)) return null
        val host = uri.host?.trim().orEmpty()
        if (host.isEmpty()) return null
        val port = uri.port
        return if (port > 0 && port != 443) "https://$host:$port" else "https://$host"
    }

    private fun bridgeScript(bridge: Bridge): String? {
        return try {
            val method = Bridge::class.java.getDeclaredMethod("getJSInjector")
            method.isAccessible = true
            val injector = method.invoke(bridge) ?: return null
            injector.javaClass.getMethod("getScriptString").invoke(injector) as? String
        } catch (_: Exception) {
            null
        }
    }
}
