// Placeholder settings window (PLAN.md milestone 1). The full settings form —
// color scheme, the three scales, undo/recent durations, and the editable
// activation hotkey — arrives in milestone 7.
export default function SettingsView() {
  return (
    <div className="acm-solid flex h-screen w-screen flex-col gap-4 p-8">
      <h1 className="text-lg font-semibold" style={{ color: "var(--acm-fg)" }}>
        ACM Settings
      </h1>
      <p className="text-sm" style={{ color: "var(--acm-fg-muted)" }}>
        Settings scaffold. The color scheme, scale, undo/recent durations, and the
        editable activation hotkey will live here (milestone 7).
      </p>
      <p className="text-xs" style={{ color: "var(--acm-fg-muted)" }}>
        Activation hotkey: <kbd>⌘⇧V</kbd> (default placeholder)
      </p>
    </div>
  );
}
