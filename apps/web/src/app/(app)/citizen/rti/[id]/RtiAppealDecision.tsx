"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ActionButton } from "@/app/_components/ds";
import { browserFetch } from "@/lib/api/browserClient";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export const APPEAL_OUTCOMES = ["allowed", "partly_allowed", "rejected", "remanded"] as const;

/**
 * D2 (CITIZEN-RTI-DETAIL-06): the appellate authority (rti_appellate) records the
 * first-appeal decision. The service enforces role, first-appeal-only, still-filed
 * and "not the CPIO who responded"; this only surfaces the form.
 */
export function RtiAppealDecision({ rtiId, appealId, onDone }: { rtiId: string; appealId: string; onDone: () => void }) {
  const t = useTranslations("citizenRti");
  const [outcome, setOutcome] = useState<(typeof APPEAL_OUTCOMES)[number]>("allowed");
  const [decisionDate, setDecisionDate] = useState("");
  const [hearingDate, setHearingDate] = useState("");
  const [reason, setReason] = useState("");
  return (
    <ActionButton
      label={t("decideAppeal")}
      confirmTitle={t("decideAppealTitle")}
      confirmDescription={t("decideAppealDescription")}
      confirmLabel={t("decideAppealConfirm")}
      blockConfirm={!decisionDate || reason.trim().length === 0 || (hearingDate !== "" && hearingDate > decisionDate)}
      onConfirm={async () => {
        const res = await browserFetch(`v1/citizen/rti/${rtiId}/appeals/${appealId}/decide`, {
          method: "POST",
          body: JSON.stringify({
            outcome, decisionDate, reason: reason.trim(),
            ...(hearingDate ? { hearingDate } : {}),
          }),
        });
        if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      }}
      onSuccess={onDone}
    >
      <label htmlFor={`appeal-outcome-${appealId}`} style={labelStyle}>{t("appealOutcomeLabel")}</label>
      <select id={`appeal-outcome-${appealId}`} value={outcome} onChange={(e) => setOutcome(e.target.value as (typeof APPEAL_OUTCOMES)[number])} style={inputStyle}>
        {APPEAL_OUTCOMES.map((o) => <option key={o} value={o}>{t(`appealOutcome_${o}`)}</option>)}
      </select>
      <label htmlFor={`appeal-hearing-${appealId}`} style={labelStyle}>{t("appealHearingDateLabel")}</label>
      <input id={`appeal-hearing-${appealId}`} type="date" value={hearingDate} onChange={(e) => setHearingDate(e.target.value)} style={inputStyle} />
      <label htmlFor={`appeal-decision-${appealId}`} style={labelStyle}>{t("appealDecisionDateLabel")}</label>
      <input id={`appeal-decision-${appealId}`} type="date" required value={decisionDate} onChange={(e) => setDecisionDate(e.target.value)} style={inputStyle} />
      <label htmlFor={`appeal-reason-${appealId}`} style={labelStyle}>{t("appealDecisionReasonLabel")}</label>
      <textarea id={`appeal-reason-${appealId}`} required rows={4} maxLength={5000} value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 100 }} />
    </ActionButton>
  );
}
