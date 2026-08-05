# CLAUDE.md — views (`src/views/`)

The two window roots (routed by label in `App.tsx`). See `SPEC.md`.

## `MenuView.tsx` (the overlay)

Owns everything that isn't a child component's concern:
- **On mount + on `onFocusChanged(true)`** (`refresh()`): re-init the tree, re-apply
  appearance (`loadSettings`→`applyAppearance`), focus the search box, and play the
  open animation (`panelRef.animate`). This is how re-showing the hidden window resets
  state and re-applies appearance on refocus.
- **Live settings**: also listens for `SETTINGS_CHANGED_EVENT` (`acm://settings-changed`,
  emitted by `setSetting`) and re-applies appearance without a refocus — so while the
  settings window is open and the overlay stays visible (Rust keeps it open when settings
  is up), scale/font/theme changes update the menu immediately.
- **Global keydown** handler (order matters): Escape → `hide_menu`; skip when typing in
  an input/textarea; **clipboard** Cmd/Ctrl+C/V/Z/Shift+Z on the selected/focused item;
  then **search-mode** nav (↑↓/Enter over results) if a query is active. **Cmd/Ctrl+↑ / ↓**
  (handled in the modifier branch) jump the selection to the top / bottom of the current
  list (search results or column). Else **tree**
  nav — first the app-local **create/delete hotkeys** (`store.newItemHotkey`/`newGroupHotkey`
  → `beginDraft`, `store.deleteHotkey` → `requestDelete` which opens the shared
  `ConfirmDeleteModal`; matched via `shortcutFromEvent`, bare-key safe since we're not in a
  field or search), then (↑↓ within column, →/Enter expand, ← collapse, Enter select).
  While `store.pendingDelete` is set the whole handler bails so the modal owns the keyboard
  and focus can't move out from under the confirmation.
- **Sizing**: the window is user-resizable and its size is persisted/restored by the
  backend — there's no content-driven `setSize` here. `ResizeGrips` (right/bottom/corner)
  call `getCurrentWindow().startResizeDragging(dir)` to resize the borderless window; the
  columns/content flex to fill it and the row scrolls horizontally (see `MenuColumns`).
- Drag handle uses `data-tauri-drag-region`; double-click maximize is disabled
  (`onDoubleClick preventDefault` + `maximizable:false` on the window). The handle
  needs `core:window:allow-start-dragging` in capabilities — `core:default` doesn't
  grant it, and without it the drag is silently denied (no error, just nothing moves).

## `SettingsView.tsx`

Loads settings on mount and `applyAppearance`s to itself. Each control → `update()` →
`setSetting` + `applyAppearance`. The reusable `HotkeyCapture` control builds a `Shortcut`
string from modifiers + `e.code` (`hotkeyFromEvent`, `allowBare` for the app-local
create/delete hotkeys — the global activation hotkey still requires a modifier). **Gotcha:**
while armed it listens on `window` (keydown accumulates the chord, first **keyup** commits,
Escape cancels) — a `<button>`-local `onKeyDown` never fired because **WebKit doesn't focus a
button on click**, which was why "Press keys…" did nothing. The **Activation Hotkey** field
routes its capture through `api.setActivationHotkey` (validates/re-registers/persists,
surfaces an error if rejected); the **New Item/Group/Delete Hotkey** fields just `update()`.
Theme Color uses `ColorPicker`. `formatHotkey` prettifies for display only.

**Configuration / Database import-export** (`ActionButton` → native `save`/`open` dialog →
the `portation` commands). Config import re-reads the store, re-applies appearance,
re-registers the hotkey, and emits `SETTINGS_CHANGED_EVENT`; DB import replaces the data and
the tree shows on the menu's next open.

Gotcha: this project uses the automatic JSX runtime — import React types
(`type KeyboardEvent as ReactKeyboardEvent`, `type ReactNode`), don't reference `React.*`.
