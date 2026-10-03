"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "../../../../_components/ds";
import { patchWithErrorCode } from "../_lib/postWithErrorCode";

/** Server-built, pre-formatted row (plain data; crosses the RSC boundary). */
export type PendingRevision = {
  id: string;
  employeeLabel: string;
  effectiveDate: string;
  typeLabel: string;
  oldBasic: string;
  newBasic: string;
  orderNo: string;
};

type Decision = "approve" | "reject";

/**
 * GAP-PAYROLL-SALARY-REVISIONS-04: maker != checker for salary revisions. A
 * revision starts 'pending' and changes neither payroll nor the HRMS basic pay
 * until a DIFFERENT payroll user approves it here. PATCH
 * /v1/payroll/salary-revisions/:id/approve|reject -- the server refuses (403
 * SELF_APPROVAL_FORBIDDEN) when the decider created the revision, and (409
 * INVALID_STATE) once it has been decided; both read as plain sentences. A
 * rejection requires a reason.
 */
export function PendingRevisions({ rows }: { rows: PendingRevision[] }) {
  const t = useTranslations("pendingRevisions");
  const router = useRouter();
  const [target, setTarget] = useState<{ row: PendingRevision; decision: Decision } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function decide(note?: string) {
    if (!target) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await patchWithErrorCode(
        `v1/payroll/salary-revisions/${target.row.id}/${target.decision}`,
        note ? { note } : {},
        { SELF_APPROVAL_FORBIDDEN: t("selfDecisionError"), INVALID_STATE: t("alreadyDecidedError") },
        { area: t("saveArea"), statusAware: true },
      );
      setMessage(t(target.decision === "approve" ? "approvedMessage" : "rejectedMessage", { employee: target.row.employeeLabel }));
      setTarget(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0 && !message) return null;

  return (
    <section aria-label={t("title")} style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>{t("title")}</h2>
      <p style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 10px" }}>{t("checkerNote")}</p>
      {message && <p role="status" aria-live="polite" className="pill good" style={{ width: "fit-content", marginBottom: 12 }}>{message}</p>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
        {rows.map((row) => (
          <li key={row.id} style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13 }}>
              <strong>{row.employeeLabel}</strong>{" "}
              {t("summary", { type: row.typeLabel, from: row.effectiveDate, oldBasic: row.oldBasic, newBasic: row.newBasic, orderNo: row.orderNo })}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                type="button"
                variant="primary"
                style={{ minHeight: 36 }}
                aria-label={t("approveAria", { employee: row.employeeLabel })}
                onClick={() => { setDialogError(undefined); setTarget({ row, decision: "approve" }); }}
              >
                {t("approveBtn")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                style={{ minHeight: 36 }}
                aria-label={t("rejectAria", { employee: row.employeeLabel })}
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
        optionalReason={target?.decision === "approve"}
        minReasonLength={target?.decision === "reject" ? 10 : undefined}
        maxReasonLength={500}
        reasonLabel={target?.decision === "reject" ? t("rejectReasonLabel") : t("approveNoteLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={target ? t(target.decision === "reject" ? "rejectDescription" : "approveDescription", { employee: target.row.employeeLabel, newBasic: target.row.newBasic }) : null}
        onConfirm={(reason) => void decide(reason)}
        onCancel={() => !busy && setTarget(null)}
      />
    </section>
  );
}
