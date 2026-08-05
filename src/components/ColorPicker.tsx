import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

interface Props {
  /** Current color as `#rrggbb`, or "" to show the live theme default. */
  value: string;
  onChange: (hex: string) => void;
  className?: string;
  ariaLabel?: string;
}

type RGB = [number, number, number];

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const byteHex = (n: number) => clampByte(n).toString(16).padStart(2, "0");
const toHex = ([r, g, b]: RGB) => `#${byteHex(r)}${byteHex(g)}${byteHex(b)}`;

function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** The effective starting color: the stored value, else the live --acm-accent. */
function effectiveColor(value: string): RGB {
  return (
    parseHex(value) ??
    parseHex(
      getComputedStyle(document.documentElement).getPropertyValue("--acm-accent"),
    ) ?? [109, 140, 255]
  );
}

/**
 * A non-native RGB color selector: a swatch trigger that opens a portalled
 * popover with three draggable R/G/B sliders plus a hex field. Emits `#rrggbb`
 * on change. Styled with the `--acm-*` tokens, mirroring Select's positioning.
 */
export default function ColorPicker({ value, onChange, className, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [rgb, setRgb] = useState<RGB>(() => effectiveColor(value));
  const [hexText, setHexText] = useState(() => toHex(effectiveColor(value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Reflect external value changes into the editor while closed.
  useEffect(() => {
    if (open) return;
    const c = effectiveColor(value);
    setRgb(c);
    setHexText(toHex(c));
  }, [value, open]);

  const reposition = () => {
    const el = rootRef.current;
    if (el) setRect(el.getBoundingClientRect());
  };

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

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const emit = (next: RGB) => {
    setRgb(next);
    setHexText(toHex(next));
    onChange(toHex(next));
  };

  const setChannel = (i: number) => (v: number) => {
    const next = [...rgb] as RGB;
    next[i] = clampByte(v);
    emit(next);
  };

  const commitHex = () => {
    const parsed = parseHex(hexText);
    if (parsed) emit(parsed);
    else setHexText(toHex(rgb)); // revert invalid entry
  };

  const swatch = toHex(rgb);

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        aria-label={ariaLabel ?? "Color"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : (reposition(), setOpen(true)))}
        className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm outline-none"
        style={{ background: "var(--acm-bg-elevated)", borderColor: open ? "var(--acm-accent)" : "var(--acm-border)", color: "var(--acm-fg)" }}
      >
        <span
          className="h-4 w-4 shrink-0 rounded"
          style={{ background: swatch, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.25)" }}
        />
        <span className="tabular-nums" style={{ color: "var(--acm-fg)" }}>
          {swatch}
        </span>
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            className="fixed z-50 flex w-56 flex-col gap-3 rounded-md border p-3 shadow-lg"
            style={{
              top: rect.bottom + 4,
              left: Math.min(rect.left, window.innerWidth - 240),
              background: "var(--acm-bg-elevated)",
              borderColor: "var(--acm-border)",
              color: "var(--acm-fg)",
            }}
          >
            <ChannelSlider label="R" value={rgb[0]} rgb={rgb} channel={0} onChange={setChannel(0)} />
            <ChannelSlider label="G" value={rgb[1]} rgb={rgb} channel={1} onChange={setChannel(1)} />
            <ChannelSlider label="B" value={rgb[2]} rgb={rgb} channel={2} onChange={setChannel(2)} />

            <div className="flex items-center gap-2 pt-1">
              <span
                className="h-6 w-6 shrink-0 rounded"
                style={{ background: swatch, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.25)" }}
              />
              <input
                value={hexText}
                spellCheck={false}
                onChange={(e) => setHexText(e.target.value)}
                onBlur={commitHex}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-sm tabular-nums outline-none"
                style={{ borderColor: "var(--acm-border)", color: "var(--acm-fg)" }}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// A custom (non-native) draggable channel slider. Its track is a gradient from
// the channel at 0 to at 255 (holding the other two fixed), so the thumb shows
// exactly what that channel does to the current color.
function ChannelSlider({
  label,
  value,
  rgb,
  channel,
  onChange,
}: {
  label: string;
  value: number;
  rgb: RGB;
  channel: number;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const fromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return value;
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return Math.round(t * 255);
  };

  const onDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onChange(fromClientX(e.clientX));
  };
  const onMove = (e: ReactPointerEvent) => {
    if (e.buttons !== 1) return;
    onChange(fromClientX(e.clientX));
  };

  const lo = [...rgb] as RGB;
  const hi = [...rgb] as RGB;
  lo[channel] = 0;
  hi[channel] = 255;
  const gradient = `linear-gradient(to right, ${toHex(lo)}, ${toHex(hi)})`;

  return (
    <div className="flex items-center gap-2">
      <span className="w-3 text-xs" style={{ color: "var(--acm-fg-muted)" }}>
        {label}
      </span>
      <div
        ref={trackRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        className="relative h-3 flex-1 cursor-pointer rounded-full"
        style={{ background: gradient, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.2)" }}
      >
        <span
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{
            left: `${(value / 255) * 100}%`,
            background: "var(--acm-bg-elevated)",
            borderColor: "var(--acm-fg)",
          }}
        />
      </div>
      <span className="w-7 text-right text-xs tabular-nums" style={{ color: "var(--acm-fg-muted)" }}>
        {value}
      </span>
    </div>
  );
}
