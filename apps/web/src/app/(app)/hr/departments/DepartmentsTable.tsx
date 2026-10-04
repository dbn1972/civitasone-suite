"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ConfirmDialog, Button } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { buildDepartmentTree, eligibleParentOptions, type DeptTreeNode } from "@/lib/hr/departmentTree";

type Dept = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  level?: number | null;
  employeeCount?: number;
};

type TreeNode = DeptTreeNode<Dept>;

// ── Input styles ────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 13,
  border: "1px solid var(--line,#cbd5e1)",
  borderRadius: 8,
  width: "100%",
  boxSizing: "border-box",
  minHeight: 36,
};

// ── Single tree node ───────────────────────────────────────────────────────

type NodeProps = {
  node: TreeNode;
  depth: number;
  editingId: string | null;
  editCode: string;
  editName: string;
  editParentId: string;
  parentOptions: { id: string; label: string }[];
  saving: boolean;
  rowError: string | null;
  t: ReturnType<typeof useTranslations>;
  canEdit: boolean;
  onStartEdit: (dept: Dept) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string) => void;
  onSetEditCode: (v: string) => void;
  onSetEditName: (v: string) => void;
  onSetEditParentId: (v: string) => void;
  onDeleteTarget: (dept: Dept) => void;
};

function DeptNode({
  node,
  depth,
  editingId,
  editCode,
  editName,
  editParentId,
  parentOptions,
  saving,
  rowError,
  t,
  canEdit,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onSetEditCode,
  onSetEditName,
  onSetEditParentId,
  onDeleteTarget,
}: NodeProps) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  const inUse = hasChildren || (node.employeeCount ?? 0) > 0;
  const isEditing = editingId === node.id;
  // Options for THIS node's own re-parent select must exclude itself and its
  // own descendants (computed by the parent from the currently-editing id),
  // so parentOptions is only meaningful while isEditing.

  return (
    <div>
      {/* Row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          paddingInlineStart: 12 + depth * 24,
          borderBottom: "1px solid var(--line,#f1f5f9)",
          borderRadius: 4,
        }}
      >
        {/* Expand/collapse toggle -- GAP-HR-DEPARTMENTS-07: a leaf row used
            to render this as a real, focusable <button> with no aria-label
            (undefined for !hasChildren) showing an inert "·" -- a focusable
            control with no accessible name and nothing to do. Leaf rows now
            render a plain decorative marker instead. */}
        {hasChildren ? (
          <button
            type="button"
            aria-label={open ? t("collapseLabel") : t("expandLabel")}
            onClick={() => setOpen((v) => !v)}
            style={{
              width: 20,
              height: 20,
              flexShrink: 0,
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 11,
              color: "var(--mut,#94a3b8)",
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {open ? "▼" : "▶"}
          </button>
        ) : (
          <span
            aria-hidden="true"
            style={{
              width: 20,
              height: 20,
              flexShrink: 0,
              fontSize: 11,
              color: "var(--mut,#94a3b8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ·
          </span>
        )}

        {isEditing ? (
          /* ── Edit mode ── */
          <>
            <input
              aria-label={t("deptCodeAriaLabel")}
              value={editCode}
              onChange={(e) => onSetEditCode(e.target.value)}
              style={{ ...inputStyle, maxWidth: 90 }}
            />
            <input
              aria-label={t("deptNameAriaLabel")}
              value={editName}
              onChange={(e) => onSetEditName(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
            {/* GAP-HR-DEPARTMENTS-03: re-parenting had no UI at all -- the
                inline edit row only ever sent {code, name}. Options exclude
                this node and its own descendants so a cycle can never be
                selected client-side (the backend also rejects one either
                way, defence in depth). */}
            <select
              aria-label={t("deptParentAriaLabel")}
              value={editParentId}
              onChange={(e) => onSetEditParentId(e.target.value)}
              style={{ ...inputStyle, maxWidth: 220 }}
            >
              <option value="">{t("parentNone")}</option>
              {parentOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            {rowError && (
              <span style={{ color: "var(--bad, #b91c1c)", fontSize: 11 }}>{rowError}</span>
            )}
            <Button variant="primary" size="sm" onClick={() => onSaveEdit(node.id)} disabled={saving}>
              {saving ? t("savingBtn") : t("saveBtn")}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancelEdit}>{t("cancelBtn")}</Button>
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
              aria-label={t("employeeCountAriaLabel", { count: node.employeeCount ?? 0 })}
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
                  marginInlineStart: 4,
                }}
              >
                {t("subDeptCount", { count: node.children.length })}
              </span>
            )}
            {canEdit && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onStartEdit(node)}
                  style={{ marginInlineStart: 8 }}
                  aria-label={t("editAria", { name: node.name })}
                >
                  {t("editBtn")}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => onDeleteTarget(node)}
                  aria-label={t("deleteAria", { name: node.name })}
                  // GAP-HR-DEPARTMENTS-02: the server now rejects deleting a
                  // department that still has children/employees with a 409
                  // (surfaced below via the existing formError-driven
                  // ConfirmDialog message) -- kept clickable rather than
                  // disabled so that message is what tells the clerk why,
                  // consistent with how every other write failure on this
                  // page is already surfaced (see doDelete/saveEdit below).
                  // The title/aria-describedby gives the same reason
                  // up front for a sighted or screen-reader user who
                  // hasn't clicked yet.
                  title={inUse ? t("deleteBlockedHint") : undefined}
                  aria-describedby={inUse ? `dept-inuse-${node.id}` : undefined}
                >
                  {t("deleteBtn")}
                </Button>
                {inUse && (
                  <span id={`dept-inuse-${node.id}`} style={{ display: "none" }}>
                    {t("deleteBlockedHint")}
                  </span>
                )}
              </>
            )}
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
              editParentId={editParentId}
              parentOptions={parentOptions}
              saving={saving}
              rowError={rowError}
              t={t}
              canEdit={canEdit}
              onStartEdit={onStartEdit}
              onCancelEdit={onCancelEdit}
              onSaveEdit={onSaveEdit}
              onSetEditCode={onSetEditCode}
              onSetEditName={onSetEditName}
              onSetEditParentId={onSetEditParentId}
              onDeleteTarget={onDeleteTarget}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function DepartmentsTable({ depts, canEdit }: { depts: Dept[]; canEdit: boolean }) {
  const t = useTranslations("departmentsTable");
  const router = useRouter();
  const [localDepts, setLocalDepts] = useState<Dept[]>(depts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Dept | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editParentId, setEditParentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const formError = useFormError("department");

  const roots = buildDepartmentTree(localDepts);
  const parentOptions = editingId ? eligibleParentOptions(localDepts, editingId) : [];

  function startEdit(dept: Dept) {
    setEditingId(dept.id);
    setEditCode(dept.code);
    setEditName(dept.name);
    setEditParentId(dept.parentId ?? "");
    setRowError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setRowError(null);
  }

  async function saveEdit(id: string) {
    if (editCode.trim() === "" || editName.trim() === "") {
      setRowError(t("rowErrorRequired"));
      return;
    }
    setSaving(true);
    formError.clear();
    try {
      const original = localDepts.find((d) => d.id === id);
      const newParentId = editParentId === "" ? null : editParentId;
      const parentChanged = (original?.parentId ?? null) !== newParentId;
      const res = await fetch(`/api/proxy/v1/hrms/departments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: editCode,
          name: editName,
          ...(parentChanged ? { parentId: newParentId } : {}),
        }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setRowError(resolved.message);
        return;
      }
      setRowError(null);
      setEditingId(null);
      setLocalDepts((prev) =>
        prev.map((d) => (d.id === id ? { ...d, code: editCode, name: editName, ...(parentChanged ? { parentId: newParentId } : {}) } : d)),
      );
    } catch (caught) {
      setRowError(formError.fromException("save", caught).message);
    } finally {
      setSaving(false);
      try { router.refresh(); } catch { /* ignore */ }
    }
  }

  async function doDelete(id: string) {
    setDeletingId(id);
    setDeleteError(undefined);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/hrms/departments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setDeleteError(resolved.message);
        return;
      }
      setDeleteTarget(null);
      setLocalDepts((prev) => prev.filter((d) => d.id !== id));
    } catch (caught) {
      setDeleteError(formError.fromException("save", caught).message);
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
            {t("noDepartmentsFound")}
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
              editParentId={editParentId}
              parentOptions={parentOptions}
              saving={saving}
              rowError={rowError}
              t={t}
              canEdit={canEdit}
              onStartEdit={startEdit}
              onCancelEdit={cancelEdit}
              onSaveEdit={saveEdit}
              onSetEditCode={setEditCode}
              onSetEditName={setEditName}
              onSetEditParentId={setEditParentId}
              onDeleteTarget={(d) => { setDeleteError(undefined); setDeleteTarget(d); }}
            />
          ))
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("deleteConfirmTitle", { name: deleteTarget?.name ?? "" })}
        description={t("deleteConfirmDesc")}
        danger
        confirmLabel={t("deleteConfirmBtn")}
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
