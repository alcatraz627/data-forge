// Data Forge menu-bar tray: a hidden always-on-top window that shows the web
// app, toggled from the tray icon or a global hotkey (Cmd+Shift+Space). It's a
// thin shell around the same web UI every other client uses, so capture from
// anywhere on the Mac is one keystroke away without a dock app.
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    ActivationPolicy, Manager, Runtime,
};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

fn toggle_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hotkey = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);

    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut(hotkey)
                .expect("register hotkey")
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &hotkey && event.state() == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(ActivationPolicy::Accessory);

            let capture = MenuItem::with_id(app, "capture", "Capture  (⌘⇧Space)", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Data Forge", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&capture, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "capture" => toggle_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
