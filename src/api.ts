import { invoke } from "@tauri-apps/api/core";
import type { ItemContent, NewContent, Node } from "./types";

// Typed wrappers around the Rust tree-CRUD commands (PLAN.md §8). Tauri maps
// these camelCase keys to the snake_case Rust parameters.
export const api = {
  listChildren: (parentId: number | null) =>
    invoke<Node[]>("list_children_cmd", { parentId }),
  getNode: (id: number) => invoke<Node>("get_node_cmd", { id }),
  getItemContent: (id: number) =>
    invoke<ItemContent>("get_item_content_cmd", { itemId: id }),
  createGroup: (parentId: number | null, name: string) =>
    invoke<Node>("create_group_cmd", { parentId, name }),
  createItem: (parentId: number | null, name: string, content: NewContent) =>
    invoke<Node>("create_item_cmd", { parentId, name, content }),
  renameNode: (id: number, name: string) =>
    invoke<void>("rename_node_cmd", { id, name }),
  deleteNode: (id: number) => invoke<void>("delete_node_cmd", { id }),
  moveNode: (id: number, newParentId: number | null, newPosition: number) =>
    invoke<void>("move_node_cmd", { id, newParentId, newPosition }),
  hideMenu: () => invoke<void>("hide_menu"),
};
