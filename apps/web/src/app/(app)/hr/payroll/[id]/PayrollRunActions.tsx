"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog, Button } from "../../../../_components/ds";
import { useToast } from "@/app/_components/ds/Toast";
import { formatMinorString } from "@/lib/payroll/runMoney";
import { useFormError } from "@/lib/useFormError";
import { APPROVAL_REVIEW_CODES, loadApprovalReview, type ApprovalReview } from "./approvalReview";

type Props = {
  runId: string;
  status: string;
  /** Context for the irreversible-action summaries. */
  employeeCount: number;
  /**
   * GAP-PAYROLL-RUNS-01: the run's exact gross / net in integer PAISE (digit
   * strings, from the API's grossMinor / netMinor). Rendered with formatMoney
   * in the Approve / Disburse confirmations; null = unknown -> "—".
   */
  grossMinor: string | null;
  netMinor: string | null;
  payPeriod: string;
  canAdminister?: boolean;
  /**
   * GAP-PAYROLL-DETAIL-02 (maker-checker): the signed-in user's id and the run's
   * maker / checker ids. The maker cannot approve their own run and the approver
   * cannot disburse it; the buttons disable with an explanation instead of
   * letting the user click into a guaranteed 403. The server is the authority
   * (403 MAKER_CHECKER_VIOLATION); this is the hint, never the only control.
   */
  currentUserId?: string | null;
  createdBy?: string | null;
  approvedBy?: string | null;
  /** GAP-PAYROLL-DETAIL-05: employees with unresolved pre-disbursement issues; shown as a warning in the Approve / Disburse confirmations. */
  exceptionCount?: number;
};

type PendingAction = "approve" | "disburse" | "revert" | null;

/** The `code` of a failed response (reads a clone, so the body stays available to useFormError); never throws. */
async function responseCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as { code?: unknown } | null;
    return typeof body?.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

/** True when a failed response carries the maker-checker `code`. Reads a clone, so the body stays available to useFormError; never throws. */
async function isMakerCheckerViolation(res: Response): Promise<boolean> {
  try {
    const body = (await res.clone().json()) as { code?: unknown } | null;
    return body?.code === "MAKER_CHECKER_VIOLATION";
  } catch {
    return false;
  }
}

