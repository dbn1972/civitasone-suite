"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { FormRenderer } from "@/app/_components/ds/designer/FormRenderer";
import type { FormDesignState } from "@/app/_components/ds/designer/formTypes";
import { ErrorState, Button } from "@/app/_components/ds";
import {
  type PublishedServiceRuntime,
  channelDisabledMessage,
  isChannelAllowed,
  type RuntimeJourneyStep,
  buildDemandLines,
  confirmPayment,
  createPaymentIntent,
  formatExpectedByDate,
  journeyStepsForService,
  listDraftsForService,
  saveDraft,
  submitDraft,
  updateDraft,
  validateField,
} from "../_data/runtimeApi";

export interface ServiceRuntimeFlowProps {
  service: PublishedServiceRuntime;
  counterMode?: boolean;
  assistedBy?: string | null;
  /** GAP-...-APPLY-02: server-provided payment mode. 'sandbox' shows a TEST
   *  MODE badge and the sandbox note; 'gateway' hides test wording. */
  paymentMode?: "sandbox" | "gateway";
}

function valuesFromDraft(formData: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(formData)) {
    if (typeof v === "string") out[k] = v;
    else if (v != null) out[k] = String(v);
  }
  return out;
}

function JourneyRail({
  steps,
  active,
}: {
  steps: { id: RuntimeJourneyStep; label: string }[];
  active: RuntimeJourneyStep;
}) {
  const t = useTranslations("citizenServices");
  const activeIdx = Math.max(0, steps.findIndex((s) => s.id === active));
  const labelFor = (id: RuntimeJourneyStep): string =>
    id === "form" ? t("journeyForm")
      : id === "review" ? t("journeyReview")
        : id === "fee" ? t("journeyFee")
          : t("journeyDone");
  return (
    <nav aria-label={t("applicationSteps")} style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {steps.map((step, idx) => {
        const done = idx < activeIdx;
        const current = idx === activeIdx;
        return (
          <span
            key={step.id}
            aria-current={current ? "step" : undefined}
            style={{
              flex: "1 1 64px",
              textAlign: "center",
              fontSize: 12,
              fontWeight: current ? 700 : 500,
              padding: "8px 6px",
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--r-sm)",
              border: `1px solid ${current ? "var(--primary)" : "var(--line)"}`,
              background: done ? "var(--goodbg)" : current ? "var(--primary-soft, var(--infobg))" : "var(--panel)",
              color: done ? "var(--good)" : current ? "var(--ink)" : "var(--mut)",
            }}
          >
            {idx + 1}. {labelFor(step.id)}
          </span>
        );
      })}
    </nav>
  );
}

