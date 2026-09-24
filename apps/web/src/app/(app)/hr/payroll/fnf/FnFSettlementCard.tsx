"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { StatusPill, ConfirmDialog, Button } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

export type FnFCardRow = {
  id: string;
  employeeId: string;
  employeeName?: string;
  separationType: string;
  separationDate: string;
  status: string;
  netPayableMinor: number | string;
  lastSalaryMinor?: number;
  gratuityMinor?: number;
  leaveEncashmentMinor?: number;
  bonusArrearsMinor?: number;
  deductionsMinor?: number;
};

const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

function rupees(minor: number) { return inrFmt.format(minor / 100); }

// UX-017: keys are the stable backend status codes, never translated -- only
// used to look up which message keys hold the next-action button/dialog text
// and the display label. Same safe pattern as salary-revisions/page.tsx's
// REVISION_TYPE_KEYS.
const NEXT_ACTION_KEYS: Record<string, { labelKey: string; endpoint: string; confirmKey: string } | undefined> = {
  draft: { labelKey: "actionSubmitForApproval", endpoint: "submit", confirmKey: "confirmSubmitForApproval" },
  manager_approved: { labelKey: "actionFinanceApprove", endpoint: "finance-approve", confirmKey: "confirmFinanceApprove" },
  finance_approved: { labelKey: "actionMarkDisbursed", endpoint: "disburse", confirmKey: "confirmMarkDisbursed" },
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  draft: "statusDraft",
  manager_approved: "statusManagerApproved",
  finance_approved: "statusFinanceApproved",
  disbursed: "statusDisbursed",
  computed: "statusComputed",
  settled: "statusSettled",
  paid: "statusPaid",
};

function FnFCard({ row, onAction }: { row: FnFCardRow; onAction: (row: FnFCardRow) => void }) {
  const t = useTranslations("fnFSettlementCard");
  const [expanded, setExpanded] = useState(false);

  const components: { label: string; amountMinor: number }[] = [
    ...(row.lastSalaryMinor ? [{ label: t("lastSalaryLabel"), amountMinor: row.lastSalaryMinor }] : []),
    ...(row.gratuityMinor ? [{ label: t("gratuityLabel"), amountMinor: row.gratuityMinor }] : []),
    ...(row.leaveEncashmentMinor ? [{ label: t("leaveEncashmentLabel"), amountMinor: row.leaveEncashmentMinor }] : []),
    ...(row.bonusArrearsMinor ? [{ label: t("bonusArrearsLabel"), amountMinor: row.bonusArrearsMinor }] : []),
    ...(row.deductionsMinor ? [{ label: t("deductionsLabel"), amountMinor: -Math.abs(row.deductionsMinor) }] : []),
  ];

  const nextActionKeys = NEXT_ACTION_KEYS[row.status];
  const nextAction = nextActionKeys ? { ...nextActionKeys, label: t(nextActionKeys.labelKey), confirm: t(nextActionKeys.confirmKey) } : undefined;
  const statusKey = STATUS_LABEL_KEYS[row.status];
  const statusLabel = statusKey ? t(statusKey) : row.status;

  return (
    <div style={{ border: "1px solid var(--line2)", borderRadius: 12, overflow: "hidden" }}>
      {/* Header row */}
      <div style={{ background: "var(--panel)", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{row.employeeName ?? row.employeeId}</div>
          <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>
            {row.employeeId} · {row.separationType.replace(/_/g, " ")} · {row.separationDate}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <StatusPill status={row.status} />
          {nextAction && (
            <Button
              variant="primary"
              style={{ minHeight: 32, fontSize: 12, padding: "0 14px" }}
              onClick={() => onAction(row)}
            >
              {nextAction.label}
            </Button>
          )}
        </div>
      </div>

      {/* Net payable + breakdown toggle */}
      <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{t("netPayableLabel")}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{rupees(Number(row.netPayableMinor))}</div>
        </div>
        {components.length > 0 && (
          <Button
            variant="ghost"
            style={{ fontSize: 12, minHeight: 30 }}
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
          >
            {expanded ? t("hideBreakdownBtn") : t("showBreakdownBtn")}
          </Button>
        )}
      </div>

      {/* Component breakdown */}
      {expanded && (
        <div style={{ padding: "0 18px 16px", borderTop: "1px solid var(--line2)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 10 }}>
            <tbody>
              {components.map((c) => (
                <tr key={c.label} style={{ borderBottom: "1px solid var(--line2)" }}>
                  <td style={{ padding: "7px 0", color: c.amountMinor < 0 ? "var(--bad, #c0392b)" : "var(--ink2)" }}>{c.label}</td>
                  <td style={{ padding: "7px 0", textAlign: "end", fontWeight: 600, color: c.amountMinor < 0 ? "var(--bad, #c0392b)" : "inherit" }}>
                    {c.amountMinor < 0 ? "−" : ""}{rupees(Math.abs(c.amountMinor))}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid var(--line2)" }}>
                <td style={{ padding: "8px 0", fontWeight: 700 }}>{t("netPayableLabel")}</td>
                <td style={{ padding: "8px 0", textAlign: "end", fontWeight: 700 }}>{rupees(Number(row.netPayableMinor))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function FnFSettlementCards({ rows }: { rows: FnFCardRow[] }) {
  const t = useTranslations("fnFSettlementCard");
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<{ row: FnFCardRow; action: { label: string; endpoint: string; confirm: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function executeAction() {
    if (!pendingAction) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson(`v1/payroll/fnf/settlements/${pendingAction.row.id}/${pendingAction.action.endpoint}`, { method: "POST" });
      setMessage(t("actionCompletedMessage", { action: pendingAction.action.label, name: pendingAction.row.employeeName ?? pendingAction.row.employeeId }));
      setPendingAction(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--ink2)" }}>
        <p style={{ fontSize: 32, margin: "0 0 8px" }}>🧮</p>
        <p style={{ fontWeight: 600 }}>{t("emptyTitle")}</p>
        <p style={{ fontSize: 13 }}>{t("emptyMessage")}</p>
      </div>
    );
  }

  return (
    <>
      {message && (
        <p role="status" className="pill good" style={{ width: "fit-content", marginBottom: 12 }}>
          {message}
        </p>
      )}
      <div style={{ display: "grid", gap: 14 }}>
        {rows.map((row) => (
          <FnFCard
            key={row.id}
            row={row}
            onAction={(r) => {
              const actionKeys = NEXT_ACTION_KEYS[r.status];
              if (actionKeys) {
                setDialogError(undefined);
                setPendingAction({ row: r, action: { ...actionKeys, label: t(actionKeys.labelKey), confirm: t(actionKeys.confirmKey) } });
              }
            }}
          />
        ))}
      </div>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.action.confirm ?? t("confirmActionFallbackTitle")}
        confirmLabel={pendingAction?.action.label ?? t("confirmFallbackLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={
          pendingAction ? (
            <>
              <strong>{pendingAction.row.employeeName ?? pendingAction.row.employeeId}</strong>
              {" ("}
              {pendingAction.row.separationType.replace(/_/g, " ")},{" "}
              {pendingAction.row.separationDate}
              {")"}
            </>
          ) : null
        }
        onConfirm={() => void executeAction()}
        onCancel={() => !busy && setPendingAction(null)}
      />
    </>
  );
}
