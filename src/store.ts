import { create } from "zustand";
import { api } from "./api";
import type { Node } from "./types";

/** One visible column: the children of `parentId` (null = root). */
export interface Column {
  parentId: number | null;
  nodes: Node[];
}

interface MenuState {
  columns: Column[];
  /** Keyboard focus: which column and which row within it. */
  focus: { col: number; id: number | null };
  /** Item whose content pane is shown, if any. */
  selectedItemId: number | null;

  init: () => Promise<void>;
  reset: () => void;

  focusRow: (col: number, id: number) => void;
  moveFocus: (delta: number) => void;
  /** Expand a group into the next column. `enter` moves focus into it. */
  expandGroup: (col: number, node: Node, enter: boolean) => Promise<void>;
  selectItem: (col: number, node: Node) => void;
  /** Enter / click: expand a group or select an item. */
  activate: (col: number, node: Node) => Promise<void>;
  collapseFocused: () => void;

  addGroup: (name: string) => Promise<void>;
  addItem: (name: string, text: string) => Promise<void>;
  renameFocused: (name: string) => Promise<void>;
  removeFocused: () => Promise<void>;
  refreshColumn: (col: number) => Promise<void>;
}

/** The node currently under keyboard focus, if any. */
export function focusedNode(state: MenuState): Node | undefined {
  const col = state.columns[state.focus.col];
  return col?.nodes.find((n) => n.id === state.focus.id);
}

export const useMenu = create<MenuState>((set, get) => ({
  columns: [],
  focus: { col: 0, id: null },
  selectedItemId: null,

  init: async () => {
    const nodes = await api.listChildren(null);
    set({
      columns: [{ parentId: null, nodes }],
      focus: { col: 0, id: nodes[0]?.id ?? null },
      selectedItemId: null,
    });
  },

  reset: () => set({ columns: [], focus: { col: 0, id: null }, selectedItemId: null }),

  // Focusing a row collapses any deeper columns opened from a sibling.
  focusRow: (col, id) =>
    set((s) => ({
      columns: s.columns.slice(0, col + 1),
      focus: { col, id },
      selectedItemId: null,
    })),

  moveFocus: (delta) =>
    set((s) => {
      const col = s.columns[s.focus.col];
      if (!col || col.nodes.length === 0) return {};
      const i = col.nodes.findIndex((n) => n.id === s.focus.id);
      const next = Math.max(0, Math.min(col.nodes.length - 1, (i < 0 ? 0 : i) + delta));
      return {
        columns: s.columns.slice(0, s.focus.col + 1),
        focus: { col: s.focus.col, id: col.nodes[next].id },
        selectedItemId: null,
      };
    }),

  expandGroup: async (col, node, enter) => {
    const children = await api.listChildren(node.id);
    set((s) => {
      const columns = s.columns.slice(0, col + 1);
      columns.push({ parentId: node.id, nodes: children });
      return {
        columns,
        focus: enter ? { col: col + 1, id: children[0]?.id ?? null } : { col, id: node.id },
        selectedItemId: null,
      };
    });
  },

  selectItem: (col, node) =>
    set((s) => ({
      columns: s.columns.slice(0, col + 1),
      focus: { col, id: node.id },
      selectedItemId: node.id,
    })),

  activate: async (col, node) => {
    if (node.kind === "group") await get().expandGroup(col, node, true);
    else get().selectItem(col, node);
  },

  collapseFocused: () =>
    set((s) => {
      const colIdx = s.focus.col;
      if (colIdx === 0) return { selectedItemId: null };
      return {
        columns: s.columns.slice(0, colIdx),
        focus: { col: colIdx - 1, id: s.columns[colIdx].parentId },
        selectedItemId: null,
      };
    }),

  refreshColumn: async (col) => {
    const parentId = get().columns[col]?.parentId ?? null;
    const nodes = await api.listChildren(parentId);
    set((s) => {
      const columns = [...s.columns];
      columns[col] = { parentId, nodes };
      return { columns };
    });
  },

  // New nodes are created into the currently focused level.
  addGroup: async (name) => {
    const col = get().focus.col;
    const parentId = get().columns[col]?.parentId ?? null;
    const node = await api.createGroup(parentId, name);
    await get().refreshColumn(col);
    set({ focus: { col, id: node.id } });
  },

  addItem: async (name, text) => {
    const col = get().focus.col;
    const parentId = get().columns[col]?.parentId ?? null;
    const node = await api.createItem(parentId, name, { type: "text", text });
    await get().refreshColumn(col);
    set({ focus: { col, id: node.id } });
  },

  renameFocused: async (name) => {
    const { focus } = get();
    if (focus.id == null) return;
    await api.renameNode(focus.id, name);
    await get().refreshColumn(focus.col);
  },

  removeFocused: async () => {
    const { focus } = get();
    if (focus.id == null) return;
    await api.deleteNode(focus.id);
    await get().refreshColumn(focus.col);
    set((s) => ({
      columns: s.columns.slice(0, focus.col + 1),
      focus: { col: focus.col, id: s.columns[focus.col]?.nodes[0]?.id ?? null },
      selectedItemId: null,
    }));
  },
}));
