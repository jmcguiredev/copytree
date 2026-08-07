import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { RECENT_ID, useMenu } from "../store";
import { setSetting } from "../settings";
import NodeRow from "./NodeRow";

export const DEFAULT_COL_W = 210;
const MIN_COL_W = 120;
const MAX_COL_W = 520;

/** Width for a column depth-index, defaulting when unset. */
export function columnWidth(widths: number[], index: number): number {
  return widths[index] ?? DEFAULT_COL_W;
}

// The cascading columns. Each expanded group appends a column to the right; all
// columns are siblings inside the single menu window (PLAN.md §3). Each column
// has a per-depth-index width (dragged via its right-edge splitter, persisted to
// settings), so the layout is identical for any tree at the same depth.
export default function MenuColumns() {
  const columns = useMenu((s) => s.columns);
  const columnWidths = useMenu((s) => s.columnWidths);
  const draft = useMenu((s) => s.draft);
  const commitDraft = useMenu((s) => s.commitDraft);
  const cancelDraft = useMenu((s) => s.cancelDraft);

  // Drag a column's right edge to resize just that column (content flexes).
  const startResize = (index: number, e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = columnWidth(useMenu.getState().columnWidths, index);
    const onMove = (ev: globalThis.MouseEvent) => {
      const w = Math.max(MIN_COL_W, Math.min(MAX_COL_W, startW + ev.clientX - startX));
      const next = [...useMenu.getState().columnWidths];
      while (next.length <= index) next.push(DEFAULT_COL_W);
      next[index] = w;
      useMenu.getState().setColumnWidths(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      void setSetting("columnWidths", useMenu.getState().columnWidths);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="flex min-h-0 shrink-0">
      {columns.map((column, col) => {
        const drafting = draft?.col === col;
        return (
          <div
            key={col}
            className="relative flex shrink-0 flex-col gap-0.5 overflow-y-auto border-r py-1 pr-1"
            style={{ width: columnWidth(columnWidths, col), borderColor: "var(--copytree-border)" }}
            onDragOver={(e) => {
              // Empty area below the rows: allow an append-to-end drop. (Rows
              // stopPropagation on their own drop, so this only fires in the gap.)
              const d = useMenu.getState().drag;
              if (!d || column.parentId === RECENT_ID) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              const d = useMenu.getState().drag;
              if (!d || column.parentId === RECENT_ID) return;
              e.preventDefault();
              void useMenu.getState().moveNode(d.id, column.parentId, null, null, [d.col, col]);
            }}
          >
            {column.nodes.length === 0 && !drafting ? (
              <div className="px-2.5 py-1.5 text-xs italic" style={{ color: "var(--copytree-fg-muted)" }}>
                empty
              </div>
            ) : (
              column.nodes.map((node) => <NodeRow key={node.id} node={node} col={col} />)
            )}
            {drafting && (
              <DraftRow
                kind={draft.kind}
                onCommit={(name) => void commitDraft(name)}
                onCancel={cancelDraft}
              />
            )}
            <div
              onMouseDown={(e) => startResize(col, e)}
              className="copytree-col-splitter absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize"
              title="Drag to resize column"
            />
          </div>
        );
      })}
    </div>
  );
}

// The inline name editor for a new group/item, placed where the node will land.
// Enter (or blur with text) creates it; Escape or an empty blur cancels. Keydowns
// are kept from the global menu handler (which would otherwise Escape-close or
// tree-navigate) via stopPropagation.
function DraftRow({
  kind,
  onCommit,
  onCancel,
}: {
  kind: "group" | "item";
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit && name.trim()) onCommit(name);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      value={name}
      placeholder={kind === "group" ? "New group…" : "New item…"}
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
