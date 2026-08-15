"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import type { OffCycleRow } from "./OffCycleList";

const REASON_LABELS: Record<string, string> = {
  bonus: "Bonus Disbursement",
  incentive: "Incentive",
  arrear: "Arrear Payment",
  adhoc: "Ad-hoc Payment",
  correction: "Salary Correction",
};

function RunCard({ row, onProcess }: { row: OffCycleRow; onProcess: (row: OffCycleRow) => void }) {
  const reasonLabel = REASON_LABELS[row.run_type] ?? row.run_type.replace(/_/g, " ");
  const totalAmount = Number(row.total_amount_minor ?? 0);
  const netAmount = Number(row.total_net_minor ?? 0);
  const empCount = (row.employee_count as number | undefined) ?? null;
  const approvalStatus = (row.approval_status as string | undefined) ?? row.status;

  return (
    <div style={{ border: "1px solid var(--line2)", borderRadius: 12, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: "var(--panel)", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{reasonLabel}</div>
          <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>
            {"Period: "}
            <strong>{row.period}</strong>
            {row.description ? " · " + row.description : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <StatusPill status={row.status} />
          {row.status === "draft" && (
            <button
              type="button"
              className="btn"
              style={{ minHeight: 32, fontSize: 12, padding: "0 14px" }}
              onClick={() => onProcess(row)}
              aria-label={"Process " + reasonLabel + " run for " + row.period}
            >
              Process Run
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{ padding: "12px 18px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>Total Amount</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3 }}>{formatMoney(totalAmount)}</div>
        </div>
        {netAmount > 0 && (
          <div>
            <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>Net Payable</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3 }}>{formatMoney(netAmount)}</div>
          </div>
        )}
        {empCount !== null && (
          <div>
            <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>Employees in Scope</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3 }}>{empCount}</div>
          </div>
        )}
        <div>
          <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>Approval Status</div>
          <div style={{ marginTop: 5 }}><StatusPill status={approvalStatus} /></div>
        </div>
      </div>
    </div>
  );
}

export function OffCycleCards({ rows }: { rows: OffCycleRow[] }) {
  const router = useRouter();
  const [pendingRow, setPendingRow] = useState<OffCycleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function processRun() {
    if (!pendingRow) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<{ data: { id: string; totalNetMinor: number } }>(
        "v1/payroll/off-cycle/" + pendingRow.id + "/process",
        { method: "POST" },
      );
      setMessage("Off-cycle run for " + pendingRow.period + " processed. Net payable " + formatMoney(res.data.totalNetMinor) + ".");
      setPendingRow(null);
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
        <p style={{ fontSize: 32, margin: "0 0 8px" }}>🗂️</p>
        <p style={{ fontWeight: 600 }}>No off-cycle runs yet</p>
        <p style={{ fontSize: 13 }}>Create an off-cycle run using the form above.</p>
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
          <RunCard key={row.id} row={row} onProcess={(r) => { setDialogError(undefined); setPendingRow(r); }} />
        ))}
      </div>

      <ConfirmDialog
        open={pendingRow !== null}
        title="Process this off-cycle run?"
        confirmLabel="Process run"
        busy={busy}
        errorMessage={dialogError}
        description={
          pendingRow ? (
            <>
              Process the {REASON_LABELS[pendingRow.run_type] ?? pendingRow.run_type} run for period{" "}
              <strong>{pendingRow.period}</strong>, total {formatMoney(pendingRow.total_amount_minor)}.{" "}
              This computes tax and net payable for every item and is irreversible.
            </>
          ) : null
        }
        onConfirm={() => void processRun()}
        onCancel={() => !busy && setPendingRow(null)}
      />
    </>
  );
}
