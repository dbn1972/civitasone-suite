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
  /** GAP-HR-WFH-04: present on a rejected row once the backend returns it. */
  rejectionReason?: string | null;
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
        // GAP-HR-WFH-04: the backend has no column to persist an approval
        // remark (only rejectionReason exists on hrms_wfh_requests) and
        // silently discarded it; only send `reason` on reject, where it is
        // actually stored and shown back to the requester below.
        body: JSON.stringify(decision === "reject" ? { reason } : {}),
      });
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setDialogError(resolved.message);
        return;
      }
      setPending(null);
      setToast({ tone: "good", text: decision === "approve" ? t("toastApproved") : t("toastRejected") });
      router.refresh();
    } catch (caught) {
      setDialogError(formError.fromException("save", caught).message);
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
    {
      key: "reason",
      label: t("colReason"),
      // GAP-HR-WFH-04: surface the rejection note (now returned by the API)
      // under the original reason for rejected rows, so a requester can see
      // why — it was previously captured on reject but never shown anywhere.
      render: (r) => (
        <>
          {r.reason ?? "—"}
          {r.status === "rejected" && r.rejectionReason && (
            <div style={{ marginTop: 4, fontSize: 12, color: "var(--mut)" }}>
              {t("rejectionNoteLine", { reason: r.rejectionReason })}
            </div>
          )}
        </>
      ),
    },
    { key: "status", label: t("colStatus"), cellType: "status" },
    // GAP-HR-WFH-05: only approvers ever act on a row, so non-approvers
    // previously saw a Decision column that was always a column of "—".
    ...(canApprove ? [{
      key: "id" as const,
      label: t("colDecision"),
      render: (row: WfhRow) =>
        row.status === "pending" ? (
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
    }] : []),
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
        // GAP-HR-WFH-04: a reason was mandatory for BOTH decisions, but the
        // backend has nowhere to store an approval remark (only
        // rejectionReason exists) and silently dropped it — only reject
        // actually persists and shows it, so only reject asks for one.
        requireReason={pending?.decision === "reject"}
        reasonLabel={t("rejectionReasonLabel")}
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
