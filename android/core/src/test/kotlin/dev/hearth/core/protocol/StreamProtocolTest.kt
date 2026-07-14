package dev.hearth.core.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Field names and frame shapes below are the contract from docs/protocol.md;
 * the server-side counterpart is server/src/server.ts.
 */
class StreamProtocolTest {

    private fun fields(json: String) = Json.parseToJsonElement(json).jsonObject

    // -- outbound frames ------------------------------------------------------

    @Test
    fun startFrameWithAllFields() {
        val obj = fields(
            StreamProtocol.startFrame(
                sessionId = "abc",
                lang = "ja",
                tag = "kitchen",
                token = "s3cret",
            ),
        )
        assertEquals("start", obj["type"]!!.jsonPrimitive.content)
        assertEquals("abc", obj["session_id"]!!.jsonPrimitive.content)
        assertEquals("ja", obj["lang"]!!.jsonPrimitive.content)
        assertEquals("kitchen", obj["tag"]!!.jsonPrimitive.content)
        assertEquals("s3cret", obj["token"]!!.jsonPrimitive.content)
    }

    @Test
    fun startFrameOmitsAbsentOptionals() {
        val obj = fields(StreamProtocol.startFrame())
        assertEquals(setOf("type"), obj.keys)
    }

    @Test
    fun endFrameCarriesMediaType() {
        val obj = fields(StreamProtocol.endFrame())
        assertEquals("end", obj["type"]!!.jsonPrimitive.content)
        assertEquals("audio/wav", obj["media_type"]!!.jsonPrimitive.content)
        val ogg = fields(StreamProtocol.endFrame("audio/ogg"))
        assertEquals("audio/ogg", ogg["media_type"]!!.jsonPrimitive.content)
    }

    @Test
    fun textFrameEscapesSpecialCharacters() {
        val text = "say \"hi\"\nback\\slash and 日本語"
        val obj = fields(StreamProtocol.textFrame(text))
        assertEquals("text", obj["type"]!!.jsonPrimitive.content)
        assertEquals(text, obj["text"]!!.jsonPrimitive.content)
    }

    // -- inbound events -------------------------------------------------------

    @Test
    fun parsesTranscript() {
        val ev = StreamProtocol.parseServerEvent(
            """{"type":"transcript","text":"turn off the lights","lang":"en","backend":{"backend":"whisper","reason":"default"}}""",
        )
        assertEquals(ServerEvent.Transcript("turn off the lights", "en"), ev)
    }

    @Test
    fun emptyLangBecomesNull() {
        val ev = StreamProtocol.parseServerEvent(
            """{"type":"transcript","text":"hello","lang":""}""",
        ) as ServerEvent.Transcript
        assertNull(ev.lang)
        val absent = StreamProtocol.parseServerEvent(
            """{"type":"transcript","text":"hello"}""",
        ) as ServerEvent.Transcript
        assertNull(absent.lang)
    }

    @Test
    fun parsesReply() {
        val ev = StreamProtocol.parseServerEvent(
            """{"type":"reply","text":"こんにちは。Hearthです。","backend":{"backend":"mock","reason":"default"}}""",
        )
        assertEquals(ServerEvent.Reply("こんにちは。Hearthです。"), ev)
    }

    @Test
    fun parsesAudioHeader() {
        val ev = StreamProtocol.parseServerEvent(
            """{"type":"audio","media_type":"audio/wav","size":32044}""",
        )
        assertEquals(ServerEvent.AudioHeader("audio/wav", 32044L), ev)
    }

    @Test
    fun audioHeaderDefaultsWhenFieldsMissing() {
        val ev = StreamProtocol.parseServerEvent("""{"type":"audio"}""")
        assertEquals(ServerEvent.AudioHeader("audio/wav", null), ev)
    }

    @Test
    fun parsesDone() {
        val ev = StreamProtocol.parseServerEvent(
            """{"type":"done","session_id":"s-1","elapsed_ms":412}""",
        )
        assertEquals(ServerEvent.Done("s-1", 412L), ev)
    }

    @Test
    fun parsesError() {
        val ev = StreamProtocol.parseServerEvent(
            """{"type":"error","message":"invalid or missing token"}""",
        )
        assertEquals(ServerEvent.Error("invalid or missing token"), ev)
    }

    @Test
    fun unknownTypeReturnsNull() {
        assertNull(StreamProtocol.parseServerEvent("""{"type":"heartbeat"}"""))
        assertNull(StreamProtocol.parseServerEvent("""{"no_type":true}"""))
    }

    @Test
    fun malformedInputReturnsNull() {
        assertNull(StreamProtocol.parseServerEvent("not json"))
        assertNull(StreamProtocol.parseServerEvent(""))
        assertNull(StreamProtocol.parseServerEvent("[1,2,3]"))
        assertNull(StreamProtocol.parseServerEvent("\"just a string\""))
    }

    @Test
    fun roundTripThroughOwnParserStaysStable() {
        // Frames the client emits are not server events, but the JSON layer
        // must survive a parse round-trip without altering the payload.
        val text = "quotes \" backslash \\ newline \n tab \t ずんだもん"
        val parsed = fields(StreamProtocol.textFrame(text))
        assertEquals(text, parsed["text"]!!.jsonPrimitive.content)
    }
}
