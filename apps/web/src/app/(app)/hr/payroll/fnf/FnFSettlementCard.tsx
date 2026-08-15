"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill, ConfirmDialog } from "../../../../_components/ds";
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

const NEXT_ACTION: Record<string, { label: string; endpoint: string; confirm: string } | undefined> = {
  draft: { label: "Submit for Approval", endpoint: "submit", confirm: "Submit this settlement for manager approval?" },
  manager_approved: { label: "Finance Approve", endpoint: "finance-approve", confirm: "Mark this settlement as finance-approved?" },
  finance_approved: { label: "Mark Disbursed", endpoint: "disburse", confirm: "Mark this settlement as disbursed?" },
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  manager_approved: "Manager Approved",
  finance_approved: "Finance Approved",
  disbursed: "Disbursed",
  computed: "Computed",
  settled: "Settled",
  paid: "Paid",
};

function FnFCard({ row, onAction }: { row: FnFCardRow; onAction: (row: FnFCardRow) => void }) {
  const [expanded, setExpanded] = useState(false);

  const components: { label: string; amountMinor: number }[] = [
    ...(row.lastSalaryMinor ? [{ label: "Last Salary", amountMinor: row.lastSalaryMinor }] : []),
    ...(row.gratuityMinor ? [{ label: "Gratuity", amountMinor: row.gratuityMinor }] : []),
    ...(row.leaveEncashmentMinor ? [{ label: "Leave Encashment", amountMinor: row.leaveEncashmentMinor }] : []),
    ...(row.bonusArrearsMinor ? [{ label: "Bonus / Arrears", amountMinor: row.bonusArrearsMinor }] : []),
    ...(row.deductionsMinor ? [{ label: "Deductions", amountMinor: -Math.abs(row.deductionsMinor) }] : []),
  ];

  const nextAction = NEXT_ACTION[row.status];
  const statusLabel = STATUS_LABELS[row.status] ?? row.status;

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
            <button
              type="button"
              className="btn"
              style={{ minHeight: 32, fontSize: 12, padding: "0 14px" }}
              onClick={() => onAction(row)}
            >
              {nextAction.label}
            </button>
          )}
        </div>
      </div>

      {/* Net payable + breakdown toggle */}
      <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>Net Payable</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{rupees(Number(row.netPayableMinor))}</div>
        </div>
        {components.length > 0 && (
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: 12, minHeight: 30 }}
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
          >
            {expanded ? "Hide breakdown ▲" : "Show breakdown ▼"}
          </button>
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
                  <td style={{ padding: "7px 0", textAlign: "right", fontWeight: 600, color: c.amountMinor < 0 ? "var(--bad, #c0392b)" : "inherit" }}>
                    {c.amountMinor < 0 ? "−" : ""}{rupees(Math.abs(c.amountMinor))}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid var(--line2)" }}>
                <td style={{ padding: "8px 0", fontWeight: 700 }}>Net Payable</td>
                <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 700 }}>{rupees(Number(row.netPayableMinor))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function FnFSettlementCards({ rows }: { rows: FnFCardRow[] }) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<{ row: FnFCardRow; action: NonNullable<typeof NEXT_ACTION[string]> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function executeAction() {
    if (!pendingAction) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson(`v1/payroll/fnf/settlements/${pendingAction.row.id}/${pendingAction.action.endpoint}`, { method: "POST" });
      setMessage(`${pendingAction.action.label} completed for ${pendingAction.row.employeeName ?? pendingAction.row.employeeId}.`);
      setPendingAction(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--ink2)" }}>
        <p style={{ fontSize: 32, margin: "0 0 8px" }}>🧮</p>
        <p style={{ fontWeight: 600 }}>No F&amp;F settlements yet</p>
        <p style={{ fontSize: 13 }}>Compute a settlement using the form above; it is processed asynchronously.</p>
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
              const action = NEXT_ACTION[r.status];
              if (action) { setDialogError(undefined); setPendingAction({ row: r, action }); }
            }}
          />
        ))}
      </div>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.action.confirm ?? "Confirm action"}
        confirmLabel={pendingAction?.action.label ?? "Confirm"}
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
