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
};

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
  return out;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  const s = await store();
  await s.set(key, value);
  await s.save();
}

/** Apply color scheme + the overall/text/content scales (PLAN.md §7). */
export function applyAppearance(s: Settings) {
  document.documentElement.dataset.theme = s.colorScheme === "Light" ? "light" : "dark";
  document.documentElement.style.fontSize = `${16 * s.textScale}px`;
  // `zoom` scales the whole layout including px sizes; window sizing multiplies
  // by the same factor (see MenuView).
  document.body.style.setProperty("zoom", String(s.scale));
  useMenu.setState({ contentScale: s.contentScale, uiScale: s.scale });
}
