import { useEffect, useRef, useState } from "react";
import type { Node } from "../types";
import { api } from "../api";
import { RECENT_ID, useMenu } from "../store";

interface Props {
  node: Node;
  col: number;
}

// A single row in a column. Groups show a trailing `>`; the row is highlighted
// when focused or when it is the open group feeding the next column.
export default function NodeRow({ node, col }: Props) {
  const focus = useMenu((s) => s.focus);
  const columns = useMenu((s) => s.columns);
  const activate = useMenu((s) => s.activate);
  const expandGroup = useMenu((s) => s.expandGroup);
  const focusRow = useMenu((s) => s.focusRow);
  const selectMode = useMenu((s) => s.selectMode);
  const refreshColumn = useMenu((s) => s.refreshColumn);
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);

  const isGroup = node.kind === "group";
  const isFocused = focus.col === col && focus.id === node.id;
  const isOpen = columns[col + 1]?.parentId === node.id;
  const canRename = node.id !== RECENT_ID;

  // Double-click the name to rename inline (PLAN §5.4). The virtual Recent group
  // isn't renamable.
  if (editing) {
    return (
      <RenameInput
        initial={node.name}
        onCommit={async (name) => {
          setEditing(false);
          const trimmed = name.trim();
          if (trimmed && trimmed !== node.name) {
            await api.renameNode(node.id, trimmed);
            await refreshColumn(col);
          }
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <button
      type="button"
      role="option"
      aria-selected={isFocused}
      onClick={() => void activate(col, node)}
      onDoubleClick={(e) => {
        if (!canRename) return;
        e.preventDefault();
        setEditing(true);
      }}
      onMouseEnter={() => {
        // Click-to-select: hovering only shows a pre-selection tint; the click
        // handler does the selecting. Hover-to-select (default): hovering a group
        // expands it (PLAN.md §5.3) and hovering an item focuses it, opening its
        // content pane immediately (contentForFocus in the store).
        if (selectMode === "click") {
          setHovered(true);
          return;
        }
        if (isGroup) void expandGroup(col, node, false);
        else focusRow(col, node.id);
      }}
      onMouseLeave={() => setHovered(false)}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm outline-none"
      style={{
        background: isFocused
          ? "var(--acm-accent)"
          : isOpen
            ? "var(--acm-bg-elevated)"
            : hovered
              ? "var(--acm-hover)"
              : "transparent",
        color: isFocused ? "#fff" : "var(--acm-fg)",
      }}
    >
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {isGroup && (
        <span
          className="shrink-0 text-xs"
          style={{ color: isFocused ? "#fff" : "var(--acm-fg-muted)" }}
        >
          ›
        </span>
      )}
    </button>
  );
}

// Inline rename editor, shown in place of a row on double-click. Enter (or blur
// with text) commits; Escape or an empty value cancels. Keydowns are kept from
// the global menu handler (Escape-close / tree-nav) via stopPropagation, like
// the new-node DraftRow.
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(name);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      className="mx-0.5 rounded-md px-2 py-1.5 text-sm outline-none"
      style={{
        background: "var(--acm-bg-elevated)",
        color: "var(--acm-fg)",
        border: "1px solid var(--acm-accent)",
      }}
    />
  );
}
