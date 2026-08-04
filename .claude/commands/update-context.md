---
description: Reconcile SPEC.md and the nested CLAUDE.md files with the current code
argument-hint: "[optional: area or scope to focus on]"
---

Update this repo's context files so they match the current state of the code, following
the "Recycling context" rules in the root `CLAUDE.md`.

Scope: $ARGUMENTS (if empty, review everything that changed since the context files were
last updated — use `git status`, `git diff`, and recent `git log` to find it).

Do this:

1. Identify what changed in the code relative to what `SPEC.md` and the nested `CLAUDE.md`
   files currently describe (commands, DB schema/triggers, window/process model, plugins,
   capabilities, settings keys, build/bundle, feature behavior, gotchas).
2. Update **`SPEC.md`** — edit the relevant greppable section(s) in place. Keep the
   "Tauri commands (wiring)" list exact (command ↔ `api.*` ↔ file). Don't append
   changelog entries; state the current design.
3. Update the **nested `CLAUDE.md`** in each affected source folder (`src-tauri/src/`,
   `src/`, `src/components/`, `src/views/`) — current design + any new gotcha/invariant/
   pattern. Create a `CLAUDE.md` for a new feature folder if one is missing. Do not touch
   the repo-root `CLAUDE.md` unless the orientation/commands/recycling rules themselves
   changed.
4. Keep entries terse and true; delete stale notes; don't duplicate a fact across files
   or restate what the code plainly shows — link areas by name.
5. Report a short summary of what you changed and why. Do not commit unless asked.
