# Data Forge — agent guide

Personal notes + reminders system: one React PWA everywhere, markdown files +
git as canonical truth, thin native companions. Read `docs/plan.md` before
structural work; `docs/adr/` records locked decisions — don't relitigate them
without new evidence.

## Commands

- `make dev` — build tokens, then server (:5040) + web (:5041) in watch mode
- `make verify` — typecheck, boot server against a throwaway data dir, build web
- `make tokens` — regenerate `packages/tokens/dist/tokens.css`
- `make format` — biome

## Layout

- `apps/server` — Hono API; owns the data repo (git) + SQLite index
- `apps/web` — React PWA, the only real UI
- `apps/android` — native companion APK (widgets/alarms), lands M3
- `apps/menubar` — SwiftBar plugin → Tauri tray, lands M2
- `packages/core` — shared types; soon: frontmatter serializer, sync client
- `packages/tokens` — design tokens; tokens.json → CSS now, Kotlin/Swift later

## Invariants (do not break)

1. Files are canonical truth; the SQLite index is derived and disposable.
2. git runs ONLY on the server; clients speak the HTTP sync protocol.
3. The frontmatter serializer is roundtrip-stable (no reformat churn).
4. Conflicts fork into sibling files; never overwrite or drop content.
5. Capture never blocks on network: local write first, sync in background.
6. All editing stays behind the `NoteEditor` abstraction (markdown in/out);
   nothing outside `apps/web/src/editor/` imports a specific editor lib.
7. Android companion: no persistent services, passive Glance widgets only,
   WorkManager ≥15 min, exact alarms via AlarmManager.
8. Titles are derived from the body, never stored.

## Performance budgets (regression-test once surfaces exist)

initial JS < 250KB gz · capture-to-saved < 100ms · local search < 30ms @ 10k
docs · Android PWA cold open < 1.5s · widget tap-to-typing < 500ms

## Environment

`FORGE_DATA` (default `~/DataForge`) · `FORGE_PORT` (default 5040).
The data repo is separate and private (ADR-0005); this repo is code only —
never write user notes into it.
