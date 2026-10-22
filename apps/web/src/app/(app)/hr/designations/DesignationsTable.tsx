"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ConfirmDialog, Button, DataTable } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { serviceGroup, payLevelSchema, SERVICE_GROUP_BANDS, type ServiceGroup } from "@/lib/payLevels";

// `& Record<string, unknown>` satisfies DataTable's `T extends
// Record<string, unknown>` generic constraint -- same pattern already used
// by designations/page.tsx and hr/locations/page.tsx's own row types.
type Designation = {
  id: string;
  code: string;
  name: string;
  level: number;
  payGrade: string | null;
  /**
   * GAP-HR-DESIGNATIONS-02: how many records (employees, seniority lists,
   * workforce posts, requisitions, ...) still reference this designation.
   * Only present when the page asked the API for usage (`?withUsage=true`,
   * admins only); absent means "unknown", never "zero".
   */
  usageCount?: number;
} & Record<string, unknown>;

// ── Service Group badge ─────────────────────────────────────────────────────
// GAP-HR-DESIGNATIONS-01: Grade Pay is a 6th-CPC concept and has no place
// beside 7th-CPC pay-matrix levels, so it's gone (no CPC7_GRADE_PAY, no
// column). Service Group classification now comes from the single shared
// `serviceGroup()` helper (apps/web/src/lib/payLevels.ts) instead of a local
// heuristic, so this screen and the add-employee wizard can't disagree again.

function groupBadgeStyle(group: ServiceGroup | null): React.CSSProperties {
  const colors: Record<ServiceGroup | "none", { bg: string; color: string }> = {
    "Group-A": { bg: "var(--infobg)", color: "var(--info)" },
    "Group-B": { bg: "var(--goodbg)", color: "var(--good)" },
    "Group-C": { bg: "var(--warnbg)", color: "var(--warn)" },
    none:      { bg: "var(--bg)", color: "var(--mut)" },
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
  border: "1px solid var(--line)",
  borderRadius: 8,
  width: "100%",
  boxSizing: "border-box",
  minHeight: 36,
};

/** Parse this row's pay-level edit box. Blank genuinely means "clear the
 * level" (saved as 0, the DB's existing NOT NULL "unclassified" sentinel --
 * schema.ts's `level` column has no separate NULL state); anything else must
 * be a whole number 1-18, same rule as the create form and the backend
 * (GAP-HR-DESIGNATIONS-04 / GAP-HR-DESIGNATIONS-01). */
function parseEditLevel(raw: string): { ok: true; value: number } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: 0 };
  if (!/^\d+$/.test(trimmed)) return { ok: false };
  const n = Number(trimmed);
  return payLevelSchema.safeParse(n).success ? { ok: true, value: n } : { ok: false };
}

// ── Main component ─────────────────────────────────────────────────────────

