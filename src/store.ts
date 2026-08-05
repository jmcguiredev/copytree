import { create } from "zustand";
import { api } from "./api";
import type { Node, SearchHit } from "./types";

/** Sentinel id for the virtual "Recent Items" group (PLAN.md §5.1). */
export const RECENT_ID = -1;

function recentNode(): Node {
  return {
    id: RECENT_ID,
    parentId: null,
    kind: "group",
    name: "Recent Items",
    position: -1,
    createdAt: 0,
    updatedAt: 0,
    lastUsedAt: null,
  };
}

/** Root children, with the Recent Items group pinned first (PLAN.md §5.1). */
function withRecent(roots: Node[]): Node[] {
  return [recentNode(), ...roots];
}

/** One visible column: the children of `parentId` (null = root). */
export interface Column {
  parentId: number | null;
  nodes: Node[];
}

interface MenuState {
  columns: Column[];
  focus: { col: number; id: number | null };
  selectedItemId: number | null;
  /** Name for the content-pane header when the item isn't in a column (search). */
  selectedItemName: string | null;
  contentScale: number;
  uiScale: number;
  contentVersion: number;
  /** Bumped on every overlay (re)open so per-row effects (scroll-into-view) can
   *  re-run against the restored focus even when the focused id is unchanged. */
  openSeq: number;
  /** Per-column-index widths (px) for the cascade; live during a splitter drag,
   *  seeded from settings on open (applyAppearance). */
  columnWidths: number[];
  /** Whether hovering or clicking selects a row; seeded from settings. */
  selectMode: "hover" | "click";
  /** App-local create/delete shortcuts (shortcutFromEvent strings); from settings. */
  newItemHotkey: string;
  newGroupHotkey: string;
  deleteHotkey: string;

  // Search-results mode (PLAN.md §5.2).
  searchQuery: string;
  searchResults: SearchHit[];
  searchFocus: number;

  /** Inline "new group / new item" being named in a column (null = none). */
  draft: { col: number; kind: "group" | "item" } | null;

  init: () => Promise<void>;
  reset: () => void;
  showItemContent: (id: number) => void;
  setColumnWidths: (widths: number[]) => void;

  focusRow: (col: number, id: number) => void;
  moveFocus: (delta: number) => void;
  expandGroup: (col: number, node: Node, enter: boolean) => Promise<void>;
  selectItem: (col: number, node: Node) => void;
  activate: (col: number, node: Node) => Promise<void>;
  collapseFocused: () => void;

  setSearchQuery: (q: string) => Promise<void>;
  moveSearchFocus: (delta: number) => void;
  openSearchHit: (index: number) => void;

  addGroup: (name: string) => Promise<void>;
  addItem: (name: string, text: string) => Promise<void>;
  addFileItem: (name: string, path: string) => Promise<void>;
  beginDraft: (kind: "group" | "item") => void;
  cancelDraft: () => void;
  commitDraft: (name: string) => Promise<void>;
  renameFocused: (name: string) => Promise<void>;
  removeFocused: () => Promise<void>;
  refreshColumn: (col: number) => Promise<void>;
}

export function focusedNode(state: MenuState): Node | undefined {
  const col = state.columns[state.focus.col];
  return col?.nodes.find((n) => n.id === state.focus.id);
}

/**
 * Content-pane state implied by a focus position: an item is shown as soon as it
 * gains focus (hover / arrow keys), a group shows nothing (PLAN.md §5.3). Lets
 * focus movement drive the content pane without a separate activate step.
 */
function contentForFocus(
  columns: Column[],
  col: number,
  id: number | null,
): { selectedItemId: number | null; selectedItemName: string | null } {
  const node = columns[col]?.nodes.find((n) => n.id === id);
  if (node?.kind === "item") return { selectedItemId: node.id, selectedItemName: node.name };
  return { selectedItemId: null, selectedItemName: null };
}

/** Load a column's nodes for a given parent, handling the virtual recent group. */
async function loadColumn(parentId: number | null): Promise<Node[]> {
  if (parentId === RECENT_ID) return api.getRecent();
  const nodes = await api.listChildren(parentId);
  return parentId === null ? withRecent(nodes) : nodes;
}

