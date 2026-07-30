import { getCurrentWindow } from "@tauri-apps/api/window";
import MenuView from "./views/MenuView";
import SettingsView from "./views/SettingsView";

// One frontend bundle serves both windows; route on the window label
// (PLAN.md §9). The label is known synchronously at load.
const label = getCurrentWindow().label;

export default function App() {
  return label === "settings" ? <SettingsView /> : <MenuView />;
}
