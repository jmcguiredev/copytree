import { useEffect, useMemo, useState } from "react";
import hljs from "highlight.js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../api";
import { useMenu } from "../store";
import type { ItemContent } from "../types";
import Select, { type SelectOption } from "./Select";

// Every language highlight.js knows, for the language picker.
const LANGUAGES = hljs.listLanguages().sort();

// Content pane (PLAN.md §5.5): text is 2-D scrollable, monospace, and syntax
// highlighted (auto-detected, or a language pinned via the picker); image/gif
// blobs render via the Tauri asset protocol. Content Display Scale drives sizing.
export default function ContentPane() {
  const selectedItemId = useMenu((s) => s.selectedItemId);
  const selectedItemName = useMenu((s) => s.selectedItemName);
  const columns = useMenu((s) => s.columns);
  const contentVersion = useMenu((s) => s.contentVersion);
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
  }, [selectedItemId, contentVersion]);

  // Highlight text: a pinned language if valid, else auto-detect (PLAN §5.5).
  const highlighted = useMemo(() => {
    if (content?.type !== "text" || content.text === "") return null;
    const forced = content.language;
    try {
      if (forced && hljs.getLanguage(forced)) {
        return hljs.highlight(content.text, { language: forced, ignoreIllegals: true });
      }
      return hljs.highlightAuto(content.text);
    } catch {
      return null;
    }
  }, [content]);

  if (selectedItemId == null) return null;

  // Prefer the name from a visible column; fall back to a search hit's name.
  const inColumn = columns.flatMap((c) => c.nodes).find((n) => n.id === selectedItemId);
  const name = inColumn?.name ?? selectedItemName ?? "Item";
  const isText = content?.type === "text";

  const langOptions: SelectOption[] = [
    { value: "", label: highlighted?.language ? `Auto · ${highlighted.language}` : "Auto" },
    ...LANGUAGES.map((l) => ({ value: l, label: l })),
  ];

  const onLanguage = (v: string) => {
    const language = v || null;
    setContent((c) => (c && c.type === "text" ? { ...c, language } : c));
    void api.setItemLanguage(selectedItemId, language);
  };

  return (
    <div
      className="flex min-w-[220px] flex-1 flex-col overflow-hidden"
      style={{ background: "var(--acm-bg-elevated)" }}
    >
      <div className="border-b px-3 py-2" style={{ borderColor: "var(--acm-border)" }}>
        <div className="truncate text-sm font-medium" style={{ color: "var(--acm-fg)" }}>
          {name}
        </div>
        {isText && (
          <div className="mt-1.5">
            <Select
              className="w-full max-w-[240px]"
              ariaLabel="Language"
              searchable
              value={content.language ?? ""}
              options={langOptions}
              onChange={onLanguage}
            />
          </div>
        )}
      </div>
      {error && (
        <div className="p-3 text-xs" style={{ color: "#e07a72" }}>
          {error}
        </div>
      )}
      {content?.type === "text" && (
        <pre
          className="acm-selectable hljs min-h-0 flex-1 overflow-auto p-3 font-mono whitespace-pre"
          style={{ background: "transparent", fontSize: `${13 * scale}px`, lineHeight: 1.5 }}
        >
          {highlighted ? (
            <code dangerouslySetInnerHTML={{ __html: highlighted.value }} />
          ) : (
            <code>{content.text}</code>
          )}
        </pre>
      )}
      {(content?.type === "image" || content?.type === "gif") && (
        <div className="acm-selectable min-h-0 flex-1 overflow-auto p-3">
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
