# PLAN.md — Advanced Clipboard Manager (ACM)

A macOS background utility that provides a hotkey-activated, infinitely-nestable
context menu for storing and retrieving text and image clipboard snippets.

This document is the implementation spec. Build in the milestone order at the
bottom. Where a decision is marked **[ASSUMPTION]**, it was not fully specified
by the owner — implement the stated default but leave it easy to change.

---

## 1. Goals and non-goals

### Goals
- A borderless context-menu overlay, opened by a global hotkey at the cursor,
  that lets the user browse a tree of groups and items, copy an item to the
  system clipboard, and paste the system clipboard into an item.
- Infinite nesting of groups; groups and items can be created/removed anywhere.
- Fast name + content search with name matches ranked higher.
- Runs in the background with a menubar (tray) icon; no dock icon.
- Dark-mode-first, modern UI. Not aiming for a fully native AppKit look.
- Builds to a `.app` / `.dmg` that drags into `/Applications`.

### Non-goals (v1)
- Code signing / notarization (personal use; unsigned build is acceptable).
- Windows/Linux support (macOS only; keep code portable where free, but do not
  invest in cross-platform QA).
- Clipboard history/monitoring of the system pasteboard. ACM only reads/writes
  the pasteboard on explicit user action (CMD+C / CMD+V inside the menu).
- Multi-level undo. The undo buffer is single-level clobber protection only.

---

## 2. Tech stack

- **Shell:** Tauri v2 (Rust backend + web frontend, native WKWebView).
- **Frontend:** React + TypeScript, built with Vite.
- **Styling:** Tailwind CSS. Dark theme by default via a `data-theme` attribute
  on `<html>` driven by the Color Scheme setting.
- **UI primitives:** Radix (Dialog for modals, ScrollArea for the content pane).
  The cascading menu itself is custom — do not try to force a component library
  into it.
- **Frontend state:** Zustand (small, no boilerplate). One store holds: the open
  path (array of node ids, one per visible column), the selected item, search
  state, and the loaded settings.
- **Database:** SQLite via `rusqlite` with the `bundled` feature (guarantees a
  modern SQLite with **FTS5** compiled in). Do all DB work in Rust behind Tauri
  commands. Do **not** use `tauri-plugin-sql` — we want FTS5 + triggers under
  our own control.
- **Settings storage:** `tauri-plugin-store` (a small JSON KV file). Keep
  settings separate from the item database.
- **Global shortcut:** `tauri-plugin-global-shortcut`.
- **Clipboard:** `tauri-plugin-clipboard-manager` for text and still images;
  a **custom Rust command using `objc2` + `objc2-app-kit`** for animated GIF
  read/write (see §6). `arboard` is acceptable for text/PNG but does not handle
  GIF animation, so it cannot be the whole solution.

macOS integration notes:
- Set the activation policy to **Accessory** on startup
  (`app.set_activation_policy(ActivationPolicy::Accessory)`) so there is no dock
  icon and the app lives in the menubar only.
- The menu window **takes keyboard focus** when shown, so `tauri-nspanel` and a
  non-activating panel are **not** required. A regular undecorated, always-on-top
  window that closes on blur is sufficient.

---

## 3. Process and window model

The app is a single background process. It owns:

1. **Tray icon** (always present). Menu: `Settings…`, `Quit`.
2. **Menu window** (`label: "menu"`). The overlay. Created hidden at startup.
   - `decorations: false`, `transparent: true`, `alwaysOnTop: true`,
     `skipTaskbar: true`, `resizable: false`, `shadow: true`, `focus: true`.
   - Hidden, never destroyed, between invocations (cheap show/hide).
3. **Settings window** (`label: "settings"`). A normal decorated window, created
   on demand from the tray. Standard resizable window.

### Opening the menu
- Global hotkey fires → get the **global cursor position** → position the menu
  window's top-left near the cursor, **clamped to the current monitor's visible
  frame** so it never opens off-screen → show + focus the window → auto-focus the
  search input.
