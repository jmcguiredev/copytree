import { load, type Store } from "@tauri-apps/plugin-store";
import { emit } from "@tauri-apps/api/event";
import { useMenu } from "./store";

/** Broadcast when a setting changes, so the (possibly unfocused) menu window can
 *  re-read + re-apply appearance live while the settings window is open. */
export const SETTINGS_CHANGED_EVENT = "acm://settings-changed";

// Settings persisted in settings.json (PLAN.md §7). Shared with the Rust side
// through tauri-plugin-store. Appearance keys are applied here; undo/recent/
// hotkey keys are consumed by the Rust commands.
export interface Settings {
  colorScheme: "Dark" | "Light";
  scale: number;
  textScale: number;
  contentScale: number;
  undoSeconds: number;
  recentDays: number;
  maxRecent: number;
  hotkey: string;
  /** true: open the menu at the cursor; false: reopen where it was last left. */
  openAtCursor: boolean;
  /** UI font family name; "" = system default stack. */
  fontFamily: string;
  /** Accent color (selected group/item) as `#rrggbb`; "" = theme default. */
  accentColor: string;
  /** Whether a mouse hover or a click selects a group/item in the cascade. */
  selectMode: "hover" | "click";
  /** App-local (not global) shortcut to start a new item / group in the focused
   *  column, active only while the overlay is open and no field is focused.
   *  Stored as a `shortcutFromEvent` string (modifiers + KeyboardEvent.code). */
  newItemHotkey: string;
  newGroupHotkey: string;
  deleteHotkey: string;
  /** Per-column-index widths (px) for the cascade; missing indices use the
   *  default. Applied by depth position, so widths are consistent across trees. */
  columnWidths: number[];
}

export const DEFAULTS: Settings = {
  colorScheme: "Dark",
  scale: 1,
  textScale: 1,
  contentScale: 1,
  undoSeconds: 60,
  recentDays: 1,
  maxRecent: 25,
  hotkey: "CmdOrCtrl+Shift+KeyX",
  openAtCursor: true,
  fontFamily: "",
  accentColor: "",
  selectMode: "hover",
  newItemHotkey: "KeyI",
  newGroupHotkey: "KeyG",
  deleteHotkey: "KeyD",
  columnWidths: [],
};

/** Canonical shortcut string for a keydown: ordered modifiers + the physical
 *  `KeyboardEvent.code`. Used both to capture a hotkey and to match one at
 *  runtime. Mirrors the activation-hotkey token format (e.g. "Shift+KeyI"). */
export function shortcutFromEvent(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.metaKey) mods.push("CmdOrCtrl");
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  return [...mods, e.code].join("+");
}

/** Scale settings and the lockout guard applied to them. */
export const SCALE_KEYS = ["scale", "textScale", "contentScale"] as const;
const SCALE_MAX = 5;
/** Floor a scale can never go below, as a fraction of its default. Keeps a bad
 *  value (null / 0 / typo) from shrinking the UI to an unrecoverable size. */
export const SCALE_MIN_FACTOR = 0.25;

/** Minimum allowed value for a scale key (0.25× its default). */
export function scaleMin(key: (typeof SCALE_KEYS)[number]): number {
  return DEFAULTS[key] * SCALE_MIN_FACTOR;
}

/** Clamp a scale to [0.25×default, SCALE_MAX]; non-finite falls back to default.
 *  The lockout guard — applied on load and again in applyAppearance so no stored
 *  or in-flight value can render the window unusable. */
function safeScale(value: unknown, def: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : def;
  return Math.min(SCALE_MAX, Math.max(def * SCALE_MIN_FACTOR, n));
}

let storePromise: Promise<Store> | null = null;
function store() {
  return (storePromise ??= load("settings.json", { autoSave: true }));
}

export async function loadSettings(): Promise<Settings> {
  const s = await store();
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const v = await s.get(key);
    if (v !== undefined && v !== null) (out as Record<string, unknown>)[key] = v;
  }
  // Sanitize scales so a corrupted stored value can't lock the user out.
  for (const key of SCALE_KEYS) out[key] = safeScale(out[key], DEFAULTS[key]);
  return out;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  const s = await store();
  await s.set(key, value);
  await s.save();
  void emit(SETTINGS_CHANGED_EVENT);
}

/** Apply color scheme, font, and the overall/text/content scales (PLAN.md §7).
 *  Scales pass through safeScale so this is always a lockout-safe application.
 *
 *  `applyScale` is false for the Settings window: it renders at 1× (ignoring the
 *  overall/text scale) so it's always usable and can rescue a bad menu scale —
 *  the scale settings size the *menu*, not the control panel you fix them in. */
export function applyAppearance(s: Settings, applyScale = true) {
  const scale = applyScale ? safeScale(s.scale, DEFAULTS.scale) : 1;
  const textScale = applyScale ? safeScale(s.textScale, DEFAULTS.textScale) : 1;
  const contentScale = safeScale(s.contentScale, DEFAULTS.contentScale);

  document.documentElement.dataset.theme = s.colorScheme === "Light" ? "light" : "dark";
  document.documentElement.style.fontSize = `${16 * textScale}px`;
  // `zoom` scales the whole layout including px sizes; window sizing multiplies
  // by the same factor (see MenuView).
  document.body.style.setProperty("zoom", String(scale));

  // Font: drive the `--acm-font` custom property that index.css falls back from;
  // clearing it restores the default system stack.
  const font = s.fontFamily.trim();
  if (font) {
    document.documentElement.style.setProperty(
      "--acm-font",
      `"${font}", ui-sans-serif, system-ui, sans-serif`,
    );
  } else {
    document.documentElement.style.removeProperty("--acm-font");
  }

  // Accent (selected group/item) color: override the theme's --acm-accent, or
  // clear it to fall back to the per-theme default from index.css.
  const accent = s.accentColor.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(accent)) {
    document.documentElement.style.setProperty("--acm-accent", accent);
  } else {
    document.documentElement.style.removeProperty("--acm-accent");
  }

  useMenu.setState({
    contentScale,
    uiScale: scale,
    columnWidths: Array.isArray(s.columnWidths) ? s.columnWidths : [],
    selectMode: s.selectMode === "click" ? "click" : "hover",
    newItemHotkey: s.newItemHotkey,
    newGroupHotkey: s.newGroupHotkey,
    deleteHotkey: s.deleteHotkey,
  });
}
