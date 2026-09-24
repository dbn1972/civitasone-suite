"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
  const t = useTranslations("payrollRunActions");
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"good" | "bad">("good");
  const { toast } = useToast();
  const formError = useFormError("payroll run");

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
      router.refresh();
    } catch {
      setError(formError.fromException("save").message);
    } finally {
      setBusy(false);
    }
  }

  const canApprove  = canAdminister && (status === "processing" || status === "draft");
  const canDisburse = canAdminister && status === "approved";
  const canRevert   = canAdminister && status === "failed";

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

      <ConfirmDialog
        open={pending === "approve"}
        title={t("approveConfirmTitle")}
        danger
        requireReason
        reasonLabel={t("approveReasonLabel")}
        confirmLabel={t("approveConfirmLabel")}
        busy={busy}
        errorMessage={error}
        description={t.rich("approveDescription", {
          period: payPeriod,
          count: employeeCount,
          amount: formatRupees(grossAmount),
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={(reason) => void runAction("approve", reason)}
        onCancel={() => !busy && setPending(null)}
      />

      <ConfirmDialog
        open={pending === "disburse"}
        title={t("disburseConfirmTitle")}
        danger
        requireReason
        reasonLabel={t("disburseReasonLabel")}
        confirmLabel={t("disburseConfirmLabel")}
        busy={busy}
        errorMessage={error}
        description={t.rich("disburseDescription", {
          amount: formatRupees(netAmount),
          count: employeeCount,
          period: payPeriod,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={(reason) => void runAction("disburse", reason)}
        onCancel={() => !busy && setPending(null)}
      />

      <ConfirmDialog
        open={pending === "revert"}
        title={t("revertConfirmTitle")}
        danger
        requireReason
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
