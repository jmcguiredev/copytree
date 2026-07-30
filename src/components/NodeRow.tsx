import type { Node } from "../types";
import { useMenu } from "../store";

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

  const isGroup = node.kind === "group";
  const isFocused = focus.col === col && focus.id === node.id;
  const isOpen = columns[col + 1]?.parentId === node.id;

  return (
    <button
      type="button"
      role="option"
      aria-selected={isFocused}
      onClick={() => void activate(col, node)}
      onMouseEnter={() => {
        // Hovering a group expands it (PLAN.md §5.3); items just take focus.
        if (isGroup) void expandGroup(col, node, false);
        else focusRow(col, node.id);
      }}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm outline-none"
      style={{
        background: isFocused
          ? "var(--acm-accent)"
          : isOpen
            ? "var(--acm-bg-elevated)"
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
