# Data Forge — plan of record

Personal notes, reminders, and data-transmission system for one user across
Android + Mac + web. This document is the architecture and product plan agents
work from. Update it when the architecture changes; record locked decisions as
ADRs in docs/adr/ instead of re-debating them.

Last updated: 2026-07-07 (scaffold session).

## 1. Product intent and hard constraints

Replace Google Keep + Google Tasks with something as fast and reliable, but
richer in notetaking and far more powerful in reminders, extensible by agents,
and free of ecosystem lock-in.

The requirements collapse into five constraints that drive everything:

1. **Web is a must, snappy is a must.** The app is local-first: every read and
   write hits a local store; sync is background. No spinner-driven UI.
2. **Android widgets and exact reminders** cannot be done by a PWA. Some
   native Android code is required, kept small (a companion APK, not a shell).
3. **Agents build it.** Boring, massively documented tech: TypeScript, React,
   SQLite, git.
4. **Agents will read/write the data.** Data at rest is plain markdown files,
   not rows in a proprietary store. Lock-in insurance.
5. **Abandonment risk is real.** Every milestone ends daily-drivable; no
   milestone gold-plates one capability while others rot.

Non-goals for now: multi-user/collaboration, end-to-end encryption, app-store
publishing, iOS.

## 2. Decision log

| Date | Decision | Outcome |
|---|---|---|
| 2026-07-07 | Backup remote | Private GitHub repo (`data-forge-data`). Code repo is separate and public by default. |
| 2026-07-07 | Code/data repo split | Separate repos. Sync auto-commits (~60s cadence) would drown code history; privacy differs. ADR-0005. |
| 2026-07-07 | Editor | TipTap as first implementation, locked behind a `NoteEditor` abstraction (markdown in/out) so it is swappable. ADR-0003. |
| 2026-07-07 | Android approach | No WebView shell. Chrome PWA is the app; a native **companion APK** ships widgets + exact alarms + micro-capture. Must not slow down a Nothing Phone 2: no persistent services, passive widgets only. ADR-0004. |
| 2026-07-07 | Security posture | Tailnet is the boundary; simple bearer token as defense in depth. No git-crypt for now. |
| 2026-07-07 | Sync model | Server-side git + rev/seq HTTP protocol + three-way merge. No CRDTs. ADR-0002. |

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript end-to-end (+ ~500-900 lines Kotlin at M3, a SwiftBar script at M2) | One language; types shared client/server |
| Web app | React 19 + Vite + Tailwind-free vanilla CSS on design tokens (Radix primitives when needed) | Boring, fast, best agent fluency |
| Client store | IndexedDB via Dexie + outbox queue; MiniSearch for local full-text | Full corpus cached locally: instant everything, true offline |
| Editor | TipTap (WYSIWYG) serializing to markdown; raw-markdown mode via CodeMirror 6 | Rich but snappy; markdown stays canonical |
| Server | Node 22 + Hono, better-sqlite3 (FTS5), system git via child process, chokidar watcher, SSE | Tiny, portable, one process |
| Canonical storage | git repo of markdown files with YAML frontmatter at `~/DataForge` | History, diffs, backup, agent-greppable |
| Android | Native companion APK: Jetpack Glance widgets, AlarmManager exact alarms, share target, QS tile | Web can't reach these; keep the native surface minimal |
| macOS | SwiftBar plugin first; Tauri tray app (global hotkey, loads web `/capture`) later | Day-one menu bar for ~50 lines |
| Hosting | This laptop: launchd service + `tailscale serve` HTTPS (ts.net cert) | Secure context for PWA/service worker with zero certificates work |
| Backup | Server auto-commits; periodic push to private GitHub remote | Offsite history for free |

Rejected (do not relitigate without new evidence):

| Option | Why not |
|---|---|
| Flutter / React Native | Second-class web output; widgets still need Kotlin anyway |
| Full native Android app | Doubles UI work forever; violates constraint 5 |
| Capacitor WebView shell | User's usage is Chrome PWA + widgets; shell adds weight for nothing. Revisit only if a real shell need appears |
| Electron (Mac) | 200MB for a menu bar; SwiftBar/Tauri do it in ~5MB |
| CRDTs (Yjs/Automerge) day one | Solves collaboration we don't have; opaque blobs hurt agent-readable files |
| PouchDB/CouchDB | Sync for free but data becomes couch docs; kills the files+git story |
| Supabase/PocketBase | DB-as-truth kills the file story; extra moving parts for one user |
| git on clients (isomorphic-git) | Slow/complex on Android+web; unnecessary once the server mediates |

