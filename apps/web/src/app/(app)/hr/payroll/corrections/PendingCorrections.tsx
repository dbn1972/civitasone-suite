"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "../../../../_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { postWithErrorCode } from "../_lib/postWithErrorCode";

export type PendingCorrection = {
  id: string;
  employee_id: string;
  component: string;
  effective_from: string;
  old_value_minor: number | string;
  new_value_minor: number | string;
  arrears_minor: number | string;
  reason: string | null;
};

type Decision = "approve" | "reject";

/**
 * GAP-PAYROLL-CORRECTIONS-01: maker-checker decision on pending salary
 * corrections. POST /v1/payroll/corrections/:id/approve|reject — the server
 * refuses (403 SELF_APPROVAL_FORBIDDEN) when the decider created the
 * correction, and (409 CORRECTION_NOT_PENDING) once it has been decided;
 * both are shown as plain sentences. A rejection requires a reason.
 */
export function PendingCorrections({ rows }: { rows: PendingCorrection[] }) {
  const t = useTranslations("pendingCorrections");
  const router = useRouter();
  const [target, setTarget] = useState<{ row: PendingCorrection; decision: Decision } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function decide(note?: string) {
    if (!target) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await postWithErrorCode(
        `v1/payroll/corrections/${target.row.id}/${target.decision}`,
        note ? { note } : {},
        {
          SELF_APPROVAL_FORBIDDEN: t("selfDecisionError"),
          CORRECTION_NOT_PENDING: t("alreadyDecidedError"),
        },
      );
      setMessage(t(target.decision === "approve" ? "approvedMessage" : "rejectedMessage", { component: target.row.component }));
      setTarget(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>{t("noneMessage")}</p>;
  }

  return (
    <>
      {message && (
        <p role="status" aria-live="polite" className="pill good" style={{ width: "fit-content", marginBottom: 12 }}>
          {message}
        </p>
      )}
      <p style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 10px" }}>{t("checkerNote")}</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
        {rows.map((row) => (
          <li key={row.id} style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13 }}>
              <strong>{row.component}</strong>{" "}
              {t("summary", {
                from: formatIndianDate(row.effective_from),
                oldValue: formatMoney(row.old_value_minor),
                newValue: formatMoney(row.new_value_minor),
                arrears: formatMoney(row.arrears_minor),
              })}
              <div style={{ fontSize: 12, color: "var(--ink2)" }}>{t("employeeLabel", { id: row.employee_id })}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                type="button"
                variant="primary"
                style={{ minHeight: 36 }}
                aria-label={t("approveAriaLabel", { component: row.component })}
                onClick={() => { setDialogError(undefined); setTarget({ row, decision: "approve" }); }}
              >
                {t("approveBtn")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                style={{ minHeight: 36 }}
                aria-label={t("rejectAriaLabel", { component: row.component })}
                onClick={() => { setDialogError(undefined); setTarget({ row, decision: "reject" }); }}
              >
                {t("rejectBtn")}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={target !== null}
        title={target?.decision === "reject" ? t("rejectTitle") : t("approveTitle")}
        confirmLabel={target?.decision === "reject" ? t("rejectBtn") : t("approveBtn")}
        danger={target?.decision === "reject"}
        requireReason={target?.decision === "reject"}
        reasonLabel={t("reasonLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={
          target
            ? t(target.decision === "reject" ? "rejectDescription" : "approveDescription", {
                component: target.row.component,
                arrears: formatMoney(target.row.arrears_minor),
              })
            : null
        }
        onConfirm={(reason) => void decide(reason)}
        onCancel={() => !busy && setTarget(null)}
      />
    </>
  );
}
