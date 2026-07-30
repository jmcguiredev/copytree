use std::str::FromStr;
use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    ActivationPolicy, AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

mod blobs;
mod clipboard;
mod commands;
mod db;
mod models;
mod settings;

use commands::UndoState;
use db::Db;

/// Window labels. The `menu` window is the cascading overlay; `settings` is a
/// normal decorated window created on demand from the tray.
const MENU_LABEL: &str = "menu";
const SETTINGS_LABEL: &str = "settings";

/// Parse and (re)register the global activation hotkey, replacing any previous
/// one. The handler shows the overlay at the cursor.
fn register_activation_hotkey(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let shortcut = Shortcut::from_str(shortcut).map_err(|e| format!("invalid hotkey: {e}"))?;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.on_shortcut(shortcut, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            show_menu(app);
        }
    })
    .map_err(|e| e.to_string())
}

/// Change the activation hotkey (PLAN.md §7): validate + re-register, then
/// persist to the store. Returns an error string if the shortcut is invalid.
#[tauri::command]
fn set_activation_hotkey(app: AppHandle, shortcut: String) -> Result<(), String> {
    register_activation_hotkey(&app, &shortcut)?;
    let store = app.store(settings::STORE_PATH).map_err(|e| e.to_string())?;
    store.set("hotkey", shortcut);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// Hide the menu overlay (invoked from the frontend on Escape).
#[tauri::command]
fn hide_menu(app: AppHandle) {
    if let Some(win) = app.get_webview_window(MENU_LABEL) {
        let _ = win.hide();
    }
}

/// Open (or focus) the settings window, creating it on first use.
#[tauri::command]
fn open_settings_window(app: AppHandle) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window(SETTINGS_LABEL) {
        win.show()?;
        win.set_focus()?;
    } else {
        WebviewWindowBuilder::new(&app, SETTINGS_LABEL, WebviewUrl::default())
            .title("ACM Settings")
            .inner_size(560.0, 460.0)
            .resizable(true)
            .build()?;
    }
    Ok(())
}

/// Position the menu window's top-left near the global cursor, clamped to the
/// visible work area of the monitor under the cursor so it never opens
/// off-screen. All values are physical pixels, so no scale-factor juggling.
fn position_menu_at_cursor(app: &AppHandle) -> tauri::Result<()> {
    let Some(win) = app.get_webview_window(MENU_LABEL) else {
        return Ok(());
    };

    let cursor = app.cursor_position()?;
    let size = win.outer_size()?;
    let (mut x, mut y) = (cursor.x as i32, cursor.y as i32);

    let monitor = app
        .monitor_from_point(cursor.x, cursor.y)?
        .or(app.primary_monitor()?);

    if let Some(m) = monitor {
        let area = m.work_area();
        let (wx, wy) = (area.position.x, area.position.y);
        let (ww, wh) = (area.size.width as i32, area.size.height as i32);
        let (w, h) = (size.width as i32, size.height as i32);
        // Keep the whole window inside the work area (shift left/up if needed),
        // but never past the top-left corner.
        x = x.min(wx + ww - w).max(wx);
        y = y.min(wy + wh - h).max(wy);
    }

    win.set_position(PhysicalPosition::new(x, y))?;
    Ok(())
}

/// Show the menu overlay at the cursor and hand it keyboard focus.
fn show_menu(app: &AppHandle) {
    let _ = position_menu_at_cursor(app);
    if let Some(win) = app.get_webview_window(MENU_LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            // Menubar-only app: no dock icon.
            #[cfg(target_os = "macos")]
            let _ = app
                .handle()
                .set_activation_policy(ActivationPolicy::Accessory);

            // Open the item database under the app data dir, create the blobs
            // directory, seed a sample tree on first run, and share the
            // connection as managed state (PLAN.md §4, §11 milestone 2).
            let data_dir = app.path().app_data_dir()?;
            let blobs_dir = data_dir.join("blobs");
            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(&blobs_dir)?;
            let mut conn = db::open(&data_dir.join("acm.db"))?;
            commands::seed_if_empty(&mut conn, &blobs_dir)?;
            app.manage(Db(Mutex::new(conn)));
            app.manage(UndoState::default());

            // Tray icon with the Settings / Quit menu.
            let settings_item =
                MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&settings_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("ACM — Advanced Clipboard Manager")
                .menu(&tray_menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "settings" => {
                        let _ = open_settings_window(app.clone());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Global hotkey opens the overlay at the cursor. Read the configured
            // shortcut, falling back to the default if it is missing/invalid.
            let hotkey = settings::load(app.handle()).hotkey;
            if register_activation_hotkey(app.handle(), &hotkey).is_err() {
                let _ = register_activation_hotkey(app.handle(), settings::DEFAULT_HOTKEY);
            }

            // Hide the overlay when it loses focus (clicked away / switched app).
            if let Some(menu_win) = app.get_webview_window(MENU_LABEL) {
                let win = menu_win.clone();
                menu_win.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        let _ = win.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hide_menu,
            open_settings_window,
            set_activation_hotkey,
            commands::list_children_cmd,
            commands::get_node_cmd,
            commands::get_item_content_cmd,
            commands::search_cmd,
            commands::get_recent_cmd,
            commands::create_group_cmd,
            commands::create_item_cmd,
            commands::rename_node_cmd,
            commands::delete_node_cmd,
            commands::move_node_cmd,
            commands::copy_item_to_clipboard_cmd,
            commands::paste_clipboard_into_item_cmd,
            commands::undo_paste_cmd,
            commands::redo_paste_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
