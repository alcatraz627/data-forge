# Android companion (lands at M3)

Native Kotlin APK, deliberately not an app shell (ADR-0004): Glance widgets
(quick capture, today agenda, pinned note), a native micro-capture activity
with an offline outbox, AlarmManager exact alarms from synced reminders,
notification actions, share target, and a Quick Settings tile.

Hard constraints: no persistent services, passive widgets only, WorkManager
cadence ≥15 min, no animations. The phone (Nothing Phone 2) must not get
slower because this exists.
