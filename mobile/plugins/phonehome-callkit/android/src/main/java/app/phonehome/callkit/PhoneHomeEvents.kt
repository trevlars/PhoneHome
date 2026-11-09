package app.phonehome.callkit

import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import java.util.ArrayDeque

/** Holds plugin events until the Capacitor bridge has attached listeners. */
object PhoneHomeEvents {
    private val main = Handler(Looper.getMainLooper())
    private val pending = ArrayDeque<Pair<String, JSObject>>()
    private var sink: ((String, JSObject) -> Unit)? = null

    fun attach(listener: (String, JSObject) -> Unit) {
        sink = listener
        main.post { flush() }
    }

    fun detach() {
        sink = null
    }

    fun emit(name: String, data: JSObject = JSObject()) {
        main.post {
            val listener = sink
            if (listener == null) {
                if (pending.size >= 24) pending.removeFirst()
                pending.addLast(name to data)
            } else {
                listener(name, data)
            }
        }
    }

    private fun flush() {
        val listener = sink ?: return
        while (pending.isNotEmpty()) {
            val (name, data) = pending.removeFirst()
            listener(name, data)
        }
    }
}
