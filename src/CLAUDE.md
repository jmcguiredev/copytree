# CLAUDE.md — frontend core (`src/`)

Working context for the top-level frontend modules. UI pieces are in
`components/CLAUDE.md` and `views/CLAUDE.md`. See `SPEC.md` for the full map.

## Files

- `App.tsx` — routes on `getCurrentWindow().label` → `MenuView` / `SettingsView`.
- `main.tsx` — mounts React, sets an initial dark `data-theme` (settings override).
- `api.ts` — typed `invoke` wrappers. **One entry per Rust command**; keep names/args
  in sync with `commands.rs` (+ `lib.rs` window commands). camelCase arg keys.
- `types.ts` — mirrors the serde types (`Node`, `NewContent`, `ItemContent`,
  `SearchHit`). Update alongside `models.rs`.
- `store.ts` — Zustand store (see below).
- `settings.ts` — `settings.json` access + `applyAppearance`.
- `index.css` — Tailwind import + `--copytree-*` theme tokens (light/dark via `data-theme`).

## Store (`store.ts`)

Single source of menu UI state:
- `columns[]` — one per open level; `columns[0]` = root children **with the virtual
  Recent Items group** (`RECENT_ID = -1`) pinned first. `loadColumn(parentId)` handles
  the sentinel (calls `getRecent`) and re-prepends Recent for the root column.
- `focus {col,id}` — keyboard cursor. `selectedItemId` — content-pane item, kept in
  lockstep with focus by `contentForFocus` (an item shows its content the moment it's
  focused via hover/arrows/group-enter; a group clears it). `selectedItemName` — header
  fallback for search hits not in a column.
- Search mode: `searchQuery`/`searchResults`/`searchFocus`. Non-empty query ⇒
  `MenuView` shows `SearchResults` instead of columns.
- `draft {col,kind}` — inline new-group/item being named in a column;
  `beginDraft`/`commitDraft` (empty name cancels; items created empty, filled by paste).
- `pendingDelete` — delete-confirm modal open flag (`requestDelete`/`closeDelete`), shared by
  the Delete hotkey and the – button; `removeFocused` clears it and performs the delete.
- `contentScale`/`uiScale`/`columnWidths`/`selectMode`/`newItemHotkey`/`newGroupHotkey`/
  `deleteHotkey` — seeded by `applyAppearance` (from settings) so behavior/appearance apply live;
  `columnWidths` is also updated live during a splitter drag. `contentVersion` bump forces
  the content pane to refetch (after paste/undo/redo). `openSeq` bumps in `init` on every
  overlay (re)open so per-row scroll-into-view effects re-run even when the focused id is
  unchanged.
- Gotcha: mutating actions map `RECENT_ID` parent → root (`null`); you can't add into
  the virtual group. Deeper columns are truncated on focus change/selection.

## Settings (`settings.ts`)

`loadSettings()` reads all keys (defaults for missing); `setSetting(k,v)` writes+saves;
`applyAppearance(s)` sets `data-theme`, root font-size (Text Scale), `body{zoom}`
(overall Scale), the `--copytree-font` (Font) and `--copytree-accent` (Theme Color, cleared →
per-theme default) custom properties, and pushes `contentScale`/`uiScale`/`selectMode`/
`newItemHotkey`/`newGroupHotkey` into the store. The store file is shared with Rust —
keep key names in sync with `settings.rs` (the new frontend-only keys aren't read by
Rust). The **activation hotkey** is changed via `api.setActivationHotkey` (Rust
re-registers + persists), not `setSetting`; the **create hotkeys** are plain settings.
`shortcutFromEvent(e)` is the shared modifier+`code` serializer for both capture and
runtime matching.

**Scale lockout guard**: `scale`/`textScale`/`contentScale` (`SCALE_KEYS`) run through
`safeScale` — clamped to `[0.25×default, 5]` — in both `loadSettings` and
`applyAppearance`, so a null/0/typo'd value can't shrink the UI past recovery. The
Settings inputs use `scaleMin(key)` as their floor, and `SettingsView` calls
`applyAppearance(s, false)` so the settings window itself renders at 1× (always usable,
rescues a bad menu scale). **Font** family names come from `api.listSystemFonts`
(WKWebView has no `queryLocalFonts`).
