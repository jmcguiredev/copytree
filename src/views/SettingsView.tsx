import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { api } from "../api";
import { applyAppearance, DEFAULTS, loadSettings, scaleMin, setSetting, type Settings } from "../settings";

const MODIFIER_CODES = [
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
];

/** Build a Shortcut string from a keydown, or null for modifier-only presses. */
function hotkeyFromEvent(e: ReactKeyboardEvent): string | null {
  if (MODIFIER_CODES.includes(e.code)) return null;
  const mods: string[] = [];
  if (e.metaKey) mods.push("CmdOrCtrl");
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (mods.length === 0) return null; // require at least one modifier
  return [...mods, e.code].join("+");
}

/** Pretty label for a stored shortcut string, e.g. "CmdOrCtrl+Shift+KeyV" -> "⌘ ⇧ V". */
function formatHotkey(raw: string): string {
  const map: Record<string, string> = {
    CmdOrCtrl: "⌘",
    Cmd: "⌘",
    Super: "⌘",
    Ctrl: "⌃",
    Control: "⌃",
    Alt: "⌥",
    Shift: "⇧",
  };
  return raw
    .split("+")
    .map((t) => map[t] ?? t.replace(/^Key/, "").replace(/^Digit/, ""))
    .join(" ");
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm" style={{ color: "var(--acm-fg)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle = {
  background: "var(--acm-bg-elevated)",
  borderColor: "var(--acm-border)",
  color: "var(--acm-fg)",
};

export default function SettingsView() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [capturing, setCapturing] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [fonts, setFonts] = useState<string[]>([]);

  useEffect(() => {
    void loadSettings().then((loaded) => {
      setS(loaded);
      applyAppearance(loaded);
    });
    void api.listSystemFonts().then(setFonts).catch(() => setFonts([]));
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => {
      const next = { ...prev, [key]: value };
      applyAppearance(next);
      return next;
    });
    void setSetting(key, value);
  }

  // A labelled number input with native up/down steppers. `step < 1` keeps one
  // decimal (the scale rows); integer steps round to whole numbers.
  function numberRow(
    label: string,
    key: "scale" | "textScale" | "contentScale" | "undoSeconds" | "recentDays" | "maxRecent",
    min: number,
    max: number,
    step: number,
    suffix: string,
  ) {
    const decimals = step < 1 ? 1 : 0;
    const clamp = (raw: number) => {
      if (Number.isNaN(raw)) return min;
      const snapped = Math.round(raw / step) * step;
      return Math.max(min, Math.min(max, Number(snapped.toFixed(decimals))));
    };
    return (
      <Field label={label}>
        <span className="flex items-center gap-2">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={s[key]}
            onChange={(e) => update(key, clamp(Number(e.target.value)))}
            className="w-20 rounded-md border px-2 py-1 text-sm"
            style={inputStyle}
          />
          <span className="text-xs" style={{ color: "var(--acm-fg-muted)" }}>
            {suffix}
          </span>
        </span>
      </Field>
    );
  }

  return (
    <div className="acm-solid min-h-screen w-screen overflow-auto p-8">
      <h1 className="mb-4 text-lg font-semibold" style={{ color: "var(--acm-fg)" }}>
        ACM Settings
      </h1>

      <div className="divide-y" style={{ borderColor: "var(--acm-border)" }}>
        <Field label="Color Scheme">
          <select
            value={s.colorScheme}
            onChange={(e) => update("colorScheme", e.target.value as Settings["colorScheme"])}
            className="rounded-md border px-2 py-1 text-sm"
            style={inputStyle}
          >
            <option value="Dark">Dark</option>
            <option value="Light">Light</option>
          </select>
        </Field>

        <Field label="Font">
          <select
            value={fonts.includes(s.fontFamily) ? s.fontFamily : ""}
            onChange={(e) => update("fontFamily", e.target.value)}
            className="max-w-52 rounded-md border px-2 py-1 text-sm"
            style={inputStyle}
          >
            <option value="">System Default</option>
            {fonts.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>

        {numberRow("Scale", "scale", scaleMin("scale"), 5, 0.1, "×")}
        {numberRow("Text Scale", "textScale", scaleMin("textScale"), 5, 0.1, "×")}
        {numberRow("Content Display Scale", "contentScale", scaleMin("contentScale"), 5, 0.1, "×")}

        {numberRow("Overwritten Item Persistence", "undoSeconds", 0, 60, 1, "seconds (0 disables undo)")}
        {numberRow("Recent Items Persistence", "recentDays", 0, 30, 1, "days (0 = keep all)")}
        {numberRow("Max Recent Items", "maxRecent", 0, 100, 1, "items (0 disables)")}

        <Field label="Open Position">
          <select
            value={s.openAtCursor ? "cursor" : "last"}
            onChange={(e) => update("openAtCursor", e.target.value === "cursor")}
            className="rounded-md border px-2 py-1 text-sm"
            style={inputStyle}
          >
            <option value="cursor">At cursor</option>
            <option value="last">Where I left it</option>
          </select>
        </Field>

        <Field label="Activation Hotkey">
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setCapturing(true);
                setHotkeyError(null);
              }}
              onKeyDown={(e) => {
                if (!capturing) return;
                e.preventDefault();
                const hk = hotkeyFromEvent(e);
                if (!hk) return;
                api
                  .setActivationHotkey(hk)
                  .then(() => {
                    setS((prev) => ({ ...prev, hotkey: hk }));
                    setCapturing(false);
                  })
                  .catch((err) => setHotkeyError(String(err)));
              }}
              onBlur={() => setCapturing(false)}
              className="min-w-28 rounded-md border px-3 py-1 text-sm"
              style={{
                ...inputStyle,
                borderColor: capturing ? "var(--acm-accent)" : "var(--acm-border)",
              }}
            >
              {capturing ? "Press keys…" : formatHotkey(s.hotkey)}
            </button>
          </span>
        </Field>
      </div>

      {hotkeyError && (
        <p className="mt-3 text-xs" style={{ color: "#e07a72" }}>
          {hotkeyError}
        </p>
      )}
    </div>
  );
}
