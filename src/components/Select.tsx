import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}

/**
 * A non-native dropdown styled with the `--acm-*` tokens. The list is portalled
 * to <body> with fixed positioning so it's never clipped by the settings
 * window's scroll container, and supports keyboard nav + type-ahead (the font
 * list is long). Focus stays on the trigger while open; it handles all keys.
 */
export default function Select({ value, options, onChange, className, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ buf: "", at: 0 });

  const selected = options.find((o) => o.value === value);

  const reposition = () => {
    const el = triggerRef.current;
    if (el) setRect(el.getBoundingClientRect());
  };

  const openMenu = () => {
    reposition();
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const commit = (idx: number) => {
    const opt = options[idx];
    if (opt) onChange(opt.value);
    close();
  };

  // Keep the popup pinned to the trigger while scrolling/resizing.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const on = () => reposition();
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
    };
  }, [open]);

  // Close on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(active);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (e.key.length === 1) {
          const now = Date.now();
          const ta = typeahead.current;
          ta.buf = now - ta.at > 800 ? e.key : ta.buf + e.key;
          ta.at = now;
          const q = ta.buf.toLowerCase();
          const found = options.findIndex((o) => o.label.toLowerCase().startsWith(q));
          if (found >= 0) setActive(found);
        }
    }
  };

  return (
    <div className={`relative ${className ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className="flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm outline-none"
        style={{
          background: "var(--acm-bg-elevated)",
          borderColor: open ? "var(--acm-accent)" : "var(--acm-border)",
          color: "var(--acm-fg)",
        }}
      >
        <span className="truncate">{selected?.label ?? ""}</span>
        <span className="shrink-0 text-[10px]" style={{ color: "var(--acm-fg-muted)" }}>
          ▾
        </span>
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            className="fixed z-50 overflow-auto rounded-md border py-1 text-sm shadow-lg"
            style={{
              top: rect.bottom + 4,
              left: rect.left,
              minWidth: rect.width,
              maxHeight: 260,
              background: "var(--acm-bg-elevated)",
              borderColor: "var(--acm-border)",
              color: "var(--acm-fg)",
            }}
          >
            {options.map((o, i) => (
              <div
                key={o.value}
                data-idx={i}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(i)}
                className="cursor-pointer truncate px-2.5 py-1.5"
                style={{
                  background: i === active ? "var(--acm-accent)" : "transparent",
                  color: i === active ? "#fff" : o.value === value ? "var(--acm-accent)" : "var(--acm-fg)",
                }}
              >
                {o.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
