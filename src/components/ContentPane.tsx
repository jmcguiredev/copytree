import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../api";
import { useMenu } from "../store";
import type { ItemContent } from "../types";

// Content pane (PLAN.md §5.5): text is 2-D scrollable and monospace; image/gif
// blobs render via the Tauri asset protocol (an <img> animates GIFs for free).
// Content Display Scale drives the text/image sizing.
export default function ContentPane() {
  const selectedItemId = useMenu((s) => s.selectedItemId);
  const scale = useMenu((s) => s.contentScale);
  const [content, setContent] = useState<ItemContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedItemId == null) {
      setContent(null);
      return;
    }
    let live = true;
    setError(null);
    api
      .getItemContent(selectedItemId)
      .then((c) => live && setContent(c))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [selectedItemId]);

  if (selectedItemId == null) return null;

  return (
    <div
      className="flex w-[320px] shrink-0 flex-col overflow-hidden"
      style={{ background: "var(--acm-bg-elevated)" }}
    >
      {error && (
        <div className="p-3 text-xs" style={{ color: "#e07a72" }}>
          {error}
        </div>
      )}
      {content?.type === "text" && (
        <pre
          className="min-h-0 flex-1 overflow-auto p-3 font-mono whitespace-pre"
          style={{ color: "var(--acm-fg)", fontSize: `${13 * scale}px`, lineHeight: 1.5 }}
        >
          {content.text}
        </pre>
      )}
      {(content?.type === "image" || content?.type === "gif") && (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <img
            src={convertFileSrc(content.path)}
            alt=""
            style={{
              width: content.width ? content.width * scale : undefined,
              maxWidth: content.width ? undefined : "100%",
              imageRendering: "auto",
            }}
          />
        </div>
      )}
    </div>
  );
}
