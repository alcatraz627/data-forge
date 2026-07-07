package com.dataforge.companion

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Exact alarms don't survive a reboot, so re-arm them by kicking a sync as
 * soon as the device comes back up. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            SyncWorker.schedulePeriodic(ctx)
            SyncWorker.requestSync(ctx)
        }
    }
}
