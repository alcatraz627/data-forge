# Data Forge tray (macOS menu bar)

A tiny Tauri v2 app: a menu-bar tray icon and a global hotkey (⌘⇧Space) that
toggle a small always-on-top window showing the web app, so capture from
anywhere on the Mac is one keystroke away. No dock icon (accessory app). It's a
thin shell around the same web UI at `http://localhost:5040` — start the
server first (`make deploy`).

This is the richer successor to the SwiftBar plugin (`apps/menubar`); both can
coexist. The window loads the forge web app directly, so it inherits every
feature (capture, agenda, editor, canvas) automatically.

## Build

Needs Rust (via rustup) + Xcode Command Line Tools — no other system deps on
macOS. From `apps/tray`:

```bash
npx @tauri-apps/cli@^2 build    # -> src-tauri/target/release/bundle/ (.app + .dmg)
# or a quick compile check:
cd src-tauri && cargo build
```

## What it does

- Tray icon with a menu: Capture (toggles the window), Quit.
- Global shortcut ⌘⇧Space toggles the window from anywhere.
- Accessory activation policy: lives in the menu bar, not the dock.
