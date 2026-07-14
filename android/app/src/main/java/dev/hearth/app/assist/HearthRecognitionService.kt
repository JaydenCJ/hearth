package dev.hearth.app.assist

import android.content.Intent
import android.speech.RecognitionService
import android.speech.SpeechRecognizer

/**
 * The voice-interaction metadata schema requires a [RecognitionService]
 * component. Hearth does not do on-device recognition — audio is streamed to
 * the self-hosted hub, which runs whisper.cpp — so this service politely
 * declines direct SpeechRecognizer requests from third-party apps.
 */
class HearthRecognitionService : RecognitionService() {

    override fun onStartListening(recognizerIntent: Intent?, listener: Callback?) {
        // Recognition happens on the hub; direct API use is unsupported.
        // ERROR_CLIENT exists on every supported API level (minSdk 29),
        // unlike ERROR_SERVER_DISCONNECTED which was only added in API 31.
        listener?.error(SpeechRecognizer.ERROR_CLIENT)
    }

    override fun onCancel(listener: Callback?) = Unit

    override fun onStopListening(listener: Callback?) = Unit
}
