import { useEffect, useRef, useState } from "react";
import { useMenu } from "../store";
import NodeRow from "./NodeRow";

// The cascading columns. Each expanded group appends a column to the right;
// all columns are siblings inside the single menu window (PLAN.md §3).
export default function MenuColumns() {
  const columns = useMenu((s) => s.columns);
  const draft = useMenu((s) => s.draft);
  const commitDraft = useMenu((s) => s.commitDraft);
  const cancelDraft = useMenu((s) => s.cancelDraft);

  return (
    <div className="flex min-h-0 flex-1">
      {columns.map((column, col) => {
        const drafting = draft?.col === col;
        return (
          <div
            key={col}
            className="flex w-[210px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r py-1 pr-1"
            style={{ borderColor: "var(--acm-border)" }}
          >
            {column.nodes.length === 0 && !drafting ? (
              <div className="px-2.5 py-1.5 text-xs italic" style={{ color: "var(--acm-fg-muted)" }}>
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
        background: "var(--acm-bg-elevated)",
        color: "var(--acm-fg)",
        border: "1px solid var(--acm-accent)",
      }}
    />
  );
}
