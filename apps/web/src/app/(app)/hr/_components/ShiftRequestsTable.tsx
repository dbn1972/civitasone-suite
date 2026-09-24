"use client";

/**
 * ShiftRequestsTable — list + approve/reject action column for shift-change
 * requests.
 *
 * CRITICAL fix: the shift-change feature was entirely view-only -- a real
 * list + stat cards backed by a real working GET /v1/hrms/shift-requests,
 * but no create route, no button linking to one, and no action column
 * anywhere, despite PATCH /v1/hrms/shift-requests/:id/approve|reject
 * already working (WAVE-4). Mirrors WfhRequestsTable (itself mirroring
 * RegularisationTable's established "manager decides pending X" pattern),
 * adapted to the shift-change row shape returned by GET
 * /v1/hrms/shift-requests (id, employeeId, employeeName, currentShift,
 * requestedShift, effectiveDate, reason, status, createdAt).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DataTable, ConfirmDialog, Button } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";

export type ShiftRequestRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  currentShift: string;
  requestedShift: string;
  effectiveDate: string;
  reason?: string | null;
  status: string;
} & Record<string, unknown>;

type Decision = "approve" | "reject";

export function ShiftRequestsTable({
  rows,
  canApprove = false,
  filterPlaceholder,
  emptyIcon = "🔄",
  emptyTitle,
  emptyMessage,
  pageSize = 20,
}: {
  rows: ShiftRequestRow[];
  canApprove?: boolean;
  filterPlaceholder?: string;
  emptyIcon?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  pageSize?: number;
}) {
  const t = useTranslations("shiftActions");
  const router = useRouter();
  const formError = useFormError("shift-change request");

  const [pending, setPending] = useState<{ row: ShiftRequestRow; decision: Decision } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [toast, setToast] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  async function act(id: string, decision: Decision, reason?: string) {
    setBusy(true);
    setDialogError(undefined);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/hrms/shift-requests/${id}/${decision}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setDialogError(resolved.message);
        return;
      }
      setPending(null);
      setToast({ tone: "good", text: decision === "approve" ? t("toastApproved") : t("toastRejected") });
      router.refresh();
    } catch {
      setDialogError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  const columns: {
    key: keyof ShiftRequestRow & string;
    label: string;
    cellType?: "status";
    render?: (row: ShiftRequestRow) => React.ReactNode;
  }[] = [
    { key: "employeeName", label: t("colEmployee") },
    { key: "currentShift", label: t("colCurrentShift") },
    { key: "requestedShift", label: t("colRequestedShift") },
    { key: "effectiveDate", label: t("colEffectiveDate"), render: (r) => formatIndianDate(r.effectiveDate) },
    { key: "reason", label: t("colReason"), render: (r) => r.reason ?? "—" },
    { key: "status", label: t("colStatus"), cellType: "status" },
    {
      key: "id",
      label: t("colDecision"),
      render: (row) =>
        !canApprove ? (
          <span style={{ color: "var(--mut)", fontSize: 12 }}>—</span>
        ) : row.status === "pending" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              variant="primary"
              size="sm"
              style={{ minHeight: 44 }}
              onClick={() => { setDialogError(undefined); setPending({ row, decision: "approve" }); }}
            >
              {t("approveBtn")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              style={{ minHeight: 44 }}
              onClick={() => { setDialogError(undefined); setPending({ row, decision: "reject" }); }}
            >
              {t("rejectBtn")}
            </Button>
          </div>
        ) : (
          <span style={{ color: "var(--mut)", fontSize: 12 }}>—</span>
        ),
    },
  ];

  return (
    <>
      {toast && (
        <p role="status" aria-live="polite" className={`pill ${toast.tone}`} style={{ margin: "0 0 12px" }}>
          {toast.text}
        </p>
      )}
      <DataTable<ShiftRequestRow>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder={filterPlaceholder}
        pageSize={pageSize}
        emptyIcon={emptyIcon}
        emptyTitle={emptyTitle}
        emptyMessage={emptyMessage}
      />

      <ConfirmDialog
        open={pending !== null}
        title={pending?.decision === "approve" ? t("confirmApproveTitle") : t("confirmRejectTitle")}
        danger={pending?.decision === "reject"}
        requireReason
        reasonLabel={pending?.decision === "approve" ? t("approvalRemarksLabel") : t("rejectionReasonLabel")}
        confirmLabel={pending?.decision === "approve" ? t("approveBtn") : t("rejectBtn")}
        busy={busy}
        errorMessage={dialogError}
        description={
          pending ? (
            <>
              {t.rich("confirmDescRich", {
                verb: pending.decision === "approve" ? t("approveBtn") : t("rejectBtn"),
                employeeName: pending.row.employeeName,
                currentShift: pending.row.currentShift,
                requestedShift: pending.row.requestedShift,
                date: formatIndianDate(pending.row.effectiveDate),
                strongName: (chunks) => <strong>{chunks}</strong>,
              })}
              {pending.row.reason && (
                <>
                  <br />
                  <span style={{ color: "var(--ink2)" }}>{t("reasonLine", { reason: pending.row.reason })}</span>
                </>
              )}
            </>
          ) : null
        }
        onConfirm={(reason) => pending && void act(pending.row.id, pending.decision, reason)}
        onCancel={() => !busy && setPending(null)}
      />
    </>
  );
}
