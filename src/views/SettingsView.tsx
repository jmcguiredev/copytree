import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { api } from "../api";
import { applyAppearance, DEFAULTS, loadSettings, scaleMin, setSetting, type Settings } from "../settings";
import NumberField from "../components/NumberField";
import Select, { type SelectOption } from "../components/Select";
import ColorPicker from "../components/ColorPicker";

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

/** Build a Shortcut string from a keydown, or null for modifier-only presses.
 *  `allowBare` permits a modifier-less key (for app-local create hotkeys); the
 *  global activation hotkey still requires at least one modifier. */
function hotkeyFromEvent(e: ReactKeyboardEvent, allowBare = false): string | null {
  if (MODIFIER_CODES.includes(e.code)) return null;
  const mods: string[] = [];
  if (e.metaKey) mods.push("CmdOrCtrl");
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (mods.length === 0 && !allowBare) return null; // global hotkey needs a modifier
  return [...mods, e.code].join("+");
}

/** A capture button: click to arm, then the next keydown becomes the shortcut. */
function HotkeyCapture({
  value,
  allowBare,
  onCapture,
  onArm,
}: {
  value: string;
  allowBare?: boolean;
  onCapture: (hotkey: string) => void;
  onArm?: () => void;
}) {
  const [capturing, setCapturing] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        setCapturing(true);
        onArm?.();
      }}
      onKeyDown={(e) => {
        if (!capturing) return;
        e.preventDefault();
        const hk = hotkeyFromEvent(e, allowBare);
        if (!hk) return;
        onCapture(hk);
        setCapturing(false);
      }}
      onBlur={() => setCapturing(false)}
      className="min-w-28 rounded-md border px-3 py-1 text-sm"
      style={{
        ...inputStyle,
        borderColor: capturing ? "var(--acm-accent)" : "var(--acm-border)",
      }}
    >
      {capturing ? "Press keys…" : formatHotkey(value)}
    </button>
  );
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

  // A labelled numeric field (custom stepper) with an optional hint to its left.
  function numberRow(
    label: string,
    key: "scale" | "textScale" | "contentScale" | "undoSeconds" | "recentDays" | "maxRecent",
    min: number,
    max: number,
    step: number,
    hint?: string,
  ) {
    return (
      <Field label={label}>
        <span className="flex items-center gap-2">
          {hint && (
            <span className="text-xs" style={{ color: "var(--acm-fg-muted)" }}>
              {hint}
            </span>
          )}
          <NumberField
            value={s[key]}
            min={min}
            max={max}
            step={step}
            onChange={(v) => update(key, v)}
          />
        </span>
      </Field>
    );
  }

  return (
    <div className="acm-solid h-screen w-screen overflow-auto p-8">
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

        <Field label="Theme Color">
          <ColorPicker
            ariaLabel="Theme Color"
            value={s.accentColor}
            onChange={(hex) => update("accentColor", hex)}
          />
        </Field>

        <Field label="Font">
          <Select
            className="w-52"
            ariaLabel="Font"
            searchable
            value={fonts.includes(s.fontFamily) ? s.fontFamily : ""}
            options={fontOptions}
            onChange={(v) => update("fontFamily", v)}
            optionStyle={(o) => (o.value ? { fontFamily: `"${o.value}"` } : undefined)}
          />
        </Field>

        {numberRow("Scale", "scale", scaleMin("scale"), 5, 0.1)}
        {numberRow("Text Scale", "textScale", scaleMin("textScale"), 5, 0.1)}
        {numberRow("Content Display Scale", "contentScale", scaleMin("contentScale"), 5, 0.1)}

        {numberRow("Overwritten Item Persistence", "undoSeconds", 0, 60, 1, "seconds (0 disables undo)")}
        {numberRow("Recent Items Persistence", "recentDays", 0, 30, 1, "days (0 = keep all)")}
        {numberRow("Max Recent Items", "maxRecent", 0, 100, 1, "items (0 disables)")}

        <Field label="Select Item / Group">
          <Select
            className="w-40"
            ariaLabel="Select Item / Group"
            value={s.selectMode}
            options={[
              { value: "hover", label: "On Hover" },
              { value: "click", label: "On Click" },
            ]}
            onChange={(v) => update("selectMode", v as Settings["selectMode"])}
          />
        </Field>

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
          <HotkeyCapture
            value={s.hotkey}
            onArm={() => setHotkeyError(null)}
            onCapture={(hk) =>
              api
                .setActivationHotkey(hk)
                .then(() => setS((prev) => ({ ...prev, hotkey: hk })))
                .catch((err) => setHotkeyError(String(err)))
            }
          />
        </Field>

        <Field label="New Item Hotkey">
          <HotkeyCapture
            value={s.newItemHotkey}
            allowBare
            onCapture={(hk) => update("newItemHotkey", hk)}
          />
        </Field>

        <Field label="New Group Hotkey">
          <HotkeyCapture
            value={s.newGroupHotkey}
            allowBare
            onCapture={(hk) => update("newGroupHotkey", hk)}
          />
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
