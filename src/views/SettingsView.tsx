import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { api } from "../api";
import { applyAppearance, DEFAULTS, loadSettings, scaleMin, setSetting, type Settings } from "../settings";
import NumberField from "../components/NumberField";
import Select, { type SelectOption } from "../components/Select";

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

// A div (not a <label>) so clicking the label text can't toggle a custom Select.
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm" style={{ color: "var(--acm-fg)" }}>
        {label}
      </span>
      {children}
    </div>
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
      // Settings renders at 1× (applyScale=false) so it stays usable regardless
      // of the menu scale — see applyAppearance.
      applyAppearance(loaded, false);
    });
    void api.listSystemFonts().then(setFonts).catch(() => setFonts([]));
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => {
      const next = { ...prev, [key]: value };
      applyAppearance(next, false);
      return next;
    });
    void setSetting(key, value);
  }

  const fontOptions = useMemo<SelectOption[]>(
    () => [{ value: "", label: "System Default" }, ...fonts.map((f) => ({ value: f, label: f }))],
    [fonts],
  );

  // A labelled numeric field (custom stepper) + a units suffix.
  function numberRow(
    label: string,
    key: "scale" | "textScale" | "contentScale" | "undoSeconds" | "recentDays" | "maxRecent",
    min: number,
    max: number,
    step: number,
    suffix: string,
  ) {
    return (
      <Field label={label}>
        <span className="flex items-center gap-2">
          <NumberField
            value={s[key]}
            min={min}
            max={max}
            step={step}
            onChange={(v) => update(key, v)}
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
          <Select
            className="w-40"
            ariaLabel="Color Scheme"
            value={s.colorScheme}
            options={[
              { value: "Dark", label: "Dark" },
              { value: "Light", label: "Light" },
            ]}
            onChange={(v) => update("colorScheme", v as Settings["colorScheme"])}
          />
        </Field>

        <Field label="Font">
          <Select
            className="w-52"
            ariaLabel="Font"
            value={fonts.includes(s.fontFamily) ? s.fontFamily : ""}
            options={fontOptions}
            onChange={(v) => update("fontFamily", v)}
          />
        </Field>

        {numberRow("Scale", "scale", scaleMin("scale"), 5, 0.1, "×")}
        {numberRow("Text Scale", "textScale", scaleMin("textScale"), 5, 0.1, "×")}
        {numberRow("Content Display Scale", "contentScale", scaleMin("contentScale"), 5, 0.1, "×")}

        {numberRow("Overwritten Item Persistence", "undoSeconds", 0, 60, 1, "seconds (0 disables undo)")}
        {numberRow("Recent Items Persistence", "recentDays", 0, 30, 1, "days (0 = keep all)")}
        {numberRow("Max Recent Items", "maxRecent", 0, 100, 1, "items (0 disables)")}

        <Field label="Open Position">
          <Select
            className="w-40"
            ariaLabel="Open Position"
            value={s.openAtCursor ? "cursor" : "last"}
            options={[
              { value: "cursor", label: "At cursor" },
              { value: "last", label: "Where I left it" },
            ]}
            onChange={(v) => update("openAtCursor", v === "cursor")}
          />
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
