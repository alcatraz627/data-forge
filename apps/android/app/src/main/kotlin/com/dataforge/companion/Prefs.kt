package com.dataforge.companion

import android.content.Context
import org.json.JSONArray

/**
 * Local, on-device state for the companion: the server URL, a small offline
 * outbox of captures the server hasn't accepted yet, and the last-synced
 * agenda snapshot the widget renders. Deliberately tiny and synchronous —
 * this app holds no database, only a mirror of what the server owns.
 */
object Prefs {
    private const val FILE = "forge"
    private const val KEY_URL = "server_url"
    private const val KEY_OUTBOX = "outbox"
    private const val KEY_AGENDA = "agenda_snapshot"

    private fun sp(ctx: Context) = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun serverUrl(ctx: Context): String =
        sp(ctx).getString(KEY_URL, "")?.trimEnd('/') ?: ""

    fun setServerUrl(ctx: Context, url: String) {
        sp(ctx).edit().putString(KEY_URL, url.trim().trimEnd('/')).apply()
    }

    /** Queue a capture that couldn't be sent (offline). Drained on next sync. */
    fun addToOutbox(ctx: Context, body: String) {
        val arr = JSONArray(sp(ctx).getString(KEY_OUTBOX, "[]"))
        arr.put(body)
        sp(ctx).edit().putString(KEY_OUTBOX, arr.toString()).apply()
    }

    fun takeOutbox(ctx: Context): List<String> {
        val arr = JSONArray(sp(ctx).getString(KEY_OUTBOX, "[]"))
        val out = ArrayList<String>(arr.length())
        for (i in 0 until arr.length()) out.add(arr.getString(i))
        sp(ctx).edit().putString(KEY_OUTBOX, "[]").apply()
        return out
    }

    fun saveAgenda(ctx: Context, json: String) {
        sp(ctx).edit().putString(KEY_AGENDA, json).apply()
    }

    fun agenda(ctx: Context): String = sp(ctx).getString(KEY_AGENDA, "[]") ?: "[]"
}
