"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

export type TransferRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  accountNumber: string;
  ifsc: string;
  amountRupees: number;
  status: "pending" | "processing" | "credited" | "failed" | string;
  nachBatchId: string | null;
  failureReason: string | null;
};

type RetryResponse = { data: { id: string; status: string } };

const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = total > 0 ? (done / total) * circ : 0;
  const dashArray = String(dash) + " " + String(circ);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width={88} height={88} viewBox="0 0 88 88" aria-hidden="true">
        <circle cx={44} cy={44} r={r} fill="none" strokeWidth={8} stroke="var(--line2)" />
        <circle
          cx={44} cy={44} r={r}
          fill="none" strokeWidth={8}
          stroke="var(--good, #27ae60)"
          strokeDasharray={dashArray}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
        />
        <text x={44} y={48} textAnchor="middle" fontSize={14} fontWeight={700} fill="var(--ink)">
          {done}/{total}
        </text>
      </svg>
      <div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Disbursed</p>
        <p style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{pct}% credited</p>
      </div>
    </div>
  );
}

export function DisbursementTransferTable({ transfers }: { transfers: TransferRow[] }) {
  const router = useRouter();
  const [pendingRetry, setPendingRetry] = useState<TransferRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const done = transfers.filter((t) => t.status === "credited").length;
  const failed = transfers.filter((t) => t.status === "failed").length;
  const processing = transfers.filter((t) => t.status === "processing").length;
  const total = transfers.reduce((s, t) => s + t.amountRupees, 0);

  async function retryTransfer() {
    if (!pendingRetry) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson<RetryResponse>(
        "v1/payroll/disbursement/transfers/" + pendingRetry.id + "/retry",
        { method: "POST" },
      );
      setMessage("Retry initiated for " + pendingRetry.employeeName + ".");
      setPendingRetry(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (transfers.length === 0) {
    return (
      <div className="pad" style={{ textAlign: "center", padding: "40px 20px", color: "var(--ink2)" }}>
        <p style={{ fontSize: 32, margin: "0 0 8px" }}>🏦</p>
        <p style={{ fontWeight: 600 }}>No transfers yet</p>
        <p style={{ fontSize: 13 }}>Bank transfers appear here after disbursement is initiated for a payroll run.</p>
      </div>
    );
  }

  return (
    <div className="pad">
      {message && (
        <p role="status" className="pill good" style={{ width: "fit-content", marginBottom: 12 }}>
          {message}
        </p>
      )}

      {/* Progress + stat strip */}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
        <ProgressRing done={done} total={transfers.length} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, flex: 1 }}>
          <div style={{ background: "var(--infobg)", borderRadius: 10, padding: "12px 16px" }}>
            <p style={{ margin: 0, fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>Total Amount</p>
            <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>{inrFmt.format(total)}</p>
          </div>
          <div style={{ background: "var(--goodbg)", borderRadius: 10, padding: "12px 16px" }}>
            <p style={{ margin: 0, fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>Credited</p>
            <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>{done}</p>
          </div>
          <div style={{ background: failed > 0 ? "var(--badbg)" : "var(--line2)", borderRadius: 10, padding: "12px 16px" }}>
            <p style={{ margin: 0, fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>Failed</p>
            <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>{failed}</p>
          </div>
          <div style={{ background: "var(--warnbg)", borderRadius: 10, padding: "12px 16px" }}>
            <p style={{ margin: 0, fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>Processing</p>
            <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>{processing}</p>
          </div>
        </div>
      </div>

      {/* Transfer table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--line2)" }}>
              {["Employee", "Account / IFSC", "Amount", "NACH Batch ID", "Status", "Action"].map((h) => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "var(--ink2)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id} style={{ borderBottom: "1px solid var(--line2)" }}>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ fontWeight: 600 }}>{t.employeeName}</div>
                  <div style={{ fontSize: 11, color: "var(--ink2)" }}>{t.employeeId}</div>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <div className="mono" style={{ fontSize: 12 }}>{t.accountNumber}</div>
                  <div style={{ fontSize: 11, color: "var(--ink2)" }}>{t.ifsc}</div>
                </td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>{inrFmt.format(t.amountRupees)}</td>
                <td style={{ padding: "10px 12px" }}>
                  {t.nachBatchId
                    ? <span className="mono" style={{ fontSize: 12 }}>{t.nachBatchId}</span>
                    : <span style={{ color: "var(--ink2)" }}>—</span>}
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <StatusPill status={t.status} />
                  {t.status === "failed" && t.failureReason ? (
                    <div style={{ fontSize: 11, color: "var(--bad, #c0392b)", marginTop: 2 }}>{t.failureReason}</div>
                  ) : null}
                </td>
                <td style={{ padding: "10px 12px" }}>
                  {t.status === "failed" ? (
                    <button
                      type="button"
                      className="btn"
                      style={{ minHeight: 32, fontSize: 12 }}
                      aria-label={"Retry transfer for " + t.employeeName}
                      onClick={() => { setDialogError(undefined); setPendingRetry(t); }}
                    >
                      Retry
                    </button>
                  ) : (
                    <span style={{ color: "var(--ink2)" }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingRetry !== null}
        title="Retry this bank transfer?"
        confirmLabel="Retry transfer"
        busy={busy}
        errorMessage={dialogError}
        description={
          pendingRetry ? (
            <>
              Retry bank transfer for <strong>{pendingRetry.employeeName}</strong> ({pendingRetry.employeeId}),
              amount <strong>{inrFmt.format(pendingRetry.amountRupees)}</strong>.
              {pendingRetry.failureReason ? " Previous failure: " + pendingRetry.failureReason : null}
            </>
          ) : null
        }
        onConfirm={() => void retryTransfer()}
        onCancel={() => !busy && setPendingRetry(null)}
      />
    </div>
  );
}