## 4. Architecture

```
┌─────────────── clients (all render the SAME React PWA) ─────────────────┐
│                                                                         │
│  Android Chrome (installed PWA)   Mac browser / PWA       Menu bar      │
│  + companion APK (native):        └─ same app + ⌘K        (SwiftBar     │
│    Glance widgets, micro-capture,                          → Tauri)     │
│    AlarmManager exact alarms,                              agenda +     │
│    share target, QS tile          ┌──────────────────┐    capture      │
│  └─ IndexedDB cache + outbox      │ every client:    │                  │
│                                   │ local-first R/W  │                  │
└───────────────────────────┬───────┴──────────────────┴──────────────────┘
                            │  HTTPS via Tailscale (ts.net cert)
                            │  pull:  GET /api/changes?since=seq
                            │  push:  PUT /api/docs/:id {baseRev,…}
                            │  nudge: SSE /api/events
┌───────────────────────────▼──────────────────────────────────────────────┐
│ forge-server (Node/TS + Hono), launchd service on the Mac                │
│  ├─ canonical truth: git repo of markdown files   ~/DataForge/           │
│  ├─ derived index:  SQLite + FTS5 (gitignored, rebuildable)              │
│  ├─ merge engine:   per-note three-way merge (git merge-file)            │
│  ├─ change feed:    monotonic seq per write → drives client pulls        │
│  ├─ file watcher:   external edits (Claude Code!) → reindex → feed       │
│  └─ jobs: debounced git commit, periodic push to private remote          │
└───────────────────────────────────────────────────────────────────────────┘
```

Key properties:

- Every client interaction is local; a background sync engine drains the
  outbox and applies pulled changes. Capture-to-saved is one IndexedDB write.
- The server is the only git user. Clients speak the small HTTP protocol.
- External edits are first-class: the watcher folds direct file changes into
  the change feed. The server must suppress watcher events for its own writes
  (quiet-period marker) or it will loop.
- Files are the write model, SQLite the read model. `forge reindex` rebuilds
  the index from files at any time; index corruption is never data loss.

## 5. Data model

Data lives in its own repo (ADR-0005):

```
~/DataForge/                     ← its own git repo, private remote
  notes/2026/07/01J1QG8Z3W.md    ← ULID filenames (time-sortable, never renamed)
  boards/….tldr.json             ← canvas docs (M5)
  attachments/<sha256>.<ext>     ← images/files, content-addressed (M4)
  meta/
    settings.json                ← saved views, axis defaults (synced via git)
    index.sqlite                 ← gitignored, derived
```

A note file:

```markdown
---
id: 01J1QG8Z3W
created: 2026-07-07T09:12:03+05:30
updated: 2026-07-07T09:14:22+05:30
durability: ephemeral        # ephemeral | working | durable | permanent
formality: scratch           # scratch | draft | polished
importance: normal           # low | normal | high | critical
pinned: false
reminders:
  - at: 2026-07-08T09:00:00+05:30
    rrule: FREQ=WEEKLY;BYDAY=TU   # optional
    status: active                 # active | done | snoozed
source: android-widget       # web | menubar | api:claude | import:keep …
---
Buy the HDMI adapter before Thursday's demo
```

Decisions inside the model:

- **Title is derived** (first heading or first line), never stored. No
  title/filename sync bugs; capture requires zero naming.
- **Axes replace folders/tags.** Discrete steps only (one tap on a phone):

| Axis | Steps | Capture default | Drives |
|---|---|---|---|
| durability | ephemeral → working → durable → permanent | ephemeral | lifecycle: stale ephemerals auto-archive after 30 days |
| formality | scratch → draft → polished | scratch | rendering + edit affordances |
| importance | low → normal → high → critical | normal | sort boost, agenda surfacing, notification loudness |
| form | line / note / doc / canvas | derived from content | which editor opens, card size |

- **Saved views are the navigation**, stored in `meta/settings.json` so they
  sync: Now (importance ≥ high, durability ≤ working), Scratchpad (ephemeral),
  Reference (durable + polished), Transfer (recent cross-device drops),
  Conflicts, All.
- **Auto-archive is a feature, not cleanup.** Capture defaults to
  ephemeral/scratch; untouched ephemerals archive (never delete) after 30
  days. The inbox self-cleans; promotion along durability is the deliberate
  filing act.
- **Data transmission is a flow, not a module**: one-tap copy on every card,
  Android share-sheet in, Transfer view, `forge cp` CLI later.
- A task/reminder is just a doc with reminder metadata. One entity type, one
  sync path, one index.

## 6. Sync protocol

