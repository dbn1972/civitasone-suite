"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../../_components/ds";

type Dept = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  employeeCount?: number;
};

type TreeNode = Dept & { children: TreeNode[] };

function buildTree(flat: Dept[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(
    flat.map((d) => [d.id, { ...d, children: [] }]),
  );
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// ── Input / button styles ──────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 13,
  border: "1px solid var(--line,#cbd5e1)",
  borderRadius: 8,
  width: "100%",
  boxSizing: "border-box",
  minHeight: 36,
};

const btnBase: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid var(--line,#e2e8f0)",
  cursor: "pointer",
  background: "var(--surface,#fff)",
};

// ── Single tree node ───────────────────────────────────────────────────────

type NodeProps = {
  node: TreeNode;
  depth: number;
  editingId: string | null;
  editCode: string;
  editName: string;
  saving: boolean;
  rowError: string | null;
  onStartEdit: (dept: Dept) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string) => void;
  onSetEditCode: (v: string) => void;
  onSetEditName: (v: string) => void;
  onDeleteTarget: (dept: Dept) => void;
};

function DeptNode({
  node,
  depth,
  editingId,
  editCode,
  editName,
  saving,
  rowError,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onSetEditCode,
  onSetEditName,
  onDeleteTarget,
}: NodeProps) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      {/* Row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          paddingLeft: 12 + depth * 24,
          borderBottom: "1px solid var(--line,#f1f5f9)",
          borderRadius: 4,
        }}
      >
        {/* Expand/collapse toggle */}
        <button
          type="button"
          aria-label={hasChildren ? (open ? "Collapse" : "Expand") : undefined}
          onClick={() => hasChildren && setOpen((v) => !v)}
          style={{
            width: 20,
            height: 20,
            flexShrink: 0,
            background: "none",
            border: "none",
            cursor: hasChildren ? "pointer" : "default",
            fontSize: 11,
            color: "var(--mut,#94a3b8)",
            padding: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {hasChildren ? (open ? "▼" : "▶") : "·"}
        </button>

        {editingId === node.id ? (
          /* ── Edit mode ── */
          <>
            <input
              aria-label="Department code"
              value={editCode}
              onChange={(e) => onSetEditCode(e.target.value)}
              style={{ ...inputStyle, maxWidth: 90 }}
            />
            <input
              aria-label="Department name"
              value={editName}
              onChange={(e) => onSetEditName(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
            {rowError && (
              <span style={{ color: "#b91c1c", fontSize: 11 }}>{rowError}</span>
            )}
            <button
              onClick={() => onSaveEdit(node.id)}
              disabled={saving}
              style={{
                ...btnBase,
                background: "var(--primary,#2563eb)",
                color: "#fff",
                border: "none",
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={onCancelEdit} style={btnBase}>Cancel</button>
          </>
        ) : (
          /* ── View mode ── */
          <>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--mut,#94a3b8)",
                minWidth: 54,
                letterSpacing: "0.3px",
              }}
            >
              {node.code}
            </span>
            <span style={{ flex: 1, fontSize: 14, fontWeight: depth === 0 ? 600 : 400 }}>
              {node.name}
            </span>
            {/* Employee count badge */}
            <span
              aria-label={`${node.employeeCount ?? 0} employees`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--infobg,#eff6ff)",
                color: "var(--info,#2563eb)",
                borderRadius: 12,
                fontSize: 11,
                fontWeight: 600,
                padding: "1px 8px",
                minWidth: 28,
              }}
            >
              {node.employeeCount ?? 0}
            </span>
            {hasChildren && (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--mut,#94a3b8)",
                  marginLeft: 4,
                }}
              >
                {node.children.length} sub-dept{node.children.length !== 1 ? "s" : ""}
              </span>
            )}
            <button
              onClick={() => onStartEdit(node)}
              style={{ ...btnBase, marginLeft: 8 }}
            >
              Edit
            </button>
            <button
              onClick={() => onDeleteTarget(node)}
              style={{ ...btnBase, color: "#b91c1c" }}
            >
              Delete
            </button>
          </>
        )}
      </div>

      {/* Children */}
      {hasChildren && open && (
        <div>
          {node.children.map((child) => (
            <DeptNode
              key={child.id}
              node={child}
              depth={depth + 1}
              editingId={editingId}
              editCode={editCode}
              editName={editName}
              saving={saving}
              rowError={rowError}
              onStartEdit={onStartEdit}
              onCancelEdit={onCancelEdit}
              onSaveEdit={onSaveEdit}
              onSetEditCode={onSetEditCode}
              onSetEditName={onSetEditName}
              onDeleteTarget={onDeleteTarget}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function DepartmentsTable({ depts }: { depts: Dept[] }) {
  const router = useRouter();
  const [localDepts, setLocalDepts] = useState<Dept[]>(depts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Dept | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | undefined>();

  const roots = buildTree(localDepts);

  function startEdit(dept: Dept) {
    setEditingId(dept.id);
    setEditCode(dept.code);
    setEditName(dept.name);
    setRowError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setRowError(null);
  }

  async function saveEdit(id: string) {
    if (editCode.trim() === "" || editName.trim() === "") {
      setRowError("Code and name are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/departments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: editCode, name: editName }),
      });
      if (!res.ok) throw new Error("Save failed");
      setRowError(null);
      setEditingId(null);
      setLocalDepts((prev) =>
        prev.map((d) => (d.id === id ? { ...d, code: editCode, name: editName } : d)),
      );
    } catch {
      setRowError("Save failed. Please try again.");
    } finally {
      setSaving(false);
      try { router.refresh(); } catch { /* ignore */ }
    }
  }

  async function doDelete(id: string) {
    setDeletingId(id);
    setDeleteError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/departments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setDeleteTarget(null);
      setLocalDepts((prev) => prev.filter((d) => d.id !== id));
    } catch {
      setDeleteError("Delete failed. Please try again.");
    } finally {
      setDeletingId(null);
      try { router.refresh(); } catch { /* ignore */ }
    }
  }

  return (
    <>
      <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--line,#e2e8f0)" }}>
        {roots.length === 0 ? (
          <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--mut,#64748b)", fontSize: 13 }}>
            No departments found.
          </div>
        ) : (
          roots.map((root) => (
            <DeptNode
              key={root.id}
              node={root}
              depth={0}
              editingId={editingId}
              editCode={editCode}
              editName={editName}
              saving={saving}
              rowError={rowError}
              onStartEdit={startEdit}
              onCancelEdit={cancelEdit}
              onSaveEdit={saveEdit}
              onSetEditCode={setEditCode}
              onSetEditName={setEditName}
              onDeleteTarget={(d) => { setDeleteError(undefined); setDeleteTarget(d); }}
            />
          ))
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete "${deleteTarget?.name ?? ""}"?`}
        description="This department will be permanently removed. This action cannot be undone."
        danger
        confirmLabel="Delete department"
        busy={deletingId !== null}
        errorMessage={deleteError}
        onConfirm={() => deleteTarget && void doDelete(deleteTarget.id)}
        onCancel={() => {
          if (deletingId === null) {
            setDeleteTarget(null);
            setDeleteError(undefined);
          }
        }}
      />
    </>
  );
}
