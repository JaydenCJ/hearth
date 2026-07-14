package dev.hearth.core.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EndpointerTest {

    /** Little-endian PCM16 chunk of [millis] ms at 16 kHz, constant amplitude. */
    private fun chunk(millis: Int, amplitude: Int): ByteArray {
        val samples = WavCodec.SAMPLE_RATE * millis / 1000
        val bytes = ByteArray(samples * 2)
        for (i in 0 until samples) {
            bytes[i * 2] = (amplitude and 0xFF).toByte()
            bytes[i * 2 + 1] = ((amplitude shr 8) and 0xFF).toByte()
        }
        return bytes
    }

    private val speech = chunk(100, 4000) // well above the default threshold
    private val silence = chunk(100, 10) // well below the default threshold

    @Test
    fun silenceAloneNeverEndsTheUtterance() {
        val ep = Endpointer()
        repeat(100) { assertFalse(ep.update(silence)) } // 10 s of silence
    }

    @Test
    fun endsAfterTrailingSilenceOnceSpeechWasHeard() {
        val ep = Endpointer()
        assertFalse(ep.update(speech))
        // Default trailing window is 1200 ms; chunks are 100 ms each.
        repeat(11) { assertFalse(ep.update(silence)) }
        assertTrue(ep.update(silence)) // 1200 ms of accumulated silence
    }

    @Test
    fun speechResetsTheSilenceCounter() {
        val ep = Endpointer()
        ep.update(speech)
        repeat(11) { assertFalse(ep.update(silence)) } // 1100 ms, not yet
        assertFalse(ep.update(speech)) // interruption resets the window
        repeat(11) { assertFalse(ep.update(silence)) }
        assertTrue(ep.update(silence))
    }

    @Test
    fun honorsCustomTrailingSilenceWindow() {
        val ep = Endpointer(trailingSilenceMs = 300)
        ep.update(speech)
        repeat(2) { assertFalse(ep.update(silence)) }
        assertTrue(ep.update(silence)) // 300 ms reached
    }

    @Test
    fun honorsCustomThreshold() {
        // With a very high threshold, loud audio still counts as silence.
        val ep = Endpointer(speechRmsThreshold = 30_000.0, trailingSilenceMs = 300)
        repeat(10) { assertFalse(ep.update(speech)) }
    }

    @Test
    fun emptyChunkIsSilent() {
        val ep = Endpointer()
        assertFalse(ep.update(ByteArray(0)))
        assertEquals(0.0, Endpointer.rms16(ByteArray(0)), 0.0)
    }

    @Test
    fun rmsOfConstantAmplitudeIsThatAmplitude() {
        assertEquals(4000.0, Endpointer.rms16(chunk(10, 4000)), 0.5)
        assertEquals(10.0, Endpointer.rms16(chunk(10, 10)), 0.5)
    }

    @Test
    fun rmsHandlesNegativeSamples() {
        // -1000 as little-endian PCM16: 0x18 0xFC.
        val bytes = ByteArray(200)
        for (i in 0 until 100) {
            bytes[i * 2] = 0x18
            bytes[i * 2 + 1] = 0xFC.toByte()
        }
        assertEquals(1000.0, Endpointer.rms16(bytes), 0.5)
    }
}
