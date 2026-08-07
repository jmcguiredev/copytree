# SPEC.md — Copy Tree architecture & wiring

Architectural reference for Copy Tree. Headers are kept
short and greppable. For per-area working notes see the nested `CLAUDE.md` in each
source folder. Keep this file current — see "Recycling context" in the root `CLAUDE.md`.

Copy Tree is a macOS menubar utility: a global hotkey opens a borderless, infinitely
nestable cascading menu at the cursor for storing/retrieving text, image, and
animated-GIF clipboard snippets.

## Tech stack

- Shell: **Tauri v2** (Rust backend, WKWebView frontend).
- Frontend: **React + TypeScript + Vite**, **Tailwind CSS v4**, **Radix** (Dialog),
  **Zustand** state.
- DB: **SQLite** via `rusqlite` (bundled, FTS5). All DB work is in Rust behind
  commands — no `tauri-plugin-sql`.
- Plugins: `global-shortcut`, `store`, `dialog`. Native pasteboard via
  `objc2`/`objc2-app-kit`.
- Settings: `tauri-plugin-store` (`settings.json`), read by both sides.

## Process & windows

Single background process, activation policy **Accessory** (no dock icon, set at
runtime in `lib.rs` setup). Owns:

- **Tray icon** — the tree art, loaded in `lib.rs` via
  `Image::from_bytes(include_bytes!("../icons/128x128.png"))` (a compile-time file dep,
  so regenerating the icon forces a rebuild — `default_window_icon()` can go stale).
  `src-tauri/icons/` is generated from `src/assets/icon.svg` via `pnpm tauri icon`.
  Menu: Settings…, Quit.
- **`menu` window** (label `menu`) — the overlay. Declared in `tauri.conf.json`,
  created hidden, shown/hidden but never destroyed. `decorations:false,
  transparent:true, alwaysOnTop, skipTaskbar, resizable:false, maximizable:false,
  shadow, visible:false`, plus **`dragDropEnabled:false`** — Tauri's native OS
  file-drop handler otherwise swallows the DOM `drop` event, breaking the HTML5
  drag-to-reorder (`NodeRow`); we don't drop OS files into the window, so it's safe to
  turn off. The **entire cascade is one window's DOM** (search bar +
  every column + content pane are sibling divs), which is why blur/Escape closes
  everything and the drag handle moves it all.
