package dev.hearth.core.audio

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Minimal WAV (RIFF) writer: wraps raw PCM16 frames in a canonical 44-byte
 * header so the hub's STT layer receives a self-describing container.
 */
object WavCodec {

    /** Sample rate the Hearth client records and ships (whisper.cpp's favorite). */
    const val SAMPLE_RATE = 16_000

    /** Size of the canonical RIFF/fmt/data header this writer produces. */
    const val HEADER_BYTES = 44

    fun pcm16ToWav(
        pcm: ByteArray,
        sampleRate: Int = SAMPLE_RATE,
        channels: Int = 1,
    ): ByteArray {
        val byteRate = sampleRate * channels * 2
        val out = ByteArrayOutputStream(pcm.size + HEADER_BYTES)
        val header = ByteBuffer.allocate(HEADER_BYTES).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray(Charsets.US_ASCII))
        header.putInt(36 + pcm.size)
        header.put("WAVE".toByteArray(Charsets.US_ASCII))
        header.put("fmt ".toByteArray(Charsets.US_ASCII))
        header.putInt(16) // PCM fmt chunk size
        header.putShort(1) // audio format: linear PCM
        header.putShort(channels.toShort())
        header.putInt(sampleRate)
        header.putInt(byteRate)
        header.putShort((channels * 2).toShort()) // block align
        header.putShort(16) // bits per sample
        header.put("data".toByteArray(Charsets.US_ASCII))
        header.putInt(pcm.size)
        out.write(header.array())
        out.write(pcm)
        return out.toByteArray()
    }
}
