"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "../../../../_components/ds";
import { useToast } from "@/app/_components/ds/Toast";
import { formatRupees } from "@/lib/formatters";

type Props = {
  runId: string;
  status: string;
  /** Context for the irreversible-action summaries. */
  employeeCount: number;
  grossAmount: number;
  netAmount: number;
  payPeriod: string;
  canAdminister?: boolean;
};

type PendingAction = "approve" | "disburse" | "revert" | null;

export function PayrollRunActions({
  runId,
  status,
  employeeCount,
  grossAmount,
  netAmount,
  payPeriod,
  canAdminister = false,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"good" | "bad">("good");
  const { toast } = useToast();

  async function runAction(action: "approve" | "disburse" | "revert", reason?: string) {
    setBusy(true);
    setError(undefined);
    const path =
      action === "approve"
        ? `/api/proxy/v1/payroll/runs/${runId}/approve`
        : action === "disburse"
          ? `/api/proxy/v1/payroll/runs/${runId}/disburse`
          : `/api/proxy/v1/payroll/runs/${runId}/revert`;
    try {
      const res = await fetch(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const text = await res.text();
      if (!res.ok) {
        setError(text || `${action} failed (${res.status})`);
        return;
      }
      setMessageTone("good");
      setMessage(
        action === "approve"
          ? `Payroll run for ${payPeriod} approved.`
          : action === "disburse"
            ? `Disbursement of ${formatRupees(netAmount)} to ${employeeCount} employees initiated.`
            : `Payroll run for ${payPeriod} reverted to draft.`,
      );
      toast.success(
        action === "approve"
          ? `✓ Payroll run for ${payPeriod} approved`
          : action === "disburse"
            ? `✓ Disbursement of ${formatRupees(netAmount)} initiated`
            : `✓ Run reverted to draft`,
      );
      setPending(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const canApprove  = canAdminister && (status === "processing" || status === "draft");
  const canDisburse = canAdminister && status === "approved";
  const canRevert   = status === "failed";

  if (!canApprove && !canDisburse && !canRevert) return null;

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3>Payroll Actions</h3>
      </div>
      <div className="pad">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {canApprove && (
            <button
              type="button"
              className="btn primary"
              style={{ minHeight: 44 }}
              onClick={() => { setError(undefined); setPending("approve"); }}
            >
              Approve Run
            </button>
          )}
          {canDisburse && (
            <button
              type="button"
              className="btn primary"
              style={{ minHeight: 44 }}
              onClick={() => { setError(undefined); setPending("disburse"); }}
            >
              Disburse Run
            </button>
          )}
          {canRevert && (
            <button
              type="button"
              className="btn secondary"
              style={{ minHeight: 44 }}
              onClick={() => { setError(undefined); setPending("revert"); }}
            >
              Revert to Draft
            </button>
          )}
        </div>

        {message && (
          <p role="status" aria-live="polite" className={`pill ${messageTone}`} style={{ marginTop: 14 }}>
            {message}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={pending === "approve"}
        title="Approve this payroll run?"
        danger
        requireReason
        reasonLabel="Approval remarks (maker-checker)"
        confirmLabel="Approve run"
        busy={busy}
        errorMessage={error}
        description={
          <>
            You are about to approve the payroll run for <strong>{payPeriod}</strong> covering{" "}
            <strong>{employeeCount}</strong> employees with a gross of{" "}
            <strong>{formatRupees(grossAmount)}</strong>. Once approved the run can be disbursed and
            cannot be edited.
          </>
        }
        onConfirm={(reason) => void runAction("approve", reason)}
        onCancel={() => !busy && setPending(null)}
      />

      <ConfirmDialog
        open={pending === "disburse"}
        title="Disburse this payroll run?"
        danger
        requireReason
        reasonLabel="Disbursement authorisation (maker-checker)"
        confirmLabel="Disburse now"
        busy={busy}
        errorMessage={error}
        description={
          <>
            This will disburse <strong>{formatRupees(netAmount)}</strong> to{" "}
            <strong>{employeeCount}</strong> employees for <strong>{payPeriod}</strong>. Funds are
            released to PFMS and this action is <strong>irreversible</strong>.
          </>
        }
        onConfirm={(reason) => void runAction("disburse", reason)}
        onCancel={() => !busy && setPending(null)}
      />

      <ConfirmDialog
        open={pending === "revert"}
        title="Revert this run to draft?"
        danger
        requireReason
        reasonLabel="Reason for revert"
        confirmLabel="Revert to draft"
        busy={busy}
        errorMessage={error}
        description={
          <>
            The payroll run for <strong>{payPeriod}</strong> will be reverted to draft status so
            it can be corrected and reprocessed. No funds have been disbursed.
          </>
        }
        onConfirm={(reason) => void runAction("revert", reason)}
        onCancel={() => !busy && setPending(null)}
      />
    </section>
  );
}
