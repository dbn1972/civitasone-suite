"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton } from "../../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";

/**
 * Plain-language failure message for a failed RTI lifecycle action. `patch`
 * is a plain async helper, not a component or hook, so it can't call the
 * useFormError hook; toHumanError is the same catalogued-message building
 * block that hook is built on -- never the backend's own message/error text
 * or the raw HTTP status. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function rtiActionError(): string {
  const human = toHumanError("save", { area: "RTI request" });
  return `${human.what} ${human.next}`;
}

/** FAA outcome options (crm-service rti-repo FIRST_APPEAL_OUTCOMES). */
const FAA_OUTCOMES = [
  { value: "allowed", labelKey: "outcomeAllowed" },
  { value: "partly_allowed", labelKey: "outcomePartlyAllowed" },
  { value: "dismissed", labelKey: "outcomeDismissed" },
] as const;
type FaaOutcome = (typeof FAA_OUTCOMES)[number]["value"];

/**
 * RTI Act 2005 lifecycle actions.
 *
 * Status vocabulary (backend `RTI_STATUS`, services/crm-service rti-repo.ts):
 *   RECEIVED       initial
 *   TRANSFERRED    forwarded to another department (s.6(3))
 *   RESPONDED      CPIO has responded within the 30-day statutory window
 *   REJECTED       request rejected
 *   FIRST_APPEAL   applicant has raised a first appeal (s.19)
 *   SECOND_APPEAL  escalated to the Information Commission
 *   DISPOSED       terminal
 *
 * Available actions (per services/crm-service/src/modules/rti/rti-route.ts):
 *   Forward         PATCH /forward              { departmentRef }        TRANSFERRED
 *   Respond         PATCH /respond              { responseText }         RESPONDED
 *   First Appeal    PATCH /first-appeal         (RESPONDED/REJECTED)     FIRST_APPEAL
 *   Record decision PATCH /first-appeal/decide  { outcome, orderText }   (admin; once)
 *   Second appeal   PATCH /second-appeal        { reference }            SECOND_APPEAL
 *   Dispose         PATCH /dispose              { reason }               DISPOSED (admin)
 *
 * GAP-CRM-RTI-DETAIL-01: FIRST_APPEAL / SECOND_APPEAL used to dead-end at
 * "no further action available here". Disposal is only offered once the FAA
 * order is on record or a second appeal has been filed (the server enforces
 * the same rule).
 */
