package dev.hearth.app.assist

import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService

/** Creates a fresh [HearthSession] per assistant invocation. */
class HearthSessionService : VoiceInteractionSessionService() {

    override fun onNewSession(args: Bundle?): VoiceInteractionSession {
        return HearthSession(this)
    }
}
