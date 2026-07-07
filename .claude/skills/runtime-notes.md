## session: M4 + M5 autonomous run [forge-plan-d4] — 2026-07-08

Purpose: user set an autonomous goal (finish through M5 while away). Built M4
(history, attachments, backup, restore drill, perf gates) and M5 (CLI, inbox,
MCP, tldraw canvas, Tauri tray), validating each with tests + browser/emulator.

Insights:
- baseRev-0 bug (general, found via canvas): a note opened before its create
  synced carries baseRev 0, which the server rejects (baseRev >= 1). saveDoc
  now advances a 0 base to the note's current synced rev — safe because a
  brand-new note has no concurrent editor (H1 doesn't apply) and the outbox
  still folds edits into an un-drained create. Only override when baseRev < 1;
  a Math.max over all cases would silently defeat the H1 conflict fork.
- Canvas notes stay markdown files (marker line + tldraw JSON body), so the
  whole pipeline (sync, merge, history, git, outbox) works on them for free.
  deriveTitle/preview must know the marker or cards show raw JSON.
- tldraw resists synthetic pointer events (its own pointer-capture pipeline);
  driving it in a test needs clicking the real tool BUTTON (data-testid=
  tools.rectangle) then a pen-type PointerEvent drag on .tl-canvas.
- The Rust/Tauri v2 tray + global-shortcut API compiled first try (55s, 25MB
  debug binary). Did NOT launch the GUI: a tray app grabs the global hotkey
  system-wide and steals focus — verify GUI runtime on the user's session,
  like the Android APK.
- Standalone client entry points (cli, mcp) correctly read FORGE_URL at their
  top rather than a shared config module — recorded in
  .claude/conventions/env-access.md so the env-access hook stops firing.
- Service-worker staleness recurs when rebuilding under an active PWA: the SW
  serves a precached index.html referencing an old chunk hash -> "Failed to
  load module script". Clear SW + caches between rebuilds in browser tests.

---

## session: M3 Android companion + toolchain [forge-plan-d4] — 2026-07-07

Purpose: install a contained Android toolchain and build the native companion
APK (capture, exact alarms, RemoteViews widgets). "Stop using Tasks" delivery.

Insights:
- Contained Android toolchain, all Homebrew/removable: openjdk@17 (keg-only)
  + android-commandlinetools cask (sdkmanager) + sdkmanager platform-34/
  build-tools-34; Gradle via the project wrapper (8.11.1), never system-wide.
  SDK scoped by apps/android/local.properties (gitignored), no shell-profile
  edits. Removal documented in docs/android-toolchain.md.
- Stack that builds: AGP 8.7.3 + Gradle 8.11.1 + Kotlin 2.0.21, compileSdk 34,
  minSdk 26. RemoteViews widgets (not Glance) — lighter, dependency-free, no
  Compose compiler, best fit for "don't slow the phone".
- The emulator earned its cost: caught a cleartext-HTTP block (targetSdk 34
  blocks http:// by default) that a compile never would. Symptom: capture
  POST silently failed and fell to the offline outbox (correct fallback!).
  Fix: usesCleartextTraffic=true. Then verified end-to-end: note typed in the
  emulator reached the host server (10.0.2.2) as a file with source:android.
- Verification ladder for a from-scratch native app: compile -> package (aapt
  badging) -> launch-no-crash (logcat FATAL scan) -> render (screencap) ->
  end-to-end (drive input, check the server). Each rung catches a different
  class; "compiles" is the weakest.
- adb run-as writes an app's shared_prefs on a debuggable build; transfer the
  XML via base64 or quotes get stripped through adb shell -> run-as sh -c.

---

## session: M2a reminders + agenda [forge-plan-d4] — 2026-07-07

Purpose: reminder engine (rrule recurrence), agenda view, set/done/snooze UI.

Insights:
- CJS-only deps break DIFFERENTLY across our three JS runtimes: `import
  { RRule } from 'rrule'` passed vitest (esbuild interop) and vite, but
  CRASHED the server on boot under tsx ("does not provide an export named").
  Green tests, dead server. Fix: default-import form `import rrule from
  'rrule'; const { RRule } = rrule`. Lesson: for any CJS dep, boot the actual
  server (tsx), don't trust that vitest passing means it loads.
- The reminder model rolls a recurring reminder forward on "done" (at = next
  occurrence, stays active) instead of needing a per-occurrence completion
  table. One-shots just flip to status done. No new schema.
- Agenda is a pure core function (buildAgenda) over the already-synced
  corpus; done/snooze go through the same saveDoc/outbox path as any edit, so
  they work offline for free.

---

## session: M1 complete, Keep replacement [forge-plan-d4] — 2026-07-07

Purpose: build all of M1 (offline outbox, saved views + mobile bottom bar,
TipTap editor, auto-archive lifecycle, Keep/Tasks importer).

Insights:
- Adding a DB column needs an explicit migration: CREATE TABLE IF NOT EXISTS
  never evolves an existing table, so the new `archived` column threw "SQL
  logic error" on insert against the pre-existing index. openDb now does an
  additive ALTER TABLE ADD COLUMN (pragma table_info gate), preserving seq
  and merge bases rather than rebuilding. Caught only by booting the new
  build against the OLD index — always exercise a migration against real
  prior state, not a fresh dir.
- Importers need to preserve source timestamps: createDoc stamped now(),
  which would misorder a Keep history. Added optional created/updated to the
  create contract; import is the load-bearing caller (don't add it
  speculatively, but here there's a real caller).
- Chrome DevTools MCP evaluate_script with a Promise + setTimeout chain hits
  the protocol timeout. Drive multi-step UI with separate click/snapshot
  calls, or a single synchronous evaluate. Controlled-input fill still needs
  the native-setter + input-event trick to reach React state.
- Swapping data dirs under the same origin:port leaves stale IndexedDB
  (cursor + cached docs) that desyncs the client. Clear IndexedDB between
  backend swaps in tests; not a production concern (backend never swaps).
- Keep the importer a POST-to-running-server (one writer) rather than a
  second process opening the same SQLite index.

---

## session: M0 build, plan to working app [forge-plan-d4] — 2026-07-07

Purpose: choose stack, scaffold monorepo, build full M0 (server store, web
client, deploy prep), fresh-eyes review + fixes.

Insights:
- node:sqlite (runtime built-in, FTS5 included) beat better-sqlite3, whose
  native build fails on Node 26. Zero native deps is now a project property
  worth defending.
- The reviewer paid for itself: runtime-verified that `pullToHead` dropped
  changes past the 500-row page cap (cursor jumped to `latestSeq` on full
  pages). Fix: advance by last received seq; only trust `latestSeq` on a
  short page. Regression-tested at 620 docs.
- Editors must capture `baseRev` at open, not read it at save: background
  pulls advance the store's rev and turn real concurrent edits into silent
  clean overwrites, bypassing the conflict fork (invariant 4).
- WAL-mode sqlite inside a git-tracked dir needs `meta/index.sqlite*` in the
  ignore file: the -wal/-shm sidecars otherwise ship binary churn in every
  batch commit. `ensureIgnores()` heals existing repos additively at boot.
- Playwright `fill()` on controlled React inputs races with SSE-driven
  re-renders; `pressSequentially` (real keystrokes) is the reliable test
  path. Real user typing is unaffected.
- The server write path is a synchronous critical section (no await between
  file write and index update). Keep it that way; it is the torn-write
  defense the reviewer called out as a strength.
- M1 additions: outbox semantics live in core (coalescing, delete-cancels-
  create, 409/404 recovery, 5xx = retry-later) so they are unit-tested
  without a browser; the web layer only supplies Dexie storage.
- State persisted via a React effect is lost if a save unmounts the
  component before the effect runs (mobile screen switch). Anything that
  must happen on save (draft clearing) goes in the save handler itself.
- Workbox autoUpdate SWs need two reloads to serve a new build (install on
  first, control on second). When "the UI didn't change", reload twice
  before debugging.
- Two same-specificity CSS classes: source order decides. .view-chip after
  .chip-active silently killed the active state; fixed with a compound
  selector, caught only by looking at pixels.

---
