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
  then **search-mode** nav (↑↓/Enter over results) if a query is active. **Cmd/Ctrl+↑**
  (handled in the modifier branch) jumps the selection to the top of the current list
  (search results or column). Else **tree**
  nav — first the app-local **create hotkeys** (`store.newItemHotkey`/`newGroupHotkey`
  matched via `shortcutFromEvent` → `beginDraft`; bare-key safe since we're not in a field
  or search), then (↑↓ within column, →/Enter expand, ← collapse, Enter select).
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
`setSetting` + `applyAppearance`. The reusable `HotkeyCapture` control captures a keydown
and builds a `Shortcut` string from modifiers + `e.code` (`hotkeyFromEvent`, `allowBare`
for the app-local create hotkeys — the global activation hotkey still requires a modifier).
The **Activation Hotkey** field routes its capture through `api.setActivationHotkey`
(validates/re-registers/persists, surfaces an error if rejected); the **New Item/Group
Hotkey** fields just `update()` the setting. Theme Color uses `ColorPicker`. `formatHotkey`
prettifies for display only.

Gotcha: this project uses the automatic JSX runtime — import React types
(`type KeyboardEvent as ReactKeyboardEvent`, `type ReactNode`), don't reference `React.*`.
