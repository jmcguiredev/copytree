import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import { applyAppearance, loadSettings, SETTINGS_CHANGED_EVENT, shortcutFromEvent } from "../settings";
import { focusedNode, useMenu } from "../store";
import SearchBar from "../components/SearchBar";
import SearchResults from "../components/SearchResults";
import MenuColumns from "../components/MenuColumns";
import ContentPane from "../components/ContentPane";
import AddRemoveControls from "../components/AddRemoveControls";

export default function MenuView() {
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchActive = useMenu((s) => s.searchQuery.trim().length > 0);
  const init = useMenu((s) => s.init);
  const moveFocus = useMenu((s) => s.moveFocus);

  // Load the root tree and apply appearance on mount, and again whenever the
  // overlay is re-shown (it regains focus) — this is how settings changes take
  // effect live on the menu (PLAN.md §3, §7).
  useEffect(() => {
    const refresh = () => {
      void init();
      void loadSettings().then(applyAppearance);
      searchRef.current?.focus();
      // Subtle open animation each time the overlay is shown (PLAN.md §11.8).
      panelRef.current?.animate(
        [
          { opacity: 0, transform: "scale(0.98)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: 110, easing: "ease-out" },
      );
    };
    refresh();
    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (focused) refresh();
    });
    // Live-apply settings changes while the menu stays open (e.g. the settings
    // window is up and the overlay is unfocused but visible).
    const unlistenSettings = listen(SETTINGS_CHANGED_EVENT, () => {
      void loadSettings().then((s) => applyAppearance(s));
    });
    return () => {
      void unlisten.then((f) => f());
      void unlistenSettings.then((f) => f());
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
        // Cmd/Ctrl+↑ jumps the selection to the top of the current list.
        if (e.key === "ArrowUp") {
          e.preventDefault();
          if (s.searchQuery.trim()) s.moveSearchFocus(-Infinity);
          else s.moveFocus(-Infinity);
          return;
        }
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

      // Search-results mode navigation (PLAN.md §5.2).
      if (s.searchQuery.trim()) {
        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            s.moveSearchFocus(1);
            break;
          case "ArrowUp":
            e.preventDefault();
            s.moveSearchFocus(-1);
            break;
          case "Enter":
            e.preventDefault();
            s.openSearchHit(s.searchFocus);
            break;
        }
        return;
      }

      // App-local create shortcuts (no global registration): start an inline
      // new item/group draft in the focused column. Only reached here — not while
      // typing in a field, not in search mode — so a bare letter is safe.
      const shortcut = shortcutFromEvent(e);
      if (shortcut === s.newItemHotkey) {
        e.preventDefault();
        s.beginDraft("item");
        return;
      }
      if (shortcut === s.newGroupHotkey) {
        e.preventDefault();
        s.beginDraft("group");
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

  // The window is user-resizable and its size is persisted by the backend
  // (restored on open); the columns/content flex to fill it (see MenuColumns),
  // so there's no content-driven auto-sizing here anymore.

  return (
    <div
      ref={panelRef}
      className="relative flex h-screen w-screen flex-col overflow-hidden rounded-xl border p-2"
      style={{ background: "var(--acm-bg)", borderColor: "var(--acm-border)" }}
    >
      <div className="flex items-center gap-2">
        <div
          data-tauri-drag-region
          onDoubleClick={(e) => e.preventDefault()}
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
            if (useMenu.getState().searchQuery.trim()) useMenu.getState().moveSearchFocus(0);
            else moveFocus(0);
          }}
        />
      </div>

      <div
        className="mt-2 flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-md border"
        style={{ borderColor: "var(--acm-border)" }}
      >
        {searchActive ? <SearchResults /> : <MenuColumns />}
        <ContentPane />
      </div>

      <AddRemoveControls />

      <ResizeGrips />
    </div>
  );
}

// Edge/corner drag zones that resize the borderless window via Tauri's native
// resize dragging (there are no decorations to grab). Bottom, right, and the
// bottom-right corner cover height, width, and both.
function ResizeGrips() {
  const start = (direction: "East" | "South" | "SouthEast") => (e: ReactMouseEvent) => {
    e.preventDefault();
    void getCurrentWindow().startResizeDragging(direction);
  };
  return (
    <>
      <div
        onMouseDown={start("East")}
        className="absolute right-0 top-2 bottom-2 w-1.5 cursor-ew-resize"
      />
      <div
        onMouseDown={start("South")}
        className="absolute bottom-0 left-2 right-2 h-1.5 cursor-ns-resize"
      />
      <div
        onMouseDown={start("SouthEast")}
        className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize"
      />
    </>
  );
}
