package dev.hearth.app.assist

import android.service.voice.VoiceInteractionService

/**
 * Bound by the system while Hearth holds the assistant role. The interesting
 * work happens in [HearthSession], which the system requests through
 * [HearthSessionService] whenever the user long-presses power / home, uses
 * the assistant gesture, or presses a dedicated assistant key.
 */
class HearthVoiceInteractionService : VoiceInteractionService()
