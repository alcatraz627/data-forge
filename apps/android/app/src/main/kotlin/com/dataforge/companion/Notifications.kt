package com.dataforge.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

/** Builds and posts reminder notifications with inline Done / Snooze actions.
 * The actions route back through AlarmReceiver so the whole reminder lifecycle
 * lives in one component. */
object Notifications {
    private const val CHANNEL = "reminders"

    fun ensureChannel(ctx: Context) {
        val mgr = ctx.getSystemService(NotificationManager::class.java)
        if (mgr.getNotificationChannel(CHANNEL) == null) {
            mgr.createNotificationChannel(
                NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH),
            )
        }
    }

    fun show(ctx: Context, docId: String, index: Int, title: String) {
        ensureChannel(ctx)
        val notifId = (docId + index).hashCode()

        fun action(name: String) = PendingIntent.getBroadcast(
            ctx,
            (name + docId + index).hashCode(),
            Intent(ctx, AlarmReceiver::class.java).apply {
                this.action = name
                putExtra(AlarmReceiver.EXTRA_DOC, docId)
                putExtra(AlarmReceiver.EXTRA_INDEX, index)
                putExtra(AlarmReceiver.EXTRA_TITLE, title)
                putExtra(AlarmReceiver.EXTRA_NOTIF, notifId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val open = PendingIntent.getActivity(
            ctx,
            notifId,
            Intent(ctx, CaptureActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notif = Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_forge)
            .setContentTitle(title)
            .setContentText("Reminder")
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Done", action(AlarmReceiver.ACTION_DONE)).build())
            .addAction(Notification.Action.Builder(null, "Snooze 1h", action(AlarmReceiver.ACTION_SNOOZE)).build())
            .build()

        ctx.getSystemService(NotificationManager::class.java).notify(notifId, notif)
    }

    fun cancel(ctx: Context, notifId: Int) {
        ctx.getSystemService(NotificationManager::class.java).cancel(notifId)
    }
}
