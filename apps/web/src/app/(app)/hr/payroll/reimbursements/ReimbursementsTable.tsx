"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, DataTable, Modal } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

/** Pre-formatted, server-built row (plain data; crosses the RSC boundary). */
export type ClaimRow = {
  id: string;
  employee_label: string;
  category_label: string;
  amount_minor: string;
  period_display: string;
  bill_date_display: string;
  bill_ref: string;
  /** GAP-PAYROLL-REIMBURSEMENTS-03 */
  receipt_count: number;
  status: string;
} & Record<string, unknown>;

/** Minimum reject-reason length -- mirrors payroll-service reimbursementRejectBody. */
export const REJECT_REASON_MIN = 10;

type Decision = { row: ClaimRow; kind: "approve" | "reject" };

/**
 * GAP-PAYROLL-REIMBURSEMENTS-02: claims table with Approve / Reject on
 * submitted claims for payroll staff (PATCH /v1/payroll/reimbursements/:id/
 * approve|reject). The server enforces role, maker-checker (not the filer,
 * not the claimant) and status; a refusal is shown in the dialog. A client
 * component because DataTable's `render` cannot cross the server boundary.
 */
export function ReimbursementsTable({
  rows,
  canDecide,
  showEmployee,
}: {
  rows: ClaimRow[];
  canDecide: boolean;
  showEmployee: boolean;
}) {
  const t = useTranslations("payrollReimbursements");
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  // GAP-PAYROLL-REIMBURSEMENTS-03: receipts viewer (links are fetched on demand,
  // short-lived, and each view is audited server-side).
  const [viewing, setViewing] = useState<ClaimRow | null>(null);
  const [links, setLinks] = useState<Array<{ index: number; filename: string; url: string }> | null>(null);
  const [linksError, setLinksError] = useState<string | null>(null);

  async function viewReceipts(row: ClaimRow) {
    setViewing(row);
    setLinks(null);
    setLinksError(null);
    try {
      const res = await browserJson<{ data: Array<{ index: number; filename: string; url: string }> }>(`v1/payroll/reimbursements/${row.id}/attachments`);
      setLinks(res.data ?? []);
    } catch (err) {
      setLinksError(err instanceof Error ? err.message : t("networkError"));
    }
  }

  async function decide(reason?: string) {
    if (!decision) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson<{ id: string; status: string }>(`v1/payroll/reimbursements/${decision.row.id}/${decision.kind}`, {
        method: "PATCH",
        body: JSON.stringify(reason?.trim() ? { reason: reason.trim() } : {}),
      });
      setMessage(t(decision.kind === "approve" ? "approvedMessage" : "rejectedMessage", { amount: formatMoney(decision.row.amount_minor) }));
      setDecision(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    ...(showEmployee ? [{ key: "employee_label" as const, label: t("colEmployee") }] : []),
    { key: "category_label" as const, label: t("colCategory") },
    { key: "amount_minor" as const, label: t("colAmount"), align: "right" as const, cellType: "amount" as const },
    { key: "period_display" as const, label: t("colPeriod"), sortable: false },
    // GAP-PAYROLL-REIMBURSEMENTS-03: bill_date was captured but never shown.
    { key: "bill_date_display" as const, label: t("colBillDate"), sortable: false },
    { key: "bill_ref" as const, label: t("colBillRef") },
    {
      key: "receipt_count" as const,
      label: t("colReceipts"),
      sortable: false,
      render: (row: ClaimRow) =>
        row.receipt_count > 0 ? (
          <Button
            variant="ghost"
            style={{ minHeight: 32, fontSize: 12, padding: "0 12px" }}
            aria-label={t("viewReceiptsAria", { count: row.receipt_count, employee: row.employee_label })}
            onClick={() => void viewReceipts(row)}
          >
            {t("viewReceipts", { count: row.receipt_count })}
          </Button>
        ) : (
          <span style={{ color: "var(--mut)" }}>{t("noReceipts")}</span>
        ),
    },
    { key: "status" as const, label: t("colStatus"), cellType: "status" as const },
    ...(canDecide
      ? [{
          key: "id" as const,
          label: t("colActions"),
          sortable: false,
          render: (row: ClaimRow) =>
            row.status === "submitted" ? (
              <div style={{ display: "flex", gap: 6 }}>
                <Button
                  variant="primary"
                  style={{ minHeight: 32, fontSize: 12, padding: "0 12px" }}
                  aria-label={t("approveAriaLabel", { employee: row.employee_label, amount: formatMoney(row.amount_minor) })}
                  onClick={() => { setDialogError(undefined); setDecision({ row, kind: "approve" }); }}
                >
                  {t("approveBtn")}
                </Button>
                <Button
                  variant="ghost"
                  style={{ minHeight: 32, fontSize: 12, padding: "0 12px" }}
                  aria-label={t("rejectAriaLabel", { employee: row.employee_label, amount: formatMoney(row.amount_minor) })}
                  onClick={() => { setDialogError(undefined); setDecision({ row, kind: "reject" }); }}
                >
                  {t("rejectBtn")}
                </Button>
              </div>
            ) : null,
        }]
      : []),
  ];

  return (
    <>
      {message && (
        <p role="status" className="pill good" style={{ width: "fit-content", margin: "12px 16px" }}>
          {message}
        </p>
      )}
      <DataTable<ClaimRow>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
        emptyIcon="🧾"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
      />
      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={t("receiptsTitle")}>
        {linksError && <p role="alert" className="pill bad" style={{ width: "fit-content" }}>{linksError}</p>}
        {!linksError && links === null && <p role="status">{t("receiptsLoading")}</p>}
        {links && (
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {links.map((l) => (
              <li key={l.index}>
                <a href={l.url} target="_blank" rel="noopener noreferrer">{l.filename}</a>
              </li>
            ))}
          </ul>
        )}
        <p style={{ fontSize: 12, color: "var(--mut)" }}>{t("receiptsNote")}</p>
        <Button type="button" variant="ghost" onClick={() => setViewing(null)}>{t("receiptsClose")}</Button>
      </Modal>
      <ConfirmDialog
        open={decision !== null}
        title={decision?.kind === "reject" ? t("rejectConfirmTitle") : t("approveConfirmTitle")}
        confirmLabel={decision?.kind === "reject" ? t("rejectBtn") : t("approveBtn")}
        danger={decision?.kind === "reject"}
        requireReason={decision?.kind === "reject"}
        optionalReason={decision?.kind === "approve"}
        reasonLabel={decision?.kind === "reject" ? t("rejectReasonLabel") : t("approveNoteLabel")}
        minReasonLength={decision?.kind === "reject" ? REJECT_REASON_MIN : undefined}
        maxReasonLength={512}
        busy={busy}
        errorMessage={dialogError}
        description={
          decision
            ? t.rich("decisionDescription", {
                category: decision.row.category_label,
                amount: formatMoney(decision.row.amount_minor),
                employee: decision.row.employee_label,
                period: decision.row.period_display,
                strong: (chunks) => <strong>{chunks}</strong>,
              })
            : null
        }
        onConfirm={(reason) => void decide(reason)}
        onCancel={() => !busy && setDecision(null)}
      />
    </>
  );
}
