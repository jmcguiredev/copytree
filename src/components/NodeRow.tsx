import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
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
  const openSeq = useMenu((s) => s.openSeq);
  const drag = useMenu((s) => s.drag);
  const beginDrag = useMenu((s) => s.beginDrag);
  const endDrag = useMenu((s) => s.endDrag);
  const moveNode = useMenu((s) => s.moveNode);
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dropMode, setDropMode] = useState<null | "before" | "after" | "into">(null);

  const rowRef = useRef<HTMLButtonElement>(null);
  const expandTimer = useRef<number | undefined>(undefined);

  const isGroup = node.kind === "group";
  const isFocused = focus.col === col && focus.id === node.id;
  const isOpen = columns[col + 1]?.parentId === node.id;
  const canRename = node.id !== RECENT_ID;

  // --- drag-to-reorder ------------------------------------------------------
  // The virtual Recent group can't be moved, and neither the Recent row nor the
  // Recent listing (a computed view) can receive drops. A row is a live target
  // for the current drag unless it is the dragged row itself.
  const column = columns[col];
  const columnIsRecent = column?.parentId === RECENT_ID;
  const canDrag = node.id !== RECENT_ID;
  const isDragging = drag?.id === node.id;
  const canDrop = !!drag && drag.id !== node.id && node.id !== RECENT_ID && !columnIsRecent;

  const clearExpandTimer = () => {
    if (expandTimer.current !== undefined) {
      window.clearTimeout(expandTimer.current);
      expandTimer.current = undefined;
    }
  };

  // Top/bottom thirds of a group insert before/after it; the middle third nests
  // into it. Items only take before/after (no nesting).
  const computeMode = (e: ReactDragEvent): "before" | "after" | "into" => {
    const r = rowRef.current!.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (isGroup && y > 0.3 && y < 0.7) return "into";
    return y < 0.5 ? "before" : "after";
  };

  const onDrop = (e: ReactDragEvent) => {
    if (!drag) return;
    // Dropped on itself: swallow so it doesn't bubble to the column's
    // append-to-end drop and become a surprise move.
    if (drag.id === node.id) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!canDrop) return;
    e.preventDefault();
    e.stopPropagation(); // don't also fire the column's append-to-end drop
    const mode = computeMode(e);
    setDropMode(null);
    clearExpandTimer();
    if (mode === "into") {
      // Nest into this group, appending to its children (open column = col+1).
      void moveNode(drag.id, node.id, null, null, [drag.col, col, col + 1]);
      return;
    }
    // Reorder within this column's parent, between the two chosen neighbours.
    const siblings = (column?.nodes ?? []).filter((n) => n.id !== RECENT_ID && n.id !== drag.id);
    const idx = siblings.findIndex((n) => n.id === node.id);
    const beforeId = mode === "before" ? (siblings[idx - 1]?.id ?? null) : node.id;
    const afterId = mode === "before" ? node.id : (siblings[idx + 1]?.id ?? null);
    const parent = column?.parentId === RECENT_ID ? null : (column?.parentId ?? null);
    void moveNode(drag.id, parent, beforeId, afterId, [drag.col, col]);
  };

  // Scroll-based pagination (PLAN §5.3): when nav focuses a row outside its
  // column's viewport, page-scroll it into view (rather than nudging it just
  // barely in) — direction inferred from geometry: a row below the fold jumps to
  // the **top** of the list, a row above the fold jumps to the **bottom**. The
  // column div is the row's offsetParent (position:relative) and the scroller.
  // `openSeq` re-runs this on every overlay (re)open so a stale scroll position
  // (persisted DOM while the window was hidden) is corrected against the restored
  // focus — layout effect so it lands before paint (no flash).
  useLayoutEffect(() => {
    if (!isFocused) return;
    const el = rowRef.current;
    const scroller = el?.offsetParent as HTMLElement | null;
    if (!el || !scroller || scroller.clientHeight === 0) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = top; // below the fold → align to top
    } else if (top < scroller.scrollTop) {
      scroller.scrollTop = bottom - scroller.clientHeight; // above the fold → align to bottom
    }
  }, [isFocused, openSeq]);

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
      ref={rowRef}
      type="button"
      role="option"
      aria-selected={isFocused}
      draggable={canDrag}
      onDragStart={(e) => {
        if (!canDrag) {
          e.preventDefault();
          return;
        }
        beginDrag(node.id, col, node.kind);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(node.id));
      }}
      onDragEnd={() => {
        endDrag();
        setDropMode(null);
        clearExpandTimer();
      }}
      onDragOver={(e) => {
        if (!canDrop) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropMode(computeMode(e));
        // Spring-loaded: holding over a collapsed group opens it after a beat,
        // exactly like arrow-key selection — independent of hover-select mode.
        if (isGroup && !isOpen && expandTimer.current === undefined) {
          expandTimer.current = window.setTimeout(() => {
            expandTimer.current = undefined;
            void expandGroup(col, node, false);
          }, 550);
        }
      }}
      onDragLeave={() => {
        setDropMode(null);
        clearExpandTimer();
      }}
      onDrop={onDrop}
      onClick={() => {
        // Click-to-select mirrors keyboard focus: the clicked row becomes the
        // selection (accent). An item focuses (opening its content); a group
        // focuses + expands but stays put (like hover-select / arrow keys), so it
        // turns the theme color rather than immediately diving into its children.
        // Hover-select keeps the classic click-a-group-enters behavior.
        if (selectMode === "click") {
          if (isGroup) void expandGroup(col, node, false);
          else focusRow(col, node.id);
        } else {
          void activate(col, node);
        }
      }}
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
      className="relative flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm outline-none"
      style={{
        background: isFocused
          ? "var(--copytree-accent)"
          : isOpen
            ? "var(--copytree-bg-elevated)"
            : hovered
              ? "var(--copytree-hover)"
              : "transparent",
        color: isFocused ? "#fff" : "var(--copytree-fg)",
        opacity: isDragging ? 0.4 : 1,
        // Nesting: ring the whole group row when dropping "into" it.
        boxShadow: dropMode === "into" ? "inset 0 0 0 2px var(--copytree-accent)" : undefined,
      }}
    >
      {/* Reorder: an insertion line at the top or bottom edge. */}
      {dropMode === "before" && (
        <span
          className="pointer-events-none absolute inset-x-1 -top-px h-0.5 rounded-full"
          style={{ background: "var(--copytree-accent)" }}
        />
      )}
      {dropMode === "after" && (
        <span
          className="pointer-events-none absolute inset-x-1 -bottom-px h-0.5 rounded-full"
          style={{ background: "var(--copytree-accent)" }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {isGroup && (
        <span
          className="shrink-0 text-xs"
          style={{ color: isFocused ? "#fff" : "var(--copytree-fg-muted)" }}
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
        background: "var(--copytree-bg-elevated)",
        color: "var(--copytree-fg)",
        border: "1px solid var(--copytree-accent)",
      }}
    />
  );
}
