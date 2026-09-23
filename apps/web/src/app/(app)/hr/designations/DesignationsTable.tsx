"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ConfirmDialog, Button } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

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
    "—":       { bg: "#f5f5f5", color: "var(--mut)" },
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

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "start",
  fontWeight: 600,
  borderBottom: "1px solid var(--line,#e2e8f0)",
  color: "#64748b",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.3px",
};

// ── Main component ─────────────────────────────────────────────────────────

export function DesignationsTable({ items, canEdit = false }: { items: Designation[]; canEdit?: boolean }) {
  const t = useTranslations("designationsTable");
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
  const formError = useFormError("designation");

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
      setRowError(t("rowErrorRequired"));
      return;
    }
    if (editLevel !== 0 && (isNaN(editLevel) || editLevel < 1 || !Number.isInteger(editLevel))) {
      setRowError(t("rowErrorLevelInteger"));
      return;
    }
    setSaving(true);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/hrms/designations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: editCode, name: editName, level: editLevel, payGrade: editPayGrade }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setRowError(resolved.message);
        return;
      }
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
      setRowError(formError.fromException("save").message);
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
      const res = await fetch(`/api/proxy/v1/hrms/designations/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setDeleteError(resolved.message);
        return;
      }
      setDeleteTarget(null);
      setLocalItems((prev) => prev.filter((d) => d.id !== id));
    } catch {
      setDeleteError(formError.fromException("save").message);
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
            <th style={thStyle}>{t("colCode")}</th>
            <th style={thStyle}>{t("colDesignation")}</th>
            <th style={{ ...thStyle, textAlign: "end" }}>{t("colPayLevel")}</th>
            <th style={thStyle}>{t("colGradePay")}</th>
            <th style={thStyle}>{t("colServiceGroup")}</th>
            <th style={thStyle}>{t("colPayGrade")}</th>
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
                        aria-label={t("designationCodeAriaLabel")}
                        value={editCode}
                        onChange={(e) => setEditCode(e.target.value)}
                        style={{ ...inputStyle, maxWidth: 80 }}
                      />
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <input
                        aria-label={t("designationNameAriaLabel")}
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
                    <td style={{ padding: "10px 12px", textAlign: "end" }}>
                      <input
                        aria-label={t("payLevelAriaLabel")}
                        type="number"
                        min={0}
                        max={18}
                        value={editLevel}
                        onChange={(e) => setEditLevel(Number(e.target.value))}
                        style={{ ...inputStyle, textAlign: "end", maxWidth: 70 }}
                      />
                    </td>
                    <td colSpan={2} style={{ padding: "10px 12px", color: "var(--mut,#94a3b8)", fontSize: 12 }}>
                      {t("computedOnSave")}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <input
                        aria-label={t("payGradeAriaLabel")}
                        value={editPayGrade}
                        onChange={(e) => setEditPayGrade(e.target.value)}
                        style={{ ...inputStyle, maxWidth: 100 }}
                      />
                    </td>
                    <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                      <Button
                        variant="primary"
                        size="sm"
                        style={{ marginInlineEnd: 6 }}
                        onClick={() => saveEdit(item.id)}
                        disabled={saving}
                      >
                        {saving ? t("savingBtn") : t("saveBtn")}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={cancelEdit}>{t("cancelBtn")}</Button>
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
                    <td style={{ padding: "10px 12px", textAlign: "end", fontVariantNumeric: "tabular-nums" }}>
                      {item.level > 0 ? (
                        <span style={{ fontWeight: 700, color: "var(--fg,#0f172a)" }}>
                          {t("levelPrefix", { level: item.level })}
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
                      {canEdit && (
                        <>
                          <Button variant="ghost" size="sm" style={{ marginInlineEnd: 6 }} onClick={() => startEdit(item)}>
                            {t("editBtn")}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => { setDeleteError(undefined); setDeleteTarget(item); }}
                          >
                            {t("deleteBtn")}
                          </Button>
                        </>
                      )}
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