- **`settings` window** (label `settings`) — normal decorated window, created on
  demand from the tray via `open_settings_window`, which shows + focuses + (macOS)
  `activateIgnoringOtherApps` so it reliably comes to the front on first open (an
  Accessory app isn't auto-activated, so a shown window can land behind others).
  While focused it drops the overlay's always-on-top (`menu.set_always_on_top(false)`)
  so it can sit in front of the overlay; the overlay restores it on `Focused(true)`
  and `show_menu` re-asserts it.

Frontend routes on `getCurrentWindow().label` in `App.tsx` → `MenuView` or
`SettingsView`.

## Open / close (menu)

Open: global hotkey → `show_menu` (Rust). With `openAtCursor` (default) it positions
the window top-left at the global cursor; otherwise it restores the last saved
position (`restore_menu_position`). Either way it clamps to the monitor work area,
then show + focus. Frontend re-inits the tree and re-applies appearance on
`onFocusChanged(true)`. Close: Escape (frontend → `hide_menu`, which calls
`save_menu_geometry`) or focus leaving the app. Blur on any of our windows runs
`schedule_focus_check`: after ~120ms it hides the overlay (saving geometry first)
**unless** one of our own windows (overlay or settings) still holds focus — so moving
between overlay ↔ settings keeps it open, but clicking another app closes it. While both
are open, settings changes broadcast `copytree://settings-changed`, which the (possibly
unfocused) menu listens for to re-read + re-apply appearance live. `save_menu_geometry`
persists `menuPosition` (pinned mode) and `menuSize` (always restored on open).

## Data model (SQLite)

Adjacency-list tree. Schema + triggers live in `db.rs` (`SCHEMA_V1`), applied via a
`user_version` migration. Pragmas: `foreign_keys=ON`, `recursive_triggers=ON`.

- **`nodes`** — `id, parent_id (FK ON DELETE CASCADE), kind('group'|'item'), name,
  position, created_at, updated_at, last_used_at`. Indexes on `(parent_id, position)`
  and `last_used_at`. **`position` is a fractional-index TEXT key** (`rank.rs`): a
  parent's children are ordered by the plain lexicographic order of these strings, so a
  reorder rewrites only the moved row (schema v3 converted it from INTEGER; on non-empty
  DBs it re-ranks each parent's children in their old order).
- **`items`** — `node_id (PK/FK), content_type('text'|'image'|'gif'), text_content,
  blob_path, blob_hash, byte_size, width, height, language`. `language` (schema v2) is
  the pinned highlight.js language id for text, or NULL to auto-detect at render; paste
  resets it to NULL.
- **`item_search`** — FTS5 over `(name, content)`, rowid = node id. **Regular**
  (content-storing) FTS5 table, not contentless: triggers span `nodes.name` and
  `items.text_content`, so old values for a contentless delete aren't available in
  one trigger. Kept in sync by triggers `nodes_search_ai/au/ad` and
  `items_search_ai/au`. `recursive_triggers` makes cascade deletes clear the index.

## Search & recent

- **Search**: `search()` runs `item_search MATCH ?` ordered by
  `bm25(item_search, 10.0, 1.0)` → name matches outrank content. Returns items with
  an ancestor breadcrumb. `fts_query()` sanitizes arbitrary input into quoted prefix
  terms (`"tok"*`) so punctuation/operators can't break MATCH.
- **Recent**: `get_recent(max, persistence_secs)` — items by `last_used_at DESC`;
  `max=0` disables, `persistence=0` = no time filter. `last_used_at` is set on copy.
  Surfaced as a virtual "Recent Items" group (`RECENT_ID = -1`) pinned first in
  column 0 (frontend `store.ts`), loaded via `get_recent` on expand.

## Filesystem layout

Under Tauri `app_data_dir()` = `~/Library/Application Support/com.z3ro.copytree/`:

```
copytree.db          # SQLite (tree, item metadata, FTS index)
blobs/          # image/gif payloads, <sha256>.<ext>, content-deduped
settings.json   # tauri-plugin-store
```

Blobs are content-addressed (`blobs.rs::store_bytes`) and shared across items via
dedup, so overwrite/undo **never deletes** blob files (no GC yet).

## Rust modules (`src-tauri/src/`)

- `lib.rs` — app setup: plugins, Accessory policy, DB open + seed + managed state,
  tray, hotkey register, window commands (`hide_menu`, `open_settings_window`,
  `set_activation_hotkey`, `clamp_menu`), invoke handler.
- `commands.rs` — all data/clipboard/search commands + their testable pure fns +
  the undo buffer (`UndoState`) + unit tests.
- `db.rs` — schema, migration, pragmas, connection open; `Db(Mutex<Connection>)`.
- `models.rs` — serde types (`Node`, `NewContent`, `ItemContent`, `SearchHit`).
- `blobs.rs` — content-addressed blob storage (`store_bytes`, sha2).
- `clipboard.rs` — **macOS only** (`objc2-app-kit`): `NSPasteboard` read/write.
- `settings.rs` — read `settings.json` for undo/recent/hotkey (Rust-side needs).
- `portation.rs` — import/export commands: settings as JSON, database as a `zip`
  bundling `copytree.db` + `blobs/` (the `zip` crate). DB import extracts, replaces the
  files, and swaps the managed connection in place (no restart).

## Tauri commands (wiring)

`command_name` (Rust in `commands.rs` unless noted) → `api.method` (`src/api.ts`).
Tauri maps camelCase JS arg keys to snake_case Rust params. Custom commands need no
capability entry.

- `list_children_cmd` → `api.listChildren`
- `get_node_cmd` → `api.getNode`
- `get_item_content_cmd` → `api.getItemContent` (resolves blob abs path)
- `search_cmd` → `api.search`
- `get_recent_cmd` → `api.getRecent`
- `create_group_cmd` → `api.createGroup`
- `create_item_cmd` → `api.createItem` (text only)
- `create_file_item_cmd` → `api.createFileItem` (image/gif from a file path)
- `rename_node_cmd` → `api.renameNode`
- `set_item_language_cmd` → `api.setItemLanguage` (pin/clear a text item's language)
- `delete_node_cmd` → `api.deleteNode` (cascades)
- `move_node_cmd` → `api.moveNode` — reparent/reorder a node between two neighbour
  ids (`before_id`/`after_id`; both null = append). Computes the new fractional key with
  `rank::key_between`; rejects (errors) a move into the node's own descendant.
- `copy_item_to_clipboard_cmd` → `api.copyItem` (sets `last_used_at`)
- `paste_clipboard_into_item_cmd` → `api.pasteIntoItem` (creates image/gif from pasteboard)
- `undo_paste_cmd` → `api.undoPaste`
- `redo_paste_cmd` → `api.redoPaste`
- `hide_menu` (`lib.rs`) → `api.hideMenu`
- `clamp_menu` (`lib.rs`) → `api.clampMenu`
- `set_activation_hotkey` (`lib.rs`) → `api.setActivationHotkey`
- `list_system_fonts` (`lib.rs`) → `api.listSystemFonts` (AppKit family names, main-thread)
- `export_settings`/`import_settings` (`portation.rs`) → `api.exportSettings`/`importSettings`
- `export_database`/`import_database` (`portation.rs`) → `api.exportDatabase`/`importDatabase`
- `open_settings_window` (`lib.rs`) — invoked from the tray, not `api`

## Clipboard & undo

`clipboard.rs` writes text, still image (PNG+TIFF), and GIF (raw bytes under UTI
`com.compuserve.gif` + still PNG fallback); `read()` prefers gif→image→text and
normalizes images to PNG. Copy/paste operate on the selected/focused item.

Undo is single-level, in managed `UndoState(Mutex<HashMap<i64, UndoSlot>>)`. Pure
fns `snapshot_content`/`set_content`/`overwrite_and_record`/`undo_paste`/`redo_paste`
swap the `items` row (which re-fires the FTS trigger). TTL from settings
`undoSeconds` (`Duration::ZERO` disables). Frontend fires Cmd+C/V/Z/Shift+Z as
in-window accelerators (no global tap; the menu holds focus); `contentVersion`
forces the content pane to refetch.

## Content display

`get_item_content` returns `ItemContent` (text + `language`, or image/gif with an
absolute blob path + dims). `ContentPane` renders text (2-D scrollable, monospace) with
**highlight.js** syntax highlighting — a pinned `language` or `highlightAuto` when NULL —
and shows a searchable language picker (text only; `api.setItemLanguage`, `""` = Auto).
hljs token colors are theme-aware CSS in `index.css` (no external hljs stylesheet). The
full hljs build is bundled for maximum language coverage. Image/gif render via the
**asset protocol** (`convertFileSrc`) — requires the tauri `protocol-asset` feature +
`security.assetProtocol` scope `$APPDATA/blobs/**` in `tauri.conf.json`.

## Settings

`settings.json` via `tauri-plugin-store`, shared:
- Rust `settings.rs::load` reads `undoSeconds`, `recentDays`, `maxRecent`, `hotkey`
  (clamped to ranges), and `openAtCursor` (bool, default true); consumed by
  `get_recent_cmd`, the paste/undo/redo TTL, and `show_menu` positioning. The window's
  last position/size are stored under `menuPosition`/`menuSize` (written by
  `save_menu_geometry`); `columnWidths` holds the per-depth cascade column widths.
- Frontend `settings.ts` (`loadSettings`/`setSetting`/`applyAppearance`) + `SettingsView`
  drive color scheme + `accentColor` (Theme Color) + font family + the three scales +
  the recent/undo durations + `selectMode` (Select Item / Group: hover vs click) +
  open position + hotkey capture (global activation + app-local `newItemHotkey`/
  `newGroupHotkey`/`deleteHotkey`, defaults `KeyI`/`KeyG`/`KeyD`) + Configuration/Database
  import & export (native dialogs → the `portation` commands). The font list comes from
  `list_system_fonts`.
  `columnWidths` (per-depth cascade widths) is written directly by the splitter drag.
  `shortcutFromEvent` builds the canonical modifier+`code` string used to capture and
  to match a hotkey at runtime.
- Appearance applies to the menu on (re)open (re-read, not a live event): `data-theme`,
  root font-size (Text Scale), `body{zoom}` (overall Scale — window `setSize` × `uiScale`
  to match), `contentScale`, `--copytree-font` (Font), and `--copytree-accent` (Theme Color; cleared
  → per-theme default). It also seeds behavior state into the store: `selectMode` and the
  two create hotkeys, so those apply live.
- **Scale lockout guard**: `scale`/`textScale`/`contentScale` are clamped to
  `[0.25×default, 5]` in both `loadSettings` and `applyAppearance` (`safeScale`), so a
  corrupted/empty stored value can't shrink the UI to an unrecoverable size. The
  **Settings window renders at 1×** (`applyAppearance(s, false)` skips the overall/text
  scale) so it's always usable and can rescue a bad menu scale — the scale settings size
  the *menu*, not the control panel.
- **Settings controls are non-native**: `components/Select.tsx` (portalled dropdown, keyboard
  nav + type-ahead), `components/NumberField.tsx` (stepper, commits on blur/Enter, reverts
  empty input), and `components/ColorPicker.tsx` (portalled popover, draggable R/G/B +
  black-level (K) sliders + hex field) replace the browser `<select>`/`<input type=number|color>`.

## Global hotkey

`register_activation_hotkey` (`lib.rs`) parses a `Shortcut::from_str` string
(`KeyboardEvent.code` tokens, e.g. `CmdOrCtrl+Shift+KeyV`), unregisters all, and
registers a handler that shows the menu. Startup reads the stored hotkey (fallback
`DEFAULT_HOTKEY`). `set_activation_hotkey` validates + re-registers + persists.
macOS prompts for Accessibility permission on first registration.

## Window sizing & positioning

The overlay is **user-resizable** (`resizable:true`, min 320×220). Being borderless,
it's resized via native drag from `ResizeGrips` (right/bottom/corner zones calling
`startResizeDragging`; needs `core:window:allow-start-resize-dragging`). Size is
persisted: `save_menu_geometry` writes `menuSize` (+ `menuPosition`) on hide;
`restore_menu_size` restores it on open before positioning. There is **no** content-
driven auto-sizing — the columns + content flex to fill the window.

Inside, each cascade column has a **per-depth-index width** (`settings.columnWidths`,
default 210), dragged via its right-edge splitter (`MenuColumns`, persisted on drag
end); the content pane is `flex-1` and fills the remainder, and the row scrolls
horizontally when columns overflow. Widths are keyed by depth, so any tree at the same
depth lays out identically. `clamp_menu`/`clamp_window_to_monitor` still keep the window
on the monitor `work_area`. All Rust-side geometry is physical px.

## Capabilities & plugins

`src-tauri/capabilities/default.json` applies to windows `menu`, `settings`:
`core:default`, `core:window:allow-set-size`, `core:window:allow-start-dragging`,
`core:window:allow-start-resize-dragging`, `store:default`, `dialog:default`.
`allow-start-dragging`/`allow-start-resize-dragging` drive the `data-tauri-drag-region`
move handle and the `ResizeGrips` — `core:default` only grants window *getters*. Any new
mutating core window/webview JS API needs its permission added here.

**Hardening** (defense in depth; there is no network/remote surface — see security
review): `security.csp` is a restrictive policy (`default-src 'self'`; images also allow
the `asset:`/`asset.localhost` protocol; `style-src` allows `'unsafe-inline'` for the
heavy inline styles + hljs; `object-src 'none'`). Tauri augments it with the nonces/IPC
sources it needs. `get_item_content` resolves a stored `blob_path` only if it matches the
content-addressed shape `<64 hex>.<png|gif>` (`blob_abspath`), so a crafted/imported DB
can't aim the asset loader outside `blobs/`. DB **import** (`portation.rs`) is zip-slip
hardened: only `copytree.db`/`blobs/*` entries, no `..`, bytes-copied (no symlinks).

## Build, test, bundle

- Dev: `pnpm tauri dev`. Frontend build: `pnpm build` (tsc + vite).
- Tests: `cd src-tauri && cargo test` (data layer, FTS, blob dedup, undo/redo,
  search/recent). Native clipboard + UI interaction are not headless-testable.
- Bundle: `pnpm tauri build` → `src-tauri/target/release/bundle/{macos/Copy Tree.app,
  dmg/Copy Tree_0.1.0_aarch64.dmg}`. Unsigned; `category: Utility`.
- Toolchain: Rust ≥ 1.85 (edition2024 transitive dep).

## Assumptions & deviations

- FTS5 is a regular (not contentless) table — see Data model.
- Default hotkey `CmdOrCtrl+Shift+KeyX`; Recent default 25 items / 1 day; undo 60s —
  all editable, defaults per PLAN assumptions.
- Settings apply to the menu on next open/focus (re-read), not a live cross-window event.
- No blob GC (content-addressed/shared).
