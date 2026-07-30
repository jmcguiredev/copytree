import * as Dialog from "@radix-ui/react-dialog";
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

/** Create a group or item (PLAN.md §5.4). Toggle chooses which. */
export function AddModal({
  open,
  onOpenChange,
  onAddGroup,
  onAddItem,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAddGroup: (name: string) => void;
  onAddItem: (name: string, text: string) => void;
}) {
  const [kind, setKind] = useState<"group" | "item">("item");
  const [name, setName] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    if (open) {
      setKind("item");
      setName("");
      setText("");
    }
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlayStyle} />
        <Dialog.Content className={contentStyle} style={panelStyle()}>
          <Dialog.Title className="text-sm font-semibold" style={{ color: "var(--acm-fg)" }}>
            New {kind}
          </Dialog.Title>
          <Dialog.Description className="sr-only">Create a new group or item.</Dialog.Description>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              if (kind === "group") onAddGroup(name.trim());
              else onAddItem(name.trim(), text);
              onOpenChange(false);
            }}
          >
            <div className="mt-3 flex gap-1">
              {(["item", "group"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className="flex-1 rounded-md px-2 py-1 text-xs capitalize"
                  style={{
                    background: kind === k ? "var(--acm-accent)" : "var(--acm-bg-elevated)",
                    color: kind === k ? "#fff" : "var(--acm-fg-muted)",
                  }}
                >
                  {k}
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
            {kind === "item" && (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Text content"
                rows={5}
                className={`mt-2 resize-none font-mono ${inputClass}`}
                style={inputStyle}
              />
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
