"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FormRenderer } from "@/app/_components/ds/designer/FormRenderer";
import type { FormDesignState } from "@/app/_components/ds/designer/formTypes";
import { ErrorState } from "@/app/_components/ds";
import {
  type PublishedServiceRuntime,
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
  const activeIdx = Math.max(0, steps.findIndex((s) => s.id === active));
  return (
    <nav aria-label="Application steps" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
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
              background: done ? "var(--good-bg)" : current ? "var(--primary-soft, var(--info-bg))" : "var(--panel)",
              color: done ? "var(--good-fg)" : current ? "var(--ink)" : "var(--mut)",
            }}
          >
            {idx + 1}. {step.label}
          </span>
        );
      })}
    </nav>
  );
}

export function ServiceRuntimeFlow({ service, counterMode = false, assistedBy = null }: ServiceRuntimeFlowProps) {
  const design = service.formDesign;
  const hasFee = service.feeFromMinor != null;
  const journey = useMemo(() => journeyStepsForService(hasFee), [hasFee]);
  const [step, setStep] = useState<RuntimeJourneyStep>("form");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftId, setDraftId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [trackingNo, setTrackingNo] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channel = counterMode ? "counter" : "portal";
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
    if (step !== "form" || Object.keys(values).length === 0) return;
    const t = setTimeout(() => { void autosave(values, draftId); }, 800);
    return () => clearTimeout(t);
  }, [values, draftId, step, autosave]);

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
        });
        setDraftId(id);
      } else {
        await updateDraft(id, values);
      }
      const ack = await submitDraft(id);
      // FN-14 — fee-bearing packs: labelled sandbox capture → receipt → GL when
      // no live gateway key is configured (pilot / Test Run path).
      if (service.feeFromMinor != null && ack.applicationId) {
        try {
          const paymentId = await createPaymentIntent({
            applicationId: ack.applicationId,
            serviceId: service.id,
            subject: values,
          });
          await confirmPayment(paymentId, "sandbox");
        } catch {
          /* payment is best-effort after submit; tracking still succeeds */
        }
      }
      setTrackingNo(ack.trackingNo);
      setSubmittedAt(new Date());
      setStep("submitted");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "We could not submit your application. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
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

  if (!design) {
    return (
      <ErrorState
        error={{
          what: "Form not available",
          next: "This service does not yet have a published application form. Try again later or ask at the counter.",
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
            background: "var(--info-bg)",
            border: "1px solid var(--info-border)",
            borderRadius: "var(--r-sm)",
            fontSize: 13,
          }}
          role="status"
        >
          Counter mode — assisting applicant
          {assistedBy ? ` (operator ${assistedBy.slice(0, 8)}…)` : ""}
        </div>
      ) : null}

      <JourneyRail steps={journey} active={step} />

      {step === "form" ? (
        <>
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
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved just now" : saveState === "error" ? "Offline — retrying" : ""}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              {sectionIndex > 0 ? (
                <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setSectionIndex((i) => i - 1)}>
                  Back
                </button>
              ) : null}
              <button type="button" className="btn primary" style={{ minHeight: 44 }} onClick={onNextSection}>
                {sectionIndex < visibleSectionCount - 1 ? "Next section" : "Review answers"}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {step === "review" ? (
        <ReviewPanel
          design={design}
          values={values}
          continueLabel={hasFee ? "Continue to fee" : "Submit application"}
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
          <h3 style={{ margin: 0 }}>Fee summary</h3>
          <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
            Review the demand lines below. For Test runs, sandbox capture posts a receipt and GL journal when no live
            gateway key is configured. Counter/offline payments remain available to officers; otherwise you may also
            receive a payment link or counter slip when the office raises the demand.
          </p>
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
              background: "var(--info-bg)",
              border: "1px solid var(--info-border)",
              fontSize: 13,
            }}
          >
            <strong>How you can pay</strong>
            <span>Counter / CSC — pay at the desk when asked.</span>
            <span>Online — SMS or WhatsApp payment link after the office raises the demand.</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setStep("review")}>Back</button>
            <button type="button" className="btn primary" style={{ minHeight: 44 }} disabled={busy} onClick={() => void onSubmit()}>
              {busy ? "Submitting…" : "Pay (sandbox) & submit"}
            </button>
          </div>
          {error ? <p role="alert" style={{ color: "var(--bad-fg)", fontSize: 13, margin: 0 }}>{error}</p> : null}
        </div>
      ) : null}

      {step === "submitted" && trackingNo ? (
        <div className="card pad" style={{ textAlign: "center", display: "grid", gap: 14 }}>
          <p style={{ margin: 0, fontSize: 14, color: "var(--good-fg)", fontWeight: 600 }}>Application submitted</p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>Your tracking number</p>
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
          <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => void copyTracking()}>
            {copied ? "Copied" : "Copy tracking number"}
          </button>
          {expectedBy ? (
            <p style={{ margin: 0, fontSize: 14 }}>
              Expected decision by <strong>{expectedBy}</strong>
              {service.slaDays ? (
                <span style={{ display: "block", fontSize: 12, color: "var(--mut)", marginTop: 4 }}>
                  ({service.slaDays} working days from today)
                </span>
              ) : null}
            </p>
          ) : null}
          <Link
            href={`/citizen/services/${service.serviceKey}/track/${encodeURIComponent(trackingNo)}`}
            className="btn primary"
            style={{ minHeight: 44 }}
          >
            Track status
          </Link>
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
  return (
    <div className="card pad" style={{ display: "grid", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Review your answers</h3>
      {design.sections.map((sec, idx) => (
        <div key={sec.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <strong>{sec.label}</strong>
            <button type="button" className="btn ghost" style={{ minHeight: 36 }} onClick={() => onEditSection(idx)}>
              Edit
            </button>
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
      <button type="button" className="btn primary" style={{ minHeight: 44 }} disabled={busy} onClick={onContinue}>
        {busy ? "Submitting…" : continueLabel}
      </button>
      {error ? <p role="alert" style={{ color: "var(--bad-fg)", fontSize: 13, margin: 0 }}>{error}</p> : null}
    </div>
  );
}
