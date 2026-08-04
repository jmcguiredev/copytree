import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  className?: string;
}

/**
 * A non-native numeric field: a text box plus up/down stepper buttons, styled
 * with the `--acm-*` theme tokens. Edits commit on blur / Enter (or immediately
 * on a stepper click); an empty or invalid entry reverts to the last valid value
 * rather than collapsing — so it can never emit an out-of-range/NaN value.
 */
export default function NumberField({ value, min, max, step, onChange, className }: Props) {
  const decimals = step < 1 ? (String(step).split(".")[1]?.length ?? 1) : 0;
  const fmt = (n: number) => n.toFixed(decimals);
  const clamp = (raw: number) => {
    if (!Number.isFinite(raw)) return value;
    const snapped = Math.round(raw / step) * step;
    return Math.max(min, Math.min(max, Number(snapped.toFixed(decimals))));
  };

  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);

  // Reflect external changes to `value` unless the user is mid-edit.
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = () => {
    const parsed = Number(text);
    const next = text.trim() === "" || Number.isNaN(parsed) ? value : clamp(parsed);
    setText(fmt(next));
    if (next !== value) onChange(next);
  };

  const nudge = (dir: number) => {
    const next = clamp(value + dir * step);
    setText(fmt(next));
    if (next !== value) onChange(next);
  };

  return (
    <div
      className={`inline-flex items-stretch overflow-hidden rounded-md border ${className ?? ""}`}
      style={{ borderColor: "var(--acm-border)", background: "var(--acm-bg-elevated)" }}
    >
      <input
        inputMode="decimal"
        value={text}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            nudge(1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            nudge(-1);
          }
        }}
        className="w-12 bg-transparent px-2 py-1 text-sm tabular-nums outline-none"
        style={{ color: "var(--acm-fg)" }}
      />
      <div className="flex flex-col border-l" style={{ borderColor: "var(--acm-border)" }}>
        <StepButton dir="▲" onClick={() => nudge(1)} />
        <StepButton dir="▼" onClick={() => nudge(-1)} border />
      </div>
    </div>
  );
}

function StepButton({ dir, onClick, border }: { dir: string; onClick: () => void; border?: boolean }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      // Keep focus on the input so clicking a stepper doesn't fire a blur-commit.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-3.5 w-6 items-center justify-center text-[8px] leading-none ${border ? "border-t" : ""}`}
      style={{ color: "var(--acm-fg-muted)", borderColor: "var(--acm-border)" }}
    >
      {dir}
    </button>
  );
}
