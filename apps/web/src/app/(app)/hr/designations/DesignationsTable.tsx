"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ConfirmDialog, Button } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { serviceGroup, payLevelSchema, type ServiceGroup } from "@/lib/payLevels";

type Designation = {
  id: string;
  code: string;
  name: string;
  level: number;
  payGrade: string | null;
};

// ── Service Group badge ─────────────────────────────────────────────────────
// GAP-HR-DESIGNATIONS-01: Grade Pay is a 6th-CPC concept and has no place
// beside 7th-CPC pay-matrix levels, so it's gone (no CPC7_GRADE_PAY, no
// column). Service Group classification now comes from the single shared
// `serviceGroup()` helper (apps/web/src/lib/payLevels.ts) instead of a local
// heuristic, so this screen and the add-employee wizard can't disagree again.

function groupBadgeStyle(group: ServiceGroup | null): React.CSSProperties {
  const colors: Record<ServiceGroup | "none", { bg: string; color: string }> = {
    "Group-A": { bg: "var(--infobg, #eff6ff)", color: "var(--info, #1d4ed8)" },
    "Group-B": { bg: "var(--goodbg, #f0fdf4)", color: "var(--good, #15803d)" },
    "Group-C": { bg: "var(--warnbg, #fff7ed)", color: "var(--warn, #c2410c)" },
    none:      { bg: "var(--bg, #f5f5f5)", color: "var(--mut, #525252)" },
  };
  const { bg, color } = colors[group ?? "none"];
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
  color: "var(--mut, #64748b)",
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
    // 0 is this row's "no level set" sentinel (see editLevel's initial state);
    // any other value must satisfy the same 1-18 rule as the create form and
    // the backend (GAP-HR-DESIGNATIONS-01).
    if (editLevel !== 0 && !payLevelSchema.safeParse(editLevel).success) {
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
            <th style={thStyle}>{t("colServiceGroup")}</th>
            <th style={thStyle}>{t("colPayGrade")}</th>
            {canEdit && <th style={{ ...thStyle, width: 1 }}></th>}
          </tr>
        </thead>
        <tbody>
          {localItems.map((item) => {
            const grp = serviceGroup(item.level);

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
                        <p style={{ color: "var(--bad, #b91c1c)", fontSize: 11, marginTop: 3, marginBottom: 0 }}>
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
                    <td style={{ padding: "10px 12px" }}>
                      {(() => {
                        const editGrp = payLevelSchema.safeParse(editLevel).success ? serviceGroup(editLevel) : null;
                        return <span style={groupBadgeStyle(editGrp)}>{editGrp ?? "—"}</span>;
                      })()}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <input
                        aria-label={t("payGradeAriaLabel")}
                        value={editPayGrade}
                        onChange={(e) => setEditPayGrade(e.target.value)}
                        style={{ ...inputStyle, maxWidth: 100 }}
                      />
                    </td>
                    {canEdit && <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
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
                    </td>}
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
                    <td style={{ padding: "10px 12px" }}>
                      <span style={groupBadgeStyle(grp)}>{grp ?? "—"}</span>
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--mut,#64748b)" }}>
                      {item.payGrade ?? "—"}
                    </td>
                    {canEdit && (
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                        <Button
                          variant="ghost"
                          size="sm"
                          style={{ marginInlineEnd: 6 }}
                          onClick={() => startEdit(item)}
                          aria-label={t("editAria", { name: item.name })}
                        >
                          {t("editBtn")}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => { setDeleteError(undefined); setDeleteTarget(item); }}
                          aria-label={t("deleteAria", { name: item.name })}
                        >
                          {t("deleteBtn")}
                        </Button>
                      </td>
                    )}
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
