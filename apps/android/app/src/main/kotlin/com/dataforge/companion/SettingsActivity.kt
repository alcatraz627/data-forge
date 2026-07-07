package com.dataforge.companion

import android.app.Activity
import android.os.Bundle
import android.widget.Button
import android.widget.EditText

/** One setting: where the server lives (a tailnet https URL). Set once. */
class SettingsActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        val field = findViewById<EditText>(R.id.settings_url)
        field.setText(Prefs.serverUrl(this))
        findViewById<Button>(R.id.settings_save).setOnClickListener {
            Prefs.setServerUrl(this, field.text.toString())
            SyncWorker.requestSync(this)
            finish()
        }
    }
}
