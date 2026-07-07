package com.dataforge.companion.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import com.dataforge.companion.CaptureActivity
import com.dataforge.companion.ForgeApi
import com.dataforge.companion.Prefs
import com.dataforge.companion.R
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * A passive agenda widget: renders up to four upcoming reminders from the
 * last-synced snapshot stored on device. It never fetches on its own — the
 * SyncWorker refreshes the snapshot and calls refresh() — so the widget adds
 * no background cost. Tapping it opens the app.
 */
class AgendaWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        val rowIds = intArrayOf(R.id.agenda_row_0, R.id.agenda_row_1, R.id.agenda_row_2, R.id.agenda_row_3)
        val items = ForgeApi.fromJson(Prefs.agenda(ctx)).take(rowIds.size)
        val fmt = DateTimeFormatter.ofPattern("d MMM HH:mm").withZone(ZoneId.systemDefault())

        for (id in ids) {
            val views = RemoteViews(ctx.packageName, R.layout.widget_agenda)
            rowIds.forEachIndexed { i, rowId ->
                val item = items.getOrNull(i)
                if (item == null) {
                    views.setViewVisibility(rowId, View.GONE)
                } else {
                    val ms = com.dataforge.companion.AlarmScheduler.parseIso(item.at)
                    val when0 = ms?.let { fmt.format(Instant.ofEpochMilli(it)) } ?: ""
                    views.setViewVisibility(rowId, View.VISIBLE)
                    views.setTextViewText(rowId, "$when0  ${item.title}")
                    views.setTextColor(rowId, ctx.getColor(if (item.overdue) R.color.danger else R.color.text))
                }
            }
            val pi = PendingIntent.getActivity(
                ctx,
                0,
                Intent(ctx, CaptureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.agenda_root, pi)
            mgr.updateAppWidget(id, views)
        }
    }

    companion object {
        fun refresh(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, AgendaWidget::class.java))
            if (ids.isNotEmpty()) AgendaWidget().onUpdate(ctx, mgr, ids)
        }
    }
}
