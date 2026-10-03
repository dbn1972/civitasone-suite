"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, DataTable } from "../../../../_components/ds";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { percentToBps } from "@/lib/money";
import { formatSplitPct, type CostingRule } from "./costingShared";

export type RuleRow = {
  id: string;
  employeeGroup: string;
  costCenterLabel: string;
  splitPct: number;
  splitPctLabel: string;
  groupTotalLabel: string;
  status: string;
} & Record<string, unknown>;

type Action = { kind: "edit" | "deactivate" | "reactivate"; rule: RuleRow };

/** 0 < split <= 100 with at most 2 decimals, as hundredths (matches the server's isValidSplitPct). */
export function parseSplit(raw: string): number | null {
  const bps = percentToBps(raw);
  if (bps === null || bps <= 0 || bps > 10000) return null;
  return bps / 100;
}

/**
 * GAP-PAYROLL-COSTING-02: the costing-rules list with edit / deactivate /
 * reactivate (payroll admin roles only). The server (PATCH
 * /v1/payroll/costing/rules/:id) is authoritative: it refuses any change that
 * would take an employee group above 100% -- the figure shown here is a
 * convenience so the clerk sees the effect before saving.
 */
export function CostingRulesTable({
  rows,
  rules,
  canAdminister,
}: {
  rows: RuleRow[];
  /** All rules, for the "group would total X%" preview. */
  rules: CostingRule[];
  canAdminister: boolean;
}) {
  const t = useTranslations("payrollCosting");
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [splitInput, setSplitInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const splitField = useId();

  const columns: {
    key: keyof RuleRow & string;
    label: string;
    align?: "left" | "right";
    cellType?: "status";
    render?: (row: RuleRow) => React.ReactNode;
  }[] = [
    { key: "employeeGroup", label: t("colEmployeeGroup") },
    { key: "costCenterLabel", label: t("colCostCenter") },
    { key: "splitPctLabel", label: t("colSplitPct"), align: "right" },
    { key: "groupTotalLabel", label: t("colGroupTotal"), align: "right" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];
  if (canAdminister) {
    columns.push({
      key: "id",
      label: t("colAction"),
      render: (row) => (
        <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          {row.status === "active" ? (
            <>
              <Button type="button" variant="secondary" size="sm" aria-label={t("editAria", { group: row.employeeGroup, center: row.costCenterLabel })} onClick={() => open("edit", row)}>
                {t("editBtn")}
              </Button>
              <Button type="button" variant="ghost" size="sm" aria-label={t("deactivateAria", { group: row.employeeGroup, center: row.costCenterLabel })} onClick={() => open("deactivate", row)}>
                {t("deactivateBtn")}
              </Button>
            </>
          ) : (
            <Button type="button" variant="secondary" size="sm" aria-label={t("reactivateAria", { group: row.employeeGroup, center: row.costCenterLabel })} onClick={() => open("reactivate", row)}>
              {t("reactivateBtn")}
            </Button>
          )}
        </span>
      ),
    });
  }

  function open(kind: Action["kind"], rule: RuleRow) {
    setError(undefined);
    setMessage(null);
    setSplitInput(String(rule.splitPct));
    setAction({ kind, rule });
  }

  const newSplit = action?.kind === "edit" ? parseSplit(splitInput) : action ? action.rule.splitPct : null;
  // Total the group would have after this change (server re-checks).
  let projected: number | null = null;
  if (action && newSplit !== null) {
    const others = rules
      .filter((r) => r.status === "active" && r.employeeGroup === action.rule.employeeGroup && r.id !== action.rule.id)
      .reduce((s, r) => s + r.splitPct, 0);
    projected = action.kind === "deactivate" ? Math.round(others * 100) / 100 : Math.round((others + newSplit) * 100) / 100;
  }

  async function submit() {
    if (!action) return;
    const body = action.kind === "edit"
      ? { splitPct: parseSplit(splitInput) }
      : { status: action.kind === "deactivate" ? "inactive" : "active" };
    if (action.kind === "edit" && body.splitPct === null) {
      setError(t("splitRangeError"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserFetch("v1/payroll/costing/rules/" + encodeURIComponent(action.rule.id), {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const code = await errorCodeFromResponse(res);
        if (code === "COSTING_SPLIT_EXCEEDS_100") throw new Error(t("serverOver100Error", { group: action.rule.employeeGroup }));
        throw new Error(await errorMessageFromResponse(res));
      }
      setMessage(t("updatedMessage", { group: action.rule.employeeGroup }));
      setAction(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const title = action?.kind === "edit" ? t("editTitle") : action?.kind === "deactivate" ? t("deactivateTitle") : t("reactivateTitle");
  const confirmLabel = action?.kind === "edit" ? t("editConfirm") : action?.kind === "deactivate" ? t("deactivateConfirm") : t("reactivateConfirm");

  return (
    <>
      {message && <p role="status" className="pill good" style={{ margin: "12px 16px 0", width: "fit-content" }}>{message}</p>}
      <DataTable<RuleRow>
        columns={columns}
        rows={rows}
        caption={t("rulesCaption")}
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
        emptyIcon="📋"
        emptyTitle={t("rulesEmptyTitle")}
        emptyMessage={t("rulesEmptyMessage")}
      />
      <ConfirmDialog
        open={action !== null}
        title={title}
        confirmLabel={confirmLabel}
        danger={action?.kind === "deactivate"}
        busy={busy}
        errorMessage={error}
        blockConfirm={action?.kind === "edit" && newSplit === null}
        description={action ? (
          <>
            <p style={{ margin: "0 0 10px" }}>
              {t(action.kind === "edit" ? "editDescription" : action.kind === "deactivate" ? "deactivateDescription" : "reactivateDescription", {
                group: action.rule.employeeGroup, center: action.rule.costCenterLabel,
              })}
            </p>
            {action.kind === "edit" && (
              <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                <label htmlFor={splitField} style={{ fontSize: 13, fontWeight: 600 }}>{t("splitInputLabel")}</label>
                <input
                  id={splitField}
                  inputMode="decimal"
                  value={splitInput}
                  onChange={(e) => setSplitInput(e.target.value)}
                  aria-invalid={newSplit === null || undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                />
                {newSplit === null && <span role="alert" className="pill bad" style={{ width: "fit-content" }}>{t("splitRangeError")}</span>}
              </div>
            )}
            {projected !== null && (
              <p role="status" className={projected > 100 ? "pill bad" : projected === 100 ? "pill good" : "pill warn"} style={{ width: "fit-content", margin: 0 }}>
                {projected > 100
                  ? t("projectedOver", { group: action.rule.employeeGroup, total: formatSplitPct(projected) })
                  : t("projectedTotal", { group: action.rule.employeeGroup, total: formatSplitPct(projected) })}
              </p>
            )}
          </>
        ) : null}
        onConfirm={() => void submit()}
        onCancel={() => !busy && setAction(null)}
      />
    </>
  );
}