export function DesignationsTable({ items, canEdit = false }: { items: Designation[]; canEdit?: boolean }) {
  const t = useTranslations("designationsTable");
  const router = useRouter();
  const [localItems, setLocalItems] = useState<Designation[]>(items);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Designation | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  // GAP-HR-DESIGNATIONS-04: string, not number -- "" is a real, distinct
  // state (the user cleared the field), never silently coerced to 0 by
  // `Number('')` the way the previous numeric state was.
  const [editLevel, setEditLevel] = useState("");
  const [editPayGrade, setEditPayGrade] = useState("");
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const formError = useFormError("designation");
  // GAP-HR-DESIGNATIONS-NEW-03: the edit row's "Blank clears the level"
  // hint is tied to its input via aria-describedby, so it is announced on
  // focus; "Clear level" is the explicit way to do what a blank box means.
  const levelEditHintId = useId();
  const levelEditInputRef = useRef<HTMLInputElement>(null);

  function startEdit(item: Designation) {
    setEditingId(item.id);
    setEditCode(item.code);
    setEditName(item.name);
    setEditLevel(item.level > 0 ? String(item.level) : "");
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
    const parsedLevel = parseEditLevel(editLevel);
    if (!parsedLevel.ok) {
      setRowError(t("rowErrorLevelInteger"));
      return;
    }
    setSaving(true);
    formError.clear();
    const trimmedPayGrade = editPayGrade.trim();
    // GAP-HR-DESIGNATIONS-04: always send a real value (string or explicit
    // null), never an empty string masquerading as "no pay grade" -- the
    // backend schema (masters-routes.ts's createDesignationBody, now
    // `.nullable()`) and consumer (f3-consumer.ts's `!== undefined` check)
    // both distinguish null (clear it) from omitted (leave as-is); sending ""
    // used to store a literal empty string, visibly different from a
    // never-set NULL everywhere else this reads the column back.
    const payGradeValue = trimmedPayGrade === "" ? null : trimmedPayGrade;
    try {
      const res = await fetch(`/api/proxy/v1/hrms/designations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: editCode, name: editName, level: parsedLevel.value, payGrade: payGradeValue }),
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
            ? { ...d, code: editCode, name: editName, level: parsedLevel.value, payGrade: payGradeValue }
            : d,
        ),
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
      const res = await fetch(`/api/proxy/v1/hrms/designations/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setDeleteError(resolved.message);
        return;
      }
      setDeleteTarget(null);
      setLocalItems((prev) => prev.filter((d) => d.id !== id));
    } catch (caught) {
      setDeleteError(formError.fromException("save", caught).message);
    } finally {
      setDeletingId(null);
      try { router.refresh(); } catch { /* ignore */ }
    }
  }

  // Live preview of the in-progress edit's level, shared by the Level and
  // Service Group columns below (computed once per render, not once per
  // column, to parse the same string only once).
  const editingParsedLevel = editingId !== null ? parseEditLevel(editLevel) : null;
  const editingLevelValue = editingParsedLevel?.ok ? editingParsedLevel.value : null;

  // GAP-HR-DESIGNATIONS-03: rebuilt on the shared ds DataTable (sortable,
  // filterable, paginated, consistent mobile-stack layout) instead of a
  // hand-built <table> with inline styles and none of those. Inline
  // row-edit stays (vs. moving it into a separate dialog/drawer) by keeping
  // each editable cell's `render` check `editingId === item.id` -- the
  // simpler of the two options the gap's own fix steps offered, and the one
  // that changes the existing edit UX the least.
  const columns = [
    {
      key: "code" as const,
      label: t("colCode"),
      render: (item: Designation) =>
        editingId === item.id ? (
          <input
            aria-label={t("designationCodeAriaLabel")}
            value={editCode}
            onChange={(e) => setEditCode(e.target.value)}
            style={{ ...inputStyle, maxWidth: 80 }}
          />
        ) : (
          <span style={{ color: "var(--mut)", fontSize: 12, fontWeight: 600, letterSpacing: "0.3px" }}>
            {item.code}
          </span>
        ),
    },
    {
      key: "name" as const,
      label: t("colDesignation"),
      render: (item: Designation) =>
        editingId === item.id ? (
          <>
            <input
              aria-label={t("designationNameAriaLabel")}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              style={inputStyle}
            />
            {rowError && (
              <p style={{ color: "var(--bad)", fontSize: 11, marginTop: 3, marginBottom: 0 }}>{rowError}</p>
            )}
          </>
        ) : (
          <span style={{ fontWeight: 500 }}>{item.name}</span>
        ),
    },
    {
      key: "level" as const,
      label: t("colPayLevel"),
      align: "right" as const,
      render: (item: Designation) =>
        editingId === item.id ? (
          <div style={{ display: "grid", gap: 4, justifyItems: "end" }}>
            <input
              ref={levelEditInputRef}
              aria-label={t("payLevelAriaLabel")}
              aria-describedby={levelEditHintId}
              type="text"
              inputMode="numeric"
              value={editLevel}
              onChange={(e) => setEditLevel(e.target.value)}
              style={{ ...inputStyle, textAlign: "end", maxWidth: 70 }}
            />
            {/* GAP-HR-DESIGNATIONS-04: blank used to silently become level 0
                ("unclassified" everywhere it's read back) with nothing in
                this row saying so -- same hint text/pattern as the create
                form's levelHint (GAP-HR-DESIGNATIONS-NEW-03). */}
            <p id={levelEditHintId} style={{ margin: 0, fontSize: 11, color: "var(--mut)", textAlign: "end" }}>
              {t("levelEditHint")}
            </p>
            <Button
              variant="ghost"
              size="sm"
              disabled={editLevel === ""}
              onClick={() => {
                setEditLevel("");
                levelEditInputRef.current?.focus();
              }}
            >
              {t("clearLevelBtn")}
            </Button>
          </div>
        ) : item.level > 0 ? (
          <span style={{ fontWeight: 700, color: "var(--fg)" }}>{t("levelPrefix", { level: item.level })}</span>
        ) : "—",
    },
    {
      key: "serviceGroup" as const,
      label: t("colServiceGroup"),
      sortable: false,
      render: (item: Designation) => {
        const grp = editingId === item.id ? serviceGroup(editingLevelValue) : serviceGroup(item.level);
        // GAP-HR-DESIGNATIONS-01 (fix step 4): the group is derived from the
        // pay level, not stored on the designation, so it is labelled
        // "Indicative" in the column header, in a footnote under the table
        // and in this badge's tooltip.
        return <span style={groupBadgeStyle(grp)} title={grp ? t("serviceGroupIndicativeTitle") : undefined}>{grp ?? "—"}</span>;
      },
    },
    {
      key: "payGrade" as const,
      label: t("colPayGrade"),
      render: (item: Designation) =>
        editingId === item.id ? (
          <input
            aria-label={t("payGradeAriaLabel")}
            value={editPayGrade}
            onChange={(e) => setEditPayGrade(e.target.value)}
            style={{ ...inputStyle, maxWidth: 100 }}
          />
        ) : (
          <span style={{ color: "var(--mut)" }}>{item.payGrade ?? "—"}</span>
        ),
    },
    ...(canEdit
      ? [
          {
            key: "id" as const,
            label: "",
            sortable: false,
            render: (item: Designation) =>
              editingId === item.id ? (
                <>
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
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    style={{ marginInlineEnd: 6 }}
                    onClick={() => startEdit(item)}
                    aria-label={t("editAria", { name: item.name })}
                  >
                    {t("editBtn")}
                  </Button>
                  {/* GAP-HR-DESIGNATIONS-02: a designation that still has
                      references can't be deleted (the API 409s), so say so up
                      front instead of offering a dialog that can only fail.
                      aria-disabled (not `disabled`) keeps the button
                      focusable, so a keyboard/screen-reader user reaches it
                      and hears the reason via aria-describedby. */}
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      if ((item.usageCount ?? 0) > 0) return;
                      setDeleteError(undefined);
                      setDeleteTarget(item);
                    }}
                    aria-label={t("deleteAria", { name: item.name })}
                    aria-disabled={(item.usageCount ?? 0) > 0 ? true : undefined}
                    aria-describedby={(item.usageCount ?? 0) > 0 ? `desig-inuse-${item.id}` : undefined}
                    style={(item.usageCount ?? 0) > 0 ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                  >
                    {t("deleteBtn")}
                  </Button>
                  {(item.usageCount ?? 0) > 0 && (
                    <span id={`desig-inuse-${item.id}`} style={{ display: "block", fontSize: 11, color: "var(--mut)", marginTop: 4 }}>
                      {t("deleteInUseHint", { count: item.usageCount ?? 0 })}
                    </span>
                  )}
                </>
              ),
          },
        ]
      : []),
  ];

  // "Group-C 1–5 · Group-B 6–9 · Group-A 10–18", straight from the shared bands.
  const serviceGroupBandsText = SERVICE_GROUP_BANDS
    .map((b) => `${b.group} ${b.minLevel}\u2013${b.maxLevel}`)
    .join(" \u00b7 ");

  return (
    <>
      <DataTable<Designation>
        columns={columns}
        rows={localItems}
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        filterKeys={["code", "name", "payGrade"]}
        pageSize={15}
        mobileStack
        caption={t("tableCaption")}
        // The parent page (designations/page.tsx) already renders its own
        // EmptyState and never mounts this component when `items` is empty,
        // so DataTable's own empty state here is reachable only one way: a
        // filter that matches nothing.
        emptyIcon="🏷️"
        emptyTitle={t("noMatchTitle")}
        emptyMessage={t("noMatchMessage")}
      />

      {/* GAP-HR-DESIGNATIONS-01: Service Group is not a stored field -- it is
          derived from the pay level (apps/web/src/lib/payLevels.ts) -- so say
          so, and print the bands it uses, instead of presenting it as
          recorded data. */}
      <p style={{ margin: "10px 2px 0", fontSize: 12, color: "var(--mut)" }}>
        {t("serviceGroupNote", { bands: serviceGroupBandsText })}
      </p>

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
