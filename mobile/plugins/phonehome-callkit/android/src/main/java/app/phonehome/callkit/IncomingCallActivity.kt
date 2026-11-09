package app.phonehome.callkit

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.TextView

/** Full-screen incoming UI. DeviceDefault theme — not AppCompat. */
class IncomingCallActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (dispatch(intent)) return
        showIncoming()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (dispatch(intent)) return
    }

    /** Notification Answer/Decline land here directly so Android 12 allows the app to open. */
    private fun dispatch(intent: Intent?): Boolean {
        when (intent?.action) {
            PhoneHomeCalls.ACTION_ANSWER -> {
                PhoneHomeCalls.answer(this)
                PhoneHomeCalls.openMain(this)
                finish()
                return true
            }
            PhoneHomeCalls.ACTION_DECLINE -> {
                PhoneHomeCalls.decline(this)
                PhoneHomeCalls.openMain(this)
                finish()
                return true
            }
        }
        return false
    }

    private fun showIncoming() {
        setContentView(R.layout.activity_incoming_call)
        val call = PhoneHomeCalls.live
        findViewById<TextView>(R.id.incoming_name).text = call?.callerName ?: "Family"
        findViewById<Button>(R.id.incoming_answer).setOnClickListener {
            PhoneHomeCalls.answer(this)
            PhoneHomeCalls.openMain(this)
            finish()
        }
        findViewById<Button>(R.id.incoming_decline).setOnClickListener {
            PhoneHomeCalls.decline(this)
            PhoneHomeCalls.openMain(this)
            finish()
        }
    }
}
