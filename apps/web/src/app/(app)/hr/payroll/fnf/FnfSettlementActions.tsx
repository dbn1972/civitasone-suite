"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, Modal, Field, Input } from "../../../../_components/ds";
import { formatMoney } from "@/lib/formatters";
import { postWithErrorCode } from "../_lib/postWithErrorCode";
import {
  fnfAvailability, todayIst, PAYMENT_REFERENCE_PATTERN, REJECT_REASON_MIN, REASON_MAX,
  type FnfAction, type FnfViewer, type FnfWorkflowFields,
} from "./fnfWorkflow";

/** i18n key prefix per action (keys stay camelCase). */
const KEY: Record<FnfAction, string> = { submit: "submit", "finance-approve": "approve", disburse: "disburse", reject: "reject" };

export type FnfActionRow = FnfWorkflowFields & {
  id: string;
  name: string;
  netPayableMinor: string | number;
};

/**
 * GAP-PAYROLL-FNF-01: the per-settlement Submit / Finance approve / Mark
 * disbursed / Reject buttons, restored now that payroll-service has the
 * POST /v1/payroll/fnf/settlements/:id/{submit,finance-approve,disburse,reject}
 * endpoints. Buttons are gated by role AND status AND segregation of duties
 * (fnfWorkflow.ts); the server is the authority and re-checks all of it.
 *
 * Every write is asynchronous (202 + queue), so the success message says the
 * status will update shortly rather than claiming it already changed.
 */
export function FnfSettlementActions({ row, viewer }: { row: FnfActionRow; viewer: FnfViewer }) {
  const t = useTranslations("fnfSettlementActions");
  const router = useRouter();
  const [pending, setPending] = useState<FnfAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const formId = useId();
  // The delayed follow-up refresh must not outlive the component: a timer
  // left running after unmount would call router.refresh() on whatever page
  // (or test) is current two seconds later.
  const followUpRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (followUpRefresh.current) clearTimeout(followUpRefresh.current);
  }, []);

  const { actions, selfExcluded } = fnfAvailability(row, viewer);
  const confirmAction = pending && pending !== "disburse" ? pending : null;
  const today = todayIst();

  const errorCodes = {
    FNF_INVALID_TRANSITION: t("staleError"),
    FNF_VERSION_CONFLICT: t("staleError"),
    FNF_SELF_APPROVAL_FORBIDDEN: t("selfApprovalError"),
    FNF_SELF_DISBURSAL_FORBIDDEN: t("selfDisbursalError"),
    FORBIDDEN: t("forbiddenError"),
    NOT_FOUND: t("staleError"),
  };

  function open(action: FnfAction) {
    setDialogError(undefined);
    setPaymentReference("");
    setPaymentDate(today);
    setPending(action);
  }

  async function run(action: FnfAction, extra: Record<string, string | undefined>) {
    setBusy(true);
    setDialogError(undefined);
    try {
      const body: Record<string, unknown> = { version: row.version };
      for (const [k, v] of Object.entries(extra)) if (v) body[k] = v;
      await postWithErrorCode(`v1/payroll/fnf/settlements/${row.id}/${action}`, body, errorCodes);
      setMessage(t(`${KEY[action]}Queued`, { name: row.name }));
      setPending(null);
      router.refresh();
      // The write lands asynchronously; refresh once more so the new status shows up.
      if (followUpRefresh.current) clearTimeout(followUpRefresh.current);
      followUpRefresh.current = setTimeout(() => {
        followUpRefresh.current = null;
        router.refresh();
      }, 2000);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const refTrimmed = paymentReference.trim();
  const refInvalid = refTrimmed.length > 0 && !PAYMENT_REFERENCE_PATTERN.test(refTrimmed);
  const dateInvalid = paymentDate !== "" && paymentDate > today;
  const disburseReady = PAYMENT_REFERENCE_PATTERN.test(refTrimmed) && paymentDate !== "" && !dateInvalid;

  if (actions.length === 0 && !selfExcluded && !message) return null;

  return (
    <div style={{ padding: "0 18px 14px" }}>
      {message && (
        <p role="status" aria-live="polite" className="pill good" style={{ width: "fit-content", margin: "0 0 10px" }}>{message}</p>
      )}
      {selfExcluded && (
        <p role="note" style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 8px" }}>
          {row.status === "finance_approved" ? t("selfExcludedDisburse") : t("selfExcludedApprove")}
        </p>
      )}
      {actions.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {actions.map((action) => (
            <Button
              key={action}
              type="button"
              variant={action === "reject" ? "danger" : "primary"}
              style={{ minHeight: 36 }}
              aria-label={t(`${KEY[action]}AriaLabel`, { name: row.name })}
              onClick={() => open(action)}
            >
              {t(`${KEY[action]}Btn`)}
            </Button>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction ? t(`${KEY[confirmAction]}Title`) : ""}
        description={confirmAction ? t(`${KEY[confirmAction]}Description`, { name: row.name, amount: formatMoney(row.netPayableMinor) }) : null}
        confirmLabel={confirmAction ? t(`${KEY[confirmAction]}Btn`) : undefined}
        cancelLabel={t("cancelBtn")}
        danger={pending === "reject"}
        requireReason={pending === "reject"}
        optionalReason={pending === "submit" || pending === "finance-approve"}
        minReasonLength={pending === "reject" ? REJECT_REASON_MIN : 1}
        maxReasonLength={REASON_MAX}
        reasonLabel={pending === "reject" ? t("rejectReasonLabel") : t("noteLabel")}
        busy={busy}
        errorMessage={dialogError}
        onConfirm={(reason) => {
          if (!confirmAction) return;
          void run(confirmAction, confirmAction === "reject" ? { reason } : { note: reason });
        }}
        onCancel={() => !busy && setPending(null)}
      />

      <Modal
        open={pending === "disburse"}
        onClose={() => !busy && setPending(null)}
        role="alertdialog"
        title={<><span aria-hidden="true">⚠️</span>{t("disburseTitle")}</>}
        closeOnOverlayClick={!busy}
        overlayClassName="cd-overlay"
        panelClassName="cd-panel"
        titleClassName="cd-title"
      >
        <form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            if (disburseReady && !busy) void run("disburse", { paymentReference: refTrimmed, paymentDate });
          }}
        >
          <div className="cd-desc">{t("disburseDescription", { name: row.name, amount: formatMoney(row.netPayableMinor) })}</div>
          <Field label={t("paymentReferenceLabel")} required error={refInvalid ? t("paymentReferenceInvalid") : undefined}>
            <Input
              value={paymentReference}
              maxLength={64}
              autoComplete="off"
              onChange={(e) => setPaymentReference(e.target.value)}
            />
          </Field>
          <Field label={t("paymentDateLabel")} required error={dateInvalid ? t("paymentDateFuture") : undefined}>
            <Input type="date" value={paymentDate} max={today} onChange={(e) => setPaymentDate(e.target.value)} />
          </Field>
          <div className="cd-error" role="alert" aria-live="assertive">{dialogError ?? ""}</div>
          <div className="cd-actions">
            <Button type="button" variant="ghost" onClick={() => setPending(null)} disabled={busy}>{t("cancelBtn")}</Button>
            <Button type="submit" variant="danger" disabled={!disburseReady || busy} aria-busy={busy}>
              {t("disburseBtn")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
