# CLAUDE.md — Rust backend (`src-tauri/src/`)

Working context for the Tauri/Rust side. See `SPEC.md` for the full map.

## Layout

- `lib.rs` — `run()`: plugins, Accessory policy, DB open/seed/manage, tray, hotkey,
  window commands, invoke handler. Add new commands to the `generate_handler!` list.
- `commands.rs` — data/clipboard/search commands. Convention: a **pure fn** taking
  `&Connection` (testable) + a thin `#[tauri::command] *_cmd` wrapper that locks
  state and maps errors to `String`.
- `db.rs`, `models.rs`, `blobs.rs`, `clipboard.rs`, `settings.rs` — see SPEC.
- `portation.rs` — import/export commands. Settings ↔ a JSON file; database ↔ a `zip`
  (`copytree.db` + `blobs/`, via the `zip` crate). Export holds the `Db` lock so the file
  snapshot is between transactions. Import holds the lock across extraction, then swaps
  the connection in place (`*guard = db::open(...)`) — no restart; only `copytree.db`/`blobs/*`
  entries are extracted (traversal entries skipped).
- `fonts.rs` — macOS-only; `NSFontManager` family enumeration. It's `MainThreadOnly`,
  so `list_system_fonts` (in `lib.rs`) calls it via `app.run_on_main_thread` and ships
  the result back over a channel. Off-macOS the command returns an empty list.

## Conventions & gotchas

- **Arg casing**: JS passes camelCase; Rust params are snake_case — Tauri converts.
  Command return errors are `Result<T, String>` (`CmdResult`) to cross IPC.
- **DB state**: `State<Db>`; `db.0.lock()`. `create_item`/`create_blob_item` need
  `&mut Connection` (transaction) → lock `mut`.
- **FTS**: `item_search` is a regular FTS5 table kept in sync by triggers in
  `SCHEMA_V1`. `recursive_triggers=ON` is required so cascade deletes clear it — if
  you change delete paths, keep the trigger-firing behavior. Editing `text_content`
  is what re-indexes content (trigger is `AFTER UPDATE OF text_content`).
- **Migrations**: bump via `PRAGMA user_version`; each `SCHEMA_Vn` block is guarded by
  `if version < n`. Never edit an existing block for shipped installs. `SCHEMA_V2` adds
  `items.language` (text-item highlight language; NULL = auto-detect).
- **Blobs**: content-addressed (`store_bytes`), deduped by sha256. Do **not** delete
  blobs on overwrite/undo — they may be shared. No GC yet.
- **Clipboard is macOS-only** (`objc2-app-kit`), deps target-gated to macOS. Type
  statics (`NSPasteboardType*`) need `unsafe`; methods are safe wrappers. Follows
  arboard's clearContents+setData pattern (no `declareTypes`). Not headless-testable.
- **Settings**: read from the store via `settings::load(app)` at call time so changes
  take effect live (undo TTL, recent params). Don't cache them in statics.
- **Undo**: single-level, `UndoState`. Pure fns take the map + a `ttl: Duration`
  (`ZERO` disables) so they're unit-testable without the pasteboard.

## Testing

`cargo test` — pure fns against an in-memory DB (`db::open_in_memory`). Cover new DB
logic here; assert FTS/undo/cascade side effects. Blob/image paths use a temp dir.
Anything touching `NSPasteboard` or windows can't be unit-tested — verify in the app.

## Adding a command

1. Pure fn in `commands.rs` (if it has testable logic) + `*_cmd` wrapper.
2. Register in `lib.rs` `generate_handler!`.
3. Add `api.<method>` in `src/api.ts` and a type if needed in `src/types.ts`.
4. If it uses a plugin/core JS API, add the permission to `capabilities/default.json`.
