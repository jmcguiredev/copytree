# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Scaffolded, with **milestones 1–2** (PLAN.md §11) implemented:
- **M1** — tray icon with Settings/Quit, `Accessory` activation policy (no dock icon), a global
  hotkey (**Cmd+Shift+V**, a placeholder default — see PLAN.md §12) that shows the transparent
  `menu` overlay at the cursor clamped to the monitor work area, Escape/blur to hide, dark-first
  Tailwind baseline.
- **M2** — SQLite (`rusqlite` bundled) opened under `app_data_dir()/acm.db` as managed `Db`
  state; schema + FTS5 index + sync triggers; tree CRUD commands; a seeded sample tree on first
  run. Backend modules: `db.rs` (schema/migrations/pragmas), `models.rs`, `commands.rs`
  (testable fns + `#[tauri::command]` wrappers). Unit tests cover CRUD, FTS name-first ranking,
  rename reindex, and cascade-delete cleanup — run with `cd src-tauri && cargo test`.

Note: the FTS5 table is a **regular** (content-storing) table, not the contentless one in
PLAN.md §4 — see the rationale comment in `db.rs`. Ranking (`bm25(item_search, 10.0, 1.0)`) is
unchanged. `recursive_triggers` is ON so cascade deletes clean the index.

- **M3** — the cascading menu UI. Zustand store (`src/store.ts`) holds `columns` (one per open
  level), keyboard `focus`, and `selectedItemId`, with actions that call the Rust commands via
  the typed `src/api.ts`. Components under `src/components/` (`MenuColumns`/`NodeRow`,
  `SearchBar`, `ContentPane`, `AddRemoveControls`, Radix-Dialog `modals`) compose in
  `views/MenuView.tsx`, which owns keyboard nav (↑↓ within column, →/Enter expand, ← collapse,
  Enter selects), hover-to-expand, re-init on window re-show (`onFocusChanged`), and
  content-driven `setSize`. Frontend routes by window label (`App.tsx`).

- **M4** — item content. `blobs.rs` stores payloads at `blobs/<sha256>.<ext>` with content
  dedup; `get_item_content` returns `ItemContent` (text, or image/gif with an absolute blob path
  + dimensions); `ContentPane` renders text (2-D scrollable, monospace) and image/gif via the
  Tauri asset protocol (`convertFileSrc`). Content Display Scale lives in the store
  (`contentScale`, default 1) pending Settings in M7. The seed now includes a generated sample
  PNG under a "Samples" group. Requires the tauri `protocol-asset` feature +
  `security.assetProtocol` (scope `$APPDATA/blobs/**`) in `tauri.conf.json`. Rust unit tests
  cover text roundtrip and blob dedup + image content read-back.

- **M5** — clipboard + undo. `clipboard.rs` (macOS/`objc2-app-kit`, deps target-gated to macOS)
  reads/writes `NSPasteboard`: text and still images (PNG+TIFF), and animated GIFs as raw bytes
  under UTI `com.compuserve.gif` with a still-PNG fallback; `read()` prefers gif→image→text and
  normalizes images to PNG. Commands `copy_item_to_clipboard`, `paste_clipboard_into_item`
  (creates image/gif items from pasted data, decoding dimensions with the `image` crate),
  `undo_paste`, `redo_paste`. Single-level undo lives in managed `UndoState`
  (`Mutex<HashMap<i64, UndoSlot>>`) with a `UNDO_TTL` (60s; `Duration::ZERO` disables) — becomes
  the M7 setting. Content overwrite/snapshot/undo/redo are pure fns (`set_content`,
  `snapshot_content`, `overwrite_and_record`, `undo_paste`, `redo_paste`) unit-tested for the
  swap + FTS reindex + ttl-zero disabling. Frontend fires Cmd+C/V/Z/Shift+Z as in-window
  accelerators on the selected/focused item; `contentVersion` forces the pane to refetch.
  Blob GC on overwrite is intentionally skipped (blobs are content-addressed/deduped, so shared
  blobs must not be deleted) — noted for a future refcount pass.

