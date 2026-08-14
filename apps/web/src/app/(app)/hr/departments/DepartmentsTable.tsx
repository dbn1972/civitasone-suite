"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../../_components/ds";

type Dept = { id: string; code: string; name: string };

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 13,
  border: "1px solid var(--line, #cbd5e1)",
  borderRadius: 8,
  width: "100%",
  boxSizing: "border-box",
  minHeight: 36,
};

const btnBase: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid var(--line, #e2e8f0)",
  cursor: "pointer",
  background: "#fff",
};

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
        prev.map((d) =>
          d.id === id ? { ...d, code: editCode, name: editName } : d,
        ),
      );
    } catch {
      setRowError("Save failed. Please try again.");
    } finally {
      setSaving(false);
      try {
        router.refresh();
      } catch {}
    }
  }

  async function doDelete(id: string) {
    setDeletingId(id);
    setDeleteError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/departments/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      setDeleteTarget(null);
      setLocalDepts((prev) => prev.filter((d) => d.id !== id));
    } catch {
      setDeleteError("Delete failed. Please try again.");
    } finally {
      setDeletingId(null);
      try {
        router.refresh();
      } catch {}
    }
  }

  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr>
            <th
              style={{
                padding: "8px 12px",
                textAlign: "left",
                fontWeight: 600,
                borderBottom: "1px solid var(--line, #e2e8f0)",
                color: "#64748b",
                fontSize: 12,
                textTransform: "uppercase",
              }}
            >
              Code
            </th>
            <th
              style={{
                padding: "8px 12px",
                textAlign: "left",
                fontWeight: 600,
                borderBottom: "1px solid var(--line, #e2e8f0)",
                color: "#64748b",
                fontSize: 12,
                textTransform: "uppercase",
              }}
            >
              Department Name
            </th>
            <th
              style={{ padding: "8px 12px", borderBottom: "1px solid var(--line, #e2e8f0)" }}
            ></th>
          </tr>
        </thead>
        <tbody>
          {localDepts.map((dept) => (
            <tr
              key={dept.id}
              style={{ borderBottom: "1px solid var(--line, #f1f5f9)" }}
            >
              {editingId === dept.id ? (
                <>
                  <td style={{ padding: "10px 12px" }}>
                    <input
                      aria-label="Department code"
                      value={editCode}
                      onChange={(e) => setEditCode(e.target.value)}
                      style={inputStyle}
                    />
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <input
                      aria-label="Department name"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      style={inputStyle}
                    />
                    {rowError && (
                      <p
                        style={{
                          color: "#b91c1c",
                          fontSize: 12,
                          marginTop: 4,
                          marginBottom: 0,
                        }}
                      >
                        {rowError}
                      </p>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => saveEdit(dept.id)}
                      disabled={saving}
                      style={{
                        ...btnBase,
                        marginRight: 6,
                        background: "var(--primary, #2563eb)",
                        color: "#fff",
                        border: "none",
                      }}
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button onClick={cancelEdit} style={btnBase}>
                      Cancel
                    </button>
                  </td>
                </>
              ) : (
                <>
                  <td style={{ padding: "10px 12px", color: "#0f172a" }}>
                    {dept.code}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#0f172a" }}>
                    {dept.name}
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => startEdit(dept)}
                      style={{ ...btnBase, marginRight: 6 }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        setDeleteError(undefined);
                        setDeleteTarget(dept);
                      }}
                      style={{ ...btnBase, color: "#b91c1c" }}
                    >
                      Delete
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

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
