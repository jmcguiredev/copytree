//! Settings the Rust side reads from `settings.json` (PLAN.md §7). Appearance
//! (color scheme + the three scales) is applied entirely in the frontend; here
//! we only need the values that drive backend behavior. The store is shared
//! with the frontend via `tauri-plugin-store`.

use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

pub const STORE_PATH: &str = "settings.json";

/// Default global activation hotkey (PLAN.md §12 leaves the shipping default
/// open). Key tokens are `KeyboardEvent.code` names, matching what the settings
/// UI captures.
pub const DEFAULT_HOTKEY: &str = "CmdOrCtrl+Shift+KeyX";

pub struct Settings {
    /// Undo/redo retention seconds; `0` disables undo/redo.
    pub undo_seconds: i64,
    /// Recent Items time filter in days; `0` = no filter.
    pub recent_days: i64,
    /// Max Recent Items; `0` disables the list.
    pub max_recent: i64,
    pub hotkey: String,
    /// `true` (default): open the overlay at the cursor each time. `false`: open
    /// where it was last left (pinned), restored from `menuPosition`.
    pub open_at_cursor: bool,
}

/// Read settings from the store, falling back to defaults (and clamping to the
/// ranges in PLAN.md §7) for anything missing or out of range.
pub fn load<R: Runtime>(app: &AppHandle<R>) -> Settings {
    let store = app.store(STORE_PATH).ok();
    let int = |key: &str, default: i64| {
        store
            .as_ref()
            .and_then(|s| s.get(key))
            .and_then(|v| v.as_i64())
            .unwrap_or(default)
    };
    let hotkey = store
        .as_ref()
        .and_then(|s| s.get("hotkey"))
        .and_then(|v| v.as_str().map(str::to_string))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_HOTKEY.to_string());
    let open_at_cursor = store
        .as_ref()
        .and_then(|s| s.get("openAtCursor"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    Settings {
        undo_seconds: int("undoSeconds", 60).clamp(0, 60),
        recent_days: int("recentDays", 1).max(0),
        max_recent: int("maxRecent", 25).clamp(0, 100),
        hotkey,
        open_at_cursor,
    }
}
