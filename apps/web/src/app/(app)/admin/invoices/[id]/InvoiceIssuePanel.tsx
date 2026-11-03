"use client";

/**
 * UAT P2 (J8, D5): issue a draft invoice on screen, and decide a pending issue approval, through the existing
 * billing-service routes PATCH /v1/billing/invoices/:id/issue and PATCH /v1/billing/invoices/:id/approvals/:approvalId.
 * A value-significant bill is routed to approval by the service (requiresApproval); the requester is not offered
 * Approve on their own request (the service enforces separation of duties in its consumer either way).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, Button, Card, ConfirmDialog } from "@/app/_components/ds";
import type { AdminInvoiceDetail } from "@/app/_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";

type Decision = { approvalId: string; approve: boolean };

export function InvoiceIssuePanel({ invoice, currentUserId }: { invoice: AdminInvoiceDetail; currentUserId: string | null }) {
  const t = useTranslations("adminInvoiceIssue");
  const router = useRouter();
  const formError = useFormError("invoice");
  const [issueOpen, setIssueOpen] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  const pendingIssue = invoice.approvals.find((a) => a.action === "issue" && a.status === "pending") ?? null;
  const mine = pendingIssue !== null && currentUserId !== null && pendingIssue.requestedBy === currentUserId;
  const canIssue = invoice.status === "draft" && pendingIssue === null;
  if (invoice.status !== "draft" && pendingIssue === null) return null;

  async function call(path: string, body: unknown): Promise<Response | null> {
    try {
      return await fetch(`/api/proxy/v1/billing/invoices/${encodeURIComponent(invoice.id)}${path}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
      });
    } catch (err) {
      setDialogError(formError.fromException("save", err).message);
      return null;
    }
  }

  async function issue() {
    if (busy) return;
    setBusy(true);
    setDialogError(undefined);
    const res = await call("/issue", {});
    setBusy(false);
    if (!res) return;
    if (!res.ok) { setDialogError((await formError.fromResponse(res, "save")).message); return; }
    const json = (await res.json().catch(() => ({}))) as { requiresApproval?: unknown };
    setIssueOpen(false);
    setNotice(json.requiresApproval === true ? t("sentForApproval") : t("issuedNotice"));
    router.refresh();
  }

  async function decide(reason: string | undefined) {
    if (!decision || busy) return;
    setBusy(true);
    setDialogError(undefined);
    const res = await call(`/approvals/${encodeURIComponent(decision.approvalId)}`, { approve: decision.approve, ...(reason ? { reason } : {}) });
    setBusy(false);
    if (!res) return;
    if (!res.ok) { setDialogError((await formError.fromResponse(res, "save")).message); return; }
    const approved = decision.approve;
    setDecision(null);
    setNotice(approved ? t("approvedNotice") : t("rejectedNotice"));
    router.refresh();
  }

  return (
    <Card title={t("title")}>
      <div className="pad" style={{ display: "grid", gap: 10 }} data-testid="invoice-issue-panel">
        {notice ? <Alert variant="success" role="status">{notice}</Alert> : null}
        {canIssue ? (
          <>
            <p style={{ margin: 0, fontSize: 13.5 }}>{t("draftHelp")}</p>
            <div>
              <Button variant="primary" style={{ minHeight: 44 }} onClick={() => { setDialogError(undefined); setIssueOpen(true); }}>{t("issue")}</Button>
            </div>
          </>
        ) : null}
        {pendingIssue ? (
          mine ? (
            <p role="note" style={{ margin: 0, fontSize: 13.5 }}>{t("pendingMine")}</p>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 13.5 }}>{t("pendingOther", { amount: formatMoney(pendingIssue.amountMinor) })}</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button variant="primary" style={{ minHeight: 44 }} onClick={() => { setDialogError(undefined); setDecision({ approvalId: pendingIssue.id, approve: true }); }}>{t("approve")}</Button>
                <Button variant="danger" style={{ minHeight: 44 }} onClick={() => { setDialogError(undefined); setDecision({ approvalId: pendingIssue.id, approve: false }); }}>{t("reject")}</Button>
              </div>
            </>
          )
        ) : null}
      </div>
      <ConfirmDialog
        open={issueOpen}
        title={t("issueConfirmTitle")}
        description={t("issueConfirmBody", { amount: formatMoney(invoice.totalMinor), period: invoice.periodMonth })}
        confirmLabel={t("issueConfirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        onConfirm={() => { void issue(); }}
        onCancel={() => { if (!busy) setIssueOpen(false); }}
      />
      <ConfirmDialog
        open={decision !== null}
        title={decision?.approve ? t("approveTitle") : t("rejectTitle")}
        description={decision?.approve ? t("approveBody") : t("rejectBody")}
        confirmLabel={decision?.approve ? t("approve") : t("reject")}
        danger={decision !== null && !decision.approve}
        requireReason={decision !== null && !decision.approve}
        reasonLabel={t("reasonLabel")}
        busy={busy}
        errorMessage={dialogError}
        onConfirm={(reason) => { void decide(reason); }}
        onCancel={() => { if (!busy) setDecision(null); }}
      />
    </Card>
  );
}
