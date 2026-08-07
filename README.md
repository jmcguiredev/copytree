# Copy Tree

A macOS menubar utility that puts a hotkey-activated, infinitely-nestable context
menu at your cursor for storing and retrieving text, image, and animated-GIF
snippets. Dark-mode-first, no dock icon, no clipboard-history snooping — Copy Tree only
touches the system pasteboard when you explicitly copy or paste.

> Personal-use project. The build is intentionally **unsigned** (see
> [Installing](#installing-unsigned-build)).

## Features

- **Global hotkey → overlay at the cursor.** Default **⌘⇧V** (configurable). The
  overlay opens where your mouse is, clamped so it never falls off-screen.
- **Infinite nesting.** Groups and items to any depth, browsed as a cascading
  column menu. Hover or → to expand, ← to collapse.
- **Text, images, and animated GIFs.** Items render in a content pane; GIFs
  animate.
- **Copy / paste on the selected item.** `⌘C` copies an item to the system
  clipboard; `⌘V` replaces the item's content with the clipboard. `⌘Z` / `⌘⇧Z`
  undo/redo the last paste (single level, time-limited).
- **Fast search.** Type to search names and contents; name matches rank first.
- **Recent Items.** A virtual group of what you copied most recently.
- **Settings.** Color scheme, three independent scales, undo and recent-items
  durations, and an editable activation hotkey.

## Keyboard

| Key | Action |
|---|---|
| Activation hotkey (default ⌘⇧V) | Open the overlay at the cursor |
| Type | Search (names + contents) |
| ↑ / ↓ | Move within a column / search results |
| → or Enter (on a group) | Expand into the next column |
| ← | Collapse the current column |
| Enter (on an item) | Open its content pane |
| ⌘C / ⌘V | Copy item → clipboard / paste clipboard → item |
| ⌘Z / ⌘⇧Z | Undo / redo the last paste |
| Esc, or click away | Close the overlay |

## GIF animation caveat

When you copy a GIF item, Copy Tree writes the raw GIF bytes to the pasteboard under the
`com.compuserve.gif` UTI along with a still-image fallback. **Whether the
animation survives depends on the destination app** — chat apps typically keep it,
document editors often flatten it to a still frame. Copy Tree's responsibility ends at
putting the correct representations on the pasteboard.

## Developing

Prerequisites: Rust toolchain (`rustup`, **≥ 1.85** — a Tauri dependency needs
edition 2024), Node, `pnpm`, and Xcode Command Line Tools.

```sh
pnpm install
pnpm tauri dev      # run with hot reload
```

Run the tests:

```sh
cd src-tauri && cargo test    # data layer, FTS, clipboard undo/redo
pnpm build                    # typecheck + build the frontend
```

macOS will prompt for **Accessibility** permission the first time the global
shortcut is registered — grant it so the hotkey works.

## Building a release

```sh
pnpm tauri build
```

This produces the app bundle and installer under
`src-tauri/target/release/bundle/`:

- `macos/Copy Tree.app`
- `dmg/Copy Tree_0.1.0_aarch64.dmg`

## Installing (unsigned build)

The build is not code-signed or notarized, so Gatekeeper blocks it on first open.
Either:

- **Right-click** `Copy Tree.app` → **Open**, then confirm in the dialog; or
- clear the quarantine flag after copying it to `/Applications`:

  ```sh
  xattr -dr com.apple.quarantine "/Applications/Copy Tree.app"
  ```

Notarization is intentionally out of scope for v1.

## Where data lives

Everything is under `~/Library/Application Support/com.z3ro.copytree/`:

```
copytree.db          # SQLite: the tree, item metadata, full-text index
blobs/          # image and gif payloads, named <sha256>.<ext>
settings.json   # your settings
```

## Tech

Tauri v2 (Rust + WKWebView) · React + TypeScript + Vite · Tailwind CSS · Radix ·
Zustand · SQLite (`rusqlite`, FTS5) · native `NSPasteboard` via `objc2`.

See [`SPEC.md`](SPEC.md) for the architecture & wiring reference and
[`CLAUDE.md`](CLAUDE.md) for repo orientation.
