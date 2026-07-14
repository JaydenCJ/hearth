package dev.hearth.app.audio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import dev.hearth.core.audio.WavCodec
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Captures microphone audio as 16 kHz mono PCM16 — the format whisper.cpp
 * likes best — and emits it as a cold [Flow] of raw PCM chunks suitable for
 * streaming over the hub WebSocket.
 */
class AudioRecorder(
    private val sampleRate: Int = SAMPLE_RATE,
    private val chunkMillis: Int = 100,
) {

    /**
     * Start recording. Collecting the returned flow starts the microphone;
     * cancelling the collection stops and releases it.
     *
     * The caller must hold the RECORD_AUDIO runtime permission; as an
     * assistant app the session is started by the system, but the permission
     * still has to be granted once from [dev.hearth.app.MainActivity].
     */
    @SuppressLint("MissingPermission") // checked by the caller
    fun stream(): Flow<ByteArray> = callbackFlow {
        val minBuffer = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        val chunkBytes = sampleRate * 2 * chunkMillis / 1000
        val record = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuffer, chunkBytes * 4),
        )
        if (record.state != AudioRecord.STATE_INITIALIZED) {
            record.release()
            close(IllegalStateException("AudioRecord failed to initialize"))
            return@callbackFlow
        }
        record.startRecording()
        val reader = launch {
            val buffer = ByteArray(chunkBytes)
            while (isActive) {
                val read = record.read(buffer, 0, buffer.size)
                if (read > 0) {
                    trySend(buffer.copyOf(read))
                } else if (read < 0) {
                    close(IllegalStateException("AudioRecord read error: $read"))
                    break
                }
            }
        }
        awaitClose {
            reader.cancel()
            runCatching { record.stop() }
            record.release()
        }
    }

    companion object {
        const val SAMPLE_RATE = WavCodec.SAMPLE_RATE
    }
}
