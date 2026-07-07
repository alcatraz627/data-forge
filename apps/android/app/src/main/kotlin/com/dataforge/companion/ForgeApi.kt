package com.dataforge.companion

import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONArray
import org.json.JSONObject

/**
 * The companion's talk to forge-server, over plain HttpURLConnection so the
 * app carries no HTTP dependency. Every call is blocking and must run off the
 * main thread (callers use coroutines / WorkManager). Returns simple results;
 * network failures surface as thrown exceptions the caller decides on.
 */
class ForgeApi(private val baseUrl: String) {

    data class AgendaItem(
        val docId: String,
        val reminderIndex: Int,
        val title: String,
        val at: String,
        val overdue: Boolean,
    )

    private fun open(path: String, method: String): HttpURLConnection {
        val conn = URL("$baseUrl$path").openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = 8000
        conn.readTimeout = 8000
        return conn
    }

    private fun HttpURLConnection.body(): String =
        (if (responseCode in 200..299) inputStream else errorStream)
            .bufferedReader()
            .use(BufferedReader::readText)

    fun createNote(body: String, source: String = "android"): Boolean {
        val conn = open("/api/docs", "POST")
        conn.doOutput = true
        conn.setRequestProperty("content-type", "application/json")
        val payload = JSONObject().put("body", body).put("source", source)
        conn.outputStream.use { it.write(payload.toString().toByteArray()) }
        return conn.responseCode in 200..299
    }

    fun agenda(): List<AgendaItem> {
        val conn = open("/api/agenda", "GET")
        val entries = JSONObject(conn.body()).getJSONArray("entries")
        val out = ArrayList<AgendaItem>(entries.length())
        for (i in 0 until entries.length()) {
            val e = entries.getJSONObject(i)
            out.add(
                AgendaItem(
                    docId = e.getString("docId"),
                    reminderIndex = e.getInt("reminderIndex"),
                    title = e.getString("title"),
                    at = e.getString("at"),
                    overdue = e.getBoolean("overdue"),
                ),
            )
        }
        return out
    }

    fun completeReminder(docId: String, index: Int): Boolean {
        val conn = open("/api/reminders/complete?doc=$docId&index=$index", "POST")
        return conn.responseCode in 200..299
    }

    fun snoozeReminder(docId: String, index: Int, untilIso: String): Boolean {
        val until = java.net.URLEncoder.encode(untilIso, "UTF-8")
        val conn = open("/api/reminders/snooze?doc=$docId&index=$index&until=$until", "POST")
        return conn.responseCode in 200..299
    }

    companion object {
        /** Serializes agenda items to the JSON the widget snapshot stores. */
        fun toJson(items: List<AgendaItem>): String {
            val arr = JSONArray()
            for (it in items) {
                arr.put(
                    JSONObject()
                        .put("docId", it.docId)
                        .put("reminderIndex", it.reminderIndex)
                        .put("title", it.title)
                        .put("at", it.at)
                        .put("overdue", it.overdue),
                )
            }
            return arr.toString()
        }

        fun fromJson(json: String): List<AgendaItem> {
            val arr = JSONArray(json)
            val out = ArrayList<AgendaItem>(arr.length())
            for (i in 0 until arr.length()) {
                val e = arr.getJSONObject(i)
                out.add(
                    AgendaItem(
                        e.getString("docId"),
                        e.getInt("reminderIndex"),
                        e.getString("title"),
                        e.getString("at"),
                        e.getBoolean("overdue"),
                    ),
                )
            }
            return out
        }
    }
}
