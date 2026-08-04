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
#[cfg(target_os = "macos")]
mod fonts;
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

/// Persist the menu window's current geometry: the top-left (for "open where I
/// left it" mode) and the size (always restored, since the overlay is now
/// user-resizable). Called just before every hide, so it captures wherever the
/// user last dragged/sized the overlay.
fn save_menu_geometry(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MENU_LABEL) {
        if let Ok(store) = app.store(settings::STORE_PATH) {
            if let Ok(pos) = win.outer_position() {
                store.set("menuPosition", serde_json::json!({ "x": pos.x, "y": pos.y }));
            }
            if let Ok(size) = win.inner_size() {
                store.set("menuSize", serde_json::json!({ "w": size.width, "h": size.height }));
            }
            let _ = store.save();
        }
    }
}

/// Restore the persisted window size before showing (independent of position
/// mode). No-op if nothing is saved yet — the conf default size applies.
fn restore_menu_size(app: &AppHandle) {
    let Some(win) = app.get_webview_window(MENU_LABEL) else {
        return;
    };
    let saved = app
        .store(settings::STORE_PATH)
        .ok()
        .and_then(|s| s.get("menuSize"));
    if let Some(v) = saved {
        if let (Some(w), Some(h)) = (
            v.get("w").and_then(|n| n.as_u64()),
            v.get("h").and_then(|n| n.as_u64()),
        ) {
            let _ = win.set_size(tauri::PhysicalSize::new(w as u32, h as u32));
        }
    }
}

/// Hide the menu overlay (invoked from the frontend on Escape). Saves the current
/// position first so pinned mode reopens in place.
#[tauri::command]
fn hide_menu(app: AppHandle) {
    save_menu_geometry(&app);
    if let Some(win) = app.get_webview_window(MENU_LABEL) {
        let _ = win.hide();
    }
}

/// List installed font family names for the settings font picker. Enumerates via
/// AppKit on the main thread (`NSFontManager` is main-thread-only); returns an
/// empty list off macOS.
#[tauri::command]
fn list_system_fonts(app: AppHandle) -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let fonts = objc2::MainThreadMarker::new()
                .map(fonts::available_families)
                .unwrap_or_default();
            let _ = tx.send(fonts);
        })
        .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(Vec::new())
    }
}

