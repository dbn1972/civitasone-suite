"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../../_components/ds";

type Designation = {
  id: string;
  code: string;
  name: string;
  level: number;
  payGrade: string | null;
};

// ── 7th CPC Pay Matrix helpers ─────────────────────────────────────────────

const CPC7_GRADE_PAY: Record<number, number> = {
  1: 1800, 2: 1900, 3: 2000, 4: 2400, 5: 2800,
  6: 4200, 7: 4600, 8: 4800, 9: 5400,
  10: 5400, 11: 6600, 12: 7600, 13: 8700, 14: 10000,
};

function serviceGroup(level: number): string {
  if (level <= 0)  return "—";
  if (level <= 3)  return "Group-D";
  if (level <= 5)  return "Group-C";
  if (level <= 9)  return "Group-B";
  return "Group-A";
}

function groupBadgeStyle(level: number): React.CSSProperties {
  const g = serviceGroup(level);
  const colors: Record<string, { bg: string; color: string }> = {
    "Group-A": { bg: "#eff6ff", color: "#1d4ed8" },
    "Group-B": { bg: "#f0fdf4", color: "#15803d" },
    "Group-C": { bg: "#fff7ed", color: "#c2410c" },
    "Group-D": { bg: "#f5f5f5", color: "#525252" },
    "—":       { bg: "#f5f5f5", color: "#94a3b8" },
  };
  const { bg, color } = colors[g] ?? colors["—"];
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 700,
    background: bg,
    color,
    whiteSpace: "nowrap",
  };
}

// ── Styles ─────────────────────────────────────────────────────────────────

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

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontWeight: 600,
  borderBottom: "1px solid var(--line,#e2e8f0)",
  color: "#64748b",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.3px",
};

// ── Main component ─────────────────────────────────────────────────────────

export function DesignationsTable({ items }: { items: Designation[] }) {
  const router = useRouter();
  const [localItems, setLocalItems] = useState<Designation[]>(items);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Designation | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editLevel, setEditLevel] = useState<number>(0);
  const [editPayGrade, setEditPayGrade] = useState("");
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | undefined>();

  function startEdit(item: Designation) {
    setEditingId(item.id);
    setEditCode(item.code);
    setEditName(item.name);
    setEditLevel(item.level);
    setEditPayGrade(item.payGrade ?? "");
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
    if (editLevel !== 0 && (isNaN(editLevel) || editLevel < 1 || !Number.isInteger(editLevel))) {
      setRowError("Level must be a positive integer if provided");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/designations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: editCode, name: editName, level: editLevel, payGrade: editPayGrade }),
      });
      if (!res.ok) throw new Error("Save failed");
      setRowError(null);
      setEditingId(null);
      setLocalItems((prev) =>
        prev.map((d) =>
          d.id === id
            ? { ...d, code: editCode, name: editName, level: editLevel, payGrade: editPayGrade || null }
            : d,
        ),
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
      const res = await fetch(`/api/proxy/v1/hrms/designations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setDeleteTarget(null);
      setLocalItems((prev) => prev.filter((d) => d.id !== id));
    } catch {
      setDeleteError("Delete failed. Please try again.");
    } finally {
      setDeletingId(null);
      try { router.refresh(); } catch { /* ignore */ }
    }
  }

  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr>
            <th style={thStyle}>Code</th>
            <th style={thStyle}>Designation</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Pay Level (7th CPC)</th>
            <th style={thStyle}>Grade Pay (₹)</th>
            <th style={thStyle}>Service Group</th>
            <th style={thStyle}>Pay Grade</th>
            <th style={{ ...thStyle, width: 1 }}></th>
          </tr>
        </thead>
        <tbody>
          {localItems.map((item) => {
            const gp  = item.level > 0 ? CPC7_GRADE_PAY[item.level] : null;
            const grp = item.level > 0 ? serviceGroup(item.level) : "—";

            return (
              <tr key={item.id} style={{ borderBottom: "1px solid var(--line,#f1f5f9)" }}>
                {editingId === item.id ? (
                  <>
                    <td style={{ padding: "10px 12px" }}>
                      <input
                        aria-label="Designation code"
                        value={editCode}
                        onChange={(e) => setEditCode(e.target.value)}
                        style={{ ...inputStyle, maxWidth: 80 }}
                      />
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <input
                        aria-label="Designation name"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        style={inputStyle}
                      />
                      {rowError && (
                        <p style={{ color: "#b91c1c", fontSize: 11, marginTop: 3, marginBottom: 0 }}>
                          {rowError}
                        </p>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <input
                        aria-label="Pay level (1–18)"
                        type="number"
                        min={0}
                        max={18}
                        value={editLevel}
                        onChange={(e) => setEditLevel(Number(e.target.value))}
                        style={{ ...inputStyle, textAlign: "right", maxWidth: 70 }}
                      />
                    </td>
                    <td colSpan={2} style={{ padding: "10px 12px", color: "var(--mut,#94a3b8)", fontSize: 12 }}>
                      computed on save
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <input
                        aria-label="Pay grade"
                        value={editPayGrade}
                        onChange={(e) => setEditPayGrade(e.target.value)}
                        style={{ ...inputStyle, maxWidth: 100 }}
                      />
                    </td>
                    <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                      <button
                        onClick={() => saveEdit(item.id)}
                        disabled={saving}
                        style={{ ...btnBase, marginRight: 6, background: "var(--primary,#2563eb)", color: "#fff", border: "none" }}
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button onClick={cancelEdit} style={btnBase}>Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: "10px 12px", color: "var(--mut,#64748b)", fontSize: 12, fontWeight: 600, letterSpacing: "0.3px" }}>
                      {item.code}
                    </td>
                    <td style={{ padding: "10px 12px", fontWeight: 500 }}>
                      {item.name}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {item.level > 0 ? (
                        <span style={{ fontWeight: 700, color: "var(--fg,#0f172a)" }}>
                          Level {item.level}
                        </span>
                      ) : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", fontVariantNumeric: "tabular-nums" }}>
                      {gp != null ? (
                        <span style={{ fontWeight: 600, color: "var(--fg,#0f172a)" }}>
                          ₹{gp.toLocaleString("en-IN")}
                        </span>
                      ) : "—"}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {item.level > 0 ? (
                        <span style={groupBadgeStyle(item.level)}>{grp}</span>
                      ) : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--mut,#64748b)" }}>
                      {item.payGrade ?? "—"}
                    </td>
                    <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                      <button onClick={() => startEdit(item)} style={{ ...btnBase, marginRight: 6 }}>
                        Edit
                      </button>
                      <button
                        onClick={() => { setDeleteError(undefined); setDeleteTarget(item); }}
                        style={{ ...btnBase, color: "#b91c1c" }}
                      >
                        Delete
                      </button>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete "${deleteTarget?.name ?? ""}"?`}
        description="This designation will be permanently removed. This action cannot be undone."
        danger
        confirmLabel="Delete designation"
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
