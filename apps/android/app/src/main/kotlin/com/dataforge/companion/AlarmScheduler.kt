package com.dataforge.companion

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

/**
 * Schedules exact device-local alarms for upcoming reminders, so a reminder
 * fires with the laptop off and no network — the property that makes this a
 * real reminders app and not just a synced list. Reschedules wholesale on
 * each sync: cancel the known set, then set an exact alarm per future item.
 */
object AlarmScheduler {

    private fun pending(ctx: Context, item: ForgeApi.AgendaItem): PendingIntent {
        val intent = Intent(ctx, AlarmReceiver::class.java).apply {
            action = AlarmReceiver.ACTION_FIRE
            putExtra(AlarmReceiver.EXTRA_DOC, item.docId)
            putExtra(AlarmReceiver.EXTRA_INDEX, item.reminderIndex)
            putExtra(AlarmReceiver.EXTRA_TITLE, item.title)
        }
        return PendingIntent.getBroadcast(
            ctx,
            (item.docId + item.reminderIndex).hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** Schedules a single exact alarm; used for snooze (a local +delay reschedule). */
    fun scheduleOne(ctx: Context, docId: String, index: Int, title: String, atMillis: Long) {
        val item = ForgeApi.AgendaItem(docId, index, title, "", overdue = false)
        ctx.getSystemService(AlarmManager::class.java)
            .setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pending(ctx, item))
    }

    fun rescheduleAll(ctx: Context, items: List<ForgeApi.AgendaItem>) {
        val mgr = ctx.getSystemService(AlarmManager::class.java)
        val now = System.currentTimeMillis()
        for (item in items) {
            val at = parseIso(item.at) ?: continue
            val pi = pending(ctx, item)
            if (at <= now) {
                mgr.cancel(pi)
                continue
            }
            mgr.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
    }

    /** Parses an ISO-8601 instant (with offset or Z) to epoch millis. */
    fun parseIso(iso: String): Long? =
        runCatching {
            val normalized = if (iso.endsWith("Z")) iso.replace("Z", "+00:00") else iso
            java.time.OffsetDateTime.parse(normalized).toInstant().toEpochMilli()
        }.getOrNull()
}
