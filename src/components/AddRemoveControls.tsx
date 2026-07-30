import { useState } from "react";
import { focusedNode, useMenu } from "../store";
import { AddModal, ConfirmDeleteModal, RenameModal } from "./modals";

// The `+` / `–` controls plus rename, and the modals they drive (PLAN.md §5.4).
export default function AddRemoveControls() {
  const addGroup = useMenu((s) => s.addGroup);
  const addItem = useMenu((s) => s.addItem);
  const addFileItem = useMenu((s) => s.addFileItem);
  const renameFocused = useMenu((s) => s.renameFocused);
  const removeFocused = useMenu((s) => s.removeFocused);
  const target = useMenu(focusedNode);

  const [addOpen, setAddOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const btn = "h-7 w-7 rounded-md text-sm leading-none";
  const btnStyle = { background: "var(--acm-bg-elevated)", color: "var(--acm-fg)" };

  return (
    <div className="flex items-center gap-1.5 pt-1">
      <button type="button" className={btn} style={btnStyle} title="Add" onClick={() => setAddOpen(true)}>
        +
      </button>
      <button
        type="button"
        className={btn}
        style={btnStyle}
        title="Remove"
        disabled={!target}
        onClick={() => setDeleteOpen(true)}
      >
        –
      </button>
      <button
        type="button"
        className="h-7 rounded-md px-2 text-xs"
        style={btnStyle}
        title="Rename"
        disabled={!target}
        onClick={() => setRenameOpen(true)}
      >
        Rename
      </button>

      <AddModal
        open={addOpen}
        onOpenChange={setAddOpen}
        onAddGroup={(name) => void addGroup(name)}
        onAddItem={(name, text) => void addItem(name, text)}
        onAddFileItem={(name, path) => void addFileItem(name, path)}
      />
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
