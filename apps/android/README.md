# Android companion

A small native Kotlin app (not a WebView shell, ADR-0004) that adds what the
Chrome PWA can't: home-screen widgets, a native micro-capture screen, a system
share target, and exact-alarm reminders that fire with the laptop off and no
network. It holds no database — only a thin mirror of what the server owns.

Design constraints (so it never slows the phone down): passive RemoteViews
widgets, no persistent services, WorkManager on the 15-minute floor plus
on-demand kicks, exact alarms via `AlarmManager`. APK is ~2.5 MB.

## What's inside

- `CaptureActivity` — the fast path in: opens straight to the keyboard, no web
  boot; also the text share target. Saves post to the server, or drop into an
  offline outbox and sync later.
- `SyncWorker` — the only background work: drain the outbox, pull `/api/agenda`,
  reschedule exact alarms, refresh widgets.
- `AlarmScheduler` + `AlarmReceiver` + `Notifications` — device-local exact
  alarms; the notification carries Done / Snooze, which talk to the server.
- `BootReceiver` — re-arms alarms after a reboot.
- `widget/CaptureWidget` (2x2 quick capture) + `widget/AgendaWidget` (upcoming
  reminders from the last-synced snapshot).

## Build

Requires a JDK 17 and the Android SDK (see `docs/android-toolchain.md` for the
contained Homebrew setup). Then:

```bash
make apk            # from the repo root -> app/build/outputs/apk/debug/app-debug.apk
# or directly:
cd apps/android && JAVA_HOME=$(brew --prefix openjdk@17) ./gradlew assembleDebug
```

`local.properties` (gitignored) points Gradle at the SDK; create it with
`sdk.dir=/opt/homebrew/share/android-commandlinetools` if missing.

## Install on your phone

Enable "install unknown apps" for your file manager, transfer the APK, tap it.
On first launch, open settings and set the server URL to your ts.net address,
then add the widgets from the home-screen widget picker. Grant the notification
permission when prompted so reminders can alert.

Status: compiles + packages (verified). Runtime is verified on-device — there's
no emulator in the build environment.