Per-doc `rev` (server-assigned), global monotonic `seq`. Client state:
`lastSeq`, per-doc `baseRev`, outbox of local edits.

```
push: PUT /api/docs/:id {baseRev, content}
        baseRev == head?  ──yes──▶ commit, return {rev}
              │no
              ▼
        git merge-file (base, client, head)
              ├─ clean  ─▶ commit merged, return {rev, merged: true}
              └─ dirty  ─▶ commit client copy as sibling file
                           01J1QG8Z3W.conflict-pixel-0707.md
                           → shows in the Conflicts view. Nothing is lost.
```

- Pull: `GET /api/changes?since=<seq>` returns changed docs + tombstones.
- Nudge: SSE `/api/events` says "something changed"; clients pull.
- Deletes: tombstone in the feed + `git rm` (history keeps the body).
- Frontmatter conflicts merge per-field by timestamp; only body conflicts
  fork sibling files. Expected conflict rate for one human: ~zero. The
  machinery exists so the rare case never destroys data.
- The frontmatter serializer must be **roundtrip-stable** (stable key order,
  no gratuitous reformatting) or sync churns git history with noise. Contract
  test required.

Why no CRDTs: one user means one concurrent editor in practice; rev-check +
server-side three-way merge + never-destructive fallback gets ~100% of the
value at ~5% of the complexity. If live co-editing ever matters, Yjs becomes
another doc body format without touching this protocol.

## 7. Reminders

- Data: `at` + optional RRULE in frontmatter (rrule.js on all ends).
  Timestamps carry explicit offsets; recurrence expands in local TZ.
- **Delivery is device-local with zero server dependency.** On every sync the
  companion APK recomputes the next ~20 occurrences and schedules them via
  `AlarmManager.setExactAndAllowWhileIdle`. Laptop asleep, network down:
  reminders still fire.
- Interim (M2, before the APK): web push to Android Chrome + agenda view +
  SwiftBar on Mac.
- Notification actions: Done / Snooze (1h, tonight, tomorrow) / Open. Actions
  write to the outbox and sync back.
- Per-device "fires reminders" toggle; default phone on, Mac off (menu bar
  shows the agenda silently).
- Sideloading means `SCHEDULE_EXACT_ALARM` is a one-time settings grant, no
  Play policy constraints.
- Missed-while-off reminders reconcile into a past-due section on open.

## 8. UI design

One design language, dark default, dense but calm: system font stack, 8px
spacing grid, small radii, one ember-orange accent, motion limited to 120ms.
Cards show title, one-line preview, tiny axis glyphs, age. Density ~10
cards/screen mobile, ~20 desktop.

**Token pipeline**: `packages/tokens/tokens.json` is the single source.
Compiled to CSS variables (web, so also the Tauri popover), `Tokens.kt`
(Glance widgets, at M3), `tokens.swift` if ever needed. Only one real UI
exists (the React app); the surfaces that can't run CSS consume the same
tokens compiled to constants.

**Mobile (Android Chrome PWA)**, thumb-first:

```
┌────────────────────────┐
│ view: Now ▾      ⋯     │  ← chrome collapses on scroll
│ ┌────────────────────┐ │
│ │ card · title       │ │    swipe → archive/done
│ │ preview · ●●○ · 2h │ │    swipe ← remind…
│ ├────────────────────┤ │    long-press: pin/promote/copy
│ │ card               │ │
│ └────────────────────┘ │
│ ┌────────────────────┐ │
│ │ ⌂    🔍   ➕   ⏰   ≡ │ │  ← bottom tab bar, capture center
└─┴────────────────────┴─┘
```

Capture screen: keyboard auto-opens, body field first, axis chips directly
above the keyboard, drafts persist if backgrounded mid-thought. Voice via the
keyboard mic.

**Android widgets (companion APK, M3)**:

- 2x2 quick capture → opens a tiny native activity (EditText → native outbox
  file → POST on sync). Tap-to-typing ~300ms, no web boot. This is the
  beat-Keep-on-speed move.
- 4x2 Today agenda (tap-to-complete later), pinned-note widget, QS tile.
- Perf constraints (Nothing Phone 2): passive RemoteViews/Glance only, no
  persistent services, no animations, WorkManager ≥15min + on-change pushes
  from the app, event-driven refresh not polling.

**Desktop web**: optional three-pane (views | list | editor); ⌘K palette
(search + commands + create), ⌘N new, `/` focus search, j/k navigate, e
archive, ⌘1..4 views, ⌘⇧R remind. `[[` links with autocomplete (markdown
links to ULIDs).

