package dev.hearth.app.assist

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.core.content.ContextCompat
import dev.hearth.app.MainActivity
import dev.hearth.app.R
import dev.hearth.app.audio.AudioRecorder
import dev.hearth.app.net.HearthClient
import dev.hearth.app.settings.SettingsRepository
import dev.hearth.core.audio.Endpointer
import dev.hearth.core.audio.WavCodec
import java.io.ByteArrayOutputStream
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import android.service.voice.VoiceInteractionSession

/**
 * One assistant invocation: shows a small overlay, records the utterance,
 * ships it to the self-hosted hub over WebSocket, then displays the
 * transcript + reply and plays the synthesized answer.
 *
 * Voice data goes to the configured hub and nowhere else.
 */
class HearthSession(context: Context) : VoiceInteractionSession(context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var recordingJob: Job? = null

    private lateinit var settings: SettingsRepository
    private lateinit var client: HearthClient

    private var statusView: TextView? = null
    private var transcriptView: TextView? = null
    private var replyView: TextView? = null
    private var stopButton: Button? = null

    private var turn: HearthClient.StreamingTurn? = null
    private var mediaPlayer: MediaPlayer? = null
    private var pcmBuffer: ByteArrayOutputStream? = null

    /** Ensures the utterance is shipped exactly once per turn. */
    @Volatile
    private var finished = false

    override fun onCreate() {
        super.onCreate()
        settings = SettingsRepository(context)
        client = HearthClient(settings)
    }

    override fun onCreateContentView(): View {
        val view = layoutInflater.inflate(R.layout.session_hearth, null)
        statusView = view.findViewById(R.id.session_status)
        transcriptView = view.findViewById(R.id.session_transcript)
        replyView = view.findViewById(R.id.session_reply)
        stopButton = view.findViewById(R.id.session_stop)
        stopButton?.setOnClickListener { stopRecording() }
        return view
    }

    override fun onShow(args: android.os.Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        transcriptView?.text = ""
        replyView?.text = ""
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            statusView?.setText(R.string.session_needs_permission)
            // Send the user to the app to grant RECORD_AUDIO once.
            val intent = Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            return
        }
        startTurn()
    }

    override fun onHide() {
        cancelTurn()
        super.onHide()
    }

    override fun onDestroy() {
        cancelTurn()
        scope.coroutineContext[Job]?.cancel()
        super.onDestroy()
    }

    // -- recording + streaming -------------------------------------------------

    private fun startTurn() {
        statusView?.setText(R.string.session_listening)
        val buffer = ByteArrayOutputStream()
        pcmBuffer = buffer
        finished = false
        val endpointer = Endpointer()

        turn = client.startTurn(sessionId = null, listener = TurnUiListener())

        // Buffer PCM while recording; on end-of-speech wrap it in a WAV
        // container and stream it to the hub (LAN transfer of a short
        // utterance is effectively instant).
        recordingJob = scope.launch(Dispatchers.IO) {
            try {
                AudioRecorder().stream()
                    .onEach { chunk ->
                        buffer.write(chunk)
                        if (endpointer.update(chunk) || buffer.size() > MAX_UTTERANCE_BYTES) {
                            finishRecording(buffer.toByteArray())
                            recordingJob?.cancel()
                        }
                    }
                    .collect()
            } catch (e: IllegalStateException) {
                scope.launch { showError(e.message ?: "microphone error") }
            }
        }
    }

    private fun stopRecording() {
        val buffer = pcmBuffer ?: return
        recordingJob?.cancel()
        finishRecording(buffer.toByteArray())
    }

    private fun finishRecording(pcm: ByteArray) {
        if (finished) return
        finished = true
        scope.launch {
            statusView?.setText(R.string.session_thinking)
            val activeTurn = turn ?: return@launch
            scope.launch(Dispatchers.IO) {
                val wav = WavCodec.pcm16ToWav(pcm)
                var offset = 0
                while (offset < wav.size) {
                    val end = minOf(offset + CHUNK_BYTES, wav.size)
                    activeTurn.sendAudioChunk(wav.copyOfRange(offset, end))
                    offset = end
                }
                activeTurn.finish()
            }
        }
    }

    private fun cancelTurn() {
        recordingJob?.cancel()
        recordingJob = null
        turn?.cancel()
        turn = null
        pcmBuffer = null
        mediaPlayer?.release()
        mediaPlayer = null
        scope.coroutineContext.cancelChildren()
    }

    private fun showError(message: String) {
        statusView?.text = context.getString(R.string.session_error, message)
    }

    // -- hub events --------------------------------------------------------------

    private inner class TurnUiListener : HearthClient.TurnListener {
        override fun onTranscript(text: String, lang: String?) {
            scope.launch { transcriptView?.text = text }
        }

        override fun onReply(text: String) {
            scope.launch {
                replyView?.text = text
                statusView?.setText(R.string.session_speaking)
            }
        }

        override fun onAudio(wav: ByteArray, mediaType: String) {
            scope.launch(Dispatchers.IO) {
                val file = File.createTempFile("hearth-reply", ".wav", context.cacheDir)
                file.writeBytes(wav)
                scope.launch {
                    mediaPlayer?.release()
                    mediaPlayer = MediaPlayer().apply {
                        setDataSource(file.absolutePath)
                        setOnCompletionListener {
                            file.delete()
                            statusView?.setText(R.string.session_done)
                        }
                        prepare()
                        start()
                    }
                }
            }
        }

        override fun onDone(sessionId: String) {
            scope.launch {
                if (mediaPlayer == null) statusView?.setText(R.string.session_done)
            }
        }

        override fun onError(message: String) {
            scope.launch { showError(message) }
        }
    }

    companion object {
        private const val CHUNK_BYTES = 32 * 1024
        private const val MAX_UTTERANCE_BYTES =
            AudioRecorder.SAMPLE_RATE * 2 * 30 // 30 seconds of PCM16
    }
}
