import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { api } from "../api";
import { focusedNode, useMenu } from "../store";
import SearchBar from "../components/SearchBar";
import MenuColumns from "../components/MenuColumns";
import ContentPane from "../components/ContentPane";
import AddRemoveControls from "../components/AddRemoveControls";

const COL_W = 210;
const CONTENT_W = 320;

export default function MenuView() {
  const searchRef = useRef<HTMLInputElement>(null);
  const columnCount = useMenu((s) => s.columns.length);
  const selectedItemId = useMenu((s) => s.selectedItemId);
  const init = useMenu((s) => s.init);
  const moveFocus = useMenu((s) => s.moveFocus);

  // Load the root tree on mount and again whenever the overlay is re-shown
  // (it regains focus). Hiding+reshowing resets to a clean state (PLAN.md §3).
  useEffect(() => {
    void init();
    searchRef.current?.focus();
    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        void init();
        searchRef.current?.focus();
      }
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [init]);

  // Global keyboard navigation (PLAN.md §5.3). Skipped while typing in an
  // input/textarea (search box, modal fields), except Escape which always closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void api.hideMenu();
        return;
      }
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;

      const s = useMenu.getState();
      const node = focusedNode(s);

      // Clipboard accelerators (PLAN.md §6) — ordinary in-window shortcuts since
      // the menu holds focus. Operate on the selected (or focused) item.
      if (e.metaKey || e.ctrlKey) {
        const target = s.selectedItemId ?? (node?.kind === "item" ? node.id : null);
        if (target == null) return;
        const key = e.key.toLowerCase();
        const after = () => s.showItemContent(target);
        if (key === "c") {
          e.preventDefault();
          void api.copyItem(target);
        } else if (key === "v") {
          e.preventDefault();
          void api.pasteIntoItem(target).then(after).catch(() => {});
        } else if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          void api.undoPaste(target).then(after).catch(() => {});
        } else if (key === "z" && e.shiftKey) {
          e.preventDefault();
          void api.redoPaste(target).then(after).catch(() => {});
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          s.moveFocus(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          s.moveFocus(-1);
          break;
        case "ArrowRight":
          if (node?.kind === "group") {
            e.preventDefault();
            void s.expandGroup(s.focus.col, node, true);
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          s.collapseFocused();
          break;
        case "Enter":
          if (node) {
            e.preventDefault();
            void s.activate(s.focus.col, node);
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Grow the native window to fit the columns + content pane. Monitor-aware
  // re-clamping is milestone 8; for now the top-left origin (set on open) stays
  // put and the window simply expands rightward.
  useEffect(() => {
    const width = Math.max(320, 16 + columnCount * COL_W + (selectedItemId != null ? CONTENT_W : 0));
    void getCurrentWindow().setSize(new LogicalSize(width, 420));
  }, [columnCount, selectedItemId]);

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden rounded-xl border p-2"
      style={{ background: "var(--acm-bg)", borderColor: "var(--acm-border)" }}
    >
      <div className="flex items-center gap-2">
        <div
          data-tauri-drag-region
          className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded-md"
          style={{ background: "var(--acm-bg-elevated)" }}
          title="Drag to move"
        >
          <span data-tauri-drag-region className="text-xs" style={{ color: "var(--acm-fg-muted)" }}>
            ⠿
          </span>
        </div>
        <SearchBar
          ref={searchRef}
          onArrowDown={() => {
            searchRef.current?.blur();
            moveFocus(0);
          }}
        />
      </div>

      <div className="mt-2 flex min-h-0 flex-1 overflow-hidden rounded-md border" style={{ borderColor: "var(--acm-border)" }}>
        <MenuColumns />
        <ContentPane />
      </div>

      <AddRemoveControls />
    </div>
  );
}
