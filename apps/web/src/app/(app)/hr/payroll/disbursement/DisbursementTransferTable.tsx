"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, StatusPill, ConfirmDialog } from "../../../../_components/ds";
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

function ProgressRing({
  done,
  total,
  doneLabel,
  creditedPctLabel,
}: {
  done: number;
  total: number;
  doneLabel: string;
  creditedPctLabel: string;
}) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = total > 0 ? (done / total) * circ : 0;
  const dashArray = String(dash) + " " + String(circ);
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
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{doneLabel}</p>
        <p style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{creditedPctLabel}</p>
      </div>
    </div>
  );
}

export function DisbursementTransferTable({ transfers }: { transfers: TransferRow[] }) {
  const t = useTranslations("disbursementTransferTable");
  const router = useRouter();
  const [pendingRetry, setPendingRetry] = useState<TransferRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  // UX-017: renamed these callback params from `t` (for "transfer") to `tx`
  // -- this component now also holds `t`, the translation function, in the
  // same scope, the exact tranche-7-discovered shadowing bug class.
  const done = transfers.filter((tx) => tx.status === "credited").length;
  const failed = transfers.filter((tx) => tx.status === "failed").length;
  const processing = transfers.filter((tx) => tx.status === "processing").length;
  const total = transfers.reduce((sum, tx) => sum + tx.amountRupees, 0);
  const pct = transfers.length > 0 ? Math.round((done / transfers.length) * 100) : 0;

  async function retryTransfer() {
    if (!pendingRetry) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson<RetryResponse>(
        "v1/payroll/disbursement/transfers/" + pendingRetry.id + "/retry",
        { method: "POST" },
      );
      setMessage(t("retryMessage", { name: pendingRetry.employeeName }));
      setPendingRetry(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("retryNetworkError"));
    } finally {
      setBusy(false);
    }
  }

  if (transfers.length === 0) {
    return (
      <div className="pad" style={{ textAlign: "center", padding: "40px 20px", color: "var(--ink2)" }}>
        <p style={{ fontSize: 32, margin: "0 0 8px" }}>🏦</p>
        <p style={{ fontWeight: 600 }}>{t("emptyTitle")}</p>
        <p style={{ fontSize: 13 }}>{t("emptyMessage")}</p>
      </div>
    );
  }

  const columns = [
    t("colEmployee"),
    t("colAccountIfsc"),
    t("colAmount"),
    t("colNachBatchId"),
    t("colStatus"),
    t("colAction"),
  ];

  return (
    <div className="pad">
      {message && (
        <p role="status" className="pill good" style={{ width: "fit-content", marginBottom: 12 }}>
          {message}
        </p>
      )}

      {/* Progress + stat strip */}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
        <ProgressRing
          done={done}
          total={transfers.length}
          doneLabel={t("disbursedLabel")}
          creditedPctLabel={t("creditedPct", { pct })}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, flex: 1 }}>
          <div style={{ background: "var(--infobg)", borderRadius: 10, padding: "12px 16px" }}>
            <p style={{ margin: 0, fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{t("totalAmountLabel")}</p>
            <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>{inrFmt.format(total)}</p>
          </div>
          <div style={{ background: "var(--goodbg)", borderRadius: 10, padding: "12px 16px" }}>
            <p style={{ margin: 0, fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{t("creditedLabel")}</p>
            <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>{done}</p>
          </div>
          <div style={{ background: failed > 0 ? "var(--badbg)" : "var(--line2)", borderRadius: 10, padding: "12px 16px" }}>
            <p style={{ margin: 0, fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{t("failedLabel")}</p>
            <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>{failed}</p>
          </div>
          <div style={{ background: "var(--warnbg)", borderRadius: 10, padding: "12px 16px" }}>
            <p style={{ margin: 0, fontSize: 11, color: "var(--ink2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{t("processingLabel")}</p>
            <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 700 }}>{processing}</p>
          </div>
        </div>
      </div>

      {/* Transfer table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--line2)" }}>
              {columns.map((h) => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "var(--ink2)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transfers.map((tx) => (
              <tr key={tx.id} style={{ borderBottom: "1px solid var(--line2)" }}>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ fontWeight: 600 }}>{tx.employeeName}</div>
                  <div style={{ fontSize: 11, color: "var(--ink2)" }}>{tx.employeeId}</div>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <div className="mono" style={{ fontSize: 12 }}>{tx.accountNumber}</div>
                  <div style={{ fontSize: 11, color: "var(--ink2)" }}>{tx.ifsc}</div>
                </td>
                <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600 }}>{inrFmt.format(tx.amountRupees)}</td>
                <td style={{ padding: "10px 12px" }}>
                  {tx.nachBatchId
                    ? <span className="mono" style={{ fontSize: 12 }}>{tx.nachBatchId}</span>
                    : <span style={{ color: "var(--ink2)" }}>—</span>}
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <StatusPill status={tx.status} />
                  {tx.status === "failed" && tx.failureReason ? (
                    <div style={{ fontSize: 11, color: "var(--bad, #c0392b)", marginTop: 2 }}>{tx.failureReason}</div>
                  ) : null}
                </td>
                <td style={{ padding: "10px 12px" }}>
                  {tx.status === "failed" ? (
                    <Button
                      type="button"
                      variant="primary"
                      style={{ minHeight: 32, fontSize: 12 }}
                      aria-label={t("retryAriaLabel", { name: tx.employeeName })}
                      onClick={() => { setDialogError(undefined); setPendingRetry(tx); }}
                    >
                      {t("retryBtn")}
                    </Button>
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
        title={t("retryConfirmTitle")}
        confirmLabel={t("retryConfirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={
          pendingRetry ? (
            <>
              {t.rich("retryConfirmDescription", {
                name: pendingRetry.employeeName,
                employeeId: pendingRetry.employeeId,
                amount: inrFmt.format(pendingRetry.amountRupees),
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
              {pendingRetry.failureReason ? " " + t("retryConfirmFailureReason", { reason: pendingRetry.failureReason }) : null}
            </>
          ) : null
        }
        onConfirm={() => void retryTransfer()}
        onCancel={() => !busy && setPendingRetry(null)}
      />
    </div>
  );
}
