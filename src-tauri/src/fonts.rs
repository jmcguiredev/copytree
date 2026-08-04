//! System font enumeration for the settings font picker (macOS). WKWebView has
//! no Local Font Access API, so the list comes from AppKit's `NSFontManager`,
//! which is main-thread-only — callers must invoke on the main thread (see
//! `list_system_fonts` in `lib.rs`).

use objc2::MainThreadMarker;
use objc2_app_kit::NSFontManager;

/// Available font family names, sorted case-insensitively. Must run on the main
/// thread (`NSFontManager` is `MainThreadOnly`).
pub fn available_families(mtm: MainThreadMarker) -> Vec<String> {
    let manager = NSFontManager::sharedFontManager(mtm);
    let mut families: Vec<String> = manager
        .availableFontFamilies()
        .iter()
        .map(|f| f.to_string())
        .collect();
    families.sort_by_key(|f| f.to_lowercase());
    families
}