export function PayrollRunActions({
  runId,
  status,
  employeeCount,
  grossMinor,
  netMinor,
  payPeriod,
  canAdminister = false,
  exceptionCount = 0,
  currentUserId = null,
  createdBy = null,
  approvedBy = null,
}: Props) {
  const t = useTranslations("payrollRunActions");
  const tr = useTranslations("payroll.runApproval");
  // T-STAT review SF7: when the server asks for a review (409 ZERO_BASIC_SLIPS /
  // ARREARS_REVIEW_REQUIRED) the approve dialog lists the items to exclude /
  // acknowledge, takes one review note, and re-sends the approval with them.
  const [review, setReview] = useState<ApprovalReview | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [reviewNote, setReviewNote] = useState("");
  const reviewNoteId = useId();
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
  const approveHintId = useId();
  const disburseHintId = useId();

  useEffect(() => {
    setSettledAction(null);
  }, [status]);

  const arrearsToAck = review ? review.arrears.employees.filter((e) => e.requiresReview) : [];

  function approveBody(reason?: string): Record<string, unknown> | null {
    if (!review) return { reason };
    const note = reviewNote.trim();
    const complete = note.length >= 10
      && review.zeroBasic.every((z) => excluded.has(z.employeeId))
      && arrearsToAck.every((e) => acknowledged.has(e.employeeId));
    if (!complete) return null;
    const zeroBasicExclusions = review.zeroBasic.map((z) => ({ employeeId: z.employeeId, reason: note }));
    const arrearsAcknowledgements = arrearsToAck.map((e) => ({ employeeId: e.employeeId, reason: note }));
    return {
      reason,
      ...(zeroBasicExclusions.length > 0 ? { zeroBasicExclusions } : {}),
      ...(arrearsAcknowledgements.length > 0 ? { arrearsAcknowledgements } : {}),
    };
  }

  async function runAction(action: "approve" | "disburse" | "revert", reason?: string) {
    let body: Record<string, unknown> = { reason };
    if (action === "approve") {
      const b = approveBody(reason);
      if (!b) { setError(tr("reviewIncomplete")); return; }
      body = b;
    }
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
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (action === "approve" && res.status === 409) {
          const code = await responseCode(res);
          if (code && APPROVAL_REVIEW_CODES.has(code)) {
            const loaded = await loadApprovalReview(runId);
            if (!loaded) { setError(tr("reviewLoadFailed")); return; }
            setReview(loaded);
            setError(tr("reviewNeededIntro"));
            return;
          }
        }
        // The shared catalogue words MAKER_CHECKER_VIOLATION as "needs approval from
        // someone other than the person who made it", which is right for approve but
        // wrong for disburse (the rule there is: the approver cannot disburse). Only
        // reachable when the hint above was bypassed or the page state was stale.
        if (action === "disburse" && res.status === 403 && (await isMakerCheckerViolation(res))) {
          setError(t("makerCheckerDisburseError"));
          return;
        }
        const resolved = await formError.fromResponse(res, "save");
        setError(resolved.message);
        return;
      }
      setMessageTone("good");
      setMessage(
        action === "approve"
          ? t("approvedMessage", { period: payPeriod })
          : action === "disburse"
            ? t("disbursementInitiatedMessage", { amount: formatMinorString(netMinor), count: employeeCount })
            : t("revertedMessage", { period: payPeriod }),
      );
      toast.success(
        action === "approve"
          ? t("approvedToast", { period: payPeriod })
          : action === "disburse"
            ? t("disbursementInitiatedToast", { amount: formatMinorString(netMinor) })
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

  // GAP-PAYROLL-DETAIL-02: maker-checker. Unknown ids (null) never block here;
  // the server enforces the same rule either way.
  const isMaker = currentUserId !== null && createdBy !== null && currentUserId === createdBy;
  const isApprover = currentUserId !== null && approvedBy !== null && currentUserId === approvedBy;
  const approveBlocked = canApprove && isMaker;
  const disburseBlocked = canDisburse && isApprover;

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
              disabled={approveBlocked}
              aria-describedby={approveBlocked ? approveHintId : undefined}
              onClick={() => { setError(undefined); setPending("approve"); }}
            >
              {t("approveRunBtn")}
            </Button>
          )}
          {canDisburse && (
            <Button
              style={{ minHeight: 44 }}
              disabled={disburseBlocked}
              aria-describedby={disburseBlocked ? disburseHintId : undefined}
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

        {approveBlocked && (
          <p id={approveHintId} role="note" className="pill warn" style={{ marginTop: 14 }}>
            {t("makerCheckerApproveHint")}
          </p>
        )}
        {disburseBlocked && (
          <p id={disburseHintId} role="note" className="pill warn" style={{ marginTop: 14 }}>
            {t("makerCheckerDisburseHint")}
          </p>
        )}

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
              amount: formatMinorString(grossMinor),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
            {exceptionCount > 0 && <p role="note" className="pill warn" style={{ margin: "10px 0 0" }}>{t("exceptionsWarning", { count: exceptionCount })}</p>}
            {review && (
              <div style={{ marginTop: 12 }}>
                {review.zeroBasic.length > 0 && (
                  <fieldset style={{ border: 0, padding: 0, margin: "0 0 10px" }}>
                    <legend><strong>{tr("zeroBasicHeading")}</strong></legend>
                    {review.zeroBasic.map((z) => (
                      <label key={z.employeeId} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
                        <input
                          type="checkbox"
                          checked={excluded.has(z.employeeId)}
                          onChange={(ev) => setExcluded((prev) => { const next = new Set(prev); if (ev.target.checked) next.add(z.employeeId); else next.delete(z.employeeId); return next; })}
                        />
                        {tr("zeroBasicExclude", { employee: z.employeeNo })}
                      </label>
                    ))}
                  </fieldset>
                )}
                {arrearsToAck.length > 0 && (
                  <fieldset style={{ border: 0, padding: 0, margin: "0 0 10px" }}>
                    <legend><strong>{tr("arrearsHeading")}</strong></legend>
                    {arrearsToAck.map((e) => (
                      <label key={e.employeeId} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
                        <input
                          type="checkbox"
                          checked={acknowledged.has(e.employeeId)}
                          onChange={(ev) => setAcknowledged((prev) => { const next = new Set(prev); if (ev.target.checked) next.add(e.employeeId); else next.delete(e.employeeId); return next; })}
                        />
                        {tr("arrearsAcknowledge", { amount: formatMinorString(e.arrearsMinor), employee: e.employeeNo })}
                      </label>
                    ))}
                  </fieldset>
                )}
                <label htmlFor={reviewNoteId} style={{ display: "block", fontWeight: 600 }}>{tr("reviewNoteLabel")}</label>
                <textarea
                  id={reviewNoteId}
                  value={reviewNote}
                  maxLength={500}
                  rows={2}
                  style={{ width: "100%" }}
                  onChange={(ev) => setReviewNote(ev.target.value)}
                />
              </div>
            )}
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
              amount: formatMinorString(netMinor),
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