export const useMenu = create<MenuState>((set, get) => ({
  columns: [],
  focus: { col: 0, id: null },
  selectedItemId: null,
  selectedItemName: null,
  contentScale: 1,
  uiScale: 1,
  contentVersion: 0,
  openSeq: 0,
  columnWidths: [],
  selectMode: "hover",
  newItemHotkey: "KeyI",
  newGroupHotkey: "KeyG",
  deleteHotkey: "KeyD",
  searchQuery: "",
  searchResults: [],
  searchFocus: 0,
  draft: null,

  showItemContent: (id) =>
    set((s) => ({ selectedItemId: id, contentVersion: s.contentVersion + 1 })),

  setColumnWidths: (widths) => set({ columnWidths: widths }),

  init: async () => {
    const nodes = await loadColumn(null);
    set((s) => ({
      columns: [{ parentId: null, nodes }],
      focus: { col: 0, id: nodes[0]?.id ?? null },
      selectedItemId: null,
      selectedItemName: null,
      searchQuery: "",
      searchResults: [],
      searchFocus: 0,
      openSeq: s.openSeq + 1,
    }));
  },

  reset: () =>
    set({ columns: [], focus: { col: 0, id: null }, selectedItemId: null }),

  focusRow: (col, id) =>
    set((s) => {
      const columns = s.columns.slice(0, col + 1);
      return { columns, focus: { col, id }, ...contentForFocus(columns, col, id) };
    }),

  moveFocus: (delta) =>
    set((s) => {
      const col = s.columns[s.focus.col];
      if (!col || col.nodes.length === 0) return {};
      const i = col.nodes.findIndex((n) => n.id === s.focus.id);
      const next = Math.max(0, Math.min(col.nodes.length - 1, (i < 0 ? 0 : i) + delta));
      const columns = s.columns.slice(0, s.focus.col + 1);
      const id = col.nodes[next].id;
      return { columns, focus: { col: s.focus.col, id }, ...contentForFocus(columns, s.focus.col, id) };
    }),

  expandGroup: async (col, node, enter) => {
    const children = await loadColumn(node.id);
    set((s) => {
      const columns = s.columns.slice(0, col + 1);
      columns.push({ parentId: node.id, nodes: children });
      if (enter) {
        const id = children[0]?.id ?? null;
        return { columns, focus: { col: col + 1, id }, ...contentForFocus(columns, col + 1, id) };
      }
      return { columns, focus: { col, id: node.id }, selectedItemId: null, selectedItemName: null };
    });
  },

  selectItem: (col, node) =>
    set((s) => ({
      columns: s.columns.slice(0, col + 1),
      focus: { col, id: node.id },
      selectedItemId: node.id,
      selectedItemName: node.name,
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

  setSearchQuery: async (q) => {
    set({ searchQuery: q });
    if (!q.trim()) {
      set({ searchResults: [], searchFocus: 0 });
      return;
    }
    const hits = await api.search(q);
    // Ignore out-of-order responses for a stale query.
    if (get().searchQuery === q) set({ searchResults: hits, searchFocus: 0 });
  },

  moveSearchFocus: (delta) =>
    set((s) => {
      if (s.searchResults.length === 0) return {};
      const i = Math.max(0, Math.min(s.searchResults.length - 1, s.searchFocus + delta));
      return { searchFocus: i };
    }),

  openSearchHit: (index) => {
    const hit = get().searchResults[index];
    if (!hit) return;
    set((s) => ({
      selectedItemId: hit.id,
      selectedItemName: hit.name,
      contentVersion: s.contentVersion + 1,
      searchFocus: index,
    }));
  },

  refreshColumn: async (col) => {
    const parentId = get().columns[col]?.parentId ?? null;
    const nodes = await loadColumn(parentId);
    set((s) => {
      const columns = [...s.columns];
      columns[col] = { parentId, nodes };
      return { columns };
    });
  },

  // New nodes go into the focused level; never into the virtual recent group.
  addGroup: async (name) => {
    const col = get().focus.col;
    const raw = get().columns[col]?.parentId ?? null;
    const parentId = raw === RECENT_ID ? null : raw;
    const node = await api.createGroup(parentId, name);
    await get().refreshColumn(col);
    set({ focus: { col, id: node.id } });
  },

  addItem: async (name, text) => {
    const col = get().focus.col;
    const raw = get().columns[col]?.parentId ?? null;
    const parentId = raw === RECENT_ID ? null : raw;
    const node = await api.createItem(parentId, name, { type: "text", text });
    await get().refreshColumn(col);
    set({ focus: { col, id: node.id } });
  },

  addFileItem: async (name, path) => {
    const col = get().focus.col;
    const raw = get().columns[col]?.parentId ?? null;
    const parentId = raw === RECENT_ID ? null : raw;
    const node = await api.createFileItem(parentId, name, path);
    await get().refreshColumn(col);
    set({ focus: { col, id: node.id } });
  },

  // Inline creation: a draft row is named in the focused column, then committed
  // (empty name → cancelled). Items are created empty — content comes from
  // pasting into them (text/image/gif, auto-detected).
  beginDraft: (kind) => set((s) => ({ draft: { col: s.focus.col, kind } })),

  cancelDraft: () => set({ draft: null }),

  commitDraft: async (name) => {
    const d = get().draft;
    if (!d) return;
    const trimmed = name.trim();
    if (!trimmed) {
      set({ draft: null });
      return;
    }
    const raw = get().columns[d.col]?.parentId ?? null;
    const parentId = raw === RECENT_ID ? null : raw;
    const node =
      d.kind === "group"
        ? await api.createGroup(parentId, trimmed)
        : await api.createItem(parentId, trimmed, { type: "text", text: "" });
    set({ draft: null });
    await get().refreshColumn(d.col);
    set((s) => ({
      columns: s.columns.slice(0, d.col + 1),
      focus: { col: d.col, id: node.id },
      ...contentForFocus(s.columns, d.col, node.id),
    }));
  },

  renameFocused: async (name) => {
    const { focus } = get();
    if (focus.id == null || focus.id === RECENT_ID) return;
    await api.renameNode(focus.id, name);
    await get().refreshColumn(focus.col);
  },

  removeFocused: async () => {
    const { focus } = get();
    if (focus.id == null || focus.id === RECENT_ID) return;
    await api.deleteNode(focus.id);
    await get().refreshColumn(focus.col);
    set((s) => ({
      columns: s.columns.slice(0, focus.col + 1),
      focus: { col: focus.col, id: s.columns[focus.col]?.nodes[0]?.id ?? null },
      selectedItemId: null,
    }));
  },
}));
