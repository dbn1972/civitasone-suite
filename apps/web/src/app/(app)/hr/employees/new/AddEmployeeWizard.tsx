"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

import { StepIndicator } from "./StepIndicator";
import { Step1 } from "./steps/Step1";
import { Step2 } from "./steps/Step2";
import { Step3 } from "./steps/Step3";
import { Step4 } from "./steps/Step4";
import { Step5 } from "./steps/Step5";

import {
  type WizardData,
  type FieldErrors,
  WIZARD_INIT,
  SESSION_KEY,
  ACCENT,
  primaryBtn,
  ghostBtn,
  cardStyle,
  validateStep,
  validateField,
} from "./wizardTypes";

type Dept = { id: string; name: string };
type Desig = { id: string; name: string };
type EmpSummary = { id: string; name: string; designationName?: string };

interface Props {
  departments: Dept[];
  designations: Desig[];
  managers?: EmpSummary[];
}

const STEP_LABELS = [
  "Personal Info",
  "Employment",
  "Assignment",
  "Statutory",
  "Review & Submit",
];

const TOTAL_STEPS = 5;

// ── Restore from sessionStorage safely ──────────────────────────────────────
function restoreDraft(): WizardData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardData>;
    // Merge with INIT so any new keys added after saving still get defaults
    return { ...WIZARD_INIT, ...parsed };
  } catch {
    return null;
  }
}

function saveDraft(data: WizardData) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    // storage quota exceeded — ignore silently
  }
}

function clearDraft() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

// ── Submission body helper ────────────────────────────────────────────────────
function buildPayload(data: WizardData): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const stringKeys: (keyof WizardData)[] = [
    "fullName", "dateOfBirth", "gender", "maritalStatus", "bloodGroup",
    "mobile", "email",
    "employeeNo", "departmentId", "designationId", "grade",
    "dateOfJoining", "employeeType",
    "managerId", "shift", "costCenter",
    "pan", "aadhaarRef", "bankAccountNo", "bankIfsc",
  ];
  for (const k of stringKeys) {
    const v = data[k];
    if (typeof v === "string" && v.trim() !== "") body[k] = v.trim();
  }
  // workLocation maps to the backend's `station` column/field (see
  // createEmployeeBody) -- sent under its real key so it actually persists,
  // instead of the "workLocation" key the API silently discards (HR-A finding).
  if (data.workLocation.trim() !== "") body.station = data.workLocation.trim();
  body.pfEnrolled = data.pfEnrolled;
  body.esiEnrolled = data.esiEnrolled;
  body.ptApplicable = data.ptApplicable;
  // NOTE: grade / shift / costCenter / maritalStatus / bloodGroup / pfEnrolled /
  // esiEnrolled / ptApplicable are collected above but have no corresponding field
  // in createEmployeeBody today, so the API silently strips them (unknown Zod
  // keys) -- same "collected but not persisted" defect class as workLocation was,
  // but each needs a real product/schema decision (new columns, or a different
  // module e.g. shift assignment) rather than a one-line key rename. Flagged as a
  // follow-up, out of scope for this fix.
  return body;
}

