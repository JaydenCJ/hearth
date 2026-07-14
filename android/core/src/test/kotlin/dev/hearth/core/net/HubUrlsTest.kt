package dev.hearth.core.net

import org.junit.Assert.assertEquals
import org.junit.Test

class HubUrlsTest {

    @Test
    fun httpBaseYieldsWsStream() {
        assertEquals(
            "ws://192.168.1.10:8321/v1/stream",
            HubUrls.streamUrl("http://192.168.1.10:8321"),
        )
    }

    @Test
    fun httpsBaseYieldsWssStream() {
        assertEquals(
            "wss://hearth.home.lan/v1/stream",
            HubUrls.streamUrl("https://hearth.home.lan"),
        )
    }

    @Test
    fun bareHostGetsPlainWsScheme() {
        assertEquals("ws://hub.local:8321/v1/stream", HubUrls.streamUrl("hub.local:8321"))
    }

    @Test
    fun trailingSlashesAndWhitespaceAreTrimmed() {
        assertEquals(
            "ws://10.0.0.2:8321/v1/stream",
            HubUrls.streamUrl("  http://10.0.0.2:8321/  "),
        )
        assertEquals("http://10.0.0.2:8321", HubUrls.normalizeBase(" http://10.0.0.2:8321// "))
    }

    @Test
    fun healthUrlAppendsRestPath() {
        assertEquals(
            "http://192.168.1.10:8321/v1/health",
            HubUrls.healthUrl("http://192.168.1.10:8321/"),
        )
    }
}
