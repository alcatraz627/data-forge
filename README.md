# Data Forge

Personal notes, reminders, and cross-device data transmission for one human
(Android + Mac + web). Local-first PWA, markdown files + git as storage,
self-hosted over Tailscale. Built to replace Google Keep + Tasks with
something faster, richer, and agent-extensible.

Status: scaffold. See `docs/plan.md` for the full plan and
`docs/adr/` for locked decisions.

## Quick start

```bash
pnpm install
make dev        # server on :5040, web on :5041
make verify     # typecheck + boot check + build
```

The server stores data in `~/DataForge` (override with `FORGE_DATA`).

## Layout

| Path | What |
|---|---|
| `apps/server` | Hono API: files+git store, SQLite FTS index, sync |
| `apps/web` | React PWA, the one UI for every platform |
| `apps/android` | native companion APK: widgets, exact alarms (M3) |
| `apps/menubar` | Mac menu bar: SwiftBar → Tauri (M2) |
| `packages/core` | shared domain types + protocol contracts |
| `packages/tokens` | design tokens compiled per platform |