// ── Wizard component ─────────────────────────────────────────────────────────
export function AddEmployeeWizard({ departments, designations, managers }: Props) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>(WIZARD_INIT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ id: string } | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);

  // Restore draft once on mount
  useEffect(() => {
    const saved = restoreDraft();
    if (saved) {
      setData(saved);
      setDraftRestored(true);
    }
  }, []);

  // Save draft whenever data changes (after mount)
  useEffect(() => {
    saveDraft(data);
  }, [data]);

  const onChange = useCallback(
    <K extends keyof WizardData>(key: K, value: WizardData[K]) => {
      setData((prev) => {
        const next = { ...prev, [key]: value };
        return next;
      });
      // Clear any existing error for this field immediately on change
      setErrors((prev) => {
        if (!prev[key as string]) return prev;
        const next = { ...prev };
        delete next[key as string];
        return next;
      });
    },
    [],
  );

  const onBlur = useCallback(
    (field: keyof WizardData) => {
      const fieldErr = validateField(field, data);
      setErrors((prev) => {
        if (!fieldErr && !prev[field as string]) return prev;
        if (!fieldErr) {
          const next = { ...prev };
          delete next[field as string];
          return next;
        }
        return { ...prev, [field as string]: fieldErr };
      });
    },
    [data],
  );

  function goToStep(target: number) {
    setGlobalError(null);
    setErrors({});
    setStep(target);
  }

  function handleNext() {
    const stepErrors = validateStep(step, data);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      setGlobalError("Please fix the highlighted fields before continuing.");
      return;
    }
    setErrors({});
    setGlobalError(null);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  function handleBack() {
    setErrors({});
    setGlobalError(null);
    setStep((s) => Math.max(s - 1, 1));
  }

  async function handleSubmit() {
    // Final validation pass across all steps
    const allErrors: FieldErrors = {
      ...validateStep(1, data),
      ...validateStep(2, data),
      ...validateStep(4, data),
    };
    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      setGlobalError("Some required fields are missing. Please use the Edit links above to correct them.");
      return;
    }

    setGlobalError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/proxy/v1/hrms/employees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPayload(data)),
      });

      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const j = await res.json();
          if (typeof j === "object" && j !== null && "message" in j) {
            msg = String((j as Record<string, unknown>).message);
          }
        } catch {
          // ignore parse errors
        }
        throw new Error(msg);
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await res.json();
      const id =
        typeof result === "object" &&
        result !== null &&
        "id" in result &&
        typeof (result as Record<string, unknown>).id === "string"
          ? ((result as Record<string, unknown>).id as string)
          : "unknown";

      clearDraft();
      setSuccess({ id });
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : "Network error. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success screen ──────────────────────────────────────────────────────────
  if (success) {
    return (
      <div
        style={{
          padding: 24,
          background: "#dcfce7",
          border: "1px solid #86efac",
          borderRadius: 8,
          color: "#166534",
          maxWidth: 520,
        }}
      >
        <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>
          Employee record created successfully!
        </p>
        <p style={{ margin: "8px 0 16px", fontSize: 14 }}>
          Employee ID: <strong>{success.id}</strong>
        </p>
        <Link
          href="/hr/employees"
          style={{ color: ACCENT, fontWeight: 600, fontSize: 14, textDecoration: "none" }}
        >
          ← View Employee Directory
        </Link>
      </div>
    );
  }

  // ── Wizard body ─────────────────────────────────────────────────────────────
  const isLastStep = step === TOTAL_STEPS;

  return (
    <div style={{ maxWidth: 860 }}>
      {/* Draft restored notice */}
      {draftRestored && (
        <div
          role="status"
          style={{
            padding: "8px 14px",
            marginBottom: 16,
            borderRadius: 8,
            fontSize: 13,
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            color: "#1e40af",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Your in-progress draft has been restored.</span>
          <button
            type="button"
            onClick={() => {
              setData(WIZARD_INIT);
              clearDraft();
              setDraftRestored(false);
            }}
            style={{
              background: "none",
              border: "none",
              color: "#1e40af",
              fontSize: 12,
              cursor: "pointer",
              textDecoration: "underline",
              padding: 0,
            }}
          >
            Clear &amp; start fresh
          </button>
        </div>
      )}

      {/* Step indicator */}
      <StepIndicator steps={STEP_LABELS} current={step} />

      {/* Global error */}
      {globalError && (
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            marginBottom: 16,
            borderRadius: 8,
            fontSize: 14,
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            color: "#b91c1c",
          }}
        >
          {globalError}
        </div>
      )}

      {/* Step card */}
      <div style={cardStyle}>
        {step === 1 && (
          <Step1 data={data} errors={errors} onChange={onChange} onBlur={onBlur} />
        )}
        {step === 2 && (
          <Step2
            data={data}
            errors={errors}
            departments={departments}
            designations={designations}
            onChange={onChange}
            onBlur={onBlur}
          />
        )}
        {step === 3 && (
          <Step3
            data={data}
            errors={errors}
            managers={managers}
            onChange={onChange}
            onBlur={onBlur}
          />
        )}
        {step === 4 && (
          <Step4 data={data} errors={errors} onChange={onChange} onBlur={onBlur} />
        )}
        {step === 5 && (
          <Step5
            data={data}
            departments={departments}
            designations={designations}
            submitting={submitting}
            onGoToStep={goToStep}
          />
        )}
      </div>

      {/* Navigation */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 20,
          justifyContent: step === 1 ? "flex-end" : "space-between",
          alignItems: "center",
        }}
      >
        {step > 1 && (
          <button type="button" onClick={handleBack} style={ghostBtn} disabled={submitting}>
            ← Back
          </button>
        )}

        {/* Step counter */}
        <span
          style={{
            fontSize: 12,
            color: "#94a3b8",
            flexGrow: 1,
            textAlign: "center",
          }}
        >
          Step {step} of {TOTAL_STEPS}
        </span>

        {!isLastStep ? (
          <button type="button" onClick={handleNext} style={primaryBtn}>
            Next →
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { void handleSubmit(); }}
            disabled={submitting}
            aria-busy={submitting}
            style={{
              ...primaryBtn,
              opacity: submitting ? 0.72 : 1,
              cursor: submitting ? "wait" : "pointer",
              minWidth: 200,
            }}
          >
            {submitting ? "Creating…" : "Create Employee Record"}
          </button>
        )}
      </div>
    </div>
  );
}
