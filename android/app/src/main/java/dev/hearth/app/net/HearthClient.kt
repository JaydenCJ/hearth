package dev.hearth.app.net

import dev.hearth.app.settings.SettingsRepository
import dev.hearth.core.protocol.ServerEvent
import dev.hearth.core.protocol.StreamProtocol
import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

/**
 * Client for the Hearth hub's ``/v1/stream`` WebSocket protocol. Frame
 * construction and parsing live in [StreamProtocol] (the pure-JVM `:core`
 * module); the authoritative contract is ``docs/protocol.md``, implemented
 * server-side in ``server/src/server.ts``.
 *
 * Frame sequence:
 *
 * ```
 * -> {"type":"start", "lang"?, "token"?, "session_id"?}
 * -> <binary PCM/WAV frames>
 * -> {"type":"end", "media_type":"audio/wav"}
 * <- {"type":"transcript", "text", "lang"}
 * <- {"type":"reply", "text"}
 * <- {"type":"audio", "media_type", "size"} then one binary frame
 * <- {"type":"done", "session_id", "elapsed_ms"}
 * ```
 */
class HearthClient(
    private val settings: SettingsRepository,
    private val httpClient: OkHttpClient = defaultClient(),
) {

    /** Callbacks for one assistant turn. All invoked on OkHttp's reader thread. */
    interface TurnListener {
        fun onTranscript(text: String, lang: String?)
        fun onReply(text: String)
        fun onAudio(wav: ByteArray, mediaType: String)
        fun onDone(sessionId: String)
        fun onError(message: String)
    }

    /** A live streaming turn; feed it audio chunks, then call [finish]. */
    inner class StreamingTurn internal constructor(private val socket: WebSocket) {
        fun sendAudioChunk(pcmChunk: ByteArray) {
            socket.send(pcmChunk.toByteString())
        }

        /** Signal end-of-utterance; the hub then runs STT -> LLM -> TTS. */
        fun finish(mediaType: String = "audio/wav") {
            socket.send(StreamProtocol.endFrame(mediaType))
        }

        fun cancel() {
            socket.cancel()
        }
    }

    /**
     * Open a streaming turn. Audio sent through the returned [StreamingTurn]
     * should be a WAV byte stream (header first — see
     * [dev.hearth.core.audio.WavCodec]), chunked arbitrarily.
     */
    fun startTurn(sessionId: String?, listener: TurnListener): StreamingTurn {
        val request = Request.Builder().url(settings.streamUrl()).build()
        var pendingAudioType = "audio/wav"
        val socket = httpClient.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(
                        StreamProtocol.startFrame(
                            sessionId = sessionId,
                            lang = settings.languageHint,
                            token = settings.authToken,
                        ),
                    )
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    when (val event = StreamProtocol.parseServerEvent(text)) {
                        is ServerEvent.Transcript ->
                            listener.onTranscript(event.text, event.lang)
                        is ServerEvent.Reply -> listener.onReply(event.text)
                        is ServerEvent.AudioHeader -> pendingAudioType = event.mediaType
                        is ServerEvent.Done -> listener.onDone(event.sessionId)
                        is ServerEvent.Error -> listener.onError(event.message)
                        null -> Unit // unknown frame type: ignore (forward compat)
                    }
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    listener.onAudio(bytes.toByteArray(), pendingAudioType)
                }

                override fun onFailure(
                    webSocket: WebSocket,
                    t: Throwable,
                    response: Response?,
                ) {
                    listener.onError(t.message ?: "connection failed")
                }
            },
        )
        return StreamingTurn(socket)
    }

    /** GET /v1/health — used by the settings screen's "test connection". */
    @Throws(IOException::class)
    fun checkHealth(): String {
        val builder = Request.Builder().url(settings.healthUrl())
        settings.authToken?.let { builder.header("Authorization", "Bearer $it") }
        httpClient.newCall(builder.build()).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("hub returned HTTP ${response.code}")
            }
            return response.body?.string() ?: ""
        }
    }

    companion object {
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS) // LLM turns can be slow
            .pingInterval(20, TimeUnit.SECONDS)
            .build()
    }
}
