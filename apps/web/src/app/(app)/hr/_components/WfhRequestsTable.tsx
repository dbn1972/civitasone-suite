"use client";

/**
 * WfhRequestsTable — shared list + approve/reject action column for WFH
 * requests, used by both /hr/wfh (all roles) and /hr/workforce/wfh
 * (hr_admin/hr_officer/manager/super_admin).
 *
 * CRITICAL fix: neither host page previously had ANY approve/reject control,
 * even though PATCH /v1/hrms/wfh-requests/:id/approve and .../reject already
 * work (WAVE-4). Mirrors attendance/regularisation's RegularisationTable —
 * same inline action-column + ConfirmDialog pattern, adapted to the WFH row
 * shape returned by GET /v1/hrms/wfh-requests (id, employeeId, employeeName,
 * fromDate, toDate, reason, status, createdAt -- no `department` or `days`
 * field exists on the real response, unlike the two host pages' previous
 * column definitions which rendered blank for both).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DataTable, ConfirmDialog, Button } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";

export type WfhRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  fromDate: string;
  toDate: string;
  reason?: string | null;
  status: string;
} & Record<string, unknown>;

type Decision = "approve" | "reject";

function calcDays(fromDate: string, toDate: string): number | "—" {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return "—";
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

export function WfhRequestsTable({
  rows,
  canApprove = false,
  filterPlaceholder,
  emptyIcon = "🏠",
  emptyTitle,
  emptyMessage,
  pageSize = 15,
}: {
  rows: WfhRow[];
  canApprove?: boolean;
  filterPlaceholder?: string;
  emptyIcon?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  pageSize?: number;
}) {
  const t = useTranslations("wfhActions");
  const router = useRouter();
  const formError = useFormError("WFH request");

  const [pending, setPending] = useState<{ row: WfhRow; decision: Decision } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [toast, setToast] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  async function act(id: string, decision: Decision, reason?: string) {
    setBusy(true);
    setDialogError(undefined);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/hrms/wfh-requests/${id}/${decision}`, {
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
    key: keyof WfhRow & string;
    label: string;
    cellType?: "status";
    render?: (row: WfhRow) => React.ReactNode;
  }[] = [
    { key: "employeeName", label: t("colEmployee") },
    { key: "fromDate", label: t("colFrom"), render: (r) => formatIndianDate(r.fromDate) },
    { key: "toDate", label: t("colTo"), render: (r) => formatIndianDate(r.toDate) },
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

  const days = pending ? calcDays(pending.row.fromDate, pending.row.toDate) : "—";

  return (
    <>
      {toast && (
        <p role="status" aria-live="polite" className={`pill ${toast.tone}`} style={{ margin: "0 0 12px" }}>
          {toast.text}
        </p>
      )}
      <DataTable<WfhRow>
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
                fromDate: formatIndianDate(pending.row.fromDate),
                toDate: formatIndianDate(pending.row.toDate),
                dayCount: typeof days === "number" ? t("dayCountSuffix", { count: days }) : "",
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