**Mac menu bar**: v0 SwiftBar plugin (~50 lines: today agenda, recent, "New
note…" dialog POSTing to the API). v2 Tauri tray: ⌥Space global hotkey pops
the web `/capture` route in a small always-on-top window.

## 9. Repo structure

```
data-forge/                        ← code repo
  CLAUDE.md                        ← agent guide: invariants, commands, ports
  docs/plan.md                     ← this file
  docs/adr/                        ← locked decisions
  apps/
    server/        Hono API; owns the data repo (git) + SQLite index
    web/           React PWA (the only real UI)
    android/       native companion APK (M3)
    menubar/       SwiftBar plugin → Tauri tray (M2/M5)
  packages/
    core/          shared types, frontmatter serializer, sync client, rrule utils
    tokens/        design tokens + generators
  scripts/verify.sh                ← the run-and-observe affordance
```

Guardrails for agent development:

- CLAUDE.md carries the invariants list; ADRs lock decisions.
- Shared contracts live in `packages/core`; server and clients import the
  same types so protocol drift is a type error.
- Perf budgets are regression tests once features exist, not vibes.

## 10. Hosting and ops

- launchd service (KeepAlive) runs `forge-server` on **:5040**; web dev server
  on :5041 proxies `/api` in dev; in prod the server serves the built web app.
- `tailscale serve` fronts it: `https://<mac>.<tailnet>.ts.net`. Real cert →
  service worker, PWA install, secure-context APIs all work on Android.
- Backup: debounced auto-commits (~60s quiet), push to private remote every
  ~10 min when ahead. Restore drill at M4.
- Known tradeoff: laptop asleep = no sync (clients keep working offline;
  reminders still fire locally). `pmset` can keep it awake on power; the
  server is a folder + a Node process, so moving to an always-on box later is
  rsync + a DNS change.

## 11. Roadmap

Each milestone ends daily-drivable. Estimates are agent-evenings, not
calendar promises.

| # | Scope | Effort | You can now… |
|---|---|---|---|
| M0 | Server store (CRUD + git commits + FTS + changes feed + SSE) + web capture/stream/search/edit + PWA + tailscale serve + launchd | ~1 weekend | Capture and search from both devices' browsers |
| M1 | Offline (Dexie + outbox + SW), axes + saved views, TipTap behind NoteEditor, Keep + Tasks importer, auto-archive | 3-4 ev | Stop using Keep; history migrated |
| M2 | Reminders (model + agenda + web push interim) + SwiftBar menu bar | 3-4 ev | Stop using Google Tasks (web-push fidelity) |
| M3 | Companion APK: Glance widgets, micro-capture, exact alarms, notification actions, QS tile | 4-6 ev | Home-screen parity with Keep, faster; bulletproof reminders |
| M4 | Conflict inbox, per-note history (git log), attachments/photos, backup + restore drill, perf pass | ~3 ev | Trust it with everything |
| M5 | MCP server + forge CLI + inbox webhook, Tauri menu bar (⌥Space), tldraw canvas | as desired | Agents read/write notes; expansive canvases |

Kill-condition mapping: "too long to usable" → M0 is one weekend, M1 is the
Keep switchover. "Overindexes one capability" → milestones are horizontal
slices; editor perfection and canvas are deliberately late.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Sync bug eats a note → trust gone | Every accepted state is a git commit; conflicts fork, never overwrite; randomized two-client replay tests |
| Exact-alarm fidelity on Android | Own thin AlarmManager plugin is ~100 lines if needed; spike early in M3 |
| Widget jank on Nothing Phone 2 | Passive widgets, no services, no polling loops; constraints are in ADR-0004 and CLAUDE.md invariants |
| Laptop-asleep sync gaps | Offline-first makes it cosmetic; pmset or migrate the server later |
| Editor/canvas scope creep | Markdown canonical; NoteEditor abstraction; canvas is M5 by decree |
| Agent drift across sessions | ADRs + invariants + shared contracts + make verify gates |

## 13. Performance budgets and verification

Budgets (regression-tested once the surfaces exist):

- initial JS < 250KB gz (editor code-split)
- capture-to-saved < 100ms perceived
- local search < 30ms at 10k notes
- Android PWA cold open < 1.5s; widget tap-to-typing < 500ms

Verification contract: `make verify` must exercise the changed path, not just
compile it. Current: typecheck + server boot against a throwaway data dir
(bootstrap exercised end-to-end) + web build. Grows with: frontmatter
roundtrip property tests, two-client sync replay, Playwright capture → search
→ edit smoke, later a widget screenshot check.
