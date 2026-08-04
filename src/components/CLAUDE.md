# CLAUDE.md — components (`src/components/`)

Presentational pieces of the menu overlay. State lives in `../store.ts`; see
`../CLAUDE.md` and `SPEC.md`.

## Pieces

- `MenuColumns.tsx` → `NodeRow.tsx` — the cascade. Each column renders one level;
  `NodeRow` shows `›` for groups and highlights focused / open rows. Hover a group
  expands it (`expandGroup(col,node,false)`); click a group expands + enters. Focusing
  an item — hover, arrow keys, or entering a group onto it — opens its content pane
  immediately (no Enter/click needed); the store's `contentForFocus` derives this, so
  `focusRow`/`moveFocus`/`expandGroup` all set the content pane in lockstep with focus.
- `SearchResults.tsx` — flat ranked list shown when `searchQuery` is non-empty; rows
  show name + breadcrumb; click / Enter → `openSearchHit`.
- `SearchBar.tsx` — controlled by `searchQuery`; ArrowDown drops focus into results/rows.
- `ContentPane.tsx` — fetches `getItemContent` on `[selectedItemId, contentVersion]`;
  renders text (`<pre>`, 2-D scroll) and image/gif via `convertFileSrc`. Name header
  resolves from a visible column, else `selectedItemName` (search).
- `AddRemoveControls.tsx` — `+ / – / Rename`, owns the modal open state; targets the
  focused level / node.
- `modals.tsx` — Radix `AddModal` / `RenameModal` / `ConfirmDeleteModal`.
- `Select.tsx` / `NumberField.tsx` — non-native form controls used by `SettingsView`
  (the native ones felt clunky). `Select` portals its list to `<body>` (fixed position,
  so the settings scroll container can't clip it) with keyboard nav + type-ahead;
  `NumberField` is a stepper that commits on blur/Enter and reverts empty/invalid input
  to the last valid value (so a scale field can't be emptied into a lockout).

## Gotchas

- **`modals.tsx` name clash**: the dialog plugin's `open` is imported as
  `openFileDialog` because `AddModal` already has an `open` prop.
- **AddModal** kinds: `Text` (textarea → `addItem`), `Image / GIF` (native file picker
  → `addFileItem` → `create_file_item_cmd`), `Group` (`addGroup`). File items default
  their name to the file's basename. GIF animation is preserved (raw bytes) by the
  backend; other images are transcoded to PNG.
- Rows are `<button>`s; keyboard nav is handled globally in `MenuView`, not per-row.
  Styling uses inline `--acm-*` vars (theme-aware), not Tailwind color classes.
- Delete confirm copy must keep warning that groups cascade.
