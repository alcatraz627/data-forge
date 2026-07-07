package com.dataforge.companion.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.dataforge.companion.CaptureActivity
import com.dataforge.companion.R
import com.dataforge.companion.SyncWorker

/**
 * A passive 2x2 home-screen widget that opens the native capture screen on
 * tap. It draws a static button — no data, no service, no polling — so it
 * costs the phone nothing to keep on the home screen. A tap reaches the
 * keyboard in a few hundred ms, which is the whole point.
 */
class CaptureWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        // First placement is a good moment to make sure background sync is armed.
        SyncWorker.schedulePeriodic(ctx)
        for (id in ids) {
            val views = RemoteViews(ctx.packageName, R.layout.widget_capture)
            val pi = PendingIntent.getActivity(
                ctx,
                0,
                Intent(ctx, CaptureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_root, pi)
            mgr.updateAppWidget(id, views)
        }
    }

    companion object {
        fun refresh(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, CaptureWidget::class.java))
            if (ids.isNotEmpty()) CaptureWidget().onUpdate(ctx, mgr, ids)
        }
    }
}
