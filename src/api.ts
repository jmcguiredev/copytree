import { invoke } from "@tauri-apps/api/core";
import type { ItemContent, NewContent, Node, SearchHit } from "./types";

// Typed wrappers around the Rust tree-CRUD commands (PLAN.md §8). Tauri maps
// these camelCase keys to the snake_case Rust parameters.
export const api = {
  listChildren: (parentId: number | null) =>
    invoke<Node[]>("list_children_cmd", { parentId }),
  getNode: (id: number) => invoke<Node>("get_node_cmd", { id }),
  getItemContent: (id: number) =>
    invoke<ItemContent>("get_item_content_cmd", { itemId: id }),
  search: (query: string) => invoke<SearchHit[]>("search_cmd", { query }),
  getRecent: () => invoke<Node[]>("get_recent_cmd"),
  createGroup: (parentId: number | null, name: string) =>
    invoke<Node>("create_group_cmd", { parentId, name }),
  createItem: (parentId: number | null, name: string, content: NewContent) =>
    invoke<Node>("create_item_cmd", { parentId, name, content }),
  createFileItem: (parentId: number | null, name: string, path: string) =>
    invoke<Node>("create_file_item_cmd", { parentId, name, path }),
  renameNode: (id: number, name: string) =>
    invoke<void>("rename_node_cmd", { id, name }),
  deleteNode: (id: number) => invoke<void>("delete_node_cmd", { id }),
  moveNode: (id: number, newParentId: number | null, newPosition: number) =>
    invoke<void>("move_node_cmd", { id, newParentId, newPosition }),
  hideMenu: () => invoke<void>("hide_menu"),
  clampMenu: () => invoke<void>("clamp_menu"),

  // Clipboard (PLAN.md §6). All operate on a single item id.
  copyItem: (id: number) => invoke<void>("copy_item_to_clipboard_cmd", { itemId: id }),
  pasteIntoItem: (id: number) =>
    invoke<void>("paste_clipboard_into_item_cmd", { itemId: id }),
  undoPaste: (id: number) => invoke<boolean>("undo_paste_cmd", { itemId: id }),
  redoPaste: (id: number) => invoke<boolean>("redo_paste_cmd", { itemId: id }),

  // Validate + persist + re-register the global hotkey (PLAN.md §7).
  setActivationHotkey: (shortcut: string) =>
    invoke<void>("set_activation_hotkey", { shortcut }),
};
