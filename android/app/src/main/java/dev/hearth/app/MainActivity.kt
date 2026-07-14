package dev.hearth.app

import android.app.role.RoleManager
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import dev.hearth.app.net.HearthClient
import dev.hearth.app.settings.SettingsRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Settings screen: hub address + token, microphone permission, and taking
 * over the device's assistant role so the assistant key opens Hearth.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var settings: SettingsRepository
    private lateinit var serverInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var roleStatus: TextView

    private val micPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val msg = if (granted) R.string.mic_granted else R.string.mic_denied
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    private val roleRequest = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { updateRoleStatus() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        settings = SettingsRepository(this)

        serverInput = findViewById(R.id.input_server_url)
        tokenInput = findViewById(R.id.input_auth_token)
        roleStatus = findViewById(R.id.text_role_status)

        serverInput.setText(settings.serverUrl)
        tokenInput.setText(settings.authToken ?: "")

        findViewById<Button>(R.id.button_save).setOnClickListener { saveSettings() }
        findViewById<Button>(R.id.button_test).setOnClickListener { testConnection() }
        findViewById<Button>(R.id.button_mic).setOnClickListener {
            micPermission.launch(android.Manifest.permission.RECORD_AUDIO)
        }
        findViewById<Button>(R.id.button_assistant_role).setOnClickListener {
            requestAssistantRole()
        }
    }

    override fun onResume() {
        super.onResume()
        updateRoleStatus()
    }

    private fun saveSettings() {
        settings.serverUrl = serverInput.text.toString()
        settings.authToken = tokenInput.text.toString()
        Toast.makeText(this, R.string.settings_saved, Toast.LENGTH_SHORT).show()
    }

    private fun testConnection() {
        saveSettings()
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { HearthClient(settings).checkHealth() }
            }
            result
                .onSuccess {
                    Toast.makeText(
                        this@MainActivity,
                        getString(R.string.connection_ok, settings.serverUrl),
                        Toast.LENGTH_LONG,
                    ).show()
                }
                .onFailure { e ->
                    Toast.makeText(
                        this@MainActivity,
                        getString(R.string.connection_failed, e.message),
                        Toast.LENGTH_LONG,
                    ).show()
                }
        }
    }

    /**
     * Take over the assistant key. [RoleManager.ROLE_ASSISTANT] cannot always
     * be granted through a runtime prompt (most OEM builds only allow picking
     * the assistant in Settings), so fall back to the system's default-
     * assistant picker when the role request is not available.
     */
    private fun requestAssistantRole() {
        val roleManager = getSystemService(RoleManager::class.java)
        if (roleManager != null &&
            roleManager.isRoleAvailable(RoleManager.ROLE_ASSISTANT) &&
            !roleManager.isRoleHeld(RoleManager.ROLE_ASSISTANT)
        ) {
            val intent = roleManager.createRequestRoleIntent(RoleManager.ROLE_ASSISTANT)
            try {
                roleRequest.launch(intent)
                return
            } catch (_: Exception) {
                // Fall through to the Settings picker below.
            }
        }
        try {
            startActivity(Intent(Settings.ACTION_VOICE_INPUT_SETTINGS))
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }

    private fun updateRoleStatus() {
        val roleManager = getSystemService(RoleManager::class.java)
        val held = roleManager?.isRoleHeld(RoleManager.ROLE_ASSISTANT) == true
        roleStatus.setText(
            if (held) R.string.role_status_held else R.string.role_status_not_held,
        )
    }
}
