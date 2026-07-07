# Mac menu bar

`dataforge.5m.sh` is a [SwiftBar](https://swiftbar.app) (or xbar) plugin: it
shows today's agenda in the menu bar and offers one-keystroke capture, both
against the local forge-server. The `5m` in the filename is the refresh
interval.

## Install

```bash
brew install --cask swiftbar          # once
chmod +x apps/menubar/dataforge.5m.sh
ln -s "$PWD/apps/menubar/dataforge.5m.sh" ~/path-to-swiftbar-plugins/
```

Point SwiftBar at a plugin folder on first launch, then drop the symlink
there. Override the server with `FORGE_URL` (e.g. your ts.net URL) in
SwiftBar's environment if the server isn't on `localhost:5040`.

## What it does

- Menu bar shows `⏰ N` — overdue count in orange, else the total due count.
- "New note…" pops a dialog and posts a note (source `menubar`).
- Each agenda item opens the app; a nested "✓ mark done" completes the
  reminder (rolling a recurring one forward) via the server.

This is the v0 menu bar. The planned Tauri tray app (M5) replaces it with a
global-hotkey capture window sharing the web app's exact UI.

## Endpoints it uses

- `GET /api/agenda` → `{ entries: AgendaEntry[] }` (server-side recurrence math)
- `POST /api/reminders/complete?doc=<id>&index=<n>` → completes one reminder
