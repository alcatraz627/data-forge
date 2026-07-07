# ADR-0004: Android is Chrome PWA + a native companion APK, not a WebView shell

Status: accepted · Date: 2026-07-07

## Context

User's stated usage: "I can literally use it on android chrome + widgets."
Widgets and exact alarms require native code; a Capacitor WebView shell would
add weight without adding capability. Custom widgets have a history of slowing
down the user's Nothing Phone 2, so widget cost must be near zero.

## Decision

The installed Chrome PWA is the app. A small native Kotlin companion APK
(sideloaded, no store) provides only what the web platform cannot:

- Glance home-screen widgets: quick capture, today agenda, pinned note
- A native micro-capture activity (EditText → local outbox → POST on sync),
  no web boot
- AlarmManager exact alarms computed from synced reminders
- Notification actions (done/snooze), share target, Quick Settings tile

Hard constraints: no persistent services, no polling loops, passive
RemoteViews/Glance widgets only, WorkManager cadence ≥15 min plus on-change
updates, no animations.

## Consequences

- ~500-900 lines of Kotlin instead of a second app platform.
- The companion talks to the server API directly with its own tiny snapshot
  store; it never shares storage with the PWA.
- A tokens→Kotlin generator joins packages/tokens at M3.
- Capacitor remains a documented fallback if a real shell need ever appears.
