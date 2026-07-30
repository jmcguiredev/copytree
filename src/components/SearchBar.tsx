import { forwardRef } from "react";
import { useMenu } from "../store";

interface Props {
  onArrowDown: () => void;
}

// Pinned, auto-focused search input (PLAN.md §5.2). A non-empty query switches
// the menu into search-results mode; ArrowDown drops focus into the results.
const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar({ onArrowDown }, ref) {
  const query = useMenu((s) => s.searchQuery);
  const setSearchQuery = useMenu((s) => s.setSearchQuery);

  return (
    <input
      ref={ref}
      type="text"
      value={query}
      placeholder="Search…"
      onChange={(e) => void setSearchQuery(e.target.value)}
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
