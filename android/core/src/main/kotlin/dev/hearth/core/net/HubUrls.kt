package dev.hearth.core.net

/**
 * Derives the hub endpoint URLs from the user-entered base address
 * (e.g. "http://192.168.1.10:8321"). Pure string logic, unit-tested in
 * this module.
 */
object HubUrls {

    /** Trims whitespace and trailing slashes from a user-entered base URL. */
    fun normalizeBase(raw: String): String = raw.trim().trimEnd('/')

    /**
     * ws:// or wss:// endpoint for the streaming turn, derived from the
     * http/https base. A bare "host:port" gets the plain ws:// scheme.
     */
    fun streamUrl(base: String): String {
        val b = normalizeBase(base)
        val wsBase = when {
            b.startsWith("https://") -> "wss://" + b.removePrefix("https://")
            b.startsWith("http://") -> "ws://" + b.removePrefix("http://")
            else -> "ws://$b"
        }
        return "$wsBase/v1/stream"
    }

    /** REST liveness endpoint, used by the settings screen's connection test. */
    fun healthUrl(base: String): String = normalizeBase(base) + "/v1/health"
}
