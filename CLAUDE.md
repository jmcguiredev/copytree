# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What ACM is

A macOS menubar utility: a global hotkey opens a borderless, infinitely-nestable
cascading context menu at the cursor for storing/retrieving text, still-image, and
animated-GIF clipboard snippets. No dock icon, dark-mode-first. macOS only.

## Orientation — read these first

- **`SPEC.md`** — architecture and wiring reference (greppable headers): windows,
  data model, the full command list, clipboard/undo, search/recent, settings,
  capabilities, build. Start here for "how does X connect to Y".
- **`NOTES.md`** in each source folder — practical working context and gotchas for
  that area: `src-tauri/src/` (backend), `src/` (frontend core), `src/components/`,
  `src/views/`. Read the one for the folder you're editing.

The full product spec that this was built from is preserved in git history (it was
tracked as `PLAN.md` up to the initial release); SPEC.md + NOTES.md supersede it.

## Commands

- `pnpm install`
- `pnpm tauri dev` — dev with hot reload (restart it when you change Rust deps,
  `tauri.conf.json`, or capabilities — those are compiled into the binary).
- `pnpm build` — frontend typecheck + build (`tsc && vite build`).
- `cd src-tauri && cargo test` — backend unit tests (data layer, FTS, blob dedup,
  clipboard undo/redo, search/recent).
- `pnpm tauri build` — release `.app`/`.dmg` under `src-tauri/target/release/bundle/`.

Prerequisites: Rust toolchain (`rustup`, **≥ 1.85** — a Tauri transitive dep needs
edition 2024; run `rustup update stable` on an `edition2024` error), Node, `pnpm`,
Xcode Command Line Tools. The build is intentionally **unsigned** (personal use).

## Verifying changes

Automated coverage is `cargo test` + `tsc`/`vite build`. The rest is manual: native
`NSPasteboard`, the tray/hotkey/overlay interaction, window sizing, drag-to-Applications,
and Gatekeeper first-open cannot be verified headlessly — exercise them in `pnpm tauri dev`.
Prefer factoring new backend logic into pure functions over `&Connection` so it can be
unit-tested without the pasteboard or a window (see `src-tauri/src/NOTES.md`).

## Scope guardrails (non-goals)

No code signing/notarization, no Windows/Linux QA, no system-pasteboard monitoring/history
(ACM only touches the pasteboard on explicit Cmd+C/Cmd+V), no multi-level undo. Keep code
portable where it's free, but don't invest in cross-platform work.

## Recycling context (keep SPEC.md & NOTES.md current)

These files are the durable memory of the codebase — maintaining them is part of the
work, not an afterthought. The `/update-context` command runs this review on demand;
also do it whenever a change lands that affects the notes below.

- **Update `SPEC.md`** when you change architecture or wiring: a command added/renamed/
  removed (keep the "Tauri commands (wiring)" list exact), the DB schema or triggers,
  the window/process model, plugins or capabilities, settings keys, or the build/bundle.
  Edit the relevant greppable section in place; don't append changelog entries.
- **Update the folder's `NOTES.md`** when you change how that area works or discover a
  gotcha worth remembering (a non-obvious invariant, a footgun, an extension pattern).
- Keep it terse and true: state the current design, not its history (git has history).
  Delete notes that no longer hold. Don't restate what the code plainly shows or
  duplicate the same fact across files — link areas by name instead.
- After editing code, ask: does any header in SPEC.md or line in a NOTES.md now describe
  something that changed? If yes, fix it in the same change.
