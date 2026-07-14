package dev.hearth.core.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** One event from the hub on the `/v1/stream` WebSocket (docs/protocol.md). */
sealed interface ServerEvent {
    /** STT result for the shipped utterance (audio turns only). */
    data class Transcript(val text: String, val lang: String?) : ServerEvent

    /** The assistant's reply text, produced by the LLM stage. */
    data class Reply(val text: String) : ServerEvent

    /**
     * Announces the synthesized reply: exactly [size] bytes of [mediaType]
     * follow in the next binary frame. [size] is null if the hub omitted it.
     */
    data class AudioHeader(val mediaType: String, val size: Long?) : ServerEvent

    /** Turn finished; [sessionId] can be replayed to keep conversation memory. */
    data class Done(val sessionId: String, val elapsedMs: Long?) : ServerEvent

    /** The hub reports a failure; the socket closes right after. */
    data class Error(val message: String) : ServerEvent
}

/**
 * Encoder/decoder for the client side of the hub's `/v1/stream` WebSocket
 * protocol. The authoritative contract (frame order, field names, close
 * codes) is `docs/protocol.md`; the server-side implementation lives in
 * `server/src/server.ts`. Pure JVM — unit-tested in this module.
 */
object StreamProtocol {

    /**
     * The mandatory first frame of a turn. Optional fields are omitted
     * entirely (not sent as null) when absent.
     */
    fun startFrame(
        sessionId: String? = null,
        lang: String? = null,
        tag: String? = null,
        token: String? = null,
    ): String = buildJsonObject {
        put("type", "start")
        sessionId?.let { put("session_id", it) }
        lang?.let { put("lang", it) }
        tag?.let { put("tag", it) }
        token?.let { put("token", it) }
    }.toString()

    /** Terminates the binary audio frames of an utterance. */
    fun endFrame(mediaType: String = "audio/wav"): String = buildJsonObject {
        put("type", "end")
        put("media_type", mediaType)
    }.toString()

    /** A text-only turn (skips the STT stage). */
    fun textFrame(text: String): String = buildJsonObject {
        put("type", "text")
        put("text", text)
    }.toString()

    /**
     * Parse one text frame from the hub. Returns null for frames that are
     * not JSON objects or carry an unknown `type` — callers should ignore
     * those (forward compatibility).
     */
    fun parseServerEvent(raw: String): ServerEvent? {
        val obj = runCatching { Json.parseToJsonElement(raw).jsonObject }.getOrNull()
            ?: return null

        fun str(key: String): String? =
            (obj[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

        fun long(key: String): Long? = (obj[key] as? JsonPrimitive)?.longOrNull

        return when (str("type")) {
            "transcript" -> ServerEvent.Transcript(
                text = str("text") ?: "",
                lang = str("lang")?.takeIf { it.isNotEmpty() },
            )
            "reply" -> ServerEvent.Reply(text = str("text") ?: "")
            "audio" -> ServerEvent.AudioHeader(
                mediaType = str("media_type") ?: "audio/wav",
                size = long("size"),
            )
            "done" -> ServerEvent.Done(
                sessionId = str("session_id") ?: "",
                elapsedMs = long("elapsed_ms"),
            )
            "error" -> ServerEvent.Error(message = str("message") ?: "")
            else -> null
        }
    }
}