/// Open (or focus) the settings window, creating it on first use. Both paths
/// show + focus + activate, so it reliably comes to the front on the first open
/// (previously the create path never focused, so it landed behind other windows).
#[tauri::command]
fn open_settings_window(app: AppHandle) -> tauri::Result<()> {
    let win = match app.get_webview_window(SETTINGS_LABEL) {
        Some(win) => win,
        None => {
            let win = WebviewWindowBuilder::new(&app, SETTINGS_LABEL, WebviewUrl::default())
                .title("ACM Settings")
                .inner_size(560.0, 460.0)
                .resizable(true)
                .build()?;
            let handle = app.clone();
            win.on_window_event(move |event| {
                if let WindowEvent::Focused(focused) = event {
                    if *focused {
                        // Let the settings window come in front of the always-on-top
                        // overlay while it's focused.
                        if let Some(menu) = handle.get_webview_window(MENU_LABEL) {
                            let _ = menu.set_always_on_top(false);
                        }
                    } else {
                        // Focus left settings: close the overlay too unless focus went
                        // to the overlay itself — see schedule_focus_check.
                        schedule_focus_check(&handle);
                    }
                }
            });
            win
        }
    };
    win.show()?;
    win.set_focus()?;
    // The app is an Accessory (no dock icon) and so isn't auto-activated; a shown
    // window can land behind another app's window. Activate the app to raise the
    // key window to the front.
    #[cfg(target_os = "macos")]
    {
        let _ = app.run_on_main_thread(|| {
            if let Some(mtm) = objc2::MainThreadMarker::new() {
                #[allow(deprecated)]
                objc2_app_kit::NSApplication::sharedApplication(mtm)
                    .activateIgnoringOtherApps(true);
            }
        });
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

/// Restore the menu window's saved top-left (pinned / "open where I left it"
/// mode), then clamp it onto the current monitor. Falls back to the cursor when
/// there is no saved position yet.
fn restore_menu_position(app: &AppHandle) -> tauri::Result<()> {
    let Some(win) = app.get_webview_window(MENU_LABEL) else {
        return Ok(());
    };
    let saved = app
        .store(settings::STORE_PATH)
        .ok()
        .and_then(|s| s.get("menuPosition"));
    if let Some(v) = saved {
        if let (Some(x), Some(y)) = (
            v.get("x").and_then(|n| n.as_i64()),
            v.get("y").and_then(|n| n.as_i64()),
        ) {
            win.set_position(PhysicalPosition::new(x as i32, y as i32))?;
            clamp_window_to_monitor(&win)?;
            return Ok(());
        }
    }
    position_menu_at_cursor(app)
}

/// Shift a window up/left so it fits within its monitor's visible work area,
/// keeping the top-left origin otherwise fixed (PLAN.md §3).
fn clamp_window_to_monitor(win: &tauri::WebviewWindow) -> tauri::Result<()> {
    let pos = win.outer_position()?;
    let size = win.outer_size()?;
    let monitor = match win.current_monitor()? {
        Some(m) => Some(m),
        None => win.primary_monitor()?,
    };
    if let Some(m) = monitor {
        let area = m.work_area();
        let (wx, wy) = (area.position.x, area.position.y);
        let (ww, wh) = (area.size.width as i32, area.size.height as i32);
        let (w, h) = (size.width as i32, size.height as i32);
        let x = pos.x.min(wx + ww - w).max(wx);
        let y = pos.y.min(wy + wh - h).max(wy);
        if x != pos.x || y != pos.y {
            win.set_position(PhysicalPosition::new(x, y))?;
        }
    }
    Ok(())
}

/// Re-clamp the (grown) menu window to the monitor. Called by the frontend
/// after it resizes the window to fit its content (PLAN.md §3, §11 milestone 8).
#[tauri::command]
fn clamp_menu(app: AppHandle) {
    if let Some(win) = app.get_webview_window(MENU_LABEL) {
        let _ = clamp_window_to_monitor(&win);
    }
}

/// After a short delay (so focus has time to settle on whichever window the user
/// clicked), hide the overlay unless one of our own windows still holds focus.
/// This closes the overlay when focus leaves the app entirely — including when
/// the settings window loses focus to another app — while keeping it open as the
/// user moves between the overlay and settings.
fn schedule_focus_check(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(120));
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            let ours_focused = [MENU_LABEL, SETTINGS_LABEL].iter().any(|label| {
                app2.get_webview_window(label)
                    .and_then(|w| w.is_focused().ok())
                    .unwrap_or(false)
            });
            if ours_focused {
                return;
            }
            if let Some(menu) = app2.get_webview_window(MENU_LABEL) {
                if menu.is_visible().unwrap_or(false) {
                    save_menu_geometry(&app2);
                    let _ = menu.hide();
                }
            }
        });
    });
}

/// Show the menu overlay and hand it keyboard focus. Positions at the cursor, or
/// restores the last position when "open where I left it" is enabled (§7).
fn show_menu(app: &AppHandle) {
    // Restore the saved size first so positioning clamps against the real size.
    restore_menu_size(app);
    if settings::load(app).open_at_cursor {
        let _ = position_menu_at_cursor(app);
    } else {
        let _ = restore_menu_position(app);
    }
    if let Some(win) = app.get_webview_window(MENU_LABEL) {
        // Re-assert always-on-top: a prior settings focus may have lowered it.
        let _ = win.set_always_on_top(true);
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
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
                    if let WindowEvent::Focused(focused) = event {
                        if *focused {
                            // Regained focus — float above other windows again
                            // (settings drops us below itself while it's focused).
                            let _ = win.set_always_on_top(true);
                        } else {
                            // On blur, defer and hide only if focus left the app
                            // entirely — moving to the settings window keeps the
                            // overlay open (settings changes broadcast
                            // `acm://settings-changed` for live updates).
                            schedule_focus_check(win.app_handle());
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hide_menu,
            open_settings_window,
            set_activation_hotkey,
            clamp_menu,
            list_system_fonts,
            commands::list_children_cmd,
            commands::get_node_cmd,
            commands::get_item_content_cmd,
            commands::search_cmd,
            commands::get_recent_cmd,
            commands::create_group_cmd,
            commands::create_item_cmd,
            commands::create_file_item_cmd,
            commands::rename_node_cmd,
            commands::set_item_language_cmd,
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
