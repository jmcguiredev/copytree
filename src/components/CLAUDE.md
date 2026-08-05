# CLAUDE.md — components (`src/components/`)

Presentational pieces of the menu overlay. State lives in `../store.ts`; see
`../CLAUDE.md` and `SPEC.md`.

## Pieces

- `MenuColumns.tsx` → `NodeRow.tsx` — the cascade. Each column has a per-depth-index
  width (`store.columnWidths` / `columnWidth()`, default `DEFAULT_COL_W`) resized by its
  right-edge splitter and persisted to `settings.columnWidths` on drag end; the content
  pane flexes to fill and the row scrolls horizontally when columns overflow. Also renders
  the inline `DraftRow` (new group/item naming) in the active column. Each column renders
  one level;
  `NodeRow` shows `›` for groups and highlights focused / open rows. In the default
  **hover** select mode, hovering a group expands it (`expandGroup(col,node,false)`) and
  hovering an item focuses it; in **click** mode (`store.selectMode`), hovering only paints
  a pre-selection tint (`--copytree-hover`) and the click *selects*, mirroring keyboard focus:
  an item focuses, a group focuses + expands but stays put (turns accent, doesn't dive in).
  In hover mode a click still enters a group.
  Focusing an item — hover, arrow keys, or entering a group onto it — opens its content pane
  immediately (no Enter/click needed); the store's `contentForFocus` derives this, so
  `focusRow`/`moveFocus`/`expandGroup` all set the content pane in lockstep with focus.
  **Double-click** a row → inline `RenameInput` (Enter/blur commits, Escape/empty cancels;
  Recent group excluded). On focus, a row **scroll-paginates** (`useLayoutEffect` on
  `[isFocused, store.openSeq]`; its `offsetParent` is the scroll container): a row below the
  fold jumps to the **top** of the list, a row above the fold to the **bottom** (inverted) —
  direction inferred from geometry. Keying on `openSeq` re-runs it on every overlay (re)open
  so a persisted stale scroll position is corrected against the restored focus even when the
  focused id didn't change.
- `SearchResults.tsx` — flat ranked list shown when `searchQuery` is non-empty; rows
  show name + breadcrumb; click / Enter → `openSearchHit`.
- `SearchBar.tsx` — controlled by `searchQuery`; ArrowDown drops focus into results/rows.
- `ContentPane.tsx` — fetches `getItemContent` on `[selectedItemId, contentVersion]`;
  renders text (`<pre class="hljs">`, 2-D scroll) with highlight.js (pinned `language` or
  `highlightAuto`) and image/gif via `convertFileSrc`. Text shows a searchable language
  picker (`api.setItemLanguage`; `""` = Auto, label shows the detected language). Token
  colors are theme-aware CSS in `index.css`. Name header resolves from a visible column,
  else `selectedItemName` (search).
- `AddRemoveControls.tsx` — `+ / – / Rename`; targets the focused level / node. Rename
  modal state is local, but the **delete-confirm** state lives in the store
  (`pendingDelete`/`requestDelete`/`closeDelete`) so the Delete hotkey (in MenuView) and the
  – button open the same `ConfirmDeleteModal`.
- `modals.tsx` — Radix `AddModal` / `RenameModal` / `ConfirmDeleteModal`.
- `ColorPicker.tsx` — non-native RGB color selector (Theme Color): a swatch trigger opens a
  portalled popover with custom draggable sliders — R/G/B (each a 0→255 channel gradient)
  plus a **black-level (K)** slider that scales all channels toward black (preserving hue) —
  plus a hex field; emits `#rrggbb`. Falls back to the live `--copytree-accent` when its value is "".
- `Select.tsx` / `NumberField.tsx` — non-native form controls used by `SettingsView`
  (the native ones felt clunky). `Select` portals its list to `<body>` (fixed position,
  so the settings scroll container can't clip it) with keyboard nav + type-ahead; with
  `searchable` the trigger is a typable filtering combobox (the Font picker) and
  `optionStyle` renders each row in its own font. `NumberField` is a stepper that commits
  on blur/Enter and reverts empty/invalid input to the last valid value (so a scale field
  can't be emptied into a lockout).

## Gotchas

- **`modals.tsx` name clash**: the dialog plugin's `open` is imported as
  `openFileDialog` because `AddModal` already has an `open` prop.
- **AddModal** kinds: `Text` (textarea → `addItem`), `Image / GIF` (native file picker
  → `addFileItem` → `create_file_item_cmd`), `Group` (`addGroup`). File items default
  their name to the file's basename. GIF animation is preserved (raw bytes) by the
  backend; other images are transcoded to PNG.
- Rows are `<button>`s; keyboard nav is handled globally in `MenuView`, not per-row.
  Styling uses inline `--copytree-*` vars (theme-aware), not Tailwind color classes.
- Delete confirm copy must keep warning that groups cascade.
