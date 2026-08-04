import { load, type Store } from "@tauri-apps/plugin-store";
import { useMenu } from "./store";

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
}

export const DEFAULTS: Settings = {
  colorScheme: "Dark",
  scale: 1,
  textScale: 1,
  contentScale: 1,
  undoSeconds: 60,
  recentDays: 1,
  maxRecent: 25,
  hotkey: "CmdOrCtrl+Shift+KeyV",
  openAtCursor: true,
  fontFamily: "",
};

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
}

/** Apply color scheme, font, and the overall/text/content scales (PLAN.md §7).
 *  Scales pass through safeScale so this is always a lockout-safe application. */
export function applyAppearance(s: Settings) {
  const scale = safeScale(s.scale, DEFAULTS.scale);
  const textScale = safeScale(s.textScale, DEFAULTS.textScale);
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

  useMenu.setState({ contentScale, uiScale: scale });
}