- Cursor position: try Tauri's cursor position API first; if it is not global
  enough, add a tiny Rust command reading `NSEvent.mouseLocation` via
  `objc2-app-kit` (remember: AppKit's origin is bottom-left; convert to top-left).
- **Position always resets to the cursor on every open.** The drag handle (§5.7)
  is a within-session nudge only and its result is never persisted.

### Closing the menu
Close (hide) on **any** of:
- `Escape` key.
- Window blur (user clicked another app/window). Listen for the window's focus
  change / blur event and hide on blur.
Hiding resets the open path and selection to a clean state for next open.

### Window sizing (important)
The **entire cascade is one window's DOM** — the search bar, every open submenu
column, and the content pane are all sibling `div`s in the `menu` window. They
are **not** separate OS windows. This is what makes the drag handle move the whole
assembly and what makes blur/Escape close everything at once.

The window is content-sized and grows as the user expands groups / selects items:
- Anchor the window at its **top-left origin**; expansion adds columns to the
  right and the content pane below/right, so the origin stays put while size grows.
- After any layout change, measure the rendered content in the frontend and call
  the window resize API (`getCurrentWindow().setSize(...)`), then re-clamp so the
  grown window still fits the monitor (shift left/up if needed).

---

## 4. Data model and storage

### Filesystem layout
Everything under Tauri's `app_data_dir()`
(`~/Library/Application Support/<bundle-identifier>/`):
```
acm.db            # SQLite: tree, item content metadata, FTS index
blobs/            # image and gif payloads, named <sha256>.<ext>
settings.json     # written by tauri-plugin-store
```
Set a real bundle identifier in `tauri.conf.json` (e.g. `com.z3ro.acm`).

### SQLite schema
Adjacency-list tree. Groups and items are both `nodes`; items have a row in
`items` for their content.

```sql
CREATE TABLE nodes (
  id          INTEGER PRIMARY KEY,
  parent_id   INTEGER REFERENCES nodes(id) ON DELETE CASCADE,  -- NULL = root
  kind        TEXT NOT NULL CHECK (kind IN ('group','item')),
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,           -- order within parent
  created_at  INTEGER NOT NULL,           -- unix seconds
  updated_at  INTEGER NOT NULL,
  last_used_at INTEGER                    -- set when an item is copied; NULL otherwise
);
CREATE INDEX idx_nodes_parent ON nodes(parent_id, position);
CREATE INDEX idx_nodes_recent ON nodes(last_used_at);

CREATE TABLE items (
  node_id      INTEGER PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('text','image','gif')),
  text_content TEXT,          -- for content_type='text'
  blob_path    TEXT,          -- relative path under blobs/ for image|gif
  blob_hash    TEXT,          -- sha256, for dedup
  byte_size    INTEGER,
  width        INTEGER,
  height       INTEGER
);
```

### Search (FTS5)
```sql
CREATE VIRTUAL TABLE item_search USING fts5(
  name,
  content,
  content='',                 -- contentless; we feed it via triggers
  tokenize='unicode61'
);
```
- Keep it in sync with triggers on `nodes` (name) and `items` (text_content).
  Image/gif items have empty `content`; their `name` is still indexed.
- Query ranking: `ORDER BY bm25(item_search, 10.0, 1.0)` — column order is
  (name, content), so weighting name at 10 and content at 1 makes name matches
  rank above content-only matches in a single query. Return matched **items**
  (not groups) with their full path for display.
- The always-visible search bar (§5.2) uses this. A plain `CONTAINS` fallback on
  name is fine for the empty-FTS edge cases but FTS5 is the primary path.

### Recent Items (derived, not stored as a node)
Computed at open time:
```
SELECT items ordered by last_used_at DESC
WHERE last_used_at IS NOT NULL
  AND (recent_persistence == 0  OR  last_used_at >= now - recent_persistence)
LIMIT max_recent_items
```
- `max_recent_items == 0` → Recent Items list is disabled/empty.
- `recent_persistence == 0` → infinite (no time filter).
- `last_used_at` is set whenever an item is copied to the clipboard (§6).

---

## 5. The menu UI

Layout, left to right, all inside the `menu` window:
```
[drag handle] [ search input...................... ]
[ Recent Items                                   > ]
[ Group A                                        > ]   [ Group A children ... ]   [ content pane ]
[ Item X                                           ]
[ Group B                                        > ]
[ + ]  [ – ]
```

### 5.1 Columns
- Column 0 = children of root. Selecting/expanding a group appends the next
  column to the right showing that group's children. Arbitrary depth.
- Groups render a trailing `>` indicator. Items do not.
- The first entry of column 0 is always **Recent Items** (a virtual group whose
  children are the derived recent items). It also shows `>`.

### 5.2 Search bar
- Pinned at the top, auto-focused on open (type immediately, Spotlight-style).
- Non-empty query switches the menu into **search-results mode**: replace the
  column view with a flat list of matching item names (with a subtle path/breadcrumb),
  ranked per §4. Clearing the query returns to the tree.
- `ArrowDown` from the search input moves focus into the first result / first row.

### 5.3 Keyboard navigation
- `Up` / `Down`: move within the active column.
- `Right` / `Enter` on a group: expand into the next column and move focus there.
- `Left`: collapse the current column and return focus to the parent row.
- `Enter` on an item: select it → open the content pane (§5.5).
- `Escape`: close the whole menu.
- `CMD+C` / `CMD+V` / `CMD+Z` / `CMD+Shift+Z`: clipboard actions (§6). These are
  ordinary in-window accelerators because the menu holds focus — **no global
  event tap is needed**.
- Mouse hover on a group also expands it (matches the spec's "hovering expands").

### 5.4 Add / remove controls
- Small `+` and `–` buttons (per the spec). `+` adds into the currently focused
  level; `–` removes the currently focused node.
- `+` opens an **input modal** (Radix Dialog). For creating an item, use a large
  multi-line text field for the content; also capture a name. For creating a
  group, capture a name only. Offer a way to choose group-vs-item (e.g. a toggle
  in the add modal) — **[ASSUMPTION]** the spec implies both are creatable via `+`.
- `–` opens a **confirm modal** before deleting. Deleting a group cascades to its
  descendants (enforced by the FK `ON DELETE CASCADE`); the confirm copy must say so.
- Renaming: **[ASSUMPTION]** allow rename via a modal (double-click a row or a
  small edit affordance). Not explicitly requested; keep it, it is cheap.

### 5.5 Content pane
- Appears to the right of the columns when an item is selected.
- Text items: multi-line, **2-D scrollable** (Radix ScrollArea, both axes),
  monospace-ish, wrapping optional. Reasonably sized box governed by the Content
  Display Scale setting.
- Image/gif items: render the blob via the Tauri asset protocol
  (`convertFileSrc(blob_path)`). An `<img>` animates GIFs for free. The pane is
  scrollable when the image exceeds the box.

### 5.6 Item content model
Items are `{ name, content }`. Content is one of: text, still image, or animated
gif. Store per §4 (text inline; image/gif as a blob file + metadata row).

### 5.7 Drag handle
- A small region in the **top-left corner** with the attribute
  `data-tauri-drag-region`. Hold-drag it to move the native `menu` window.
- **Disable double-click-to-maximize** on that region (Tauri enables it by
  default; maximizing a menu is nonsense). Set the relevant window option / or
  suppress via the drag-region config.
- Dragging keeps window focus, so it must not trigger the blur-close.
- The moved position is **not persisted** — next open resets to the cursor.

---

## 6. Clipboard behavior

All clipboard actions operate on the **currently selected item** while the menu
is focused.

### CMD+C — copy item → system clipboard  (`copy_item_to_clipboard(item_id)`)
- `text` → write plain text (clipboard-manager plugin or arboard).
- `image` (still) → write image data (PNG/TIFF representation).
- `gif` → **write the raw GIF bytes to `NSPasteboard` under the UTI
  `com.compuserve.gif`** (custom Rust via `objc2-app-kit`). Also attach a bitmap
  fallback representation and, optionally, a temp file URL, in the same pasteboard
  item so bitmap-only consumers still get a still frame.
  - **Known limitation to document in the UI/README:** whether the animation
    survives depends on the *destination* app. Chat apps typically keep it;
    document editors often flatten to a still. ACM's responsibility ends at
    putting the correct representations on the pasteboard.
- On success, set the item's `last_used_at = now` (feeds Recent Items).

### CMD+V — paste system clipboard → into the item  (`paste_clipboard_into_item(item_id)`)
- Read `NSPasteboard`, preferring types in this order:
  1. `com.compuserve.gif` present → save raw bytes as a `.gif` blob, `content_type='gif'`.
  2. image data present → save as `.png` blob, `content_type='image'`.
  3. string present → `content_type='text'`, store `text_content`.
- This **overwrites** the item's content. Before overwriting, push the previous
  content into the undo buffer (below). Update `updated_at` and the FTS index.

### Undo buffer (clobber protection only)
- Single-level. Keyed by `item_id`. Holds the **previous** content (including the
  previous blob file, kept on disk, not deleted yet) plus a timestamp.
- Implement as a `Mutex<HashMap<i64, UndoEntry>>` in Rust state.
- TTL = the **Overwritten Item Persistence Duration** setting (default 60s).
  A background task (or lazy check on access) evicts entries older than the TTL
  and GCs their retained blob files.
- `CMD+Z` (`undo_paste(item_id)`) restores the previous content and stashes the
  current one as the single redo slot. `CMD+Shift+Z` (`redo_paste`) reverses it.
  Max 1 undo + 1 redo.
- If the setting is `0`, **undo/redo is disabled entirely** — do not retain
  previous content at all on paste.

---

## 7. Settings

Stored via `tauri-plugin-store` in `settings.json`. The settings window edits
them; changes apply **live** to the menu window (theme + scales) via an event or
by re-reading on next open.

| Setting | Type / range | Default | Effect |
|---|---|---|---|
| Color Scheme | `Dark` \| `Light` | `Dark` | Sets `data-theme` on the menu + settings UIs |
| Scale | 0.1 – 5 | 1.0 | Overall menu UI scale (root `rem`/zoom on the menu window) |
| Text Scale | 0.1 – 5 | 1.0 | Font size multiplier for text |
| Content Display Scale | 0.1 – 5 | 1.0 | Size of the content pane box (§5.5) |
| Overwritten Item Persistence Duration | 0–60 seconds | 60 | Undo/redo TTL; `0` disables undo/redo |
| Recent Items Persistence Duration | `0` = infinite, else N | 1 | Time filter for Recent Items (§4). **[ASSUMPTION]** unit = **days**; the original spec left the unit/max unclear — confirm with owner. Suggest range 0–30 days. |
| Max Recent Items | 0 – 100 | 25 **[ASSUMPTION]** | Cap on Recent Items; `0` disables the list. Default not specified by owner. |

Also expose the **global activation hotkey** as an editable setting (register via
`tauri-plugin-global-shortcut`; re-register on change; unregister on exit).
macOS may prompt for accessibility permission when registering — handle a
first-run prompt gracefully.

---

## 8. Rust command surface (Tauri commands)

Tree / data:
- `list_children(parent_id: Option<i64>) -> Vec<Node>`
- `get_node(id) -> Node`
- `create_group(parent_id, name) -> Node`
- `create_item(parent_id, name, content: NewContent) -> Node`
- `rename_node(id, name)`
- `delete_node(id)`  (cascades)
- `move_node(id, new_parent_id, new_position)`  (reorder / reparent)

Search / recent:
- `search(query) -> Vec<SearchHit>`  (ranked, items only, with path)
- `get_recent() -> Vec<Node>`

Content / clipboard:
- `get_item_content(item_id) -> ItemContent`
- `copy_item_to_clipboard(item_id)`
- `paste_clipboard_into_item(item_id) -> UndoToken`
- `undo_paste(item_id)`
- `redo_paste(item_id)`

Window / system:
- `open_menu_at_cursor()`  (invoked by the global-shortcut handler)
- `hide_menu()`
- `resize_menu(width, height)`  (or drive resize from the frontend window API)
- `open_settings_window()`

Frontend uses the Tauri asset protocol (`convertFileSrc`) to display blobs; no
command needed for reads of image/gif files.

---

## 9. Frontend component breakdown

- `App` — routes to `MenuView` (menu window) or `SettingsView` (settings window)
  based on the current window label.
- `MenuView`
  - `DragHandle`
  - `SearchBar`
  - `MenuColumns` → `MenuColumn` → `NodeRow` (`GroupRow` shows `>`, `ItemRow`)
  - `SearchResults` (flat ranked list; replaces columns when query non-empty)
  - `ContentPane` (text vs image/gif)
  - `AddRemoveControls` → `AddModal`, `ConfirmDeleteModal`, `RenameModal`
- `SettingsView` — the settings form of §7.
- `store.ts` (Zustand) — open path, selection, search query, settings, and
  actions that call the Tauri commands.
- `theme.ts` — apply Color Scheme + the three scale values (CSS variables /
  root font size on the menu window).

---

## 10. Build, run, bundle

Prerequisites (developer machine):
- Rust toolchain (`rustup`), Node, `pnpm`, Xcode Command Line Tools.

Commands:
- `pnpm install`
- `pnpm tauri dev` — development with hot reload.
- `pnpm tauri build` — release. Produces the `.app` and `.dmg` under
  `src-tauri/target/release/bundle/`.

`tauri.conf.json` essentials:
- `identifier`: e.g. `com.z3ro.acm`.
- macOS `minimumSystemVersion` set appropriately (target the owner's OS).
- `category`: `Utility`.
- Two windows declared (`menu` hidden by default; `settings` created on demand or
  declared and hidden). `menu`: decorations false, transparent true, alwaysOnTop,
  skipTaskbar, resizable false.
- Activation policy Accessory (set in Rust `setup`, not all versions expose it in
  config).
- Plugins: `global-shortcut`, `clipboard-manager`, `store`.

Personal (unsigned) install note — put this in the README:
- Gatekeeper will block an unsigned `.app` on first open. Either right-click →
  **Open** and confirm, or run `xattr -dr com.apple.quarantine /Applications/ACM.app`.
- Notarization is intentionally out of scope for v1.

---

## 11. Suggested build order (milestones)

1. **Scaffold & shell.** Tauri v2 + React + Vite + Tailwind. Tray icon with
   Settings/Quit. Accessory activation policy (no dock icon). Global shortcut
   opens a placeholder `menu` window at the (clamped) cursor position; Escape and
   blur hide it. Dark theme baseline.
2. **Database layer.** `rusqlite` (bundled) + schema + migrations + FTS5 table and
   sync triggers. Implement tree CRUD commands. Seed a few nodes for testing.
3. **Menu UI.** Columns, `>` indicators, keyboard + hover navigation, `+`/`–`
   controls, add/confirm/rename modals, single-window growing layout.
4. **Item content.** Blob storage under `blobs/`, content pane for text and
   image/gif via the asset protocol. Content Display Scale.
5. **Clipboard.** `copy_item_to_clipboard` (text/image/gif with the GIF UTI path),
   `paste_clipboard_into_item`, and the single-level undo/redo buffer with TTL.
6. **Search & Recent Items.** FTS5 query with bm25 name-weighted ranking;
   search-results mode; derived Recent Items with the two recent-related settings.
7. **Settings window.** `tauri-plugin-store`; all settings of §7; live application
   of theme and the three scales; editable activation hotkey with re-registration.
8. **Polish & window resize.** Content-driven resize + monitor clamping, drag
   handle (double-click-maximize disabled), open animation if desired.
9. **Bundle.** `pnpm tauri build`; verify the `.dmg`, drag-to-Applications, and
   the unsigned first-open flow; write the README notes.

---

## 12. Open questions to confirm with the owner
- **Recent Items Persistence Duration** unit and max (assumed days, 0–30, default 1).
- **Max Recent Items** default (assumed 25).
- Whether `+` should create both groups and items (assumed yes, via a toggle in
  the add modal), and whether rename should be included (assumed yes).
- Default global activation hotkey to ship with.