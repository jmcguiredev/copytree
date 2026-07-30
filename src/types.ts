// Mirrors the Rust `Node` (serde camelCase) and `NewContent` (PLAN.md §4, §8).
export interface Node {
  id: number;
  parentId: number | null;
  kind: "group" | "item";
  name: string;
  position: number;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
}

// Only text is created from the frontend; image/gif items come from pasting (M5).
export type NewContent = { type: "text"; text: string };

// An item's stored content for display. Blob variants carry an absolute path
// to be rendered through the Tauri asset protocol.
export type ItemContent =
  | { type: "text"; text: string }
  | { type: "image"; path: string; width: number | null; height: number | null }
  | { type: "gif"; path: string; width: number | null; height: number | null };