- **M6** — search & Recent Items. `search` command runs the FTS5 MATCH with `bm25(10,1)`
  name-first ranking and returns `SearchHit`s (id, name, ancestor breadcrumb); `fts_query`
  sanitizes arbitrary input into quoted prefix terms so operators/punctuation can't break MATCH.
  `get_recent` derives items from `last_used_at` (max/persistence args; `0` disables / no filter).
  Frontend: a non-empty `SearchBar` query switches `MenuView` to a flat `SearchResults` list
  (↑↓/Enter, breadcrumb subtitle); the "Recent Items" virtual group (`RECENT_ID = -1`) is pinned
  first in column 0 and loads via `get_recent` on expand. `contentScale`/breadcrumb-aware
  `ContentPane` shows a name header (from column or search hit). Rust tests: +search breadcrumb
  & sanitized MATCH, +recent ordering/limit.

- **M7** — Settings. `tauri-plugin-store` (`settings.json`) is the shared source of truth read
  by both sides. Rust `settings.rs::load` reads undo seconds / recent days / max recent / hotkey
  (clamped to §7 ranges); `get_recent_cmd` and the paste/undo/redo TTL now read live settings
  instead of constants. `set_activation_hotkey` command validates (`Shortcut::from_str`),
  re-registers via `register_activation_hotkey`, and persists; startup reads the stored hotkey
  (fallback `DEFAULT_HOTKEY`). Frontend `settings.ts` (`loadSettings`/`setSetting`/
  `applyAppearance`) + `SettingsView` form drives color scheme, the three scales, the two recent
  settings, undo duration, and a key-capture hotkey field. Appearance applies live to the menu
  on (re)open: theme via `data-theme`, Text Scale via root font-size, overall Scale via
  `body { zoom }` (window `setSize` multiplied by `uiScale` to match), Content Display Scale via
  `contentScale`. Capability gains `store:default`.

- **M8** — polish & window resize. After the frontend grows the menu window (`setSize`) it
  calls the `clamp_menu` command; `clamp_window_to_monitor` shifts the window up/left to fit the
  monitor's `work_area` (physical px), keeping the top-left origin otherwise fixed so growth
  never runs off-screen. The drag handle disables double-click-maximize (`maximizable: false` on
  the window + `onDoubleClick preventDefault`). A subtle scale/opacity open animation
  (`element.animate`) plays on each show, retriggered from the focus/refresh handler.

Milestone 9 (bundle: `pnpm tauri build`, verify the `.dmg` / drag-to-Applications / unsigned
first-open, README) is the remainder. Not yet wired: `NewContent` (JS-facing) is still text-only
(image/gif come from paste, not the add modal). Settings changes apply to the menu on its next
open/focus (re-read), not via a live cross-window event — sufficient since the overlay is hidden
between uses.

To display image/gif blobs the frontend uses `convertFileSrc`, which needs the
`security.assetProtocol` scope to cover the file — keep blobs under `$APPDATA/blobs/`.

Frontend↔Rust: Tauri maps camelCase JS arg keys to snake_case Rust params. Any new JS call to a
mutating core window/webview API needs its permission added to `capabilities/default.json`
(e.g. `core:window:allow-set-size` is already there for `setSize`).

`PLAN.md` is the source of truth. Read it before doing any work — it defines the data
model, command surface, UI behavior, and the milestone build order (§11). Decisions marked
**[ASSUMPTION]** were not confirmed by the owner (see the open questions in §12); implement
the stated default but keep it easy to change, and prefer surfacing the assumption over
silently hard-coding it.

Note on toolchain: Tauri 2.11's dependency tree requires Rust ≥1.85 (edition2024). Run
`rustup update stable` if `cargo` reports an `edition2024` feature error.

## What ACM is

A macOS background utility: a global hotkey opens a borderless, infinitely-nestable
cascading context menu at the cursor for storing/retrieving text, still-image, and
animated-GIF clipboard snippets. Menubar (tray) app, no dock icon, dark-mode-first.

## Tech stack

