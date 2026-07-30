import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

// Placeholder overlay (PLAN.md milestone 1). The real cascading columns,
// content pane and add/remove controls arrive in milestone 3. For now this
// establishes the window chrome: a rounded floating panel, a top-left drag
// handle, an auto-focused search input, and Escape-to-close.
export default function MenuView() {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void invoke("hide_menu");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden rounded-xl border p-2"
      style={{
        background: "var(--acm-bg)",
        borderColor: "var(--acm-border)",
      }}
    >
      <div className="flex items-center gap-2">
        {/* Drag handle: moves the native window; double-click-maximize is
            disabled at the window level (resizable: false). */}
        <div
          data-tauri-drag-region
          className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded-md"
          style={{ background: "var(--acm-bg-elevated)" }}
          title="Drag to move"
        >
          <span
            data-tauri-drag-region
            className="text-xs leading-none"
            style={{ color: "var(--acm-fg-muted)" }}
          >
            ⠿
          </span>
        </div>
        <input
          ref={searchRef}
          type="text"
          placeholder="Search…"
          className="h-8 w-full rounded-md border px-3 text-sm outline-none"
          style={{
            background: "var(--acm-bg-elevated)",
            borderColor: "var(--acm-border)",
            color: "var(--acm-fg)",
          }}
        />
      </div>

      <div
        className="mt-2 flex flex-1 items-center justify-center rounded-md text-center text-xs"
        style={{ color: "var(--acm-fg-muted)" }}
      >
        Menu overlay — milestone 1 scaffold.
        <br />
        Cascading groups &amp; items land in milestone 3.
      </div>
    </div>
  );
}
