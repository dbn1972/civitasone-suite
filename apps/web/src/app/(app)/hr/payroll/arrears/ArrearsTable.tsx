"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, DataTable } from "../../../../_components/ds";
import { formatMoney } from "@/lib/formatters";
import { postWithErrorCode } from "../_lib/postWithErrorCode";
import { canDecideArrear } from "./arrearApproval";

export type ArrearTableRow = {
  id: string;
  status: string;
  difference_minor: number | string;
  created_by?: string | null;
  employee_label: string;
  component_label: string;
} & Record<string, unknown>;

export type ArrearTableColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
  cellType?: "status" | "amount";
  sortable?: boolean;
};

type Decision = "approve" | "reject";

/**
 * GAP-PAYROLL-ARREARS-03: the register could not move an arrear forward. A
 * pending MANUAL arrear is now approved or rejected here (POST
 * /v1/payroll/arrears/:id/approve|reject). Maker != checker is enforced by
 * the server (403 SELF_APPROVAL_FORBIDDEN, race-safe conditional update in
 * the consumer); the Approve button is also hidden for the arrear's own
 * creator so the common case never reaches a refusal. By default the payroll
 * run pays only APPROVED arrears, so approval is a real gate on payment.
 * A rejection requires a reason.
 */
export function ArrearsTable({
  columns, rows, canDecide, actorId, approvalRequired,
}: {
  columns: ArrearTableColumn[];
  rows: ArrearTableRow[];
  canDecide: boolean;
  actorId: string | null;
  approvalRequired: boolean;
}) {
  const t = useTranslations("arrears");
  const router = useRouter();
  const [target, setTarget] = useState<{ row: ArrearTableRow; decision: Decision } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function decide(note?: string) {
    if (!target) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await postWithErrorCode(
        `v1/payroll/arrears/${target.row.id}/${target.decision}`,
        note ? { note } : {},
        {
          SELF_APPROVAL_FORBIDDEN: t("selfDecisionError"),
          ARREAR_NOT_PENDING: t("alreadyDecidedError"),
        },
      );
      setMessage(t(target.decision === "approve" ? "approvedMessage" : "rejectedMessage", { employee: target.row.employee_label }));
      setTarget(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const cols = [...columns] as Array<ArrearTableColumn & { render?: (row: ArrearTableRow) => React.ReactNode }>;
  if (canDecide) {
    cols.push({
      key: "id",
      label: t("colActions"),
      sortable: false,
      render: (row) => {
        if (row.status !== "pending") return <>—</>;
        const mayApprove = canDecideArrear({ createdBy: row.created_by ?? null, actorId, approvalRequired });
        return (
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {mayApprove ? (
              <Button type="button" variant="primary" size="sm"
                aria-label={t("approveAria", { employee: row.employee_label })}
                onClick={() => { setDialogError(undefined); setTarget({ row, decision: "approve" }); }}>
                {t("approveBtn")}
              </Button>
            ) : (
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>{t("needsOtherApprover")}</span>
            )}
            <Button type="button" variant="ghost" size="sm"
              aria-label={t("rejectAria", { employee: row.employee_label })}
              onClick={() => { setDialogError(undefined); setTarget({ row, decision: "reject" }); }}>
              {t("rejectBtn")}
            </Button>
          </span>
        );
      },
    });
  }

  return (
    <>
      {message && (
        <p role="status" aria-live="polite" className="pill good" style={{ width: "fit-content", margin: "0 0 12px 16px" }}>{message}</p>
      )}
      <DataTable<ArrearTableRow>
        columns={cols as never}
        rows={rows}
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
        emptyIcon="📋"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
      />
      <ConfirmDialog
        open={target !== null}
        title={target?.decision === "reject" ? t("rejectTitle") : t("approveTitle")}
        confirmLabel={target?.decision === "reject" ? t("rejectBtn") : t("approveBtn")}
        danger={target?.decision === "reject"}
        requireReason={target?.decision === "reject"}
        optionalReason={target?.decision === "approve"}
        reasonLabel={t("reasonLabel")}
        maxReasonLength={512}
        busy={busy}
        errorMessage={dialogError}
        description={target ? t(target.decision === "reject" ? "rejectDescription" : "approveDescription", {
          employee: target.row.employee_label, amount: formatMoney(target.row.difference_minor),
        }) : null}
        onConfirm={(reason) => void decide(reason)}
        onCancel={() => !busy && setTarget(null)}
      />
    </>
  );
}
