package app.phonehome.callkit

import android.content.Context
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.audio.JavaAudioDeviceModule
import android.util.Log
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * In-process WebRTC (DTLS-SRTP) for answered calls.
 * The WebView can be frozen or discarded without dropping the audio.
 * Do not log SDP, ICE candidates, or credentials.
 */
object PhoneHomeNativePeer {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private var factory: PeerConnectionFactory? = null
    private var peer: PeerConnection? = null
    private var localAudio: AudioTrack? = null
    private var audioSource: AudioSource? = null
    private var callId: String = ""
    private var remoteSet = false
    private val pendingIce = ArrayList<IceCandidate>()
    private var muted = false
    private var held = false
    @Volatile private var iceGatherLatch: CountDownLatch? = null

    fun createOffer(
        context: Context,
        callId: String,
        iceServers: JSONArray?,
        done: (Result<String>) -> Unit
    ) {
        val app = context.applicationContext
        executor.execute {
            try {
                Log.i("PhoneHomeAudio", "createNativeOffer callId=$callId")
                closeOnExecutor()
                this.callId = callId
                remoteSet = false
                pendingIce.clear()
                val latch = CountDownLatch(1)
                iceGatherLatch = latch
                PhoneHomeCalls.setSpeaker(app, false)
                val pc = createPeer(app, iceServers)
                peer = pc
                val source = factory(app).createAudioSource(MediaConstraints())
                audioSource = source
                val track = factory(app).createAudioTrack("phonehome-audio", source)
                track.setEnabled(!muted && !held)
                localAudio = track
                pc.addTrack(track, listOf("phonehome"))
                val constraints = MediaConstraints().apply {
                    mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
                    mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
                }
                pc.createOffer(object : SdpObserver {
                    override fun onCreateSuccess(sdp: SessionDescription?) {
                        if (sdp == null || sdp.description.isBlank()) {
                            done(Result.failure(IllegalStateException("Empty offer")))
                            return
                        }
                        pc.setLocalDescription(object : SdpObserver {
                            override fun onSetSuccess() {
                                executor.execute {
                                    try {
                                        latch.await(4, TimeUnit.SECONDS)
                                    } catch (_: Exception) {
                                    }
                                    iceGatherLatch = null
                                    val local = pc.localDescription?.description ?: sdp.description
                                    done(Result.success(local))
                                }
                            }
                            override fun onSetFailure(error: String?) {
                                done(Result.failure(IllegalStateException(error ?: "set local failed")))
                            }
                            override fun onCreateSuccess(p0: SessionDescription?) {}
                            override fun onCreateFailure(error: String?) {}
                        }, sdp)
                    }
                    override fun onCreateFailure(error: String?) {
                        done(Result.failure(IllegalStateException(error ?: "offer failed")))
                    }
                    override fun onSetSuccess() {}
                    override fun onSetFailure(error: String?) {}
                }, constraints)
            } catch (e: Exception) {
                done(Result.failure(e))
            }
        }
    }

    fun setRemoteAnswer(answerSdp: String, done: (Result<Unit>) -> Unit) {
        executor.execute {
            val pc = peer
            if (pc == null) {
                done(Result.failure(IllegalStateException("No native peer")))
                return@execute
            }
            val answer = SessionDescription(SessionDescription.Type.ANSWER, answerSdp)
            pc.setRemoteDescription(object : SdpObserver {
                override fun onSetSuccess() {
                    remoteSet = true
                    flushIce(pc)
                    done(Result.success(Unit))
                }
                override fun onSetFailure(error: String?) {
                    done(Result.failure(IllegalStateException(error ?: "set remote failed")))
                }
                override fun onCreateSuccess(p0: SessionDescription?) {}
                override fun onCreateFailure(error: String?) {}
            }, answer)
        }
    }

    fun updateCallId(id: String) {
        if (id.isNotBlank()) callId = id
    }

