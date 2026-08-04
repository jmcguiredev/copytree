# CLAUDE.md — views (`src/views/`)

The two window roots (routed by label in `App.tsx`). See `SPEC.md`.

## `MenuView.tsx` (the overlay)

Owns everything that isn't a child component's concern:
- **On mount + on `onFocusChanged(true)`** (`refresh()`): re-init the tree, re-apply
  appearance (`loadSettings`→`applyAppearance`), focus the search box, and play the
  open animation (`panelRef.animate`). This is how settings changes take effect live
  and why re-showing the hidden window resets state.
- **Global keydown** handler (order matters): Escape → `hide_menu`; skip when typing in
  an input/textarea; **clipboard** Cmd/Ctrl+C/V/Z/Shift+Z on the selected/focused item;
  then **search-mode** nav (↑↓/Enter over results) if a query is active; else **tree**
  nav (↑↓ within column, →/Enter expand, ← collapse, Enter select).
- **Resize**: effect on `[columnCount, selectedItemId, searchActive, uiScale]` computes
  width, `setSize(width×uiScale, 420×uiScale)`, then `api.clampMenu()` to keep it on the
  monitor. Column/content/results widths are the `*_W` consts — keep them in sync with
  the components' `w-[…]` classes.
- Drag handle uses `data-tauri-drag-region`; double-click maximize is disabled
  (`onDoubleClick preventDefault` + `maximizable:false` on the window). The handle
  needs `core:window:allow-start-dragging` in capabilities — `core:default` doesn't
  grant it, and without it the drag is silently denied (no error, just nothing moves).

## `SettingsView.tsx`

Loads settings on mount and `applyAppearance`s to itself. Each control → `update()` →
`setSetting` + `applyAppearance`. The **hotkey** field captures a keydown, builds a
`Shortcut` string from modifiers + `e.code` (`hotkeyFromEvent`), and calls
`api.setActivationHotkey` (which validates/re-registers/persists) — surfaces an error if
the shortcut is rejected. `formatHotkey` prettifies for display only.

Gotcha: this project uses the automatic JSX runtime — import React types
(`type KeyboardEvent as ReactKeyboardEvent`, `type ReactNode`), don't reference `React.*`.
