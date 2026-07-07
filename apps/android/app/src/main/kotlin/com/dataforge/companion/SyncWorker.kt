package com.dataforge.companion

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.dataforge.companion.widget.AgendaWidget
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The companion's only background work: drain queued offline captures, pull
 * the agenda, reschedule exact alarms, and refresh the widgets. Runs on
 * WorkManager — a periodic pass (the 15-minute floor Android allows) plus
 * on-demand kicks after a capture or a reminder action. No always-on service;
 * the alarms, once set, fire without this running.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val url = Prefs.serverUrl(applicationContext)
        if (url.isEmpty()) return@withContext Result.success()
        val api = ForgeApi(url)
        try {
            for (body in Prefs.takeOutbox(applicationContext)) {
                if (!api.createNote(body)) {
                    Prefs.addToOutbox(applicationContext, body)
                }
            }
            val agenda = api.agenda()
            Prefs.saveAgenda(applicationContext, ForgeApi.toJson(agenda))
            AlarmScheduler.rescheduleAll(applicationContext, agenda)
            AgendaWidget.refresh(applicationContext)
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val PERIODIC = "forge-sync-periodic"
        private const val ONCE = "forge-sync-once"

        fun schedulePeriodic(ctx: Context) {
            val work = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx)
                .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, work)
        }

        fun requestSync(ctx: Context) {
            val work = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueue(work)
        }
    }
}
