import { useState } from "react";
import { focusedNode, useMenu } from "../store";
import { ConfirmDeleteModal, RenameModal } from "./modals";

// Separate add-group / add-item / remove / rename controls. Add starts an inline
// draft in the focused column (name it in place); content for items comes from
// pasting into them afterwards (PLAN.md §5.4).
export default function AddRemoveControls() {
  const beginDraft = useMenu((s) => s.beginDraft);
  const renameFocused = useMenu((s) => s.renameFocused);
  const removeFocused = useMenu((s) => s.removeFocused);
  const target = useMenu(focusedNode);

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const btn =
    "flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-40";
  const btnStyle = { background: "var(--acm-bg-elevated)", color: "var(--acm-fg)" };

  return (
    <div className="flex items-center gap-1.5 pt-1">
      <button
        type="button"
        className={btn}
        style={btnStyle}
        title="Add group"
        onClick={() => beginDraft("group")}
      >
        <FolderPlusIcon />
      </button>
      <button
        type="button"
        className={btn}
        style={btnStyle}
        title="Add item"
        onClick={() => beginDraft("item")}
      >
        <FilePlusIcon />
      </button>
      <button
        type="button"
        className={btn}
        style={btnStyle}
        title="Remove"
        disabled={!target}
        onClick={() => setDeleteOpen(true)}
      >
        <MinusIcon />
      </button>
      <button
        type="button"
        className="h-7 rounded-md px-2 text-xs disabled:opacity-40"
        style={btnStyle}
        title="Rename"
        disabled={!target}
        onClick={() => setRenameOpen(true)}
      >
        Rename
      </button>

      <RenameModal
        open={renameOpen}
        onOpenChange={setRenameOpen}
        initialName={target?.name ?? ""}
        onRename={(name) => void renameFocused(name)}
      />
      <ConfirmDeleteModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        node={target ? { name: target.name, kind: target.kind } : null}
        onConfirm={() => void removeFocused()}
      />
    </div>
  );
}

const ICON = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function FolderPlusIcon() {
  return (
    <svg {...ICON}>
      <path d="M4 4h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M12 11v5M9.5 13.5h5" />
    </svg>
  );
}

function FilePlusIcon() {
  return (
    <svg {...ICON}>
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z" />
      <path d="M14 3v4h4M12 11v5M9.5 13.5h5" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg {...ICON}>
      <path d="M5 12h14" />
    </svg>
  );
}
