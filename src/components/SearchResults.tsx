import { useMenu } from "../store";

// Flat, ranked search-results list that replaces the columns while a query is
// active (PLAN.md §5.2). Each row shows the item name with a subtle breadcrumb.
export default function SearchResults() {
  const results = useMenu((s) => s.searchResults);
  const focus = useMenu((s) => s.searchFocus);
  const openSearchHit = useMenu((s) => s.openSearchHit);

  if (results.length === 0) {
    return (
      <div className="w-[320px] shrink-0 p-3 text-xs" style={{ color: "var(--acm-fg-muted)" }}>
        No matches
      </div>
    );
  }

  return (
    <div className="flex w-[320px] shrink-0 flex-col gap-0.5 overflow-y-auto p-1">
      {results.map((hit, i) => {
        const active = i === focus;
        return (
          <button
            key={hit.id}
            type="button"
            onClick={() => openSearchHit(i)}
            onMouseEnter={() => useMenu.setState({ searchFocus: i })}
            className="flex flex-col rounded-md px-2.5 py-1.5 text-left"
            style={{
              background: active ? "var(--acm-accent)" : "transparent",
              color: active ? "#fff" : "var(--acm-fg)",
            }}
          >
            <span className="truncate text-sm">{hit.name}</span>
            {hit.path && (
              <span
                className="truncate text-xs"
                style={{ color: active ? "rgba(255,255,255,0.8)" : "var(--acm-fg-muted)" }}
              >
                {hit.path}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
