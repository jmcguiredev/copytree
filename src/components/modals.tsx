import * as Dialog from "@radix-ui/react-dialog";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";

const overlayStyle = "fixed inset-0 bg-black/50";
const contentStyle =
  "fixed left-1/2 top-1/2 w-[340px] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-4 shadow-xl";

function panelStyle() {
  return { background: "var(--acm-bg)", borderColor: "var(--acm-border)" };
}

const inputClass =
  "w-full rounded-md border px-2.5 py-1.5 text-sm outline-none";
const inputStyle = {
  background: "var(--acm-bg-elevated)",
  borderColor: "var(--acm-border)",
  color: "var(--acm-fg)",
};

function Buttons({ onCancel, confirmLabel }: { onCancel: () => void; confirmLabel: string }) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md px-3 py-1.5 text-sm"
        style={{ color: "var(--acm-fg-muted)" }}
      >
        Cancel
      </button>
      <button
        type="submit"
        className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
        style={{ background: "var(--acm-accent)" }}
      >
        {confirmLabel}
      </button>
    </div>
  );
}

/** Base name of a path, without extension, for defaulting the item name. */
function baseName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.[^.]+$/, "");
}

type AddKind = "text" | "file" | "group";

/** Create a group or a text / image·gif item (PLAN.md §5.4). */
export function AddModal({
  open,
  onOpenChange,
  onAddGroup,
  onAddItem,
  onAddFileItem,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAddGroup: (name: string) => void;
  onAddItem: (name: string, text: string) => void;
  onAddFileItem: (name: string, path: string) => void;
}) {
  const [kind, setKind] = useState<AddKind>("text");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKind("text");
      setName("");
      setText("");
      setFilePath(null);
    }
  }, [open]);

  async function chooseFile() {
    const selected = await openFileDialog({
      multiple: false,
      filters: [{ name: "Image / GIF", extensions: ["gif", "png", "jpg", "jpeg", "webp", "bmp"] }],
    });
    if (typeof selected === "string") {
      setFilePath(selected);
      if (!name.trim()) setName(baseName(selected));
    }
  }

  const canSubmit = name.trim().length > 0 && (kind !== "file" || filePath != null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlayStyle} />
        <Dialog.Content className={contentStyle} style={panelStyle()}>
          <Dialog.Title className="text-sm font-semibold" style={{ color: "var(--acm-fg)" }}>
            New {kind === "group" ? "group" : "item"}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            Create a new group, text item, or image/gif item.
          </Dialog.Description>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!canSubmit) return;
              if (kind === "group") onAddGroup(name.trim());
              else if (kind === "file" && filePath) onAddFileItem(name.trim(), filePath);
              else onAddItem(name.trim(), text);
              onOpenChange(false);
            }}
          >
            <div className="mt-3 flex gap-1">
              {(
                [
                  ["text", "Text"],
                  ["file", "Image / GIF"],
                  ["group", "Group"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className="flex-1 rounded-md px-2 py-1 text-xs"
                  style={{
                    background: kind === k ? "var(--acm-accent)" : "var(--acm-bg-elevated)",
                    color: kind === k ? "#fff" : "var(--acm-fg-muted)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className={`mt-3 ${inputClass}`}
              style={inputStyle}
            />
            {kind === "text" && (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Text content"
                rows={5}
                className={`mt-2 resize-none font-mono ${inputClass}`}
                style={inputStyle}
              />
            )}
            {kind === "file" && (
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void chooseFile()}
                  className="rounded-md border px-3 py-1.5 text-sm"
                  style={inputStyle}
                >
                  Choose file…
                </button>
                <span className="truncate text-xs" style={{ color: "var(--acm-fg-muted)" }}>
                  {filePath ? baseName(filePath) : "No file selected"}
                </span>
              </div>
            )}
            <Buttons onCancel={() => onOpenChange(false)} confirmLabel="Create" />
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Rename the focused node (PLAN.md §5.4). */
export function RenameModal({
  open,
  onOpenChange,
  initialName,
  onRename,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialName: string;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlayStyle} />
        <Dialog.Content className={contentStyle} style={panelStyle()}>
          <Dialog.Title className="text-sm font-semibold" style={{ color: "var(--acm-fg)" }}>
            Rename
          </Dialog.Title>
          <Dialog.Description className="sr-only">Rename this node.</Dialog.Description>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              onRename(name.trim());
              onOpenChange(false);
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`mt-3 ${inputClass}`}
              style={inputStyle}
            />
            <Buttons onCancel={() => onOpenChange(false)} confirmLabel="Rename" />
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Confirm deletion; the copy warns that groups cascade (PLAN.md §5.4). */
export function ConfirmDeleteModal({
  open,
  onOpenChange,
  node,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  node: { name: string; kind: "group" | "item" } | null;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlayStyle} />
        <Dialog.Content className={contentStyle} style={panelStyle()}>
          <Dialog.Title className="text-sm font-semibold" style={{ color: "var(--acm-fg)" }}>
            Delete “{node?.name}”?
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-xs" style={{ color: "var(--acm-fg-muted)" }}>
            {node?.kind === "group"
              ? "This group and everything inside it will be permanently deleted."
              : "This item will be permanently deleted."}
          </Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md px-3 py-1.5 text-sm"
              style={{ color: "var(--acm-fg-muted)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
              style={{ background: "#c8453c" }}
            >
              Delete
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
