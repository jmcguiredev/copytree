# NOTES — frontend core (`src/`)

Working context for the top-level frontend modules. UI pieces are in
`components/NOTES.md` and `views/NOTES.md`. See `SPEC.md` for the full map.

## Files

- `App.tsx` — routes on `getCurrentWindow().label` → `MenuView` / `SettingsView`.
- `main.tsx` — mounts React, sets an initial dark `data-theme` (settings override).
- `api.ts` — typed `invoke` wrappers. **One entry per Rust command**; keep names/args
  in sync with `commands.rs` (+ `lib.rs` window commands). camelCase arg keys.
- `types.ts` — mirrors the serde types (`Node`, `NewContent`, `ItemContent`,
  `SearchHit`). Update alongside `models.rs`.
- `store.ts` — Zustand store (see below).
- `settings.ts` — `settings.json` access + `applyAppearance`.
- `index.css` — Tailwind import + `--acm-*` theme tokens (light/dark via `data-theme`).

## Store (`store.ts`)

Single source of menu UI state:
- `columns[]` — one per open level; `columns[0]` = root children **with the virtual
  Recent Items group** (`RECENT_ID = -1`) pinned first. `loadColumn(parentId)` handles
  the sentinel (calls `getRecent`) and re-prepends Recent for the root column.
- `focus {col,id}` — keyboard cursor. `selectedItemId` — content-pane item;
  `selectedItemName` — header fallback for search hits not in a column.
- Search mode: `searchQuery`/`searchResults`/`searchFocus`. Non-empty query ⇒
  `MenuView` shows `SearchResults` instead of columns.
- `contentScale`/`uiScale` — set by `applyAppearance`; `contentVersion` bump forces
  the content pane to refetch (after paste/undo/redo).
- Gotcha: mutating actions map `RECENT_ID` parent → root (`null`); you can't add into
  the virtual group. Deeper columns are truncated on focus change/selection.

## Settings (`settings.ts`)

`loadSettings()` reads all keys (defaults for missing); `setSetting(k,v)` writes+saves;
`applyAppearance(s)` sets `data-theme`, root font-size (Text Scale), `body{zoom}`
(overall Scale), and pushes `contentScale`/`uiScale` into the store. The store file is
shared with Rust — keep key names in sync with `settings.rs`. The **hotkey** is changed
via `api.setActivationHotkey` (Rust re-registers + persists), not `setSetting`.
