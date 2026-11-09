package app.phonehome.callkit

import com.getcapacitor.JSObject
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class PhoneHomeFcmService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        PhoneHomeFcm.cache(this, token)
        PhoneHomeEvents.emit("voipToken", JSObject().put("token", token))
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (!PhoneHomeFcm.available(this)) return
        val data = message.data
        if (data.isEmpty()) return
        PhoneHomeFcm.onMessage(this, data)
    }
}