export function ServiceRuntimeFlow({ service, counterMode = false, assistedBy = null, paymentMode = "sandbox" }: ServiceRuntimeFlowProps) {
  const t = useTranslations("citizenServices");
  const design = service.formDesign;
  const hasFee = service.feeFromMinor != null;
  const journey = useMemo(() => journeyStepsForService(hasFee), [hasFee]);
  const [step, setStep] = useState("form" as RuntimeJourneyStep);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [values, setValues] = useState({} as Record<string, string>);
  const [errors, setErrors] = useState({} as Record<string, string>);
  const [draftId, setDraftId] = useState(null as string | null);
  const [saveState, setSaveState] = useState("idle" as "idle" | "saving" | "saved" | "error");
  const [trackingNo, setTrackingNo] = useState(null as string | null);
  const [applicationId, setApplicationId] = useState("");
  const [paymentState, setPaymentState] = useState(null as "paid" | "failed" | "skipped" | "retrying" | null);
  const [submittedAt, setSubmittedAt] = useState(null as Date | null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null as string | null);
  // GAP-...-APPLY-05 (DPDP): do not persist partial personal data until the
  // applicant has acknowledged the save-as-draft purpose notice. Resuming an
  // existing draft implies prior consent, so it is pre-acknowledged then.
  const [consented, setConsented] = useState(false);

  const channel = counterMode ? "counter" : "portal";
  const channelOk = isChannelAllowed(service.channels, channel);
  const demandLines = useMemo(() => buildDemandLines(service), [service]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const drafts = await listDraftsForService(service.id);
        const latest = drafts[0];
        if (!cancelled && latest) {
          setDraftId(latest.id);
          setValues(valuesFromDraft(latest.formData));
          setConsented(true); // resuming an existing draft implies prior consent
        }
      } catch {
        /* resume optional */
      }
    })();
    return () => { cancelled = true; };
  }, [service.id]);

  const visibleSectionCount = useMemo(() => {
    if (!design) return 0;
    return design.sections.length;
  }, [design]);

  const autosave = useCallback(
    async (nextValues: Record<string, string>, id: string | null) => {
      setSaveState("saving");
      try {
        if (id) {
          await updateDraft(id, nextValues);
        } else {
          const newId = await saveDraft({
            serviceId: service.id,
            serviceKey: service.serviceKey,
            channel,
            formData: nextValues,
            ...(counterMode && assistedBy ? { operatorId: assistedBy } : {}),
          });
          setDraftId(newId);
        }
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    },
    [service.id, service.serviceKey, channel, counterMode, assistedBy],
  );

  useEffect(() => {
    if (step !== "form" || !consented || Object.keys(values).length === 0) return;
    const t = setTimeout(() => { void autosave(values, draftId); }, 800);
    return () => clearTimeout(t);
  }, [values, draftId, step, autosave, consented]);

  const validateSection = (): boolean => {
    if (!design) return false;
    const section = design.sections[sectionIndex];
    const nextErrors: Record<string, string> = {};
    for (const fid of section?.fieldIds ?? []) {
      const field = design.fields[fid];
      if (!field) continue;
      const err = validateField(field.apiName, values[field.apiName] ?? "", field.required);
      if (err) nextErrors[field.apiName] = err;
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const validateAll = (): boolean => {
    if (!design) return false;
    const nextErrors: Record<string, string> = {};
    for (const field of Object.values(design.fields)) {
      const err = validateField(field.apiName, values[field.apiName] ?? "", field.required);
      if (err) nextErrors[field.apiName] = err;
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const onNextSection = () => {
    if (!validateSection()) return;
    if (sectionIndex < visibleSectionCount - 1) setSectionIndex((i) => i + 1);
    else setStep("review");
  };

  const onSubmit = async () => {
    if (!validateAll()) { setStep("form"); return; }
    setBusy(true);
    setError(null);
    try {
      let id = draftId;
      if (!id) {
        id = await saveDraft({
          serviceId: service.id,
          serviceKey: service.serviceKey,
          channel,
          formData: values,
          ...(counterMode && assistedBy ? { operatorId: assistedBy } : {}),
        });
        setDraftId(id);
      } else {
        await updateDraft(id, values);
      }
      const ack = await submitDraft(id);
      setApplicationId(ack.applicationId);
      // FN-14 — fee-bearing packs: capture payment via the configured mode.
      // GAP-...-APPLY-01: do NOT swallow a payment failure — record the outcome
      // and surface it on the submitted screen so a citizen is never told
      // "submitted" (implying paid) when payment did not complete.
      if (service.feeFromMinor != null) {
        if (ack.applicationId) {
          try {
            const paymentId = await createPaymentIntent({
              applicationId: ack.applicationId,
              serviceId: service.id,
              subject: values,
            });
            await confirmPayment(paymentId, paymentMode);
            setPaymentState("paid");
          } catch {
            // telemetry only — never console.log, never log PII
            setPaymentState("failed");
          }
        } else {
          // tracking/applicationId not yet issued — payment cannot be attempted
          setPaymentState("skipped");
        }
      }
      setTrackingNo(ack.trackingNo);
      setSubmittedAt(new Date());
      setStep("submitted");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("submitFailed"));
    } finally {
      setBusy(false);
    }
  };

  // GAP-...-APPLY-01: retry payment for an already-submitted fee-bearing application.
  const payNow = async () => {
    if (!applicationId) return;
    setPaymentState("retrying");
    try {
      const paymentId = await createPaymentIntent({ applicationId, serviceId: service.id, subject: values });
      await confirmPayment(paymentId, paymentMode);
      setPaymentState("paid");
    } catch {
      setPaymentState("failed");
    }
  };

  const copyTracking = async () => {
    if (!trackingNo) return;
    try {
      await navigator.clipboard?.writeText(trackingNo);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  if (!channelOk) {
    return (
      <ErrorState
        error={{
          what: t("channelNotAvailableTitle"),
          next: channelDisabledMessage(channel, service.channels),
          actions: ["back"],
        }}
        backHref={`/citizen/services/${service.serviceKey}`}
      />
    );
  }

  if (!design) {
    return (
      <ErrorState
        error={{
          what: t("formNotAvailableTitle"),
          next: t("formNotAvailableNext"),
          actions: ["back"],
        }}
        backHref="/citizen/catalogue"
      />
    );
  }

  const expectedBy = formatExpectedByDate(service.slaDays, submittedAt ?? new Date());

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: counterMode ? 960 : 640, margin: "0 auto", width: "100%" }}>
      {counterMode ? (
        <div
          className="pad"
          style={{
            background: "var(--infobg)",
            border: "1px solid var(--infobd)",
            borderRadius: "var(--r-sm)",
            fontSize: 13,
          }}
          role="status"
        >
          {t("counterModeNotice")}
          {assistedBy ? ` (operator ${assistedBy.slice(0, 8)}…)` : ""}
        </div>
      ) : null}

      <JourneyRail steps={journey} active={step} />

      {step === "form" ? (
        <>
          {!consented ? (
            <div
              className="pad"
              style={{
                background: "var(--infobg)",
                border: "1px solid var(--infobd)",
                borderRadius: "var(--r-sm)",
                fontSize: 13,
                display: "grid",
                gap: 8,
              }}
            >
              <strong>{t("consentTitle")}</strong>
              <span>{t("consentNotice")}</span>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", minHeight: 44 }}>
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={(e) => setConsented(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>{t("consentCheckbox")}</span>
              </label>
            </div>
          ) : null}
          <FormRenderer
            design={design}
            showRuntimeNote={false}
            mode="stepped"
            values={values}
            onChange={setValues}
            activeSectionIndex={sectionIndex}
            onSectionChange={setSectionIndex}
            errors={errors}
            onFieldBlur={(apiName) => {
              const field = Object.values(design.fields).find((f) => f.apiName === apiName);
              if (!field) return;
              const err = validateField(apiName, values[apiName] ?? "", field.required);
              setErrors((prev) => {
                const next = { ...prev };
                if (err) next[apiName] = err;
                else delete next[apiName];
                return next;
              });
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--mut)" }} aria-live="polite">
              {saveState === "saving" ? t("saving") : saveState === "saved" ? t("savedJustNow") : saveState === "error" ? t("offlineRetrying") : ""}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              {sectionIndex > 0 ? (
                <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={() => setSectionIndex((i) => i - 1)}>
                  {t("back")}
                </Button>
              ) : null}
              <Button type="button" variant="primary" style={{ minHeight: 44 }} onClick={onNextSection}>
                {sectionIndex < visibleSectionCount - 1 ? t("nextSection") : t("reviewAnswers")}
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {step === "review" ? (
        <ReviewPanel
          design={design}
          values={values}
          continueLabel={hasFee ? t("continueToFee") : t("submitApplicationButton")}
          onEditSection={(idx) => { setSectionIndex(idx); setStep("form"); }}
          onContinue={() => {
            if (hasFee) setStep("fee");
            else void onSubmit();
          }}
          busy={busy}
          error={error}
        />
      ) : null}

      {step === "fee" ? (
        <div className="card pad" style={{ display: "grid", gap: 14 }}>
          <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            {t("feeSummaryTitle")}
            {paymentMode === "sandbox" ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--warn)",
                  background: "var(--warnbg)",
                  border: "1px solid var(--warnbd)",
                  padding: "2px 8px",
                  borderRadius: 4,
                }}
              >
                {t("testModeBadge")}
              </span>
            ) : null}
          </h3>
          {paymentMode === "sandbox" ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
              {t("feeSummaryNote")}
            </p>
          ) : null}
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
            {demandLines.map((line) => (
              <li
                key={line.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: "var(--r-sm)",
                  border: "1px solid var(--line)",
                  background: "var(--bg)",
                  fontSize: 14,
                  minHeight: 44,
                  alignItems: "center",
                }}
              >
                <span>{line.label}</span>
                <strong>{line.amountLabel}</strong>
              </li>
            ))}
          </ul>
          <div
            style={{
              display: "grid",
              gap: 8,
              padding: 12,
              borderRadius: "var(--r-sm)",
              background: "var(--infobg)",
              border: "1px solid var(--infobd)",
              fontSize: 13,
            }}
          >
            <strong>{t("howYouCanPay")}</strong>
            <span>{t("payCounter")}</span>
            <span>{t("payOnline")}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={() => setStep("review")}>{t("back")}</Button>
            <Button type="button" variant="primary" style={{ minHeight: 44 }} disabled={busy} onClick={() => void onSubmit()}>
              {busy ? t("submitting") : paymentMode === "sandbox" ? t("paySandboxAndSubmit") : t("payAndSubmit")}
            </Button>
          </div>
          {error ? <p role="alert" style={{ color: "var(--bad)", fontSize: 13, margin: 0 }}>{error}</p> : null}
        </div>
      ) : null}

      {step === "submitted" ? (
        <div className="card pad" style={{ textAlign: "center", display: "grid", gap: 14 }}>
          {/* GAP-...-APPLY-01: do not imply "paid" when payment failed/was skipped. */}
          <p style={{ margin: 0, fontSize: 14, color: "var(--good)", fontWeight: 600 }}>
            {paymentState === "failed" || paymentState === "skipped"
              ? t("submittedPaymentPendingTitle")
              : t("applicationSubmitted")}
          </p>

          {/* GAP-...-APPLY-03: null tracking -> pending state, no copy/track link. */}
          {trackingNo ? (
            <>
              <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{t("yourTrackingNumber")}</p>
              <p
                style={{
                  margin: 0,
                  fontSize: 28,
                  fontWeight: 700,
                  letterSpacing: 1,
                  wordBreak: "break-all",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {trackingNo}
              </p>
              <Button type="button" variant="primary" style={{ minHeight: 44 }} onClick={() => void copyTracking()}>
                {copied ? t("copied") : t("copyTrackingNumber")}
              </Button>
            </>
          ) : (
            <div role="status" style={{ display: "grid", gap: 6 }}>
              <strong style={{ fontSize: 16 }}>{t("trackingPendingTitle")}</strong>
              <span style={{ fontSize: 13, color: "var(--mut)" }}>{t("trackingPendingMessage")}</span>
            </div>
          )}

          {/* GAP-...-APPLY-01: payment status + retry when a fee-bearing payment did not complete. */}
          {hasFee && (paymentState === "failed" || paymentState === "skipped" || paymentState === "retrying") ? (
            <div
              role="alert"
              style={{
                display: "grid",
                gap: 8,
                padding: 12,
                borderRadius: "var(--r-sm)",
                background: "var(--warnbg)",
                border: "1px solid var(--warnbd)",
                fontSize: 13,
              }}
            >
              <span>{paymentState === "retrying" ? t("paymentRetrying") : t("paymentNotCompleted")}</span>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <Button
                  type="button"
                  variant="primary"
                  style={{ minHeight: 44 }}
                  disabled={paymentState === "retrying" || !applicationId}
                  onClick={() => void payNow()}
                >
                  {t("payNow")}
                </Button>
                <span style={{ fontSize: 12, color: "var(--mut)", alignSelf: "center" }}>{t("payCounter")}</span>
              </div>
            </div>
          ) : null}

          {expectedBy ? (
            <p style={{ margin: 0, fontSize: 14 }}>
              {t("expectedDecisionBy", { date: expectedBy })}
              {service.slaDays ? (
                <span style={{ display: "block", fontSize: 12, color: "var(--mut)", marginTop: 4 }}>
                  {t("workingDaysFromToday", { days: service.slaDays })}
                </span>
              ) : null}
            </p>
          ) : null}
          {trackingNo ? (
            <Link
              href={`/citizen/services/${service.serviceKey}/track/${encodeURIComponent(trackingNo)}`}
              className="btn primary"
              style={{ minHeight: 44 }}
            >
              {t("trackStatus")}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ReviewPanel({
  design,
  values,
  onEditSection,
  onContinue,
  continueLabel,
  busy,
  error,
}: {
  design: FormDesignState;
  values: Record<string, string>;
  onEditSection: (idx: number) => void;
  onContinue: () => void;
  continueLabel: string;
  busy: boolean;
  error: string | null;
}) {
  const t = useTranslations("citizenServices");
  return (
    <div className="card pad" style={{ display: "grid", gap: 16 }}>
      <h3 style={{ margin: 0 }}>{t("reviewYourAnswers")}</h3>
      {design.sections.map((sec, idx) => (
        <div key={sec.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <strong>{sec.label}</strong>
            <Button type="button" variant="ghost" style={{ minHeight: 36 }} onClick={() => onEditSection(idx)}>
              {t("edit")}
            </Button>
          </div>
          <dl style={{ margin: "8px 0 0", display: "grid", gap: 6 }}>
            {sec.fieldIds.map((fid) => {
              const f = design.fields[fid];
              if (!f) return null;
              return (
                <div key={fid}>
                  <dt style={{ fontSize: 12, color: "var(--mut)" }}>{f.label}</dt>
                  <dd style={{ margin: 0 }}>{values[f.apiName] || "—"}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
      <Button type="button" variant="primary" style={{ minHeight: 44 }} disabled={busy} onClick={onContinue}>
        {busy ? t("submitting") : continueLabel}
      </Button>
      {error ? <p role="alert" style={{ color: "var(--bad)", fontSize: 13, margin: 0 }}>{error}</p> : null}
    </div>
  );
}