- **Shell:** Tauri v2 (Rust backend, WKWebView frontend)
- **Frontend:** React + TypeScript + Vite, Tailwind CSS, Radix (Dialog/ScrollArea), Zustand for state
- **DB:** SQLite via `rusqlite` with the `bundled` feature (for FTS5). All DB work lives in Rust behind Tauri commands — **do not** use `tauri-plugin-sql`.
- **Settings:** `tauri-plugin-store` (JSON KV), kept separate from the item DB
- **Plugins:** `tauri-plugin-global-shortcut`, `tauri-plugin-clipboard-manager`
- **Native macOS:** `objc2` + `objc2-app-kit` for the two things the plugins can't do — animated-GIF pasteboard read/write (UTI `com.compuserve.gif`) and global cursor position (`NSEvent.mouseLocation`).

## Commands (per PLAN.md §10, once scaffolded)

- `pnpm install`
- `pnpm tauri dev` — dev with hot reload
- `pnpm tauri build` — release `.app`/`.dmg` under `src-tauri/target/release/bundle/`

Prerequisites: Rust toolchain (`rustup`), Node, `pnpm`, Xcode Command Line Tools.
The build is intentionally **unsigned** (personal use); notarization is out of scope for v1.

## Architecture notes that span multiple parts of the spec

These are the non-obvious constraints — the ones you can't infer from a single file once
code exists:

- **The entire cascade is ONE window's DOM.** The search bar, every open submenu column,
  and the content pane are sibling `div`s inside the single `menu` window — not separate
  OS windows. This is what makes the drag handle move the whole assembly and makes
  blur/Escape close everything at once. The window is content-sized: after any layout
  change, measure the DOM in the frontend, call `setSize(...)`, then re-clamp to the
  monitor. Anchor at top-left so growth adds columns to the right without moving the origin.

- **Three-window process model.** One background process owns: the tray icon (always),
  the `menu` window (created hidden at startup, shown/hidden but never destroyed), and the
  `settings` window (normal decorated, on demand). Activation policy is set to `Accessory`
  in Rust `setup` (no dock icon). The menu window takes keyboard focus, so `tauri-nspanel` /
  non-activating panels are **not** needed — a plain undecorated always-on-top window that
  closes on blur suffices.

- **Menu open/close is stateless per invocation.** Open = global hotkey → global cursor
  position → position + clamp to monitor → show/focus → auto-focus search. Close = Escape
  OR blur, which resets open-path and selection. The drag-handle nudge is within-session
  only and is **never persisted** — every open resets to the cursor.

- **Clipboard shortcuts are ordinary in-window accelerators**, not a global event tap,
  because the menu holds focus. CMD+C/V/Z/Shift+Z act on the currently selected item.

- **Tree = adjacency list.** Groups and items are both rows in `nodes` (`parent_id`,
  `position`, `kind`); items add a row in `items` for content. Deletes cascade via the FK.
  Text is stored inline; images/GIFs are blob files under `blobs/` named `<sha256>.<ext>`
  with a metadata row. Everything lives under `app_data_dir()`.

- **Search is FTS5, name-weighted.** Contentless `item_search` FTS5 table fed by triggers
  on `nodes`(name) and `items`(text_content). Rank with `bm25(item_search, 10.0, 1.0)` so
  name matches outrank content-only matches. Returns items only, with their full path.

- **Recent Items is derived, not a stored node.** Computed at open from `nodes.last_used_at`
  (set on copy), filtered/capped by the two recent-related settings. It renders as the first
  virtual group in column 0.

- **Undo is single-level clobber protection only** — a `Mutex<HashMap<i64, UndoEntry>>` in
  Rust holding the pre-paste content (retaining its blob on disk) with a TTL from the
  "Overwritten Item Persistence Duration" setting. Setting `0` disables undo/redo entirely
  (don't retain anything on paste). Max 1 undo + 1 redo.

## Scope guardrails (non-goals for v1)

No code signing/notarization, no Windows/Linux QA, no system-pasteboard monitoring/history
(ACM only touches the pasteboard on explicit CMD+C/CMD+V), no multi-level undo. Keep code
portable where it's free, but don't invest in cross-platform work.
