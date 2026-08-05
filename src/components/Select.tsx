import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
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
  /** Render the trigger as a typable input that filters the list (combobox). */
  searchable?: boolean;
  /** Per-option style, e.g. render each font name in its own font. */
  optionStyle?: (opt: SelectOption) => CSSProperties | undefined;
}

/**
 * A non-native dropdown styled with the `--copytree-*` tokens. The list is portalled
 * to <body> with fixed positioning so it's never clipped by the settings
 * window's scroll container, and sizes to its content (up to a cap) so long
 * labels stay readable. With `searchable` the trigger is a text input that
 * filters options (a combobox, used for the long font/language lists);
 * otherwise it's a button with type-ahead.
 */
export default function Select({
  value,
  options,
  onChange,
  className,
  ariaLabel,
  searchable,
  optionStyle,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ buf: "", at: 0 });

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  const reposition = () => {
    const el = rootRef.current;
    if (el) setRect(el.getBoundingClientRect());
  };

  const openMenu = () => {
    setQuery("");
    reposition();
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const commit = (idx: number) => {
    const opt = filtered[idx];
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
      if (!rootRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
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
      if (e.key === "Enter" || e.key === "ArrowDown" || (!searchable && e.key === " ")) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(filtered.length - 1, i + 1));
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
        setActive(filtered.length - 1);
        break;
      case "Enter":
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
      case " ":
        if (searchable) break; // let the space reach the input
        e.preventDefault();
        commit(active);
        break;
      default:
        if (!searchable && e.key.length === 1) {
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

  const triggerStyle: CSSProperties = {
    background: "var(--copytree-bg-elevated)",
    borderColor: open ? "var(--copytree-accent)" : "var(--copytree-border)",
    color: "var(--copytree-fg)",
  };

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      {searchable ? (
        <div
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm"
          style={triggerStyle}
        >
          <input
            ref={inputRef}
            aria-label={ariaLabel}
            aria-expanded={open}
            role="combobox"
            value={open ? query : selected?.label ?? ""}
            placeholder={selected?.label ?? ""}
            // Open on pointer-down (not just focus, which doesn't re-fire when the
            // input is already focused — the cause of the "click twice" bug).
            onMouseDown={() => {
              if (!open) openMenu();
            }}
            onFocus={() => {
              if (!open) openMenu();
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              if (!open) setOpen(true);
            }}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1 bg-transparent outline-none"
            style={{ ...(selected ? optionStyle?.(selected) : undefined), color: "var(--copytree-fg)" }}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="Toggle options"
            // preventDefault keeps focus on the input; toggle open/closed.
            onMouseDown={(e) => {
              e.preventDefault();
              if (open) setOpen(false);
              else openMenu();
            }}
            className="flex shrink-0 items-center justify-center"
            style={{ color: "var(--copytree-fg-muted)" }}
          >
            <ChevronDown />
          </button>
        </div>
      ) : (
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={onKeyDown}
          className="flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm outline-none"
          style={triggerStyle}
        >
          <span className="truncate">{selected?.label ?? ""}</span>
          <span className="flex shrink-0 items-center" style={{ color: "var(--copytree-fg-muted)" }}>
            <ChevronDown />
          </span>
        </button>
      )}
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
              // Size to the widest label (readable), floored at the trigger width
              // and capped so it can't run off-screen; longer labels then ellipsize.
              width: "max-content",
              minWidth: rect.width,
              maxWidth: "min(90vw, 360px)",
              maxHeight: 260,
              background: "var(--copytree-bg-elevated)",
              borderColor: "var(--copytree-border)",
              color: "var(--copytree-fg)",
            }}
          >
            {filtered.length === 0 ? (
              <div className="px-2.5 py-1.5 italic" style={{ color: "var(--copytree-fg-muted)" }}>
                no matches
              </div>
            ) : (
              filtered.map((o, i) => (
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
                    ...optionStyle?.(o),
                    background: i === active ? "var(--copytree-accent)" : "transparent",
                    color:
                      i === active ? "#fff" : o.value === value ? "var(--copytree-accent)" : "var(--copytree-fg)",
                  }}
                >
                  {o.label}
                </div>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

function ChevronDown() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
