package dev.hearth.app.settings

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import dev.hearth.core.net.HubUrls

/**
 * Persists the hub connection settings (server URL, optional bearer token,
 * preferred language tag). Backed by [SharedPreferences]; small enough that
 * DataStore would be overkill.
 */
class SettingsRepository(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        set(value) = prefs.edit { putString(KEY_SERVER_URL, HubUrls.normalizeBase(value)) }

    var authToken: String?
        get() = prefs.getString(KEY_AUTH_TOKEN, null)?.takeIf { it.isNotBlank() }
        set(value) = prefs.edit { putString(KEY_AUTH_TOKEN, value?.trim()) }

    /** BCP-47 language hint sent to the hub, or null for auto-detection. */
    var languageHint: String?
        get() = prefs.getString(KEY_LANGUAGE, null)?.takeIf { it.isNotBlank() }
        set(value) = prefs.edit { putString(KEY_LANGUAGE, value?.trim()) }

    /** ws:// or wss:// endpoint derived from the configured base URL. */
    fun streamUrl(): String = HubUrls.streamUrl(serverUrl)

    fun healthUrl(): String = HubUrls.healthUrl(serverUrl)

    companion object {
        private const val PREFS_NAME = "hearth_settings"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_AUTH_TOKEN = "auth_token"
        private const val KEY_LANGUAGE = "language_hint"
        const val DEFAULT_SERVER_URL = "http://192.168.1.10:8321"
    }
}
