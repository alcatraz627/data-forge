package com.dataforge.companion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlin.concurrent.thread

/**
 * The single home of the reminder lifecycle. Handles three broadcasts:
 * FIRE (an exact alarm went off) posts the notification; DONE and SNOOZE come
 * from the notification's action buttons and talk to the server. Network work
 * runs on a short-lived thread inside goAsync() — a single fast call, well
 * within the broadcast window, and no lingering service.
 */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(ctx: Context, intent: Intent) {
        val docId = intent.getStringExtra(EXTRA_DOC) ?: return
        val index = intent.getIntExtra(EXTRA_INDEX, -1)
        if (index < 0) return

        when (intent.action) {
            ACTION_FIRE -> {
                val title = intent.getStringExtra(EXTRA_TITLE) ?: "Reminder"
                Notifications.show(ctx, docId, index, title)
            }

            ACTION_DONE -> {
                Notifications.cancel(ctx, intent.getIntExtra(EXTRA_NOTIF, 0))
                runAsync(ctx) { url -> ForgeApi(url).completeReminder(docId, index) }
            }

            ACTION_SNOOZE -> {
                Notifications.cancel(ctx, intent.getIntExtra(EXTRA_NOTIF, 0))
                // A snooze is a local reschedule +1h; the server keeps the
                // reminder active, so the next sync leaves it in the agenda.
                val title = intent.getStringExtra(EXTRA_TITLE) ?: "Reminder"
                AlarmScheduler.scheduleOne(
                    ctx, docId, index, title, System.currentTimeMillis() + 3_600_000L,
                )
            }
        }
    }

    private fun runAsync(ctx: Context, block: (String) -> Unit) {
        val url = Prefs.serverUrl(ctx)
        if (url.isEmpty()) return
        val pending = goAsync()
        thread {
            try {
                block(url)
                SyncWorker.requestSync(ctx)
            } catch (_: Exception) {
                // best effort; the next periodic sync will retry state
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_FIRE = "com.dataforge.companion.FIRE"
        const val ACTION_DONE = "com.dataforge.companion.DONE"
        const val ACTION_SNOOZE = "com.dataforge.companion.SNOOZE"
        const val EXTRA_DOC = "doc"
        const val EXTRA_INDEX = "index"
        const val EXTRA_TITLE = "title"
        const val EXTRA_NOTIF = "notif"
    }
}
