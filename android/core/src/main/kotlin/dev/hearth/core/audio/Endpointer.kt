package dev.hearth.core.audio

import kotlin.math.sqrt

/**
 * Small energy-based endpointer over little-endian PCM16 chunks: the
 * utterance is considered finished after [trailingSilenceMs] of quiet once
 * speech has been detected at least once.
 *
 * Stateful and single-use: create one instance per recording turn.
 */
class Endpointer(
    private val sampleRate: Int = WavCodec.SAMPLE_RATE,
    private val speechRmsThreshold: Double = DEFAULT_SPEECH_RMS_THRESHOLD,
    private val trailingSilenceMs: Int = DEFAULT_TRAILING_SILENCE_MS,
) {

    private var sawSpeech = false
    private var silentMs = 0

    /**
     * Feed the next PCM16 chunk. Returns true when the utterance should be
     * considered finished (speech was heard, then [trailingSilenceMs] of
     * silence accumulated).
     */
    fun update(pcmChunk: ByteArray): Boolean {
        val rms = rms16(pcmChunk)
        val chunkMs = pcmChunk.size / 2 * 1000 / sampleRate
        if (rms > speechRmsThreshold) {
            sawSpeech = true
            silentMs = 0
        } else if (sawSpeech) {
            silentMs += chunkMs
        }
        return sawSpeech && silentMs >= trailingSilenceMs
    }

    companion object {
        const val DEFAULT_SPEECH_RMS_THRESHOLD = 500.0
        const val DEFAULT_TRAILING_SILENCE_MS = 1200

        /** Root mean square of a little-endian PCM16 byte buffer. */
        fun rms16(bytes: ByteArray): Double {
            var sum = 0.0
            var count = 0
            var i = 0
            while (i + 1 < bytes.size) {
                val sample = ((bytes[i + 1].toInt() shl 8) or (bytes[i].toInt() and 0xFF))
                    .toShort()
                    .toInt()
                sum += 1.0 * sample * sample
                count++
                i += 2
            }
            return if (count == 0) 0.0 else sqrt(sum / count)
        }
    }
}