    fun answer(
        context: Context,
        callId: String,
        offerSdp: String,
        iceServers: JSONArray?,
        done: (Result<String>) -> Unit
    ) {
        val app = context.applicationContext
        executor.execute {
            try {
                closeOnExecutor()
                this.callId = callId
                remoteSet = false
                pendingIce.clear()
                val pc = createPeer(app, iceServers)
                peer = pc
                val source = factory(app).createAudioSource(MediaConstraints())
                audioSource = source
                val track = factory(app).createAudioTrack("phonehome-audio", source)
                track.setEnabled(!muted && !held)
                localAudio = track
                pc.addTrack(track, listOf("phonehome"))
                val offer = SessionDescription(SessionDescription.Type.OFFER, offerSdp)
                pc.setRemoteDescription(object : SdpObserver {
                    override fun onSetSuccess() {
                        executor.execute {
                            remoteSet = true
                            flushIce(pc)
                            val constraints = MediaConstraints().apply {
                                mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
                                mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
                            }
                            pc.createAnswer(object : SdpObserver {
                                override fun onCreateSuccess(sdp: SessionDescription?) {
                                    if (sdp == null || sdp.description.isBlank()) {
                                        done(Result.failure(IllegalStateException("Empty answer")))
                                        return
                                    }
                                    pc.setLocalDescription(object : SdpObserver {
                                        override fun onSetSuccess() {
                                            done(Result.success(sdp.description))
                                        }
                                        override fun onSetFailure(error: String?) {
                                            done(Result.failure(IllegalStateException(error ?: "set local failed")))
                                        }
                                        override fun onCreateSuccess(p0: SessionDescription?) {}
                                        override fun onCreateFailure(error: String?) {}
                                    }, sdp)
                                }
                                override fun onCreateFailure(error: String?) {
                                    done(Result.failure(IllegalStateException(error ?: "answer failed")))
                                }
                                override fun onSetSuccess() {}
                                override fun onSetFailure(error: String?) {}
                            }, constraints)
                        }
                    }
                    override fun onSetFailure(error: String?) {
                        done(Result.failure(IllegalStateException(error ?: "set remote failed")))
                    }
                    override fun onCreateSuccess(sdp: SessionDescription?) {}
                    override fun onCreateFailure(error: String?) {}
                }, offer)
            } catch (e: Exception) {
                done(Result.failure(e))
            }
        }
    }

    fun addIce(candidate: String, sdpMid: String?, sdpMLineIndex: Int) {
        if (candidate.isBlank()) return
        executor.execute {
            val ice = IceCandidate(sdpMid, sdpMLineIndex, candidate)
            val pc = peer
            if (!remoteSet || pc == null) {
                pendingIce.add(ice)
            } else {
                pc.addIceCandidate(ice)
            }
        }
    }

    fun setMuted(on: Boolean) {
        executor.execute {
            muted = on
            localAudio?.setEnabled(!muted && !held)
        }
    }

    fun setHeld(on: Boolean) {
        executor.execute {
            held = on
            localAudio?.setEnabled(!muted && !held)
        }
    }

    fun end() {
        executor.execute { closeOnExecutor() }
    }

    private fun flushIce(pc: PeerConnection) {
        val copy = ArrayList(pendingIce)
        pendingIce.clear()
        for (ice in copy) pc.addIceCandidate(ice)
    }

    private fun createPeer(context: Context, iceServers: JSONArray?): PeerConnection {
        val config = PeerConnection.RTCConfiguration(parseIce(iceServers)).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        val constraints = MediaConstraints()
        return factory(context).createPeerConnection(config, constraints, observer())
            ?: throw IllegalStateException("Peer connection failed")
    }

