"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog, Button } from "../../../../_components/ds";
import { useToast } from "@/app/_components/ds/Toast";
import { formatRupees } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";

type Props = {
  runId: string;
  status: string;
  /** Context for the irreversible-action summaries. */
  employeeCount: number;
  grossAmount: number;
  netAmount: number;
  payPeriod: string;
  canAdminister?: boolean;
  /** GAP-PAYROLL-DETAIL-05: employees with unresolved pre-disbursement issues; shown as a warning in the Approve / Disburse confirmations. */
  exceptionCount?: number;
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
  exceptionCount = 0,
}: Props) {
  const t = useTranslations("payrollRunActions");
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"good" | "bad">("good");
  // GAP-PAYROLL-DETAIL-07: router.refresh() re-renders the server component,
  // but getPayrollRunById's cached response could still be stale for a
  // moment right after a successful action, so the just-acted-on button
  // could keep rendering and invite a second click on an irreversible
  // action. Track the just-completed action locally so its buttons
  // disappear immediately, independent of when the `status` prop itself
  // catches up; resets once it genuinely does (see the effect below).
  const [settledAction, setSettledAction] = useState<PendingAction>(null);
  const { toast } = useToast();
  const formError = useFormError("payroll run");

  useEffect(() => {
    setSettledAction(null);
  }, [status]);

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
      if (!res.ok) {
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setMessageTone("good");
      setMessage(
        action === "approve"
          ? t("approvedMessage", { period: payPeriod })
          : action === "disburse"
            ? t("disbursementInitiatedMessage", { amount: formatRupees(netAmount), count: employeeCount })
            : t("revertedMessage", { period: payPeriod }),
      );
      toast.success(
        action === "approve"
          ? t("approvedToast", { period: payPeriod })
          : action === "disburse"
            ? t("disbursementInitiatedToast", { amount: formatRupees(netAmount) })
            : t("revertedToast"),
      );
      setPending(null);
      setSettledAction(action);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  // GAP-PAYROLL-DETAIL-04: the real backend state machine
  // (payroll-service domain.ts assertRunStatusTransition) only allows
  // approved FROM "processing" -- never "draft" (draft -> processing is
  // itself a separate, earlier transition). Approving from draft always
  // fails server-side today; this used to render an Approve button that
  // could never succeed from that state.
  //
  // The wire status enum (payroll-service queries.ts mapRunStatus) is only
  // ever draft/processing/completed/paid/failed -- "approved" is remapped
  // to "completed" before the API responds, so a check against the literal
  // string "approved" can never match anything the API actually sends. That
  // made Disburse a dead button: canDisburse was never true for any real
  // run, no matter how far along it was.
  const canApprove  = canAdminister && status === "processing" && settledAction !== "approve";
  const canDisburse = canAdminister && status === "completed"  && settledAction !== "disburse";
  const canRevert   = canAdminister && status === "failed"     && settledAction !== "revert";

  if (!canApprove && !canDisburse && !canRevert) return null;

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3>{t("sectionTitle")}</h3>
      </div>
      <div className="pad">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {canApprove && (
            <Button
              style={{ minHeight: 44 }}
              onClick={() => { setError(undefined); setPending("approve"); }}
            >
              {t("approveRunBtn")}
            </Button>
          )}
          {canDisburse && (
            <Button
              style={{ minHeight: 44 }}
              onClick={() => { setError(undefined); setPending("disburse"); }}
            >
              {t("disburseRunBtn")}
            </Button>
          )}
          {canRevert && (
            <Button
              variant="secondary"
              style={{ minHeight: 44 }}
              onClick={() => { setError(undefined); setPending("revert"); }}
            >
              {t("revertToDraftBtn")}
            </Button>
          )}
        </div>

        {message && (
          <p role="status" aria-live="polite" className={`pill ${messageTone}`} style={{ marginTop: 14 }}>
            {message}
          </p>
        )}
      </div>

      {/* GAP-PAYROLL-DETAIL-02/03: maker-checker and revert were a free-text
          box (minReasonLength defaulted to 1, i.e. a single character would
          pass). The backend already enforces maker != creator server-side
          (payroll-service consumer.ts: SELF_APPROVAL_FORBIDDEN) and a
          disbursement reconciliation check (DISBURSE_RECONCILIATION_FAILED)
          -- this raises the client-side bar to match the seriousness of an
          irreversible, money-moving action. */}
      <ConfirmDialog
        open={pending === "approve"}
        title={t("approveConfirmTitle")}
        danger
        requireReason
        minReasonLength={10}
        maxReasonLength={1000}
        reasonLabel={t("approveReasonLabel")}
        confirmLabel={t("approveConfirmLabel")}
        busy={busy}
        errorMessage={error}
        description={(
          <>
            {t.rich("approveDescription", {
              period: payPeriod,
              count: employeeCount,
              amount: formatRupees(grossAmount),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
            {exceptionCount > 0 && <p role="note" className="pill warn" style={{ margin: "10px 0 0" }}>{t("exceptionsWarning", { count: exceptionCount })}</p>}
          </>
        )}
        onConfirm={(reason) => void runAction("approve", reason)}
        onCancel={() => !busy && setPending(null)}
      />

      <ConfirmDialog
        open={pending === "disburse"}
        title={t("disburseConfirmTitle")}
        danger
        requireReason
        minReasonLength={10}
        maxReasonLength={1000}
        reasonLabel={t("disburseReasonLabel")}
        confirmLabel={t("disburseConfirmLabel")}
        busy={busy}
        errorMessage={error}
        description={(
          <>
            {t.rich("disburseDescription", {
              amount: formatRupees(netAmount),
              count: employeeCount,
              period: payPeriod,
              // GAP-PAYROLL-DETAIL-06: the channel is a translated, replaceable
              // argument, never a hard-coded "PFMS" in the sentence.
              channel: t("disburseChannelDefault"),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
            {exceptionCount > 0 && <p role="note" className="pill warn" style={{ margin: "10px 0 0" }}>{t("exceptionsWarning", { count: exceptionCount })}</p>}
          </>
        )}
        onConfirm={(reason) => void runAction("disburse", reason)}
        onCancel={() => !busy && setPending(null)}
      />

      <ConfirmDialog
        open={pending === "revert"}
        title={t("revertConfirmTitle")}
        danger
        requireReason
        minReasonLength={10}
        maxReasonLength={1000}
        reasonLabel={t("revertReasonLabel")}
        confirmLabel={t("revertConfirmLabel")}
        busy={busy}
        errorMessage={error}
        description={t.rich("revertDescription", {
          period: payPeriod,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={(reason) => void runAction("revert", reason)}
        onCancel={() => !busy && setPending(null)}
      />
    </section>
  );
}
