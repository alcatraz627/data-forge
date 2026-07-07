package com.dataforge.companion

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The fast path in: a bare capture box that opens straight to the keyboard, no
 * web view, no app boot. Doubles as the system share target for text. A save
 * posts to the server; if that fails it drops into the offline outbox so a
 * thought is never lost, then the screen closes. This is what makes the
 * companion beat Keep on capture speed.
 */
class CaptureActivity : Activity() {

    private val scope = CoroutineScope(Dispatchers.Main)

    // Android 13+ makes POST_NOTIFICATIONS a runtime grant that defaults to
    // denied; without it every reminder notification is silently dropped, so
    // the headline reminders feature is invisible (review H2). Ask once on
    // launch — the OS no-ops if already granted or permanently denied.
    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_capture)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
        requestNotificationPermission()

        val input = findViewById<EditText>(R.id.capture_input)
        val shared = intent?.takeIf { it.action == Intent.ACTION_SEND }
            ?.getStringExtra(Intent.EXTRA_TEXT)
        if (!shared.isNullOrBlank()) input.setText(shared)
        input.requestFocus()

        findViewById<Button>(R.id.capture_save).setOnClickListener {
            val body = input.text.toString().trim()
            if (body.isEmpty()) {
                finish()
                return@setOnClickListener
            }
            save(body)
        }
    }

    private fun save(body: String) {
        val url = Prefs.serverUrl(this)
        if (url.isEmpty()) {
            startActivity(Intent(this, SettingsActivity::class.java))
            return
        }
        scope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching { ForgeApi(url).createNote(body) }.getOrDefault(false)
            }
            if (!ok) {
                Prefs.addToOutbox(this@CaptureActivity, body)
                Toast.makeText(this@CaptureActivity, "Saved offline — will sync", Toast.LENGTH_SHORT)
                    .show()
                SyncWorker.requestSync(this@CaptureActivity)
            }
            finish()
        }
    }
}