    private fun observer(): PeerConnection.Observer = object : PeerConnection.Observer {
        override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
            emitState(iceName(state), null)
        }
        override fun onIceConnectionReceivingChange(receiving: Boolean) {}
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {
            if (state == PeerConnection.IceGatheringState.COMPLETE) {
                iceGatherLatch?.countDown()
            }
        }
        override fun onIceCandidate(candidate: IceCandidate?) {
            if (candidate == null || candidate.sdp.isBlank()) return
            PhoneHomeEvents.emit("nativeIceCandidate", JSObject().apply {
                put("callId", callId)
                put("candidate", candidate.sdp)
                put("sdpMid", candidate.sdpMid ?: "")
                put("sdpMLineIndex", candidate.sdpMLineIndex)
            })
        }
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
        override fun onAddStream(stream: org.webrtc.MediaStream?) {}
        override fun onRemoveStream(stream: org.webrtc.MediaStream?) {}
        override fun onDataChannel(channel: org.webrtc.DataChannel?) {}
        override fun onRenegotiationNeeded() {}
        override fun onAddTrack(receiver: org.webrtc.RtpReceiver?, streams: Array<out org.webrtc.MediaStream>?) {}
        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
            emitState(null, connName(newState))
        }
    }

    private fun emitState(ice: String?, conn: String?) {
        PhoneHomeEvents.emit("nativeConnectionState", JSObject().apply {
            put("callId", callId)
            put("ice", ice ?: "")
            put("conn", conn ?: "")
        })
    }

    private fun factory(context: Context): PeerConnectionFactory {
        factory?.let { return it }
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .setEnableInternalTracer(false)
                .createInitializationOptions()
        )
        val app = context.applicationContext
        val audio = JavaAudioDeviceModule.builder(app)
            .setAudioAttributes(PhoneHomeAudioRoute.webRtcAudioAttributes())
            .setAudioSource(PhoneHomeAudioRoute.webRtcInputSource())
            .setUseHardwareAcousticEchoCanceler(true)
            .setUseHardwareNoiseSuppressor(true)
            .setAudioTrackStateCallback(object : JavaAudioDeviceModule.AudioTrackStateCallback {
                override fun onWebRtcAudioTrackStart() {
                    PhoneHomeAudioRoute.onWebRtcTrackStart(app)
                }
                override fun onWebRtcAudioTrackStop() {}
            })
            .createAudioDeviceModule()
        val created = PeerConnectionFactory.builder()
            .setAudioDeviceModule(audio)
            .createPeerConnectionFactory()
        factory = created
        return created
    }

    private fun parseIce(arr: JSONArray?): List<PeerConnection.IceServer> {
        if (arr == null) return emptyList()
        val out = ArrayList<PeerConnection.IceServer>()
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            val urls = ArrayList<String>()
            when (val raw = obj.opt("urls")) {
                is String -> if (raw.isNotBlank()) urls.add(raw)
                is JSONArray -> {
                    for (j in 0 until raw.length()) {
                        val url = raw.optString(j)
                        if (url.isNotBlank()) urls.add(url)
                    }
                }
            }
            if (urls.isEmpty()) continue
            val builder = PeerConnection.IceServer.builder(urls)
            val user = obj.optString("username")
            val cred = obj.optString("credential")
            if (user.isNotBlank()) builder.setUsername(user)
            if (cred.isNotBlank()) builder.setPassword(cred)
            out.add(builder.createIceServer())
        }
        return out
    }

    private fun closeOnExecutor() {
        try {
            peer?.close()
        } catch (_: Exception) {
        }
        peer = null
        try {
            localAudio?.dispose()
        } catch (_: Exception) {
        }
        localAudio = null
        try {
            audioSource?.dispose()
        } catch (_: Exception) {
        }
        audioSource = null
        remoteSet = false
        pendingIce.clear()
        callId = ""
        iceGatherLatch = null
    }

    private fun iceName(state: PeerConnection.IceConnectionState?): String = when (state) {
        PeerConnection.IceConnectionState.NEW -> "new"
        PeerConnection.IceConnectionState.CHECKING -> "checking"
        PeerConnection.IceConnectionState.CONNECTED -> "connected"
        PeerConnection.IceConnectionState.COMPLETED -> "completed"
        PeerConnection.IceConnectionState.FAILED -> "failed"
        PeerConnection.IceConnectionState.DISCONNECTED -> "disconnected"
        PeerConnection.IceConnectionState.CLOSED -> "closed"
        else -> ""
    }

    private fun connName(state: PeerConnection.PeerConnectionState?): String = when (state) {
        PeerConnection.PeerConnectionState.NEW -> "new"
        PeerConnection.PeerConnectionState.CONNECTING -> "connecting"
        PeerConnection.PeerConnectionState.CONNECTED -> "connected"
        PeerConnection.PeerConnectionState.DISCONNECTED -> "disconnected"
        PeerConnection.PeerConnectionState.FAILED -> "failed"
        PeerConnection.PeerConnectionState.CLOSED -> "closed"
        else -> ""
    }
}
