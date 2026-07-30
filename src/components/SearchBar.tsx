import { forwardRef } from "react";

interface Props {
  onArrowDown: () => void;
}

// Pinned, auto-focused search input. Filtering / search-results mode is wired
// up in milestone 6; for now ArrowDown drops focus into the first column row
// (PLAN.md §5.2).
const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar({ onArrowDown }, ref) {
  return (
    <input
      ref={ref}
      type="text"
      placeholder="Search…"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          onArrowDown();
        }
      }}
      className="h-8 w-full rounded-md border px-3 text-sm outline-none"
      style={{
        background: "var(--acm-bg-elevated)",
        borderColor: "var(--acm-border)",
        color: "var(--acm-fg)",
      }}
    />
  );
});

export default SearchBar;
