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

// Only text is wired up so far; image/gif arrive with blob storage (M4).
export type NewContent = { type: "text"; text: string };
