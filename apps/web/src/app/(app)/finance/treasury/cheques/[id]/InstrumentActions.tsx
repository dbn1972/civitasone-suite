"use client";

/**
 * GAP-FINANCE-TREASURY-CHEQUES-DETAIL-04: cheque / DD actions on the detail page.
 *   Cancel     (issued)             POST /v1/finance/instruments/:id/cancel      mandatory reason
 *   Re-present (bounced)            POST /v1/finance/instruments/:id/represent   mandatory reason
 *   Mark stale (issued, past valid) POST /v1/finance/instruments/:id/stale       optional note
 * finance-service restricts them to finance_officer / finance_admin / super_admin, allows each only
 * from its source state (409 otherwise), refuses a re-present or mark-stale against the tenant's
 * validity horizon, and audits each transition exactly once (guarded UPDATE + audit in one
 * transaction). finance-service does not deduplicate on x-idempotency-key for instruments; the header
 * (the one the BFF proxy and gateway forward) is sent for request tracing only.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton } from "@/app/_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { workflowErrorMessage } from "@/lib/finance/workflowErrors";
import { useSettledRefresh } from "@/lib/finance/useSettledRefresh";

export type InstrumentActionsProps = {
  id: string;
  instrumentNo: string;
  canCancel: boolean;
  canRepresent: boolean;
  canStale: boolean;
};

export function InstrumentActions({ id, instrumentNo, canCancel, canRepresent, canStale }: InstrumentActionsProps) {
  const t = useTranslations("financeInstrumentActions");
  const te = useTranslations("financeWorkflowErrors");
  const router = useRouter();
  const settle = useSettledRefresh(router);
  const [note, setNote] = useState<string | null>(null);
  const idemKey = useRef<string>(globalThis.crypto.randomUUID());

  async function post(action: "cancel" | "represent" | "stale", reason?: string): Promise<void> {
    const res = await browserFetch(`v1/finance/instruments/${id}/${action}`, {
      method: "POST",
      headers: { "x-idempotency-key": idemKey.current },
      body: JSON.stringify(reason ? { reason } : {}),
    });
    if (!res.ok) {
      // A failed attempt may be retried: use a fresh key next time.
      idemKey.current = globalThis.crypto.randomUUID();
      throw new Error(await workflowErrorMessage(res, (k) => te(k), res.status === 409 ? "conflict" : "save", "cheque"));
    }
  }
  // Every action here is a queued command: the route answers 202 (or, when the worker applies it promptly, the updated
  // cheque), so none of them can assume it has landed. Re-read until the new state shows.
  const queued = (msg: string) => () => { setNote(msg); settle(); };
  const done = queued;

  return (
    <>
      {canRepresent ? (
        <ActionButton
          label={t("representLabel")}
          className="btn ghost"
          confirmTitle={t("representTitle", { no: instrumentNo })}
          confirmDescription={t("representDescription")}
          confirmLabel={t("representConfirm")}
          requireReason
          reasonLabel={t("reasonLabel")}
          minReasonLength={5}
          maxReasonLength={500}
          onConfirm={(reason) => post("represent", reason)}
          onSuccess={queued(t("represented"))}
        />
      ) : null}
      {canStale ? (
        <ActionButton
          label={t("staleLabel")}
          className="btn ghost"
          confirmTitle={t("staleTitle", { no: instrumentNo })}
          confirmDescription={t("staleDescription")}
          confirmLabel={t("staleConfirm")}
          onConfirm={() => post("stale")}
          onSuccess={queued(t("staled"))}
        />
      ) : null}
      {canCancel ? (
        <ActionButton
          label={t("cancelLabel")}
          className="btn ghost"
          danger
          confirmTitle={t("cancelTitle", { no: instrumentNo })}
          confirmDescription={t("cancelDescription")}
          confirmLabel={t("cancelConfirm")}
          requireReason
          reasonLabel={t("reasonLabel")}
          minReasonLength={5}
          maxReasonLength={500}
          onConfirm={(reason) => post("cancel", reason)}
          onSuccess={done(t("cancelled"))}
        />
      ) : null}
      {note ? <span role="status" style={{ fontSize: 12 }}>{note}</span> : null}
    </>
  );
}
