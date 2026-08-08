"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FormRenderer } from "@/app/_components/ds/designer/FormRenderer";
import type { FormDesignState } from "@/app/_components/ds/designer/formTypes";
import { ErrorState } from "@/app/_components/ds";
import {
  type PublishedServiceRuntime,
  confirmPayment,
  createPaymentIntent,
  formatFee,
  listDraftsForService,
  saveDraft,
  submitDraft,
  updateDraft,
  validateField,
} from "../_data/runtimeApi";

type FlowStep = "form" | "review" | "fee" | "submitted";

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

export function ServiceRuntimeFlow({ service, counterMode = false, assistedBy = null }: ServiceRuntimeFlowProps) {
  const design = service.formDesign;
  const [step, setStep] = useState<FlowStep>("form");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftId, setDraftId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [trackingNo, setTrackingNo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channel = counterMode ? "counter" : "portal";

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
      setStep("submitted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!design) {
    return (
      <ErrorState
        error={{
          what: "Form not available",
          next: "This service does not yet have a published application form. The department is still configuring it.",
          actions: ["back"],
        }}
        backHref={`/citizen/catalogue`}
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: counterMode ? 960 : 640, margin: "0 auto" }}>
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
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Offline — retrying" : ""}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              {sectionIndex > 0 ? (
                <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setSectionIndex((i) => i - 1)}>
                  Back
                </button>
              ) : null}
              <button type="button" className="btn primary" style={{ minHeight: 44 }} onClick={onNextSection}>
                {sectionIndex < visibleSectionCount - 1 ? "Next section" : "Review"}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {step === "review" ? (
        <ReviewPanel
          design={design}
          values={values}
          onEditSection={(idx) => { setSectionIndex(idx); setStep("form"); }}
          onContinue={() => {
            if (service.feeFromMinor != null) setStep("fee");
            else void onSubmit();
          }}
        />
      ) : null}

      {step === "fee" ? (
        <div className="card pad" style={{ display: "grid", gap: 12 }}>
          <h3 style={{ margin: 0 }}>Fee & payment</h3>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>Application fee — {formatFee(service.feeFromMinor, service.feeCurrency)}</li>
            <li>Inspection fee — included (stub)</li>
          </ul>
          <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
            Sandbox capture posts a receipt and GL journal for Test runs when no live gateway key is configured. Counter/offline payments remain available to officers.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setStep("review")}>Back</button>
            <button type="button" className="btn primary" style={{ minHeight: 44 }} disabled={busy} onClick={onSubmit}>
              {busy ? "Submitting…" : "Pay (sandbox) & submit"}
            </button>
          </div>
          {error ? <p role="alert" style={{ color: "var(--bad-fg)", fontSize: 13 }}>{error}</p> : null}
        </div>
      ) : null}

      {step === "submitted" && trackingNo ? (
        <div className="card pad" style={{ textAlign: "center", display: "grid", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 14, color: "var(--mut)" }}>Application submitted</p>
          <p style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: 1 }}>{trackingNo}</p>
          <button
            type="button"
            className="btn"
            style={{ minHeight: 44 }}
            onClick={() => navigator.clipboard?.writeText(trackingNo)}
          >
            Copy tracking number
          </button>
          {service.slaDays ? (
            <p style={{ margin: 0, fontSize: 13 }}>Expected by {service.slaDays} working days</p>
          ) : null}
          <Link href={`/citizen/services/${service.serviceKey}/track/${encodeURIComponent(trackingNo)}`} className="btn primary" style={{ minHeight: 44 }}>
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
}: {
  design: FormDesignState;
  values: Record<string, string>;
  onEditSection: (idx: number) => void;
  onContinue: () => void;
}) {
  return (
    <div className="card pad" style={{ display: "grid", gap: 16 }}>
      <h3 style={{ margin: 0 }}>Review your answers</h3>
      {design.sections.map((sec, idx) => (
        <div key={sec.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
      <button type="button" className="btn primary" style={{ minHeight: 44 }} onClick={onContinue}>
        Continue to fee
      </button>
    </div>
  );
}
