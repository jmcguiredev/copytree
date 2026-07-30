import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { api } from "../api";
import { applyAppearance, DEFAULTS, loadSettings, setSetting, type Settings } from "../settings";

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

  useEffect(() => {
    void loadSettings().then((loaded) => {
      setS(loaded);
      applyAppearance(loaded);
    });
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => {
      const next = { ...prev, [key]: value };
      applyAppearance(next);
      return next;
    });
    void setSetting(key, value);
  }

  function scaleRow(label: string, key: "scale" | "textScale" | "contentScale") {
    return (
      <Field label={label}>
        <span className="flex items-center gap-2">
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.1}
            value={s[key]}
            onChange={(e) => update(key, Number(e.target.value))}
          />
          <span className="w-10 text-right text-sm tabular-nums" style={{ color: "var(--acm-fg-muted)" }}>
            {s[key].toFixed(1)}×
          </span>
        </span>
      </Field>
    );
  }

  function numberRow(
    label: string,
    key: "undoSeconds" | "recentDays" | "maxRecent",
    min: number,
    max: number,
    suffix: string,
  ) {
    return (
      <Field label={label}>
        <span className="flex items-center gap-2">
          <input
            type="number"
            min={min}
            max={max}
            value={s[key]}
            onChange={(e) =>
              update(key, Math.max(min, Math.min(max, Math.round(Number(e.target.value)))))
            }
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

        {scaleRow("Scale", "scale")}
        {scaleRow("Text Scale", "textScale")}
        {scaleRow("Content Display Scale", "contentScale")}

        {numberRow("Overwritten Item Persistence", "undoSeconds", 0, 60, "seconds (0 disables undo)")}
        {numberRow("Recent Items Persistence", "recentDays", 0, 30, "days (0 = keep all)")}
        {numberRow("Max Recent Items", "maxRecent", 0, 100, "items (0 disables)")}

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
