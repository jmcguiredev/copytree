import { useMenu } from "../store";
import type { Node } from "../types";

// Placeholder content pane (PLAN.md §5.5). Real text/image/gif rendering,
// scrolling, and the Content Display Scale arrive with blob storage in M4.
export default function ContentPane() {
  const selectedItemId = useMenu((s) => s.selectedItemId);
  const columns = useMenu((s) => s.columns);

  if (selectedItemId == null) return null;

  let item: Node | undefined;
  for (const c of columns) {
    const found = c.nodes.find((n) => n.id === selectedItemId);
    if (found) item = found;
  }

  return (
    <div
      className="flex w-[320px] shrink-0 flex-col gap-2 overflow-auto p-3"
      style={{ background: "var(--acm-bg-elevated)" }}
    >
      <div className="text-sm font-medium" style={{ color: "var(--acm-fg)" }}>
        {item?.name ?? "Item"}
      </div>
      <div className="text-xs" style={{ color: "var(--acm-fg-muted)" }}>
        Content preview lands in milestone 4 (text / image / gif).
      </div>
    </div>
  );
}