export function RtiActions({
  id,
  status,
  canAct = true,
  canDecide = false,
  firstAppealDueAt,
  firstAppealDecidedAt,
  disposedAt,
}: {
  id: string;
  status: string;
  /**
   * GAP-CRM-RTI-DETAIL-02: whether the signed-in user holds a CRM write role
   * (the same ACL crm-service enforces on these PATCH routes). When false,
   * no action buttons are offered at all — UI hiding is not authorisation
   * (the server stays the authority), but it stops presenting controls that
   * are guaranteed to 403. The CPIO/APIO distinction is not modelled in the
   * backend yet (see report), so the safest available gate is the CRM ACL.
   */
  canAct?: boolean;
  /**
   * GAP-CRM-RTI-DETAIL-01: whether the user holds an appellate (admin) role —
   * the server's RTI_APPELLATE_ROLES. Deciding a first appeal and disposing a
   * request are offered only then. Defaults to false (fail closed).
   */
  canDecide?: boolean;
  /** First-appeal statutory deadline, surfaced prominently once in appeal. */
  firstAppealDueAt?: string | null;
  /** When the FAA's order was recorded (null while undecided). */
  firstAppealDecidedAt?: string | null;
  /** When the request was disposed. */
  disposedAt?: string | null;
}) {
  const t = useTranslations("crmRtiActions");
  const router = useRouter();
  const [outcome, setOutcome] = useState<FaaOutcome>("allowed");

  const canProgress = status === "RECEIVED" || status === "TRANSFERRED";
  const canAppeal = status === "RESPONDED" || status === "REJECTED";
  const inFirstAppeal = status === "FIRST_APPEAL";
  const decidedAt = firstAppealDecidedAt ?? null;

  async function patch(action: string, payload?: Record<string, unknown>) {
    const res = await fetch(`/api/proxy/v1/crm/rti/${id}/${action}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (!res.ok) {
      throw new Error(rtiActionError());
    }
    router.refresh();
  }

  // GAP-CRM-RTI-DETAIL-02: a user without a CRM write role sees no action
  // buttons (the server would 403 them anyway).
  if (!canAct) {
    return (
      <span style={{ fontSize: 13, color: "var(--ink2)" }}>
        {t("noPermission")}
      </span>
    );
  }

  if (status === "DISPOSED") {
    return (
      <span style={{ fontSize: 13, color: "var(--ink2)", maxWidth: 420 }}>
        {disposedAt ? t("disposedOn", { date: formatIndianDate(disposedAt) }) : t("disposed")}
      </span>
    );
  }

  if (inFirstAppeal || status === "SECOND_APPEAL") {
    const canDispose = canDecide && (status === "SECOND_APPEAL" || decidedAt !== null);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 480 }}>
        <span style={{ fontSize: 13, color: "var(--ink2)" }}>
          {inFirstAppeal
            ? decidedAt
              ? t("faaOrderRecorded", { date: formatIndianDate(decidedAt) })
              : t("faaPending")
            : t("secondAppealInfo")}
          {!canDecide && ` ${t("needsAdmin")}`}
        </span>
        {inFirstAppeal && !decidedAt && firstAppealDueAt && (
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--warn)" }}>
            {t("decisionDue", { date: formatIndianDate(firstAppealDueAt) })}
          </span>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {inFirstAppeal && !decidedAt && canDecide && (
            <ActionButton
              label={t("recordFaaDecision")}
              className="btn primary"
              confirmTitle={t("recordFaaConfirmTitle")}
              confirmDescription={
                <>
                  <p style={{ margin: "0 0 8px" }}>
                    {t("recordFaaConfirmBody")}
                  </p>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                    {t("outcomeLabel")}
                    <select
                      value={outcome}
                      onChange={(e) => setOutcome(e.target.value as FaaOutcome)}
                      style={{ padding: 6, minHeight: 36 }}
                    >
                      {FAA_OUTCOMES.map((o) => (
                        <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                      ))}
                    </select>
                  </label>
                </>
              }
              requireReason
              reasonLabel={t("appellateOrderLabel")}
              minReasonLength={20}
              maxReasonLength={10000}
              onConfirm={(orderText) => patch("first-appeal/decide", { outcome, orderText })}
            />
          )}
          {inFirstAppeal && (
            <ActionButton
              label={t("recordSecondAppeal")}
              className="btn"
              confirmTitle={t("secondAppealConfirmTitle")}
              confirmDescription={t("secondAppealConfirmBody")}
              requireReason
              reasonLabel={t("commissionRefLabel")}
              minReasonLength={3}
              maxReasonLength={500}
              onConfirm={(reference) => patch("second-appeal", { reference })}
            />
          )}
          {canDispose && (
            <ActionButton
              label={t("dispose")}
              danger
              confirmTitle={t("disposeConfirmTitle")}
              confirmDescription={t("disposeConfirmBody")}
              requireReason
              reasonLabel={t("disposeReasonLabel")}
              minReasonLength={20}
              maxReasonLength={2000}
              onConfirm={(reason) => patch("dispose", { reason })}
            />
          )}
        </div>
      </div>
    );
  }

  if (!canProgress && !canAppeal) {
    return (
      <span style={{ fontSize: 13, color: "var(--ink2)" }}>
        {t("noFurtherAction")}
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {canProgress && (
        <>
          {/* Forward to another department — s.6(3) transfer */}
          <ActionButton
            label={t("forward")}
            confirmTitle={t("forwardConfirmTitle")}
            confirmDescription={t("forwardConfirmBody")}
            requireReason
            reasonLabel={t("forwardReasonLabel")}
            onConfirm={(dept) => patch("forward", { departmentRef: dept })}
          />

          {/* Respond within the 30-day statutory deadline. GAP-CRM-RTI-DETAIL-02:
              the response is a statutory record, so require a substantive reply
              (not the 1-char default) and show it back for review before send. */}
          <ActionButton
            label={t("respond")}
            className="primary"
            confirmTitle={t("respondConfirmTitle")}
            confirmDescription={t("respondConfirmBody")}
            requireReason
            reasonLabel={t("respondReasonLabel")}
            minReasonLength={20}
            maxReasonLength={10000}
            onConfirm={(text) => patch("respond", { responseText: text })}
          />
        </>
      )}

      {canAppeal && (
        <ActionButton
          label={t("firstAppeal")}
          confirmTitle={t("firstAppealConfirmTitle")}
          confirmDescription={t("firstAppealConfirmBody")}
          onConfirm={() => patch("first-appeal")}
        />
      )}
    </div>
  );
}
