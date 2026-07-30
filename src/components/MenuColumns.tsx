import { useMenu } from "../store";
import NodeRow from "./NodeRow";

// The cascading columns. Each expanded group appends a column to the right;
// all columns are siblings inside the single menu window (PLAN.md §3).
export default function MenuColumns() {
  const columns = useMenu((s) => s.columns);

  return (
    <div className="flex min-h-0 flex-1">
      {columns.map((column, col) => (
        <div
          key={col}
          className="flex w-[210px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r py-1 pr-1"
          style={{ borderColor: "var(--acm-border)" }}
        >
          {column.nodes.length === 0 ? (
            <div
              className="px-2.5 py-1.5 text-xs italic"
              style={{ color: "var(--acm-fg-muted)" }}
            >
              empty
            </div>
          ) : (
            column.nodes.map((node) => <NodeRow key={node.id} node={node} col={col} />)
          )}
        </div>
      ))}
    </div>
  );
}
