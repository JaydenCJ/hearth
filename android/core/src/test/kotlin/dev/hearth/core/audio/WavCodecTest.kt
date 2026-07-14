package dev.hearth.core.audio

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class WavCodecTest {

    private fun header(wav: ByteArray): ByteBuffer =
        ByteBuffer.wrap(wav, 0, WavCodec.HEADER_BYTES).order(ByteOrder.LITTLE_ENDIAN)

    private fun ascii(buf: ByteBuffer, at: Int, len: Int): String {
        val bytes = ByteArray(len)
        for (i in 0 until len) bytes[i] = buf.get(at + i)
        return String(bytes, Charsets.US_ASCII)
    }

    @Test
    fun writesCanonicalRiffMarkers() {
        val wav = WavCodec.pcm16ToWav(ByteArray(320))
        val h = header(wav)
        assertEquals("RIFF", ascii(h, 0, 4))
        assertEquals("WAVE", ascii(h, 8, 4))
        assertEquals("fmt ", ascii(h, 12, 4))
        assertEquals("data", ascii(h, 36, 4))
    }

    @Test
    fun headerSizesMatchPayload() {
        val pcm = ByteArray(1234)
        val wav = WavCodec.pcm16ToWav(pcm)
        val h = header(wav)
        assertEquals(pcm.size + WavCodec.HEADER_BYTES, wav.size)
        // RIFF chunk size = 36 + data size; data chunk size = payload size.
        assertEquals(36 + pcm.size, h.getInt(4))
        assertEquals(pcm.size, h.getInt(40))
    }

    @Test
    fun encodesDefaultFormatAs16kMonoPcm16() {
        val h = header(WavCodec.pcm16ToWav(ByteArray(64)))
        assertEquals(16, h.getInt(16)) // fmt chunk size
        assertEquals(1, h.getShort(20).toInt()) // linear PCM
        assertEquals(1, h.getShort(22).toInt()) // mono
        assertEquals(WavCodec.SAMPLE_RATE, h.getInt(24))
        assertEquals(WavCodec.SAMPLE_RATE * 2, h.getInt(28)) // byte rate
        assertEquals(2, h.getShort(32).toInt()) // block align
        assertEquals(16, h.getShort(34).toInt()) // bits per sample
    }

    @Test
    fun respectsCustomSampleRateAndChannels() {
        val h = header(WavCodec.pcm16ToWav(ByteArray(64), sampleRate = 44_100, channels = 2))
        assertEquals(44_100, h.getInt(24))
        assertEquals(2, h.getShort(22).toInt())
        assertEquals(44_100 * 2 * 2, h.getInt(28)) // byte rate
        assertEquals(4, h.getShort(32).toInt()) // block align
    }

    @Test
    fun copiesPcmPayloadVerbatim() {
        val pcm = ByteArray(100) { (it * 7).toByte() }
        val wav = WavCodec.pcm16ToWav(pcm)
        assertArrayEquals(pcm, wav.copyOfRange(WavCodec.HEADER_BYTES, wav.size))
    }

    @Test
    fun emptyPcmYieldsHeaderOnlyContainer() {
        val wav = WavCodec.pcm16ToWav(ByteArray(0))
        assertEquals(WavCodec.HEADER_BYTES, wav.size)
        assertEquals(36, header(wav).getInt(4))
        assertEquals(0, header(wav).getInt(40))
    }
}
