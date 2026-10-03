"use client";

/**
 * GAP-FINANCE-AUDIT-PARAS-DETAIL-04: record the department reply, escalate or settle an audit para.
 * POST /v1/finance/audit-paras/:id/respond | /escalate | /settle, each with a mandatory note. The service
 * enforces the status machine race-safely (a lost race is a 409) and, for settle, that the user who
 * recorded the reply cannot also settle it (maker != checker); each step is audited once.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton } from "@/app/_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { workflowErrorMessage } from "@/lib/finance/workflowErrors";
import { useSettledRefresh } from "@/lib/finance/useSettledRefresh";
import type { ParaAction } from "./auditParaActions";

export function AuditParaActions({ id, paraNo, actions }: { id: string; paraNo: string; actions: ParaAction[] }) {
  const t = useTranslations("financeAuditParaActions");
  const te = useTranslations("financeWorkflowErrors");
  const router = useRouter();
  const settle = useSettledRefresh(router);
  const [note, setNote] = useState<string | null>(null);
  const idemKey = useRef(globalThis.crypto.randomUUID());

  async function post(action: ParaAction, text?: string): Promise<void> {
    const res = await browserFetch(`v1/finance/audit-paras/${id}/${action}`, {
      method: "POST",
      headers: { "x-idempotency-key": idemKey.current },
      body: JSON.stringify({ note: text }),
    });
    if (!res.ok) {
      idemKey.current = globalThis.crypto.randomUUID();
      throw new Error(await workflowErrorMessage(res, (k) => te(k), res.status === 409 ? "conflict" : "save", "audit para"));
    }
  }
  // each action answers 202 (queued): re-read until it lands
  const done = (msg: string) => () => { setNote(msg); settle(); };

  return (
    <>
      {actions.includes("respond") ? (
        <ActionButton
          label={t("respondLabel")} className="btn primary"
          confirmTitle={t("respondTitle", { no: paraNo })} confirmDescription={t("respondDescription")} confirmLabel={t("respondConfirm")}
          requireReason reasonLabel={t("respondNoteLabel")} minReasonLength={5} maxReasonLength={2000}
          onConfirm={(text) => post("respond", text)} onSuccess={done(t("responded"))}
        />
      ) : null}
      {actions.includes("escalate") ? (
        <ActionButton
          label={t("escalateLabel")} className="btn ghost"
          confirmTitle={t("escalateTitle", { no: paraNo })} confirmDescription={t("escalateDescription")} confirmLabel={t("escalateConfirm")}
          requireReason reasonLabel={t("escalateNoteLabel")} minReasonLength={5} maxReasonLength={2000}
          onConfirm={(text) => post("escalate", text)} onSuccess={done(t("escalated"))}
        />
      ) : null}
      {actions.includes("settle") ? (
        <ActionButton
          label={t("settleLabel")} className="btn ghost" danger
          confirmTitle={t("settleTitle", { no: paraNo })} confirmDescription={t("settleDescription")} confirmLabel={t("settleConfirm")}
          requireReason reasonLabel={t("settleNoteLabel")} minReasonLength={5} maxReasonLength={2000}
          onConfirm={(text) => post("settle", text)} onSuccess={done(t("settled"))}
        />
      ) : null}
      {note ? <span role="status" style={{ fontSize: 12 }}>{note}</span> : null}
    </>
  );
}
