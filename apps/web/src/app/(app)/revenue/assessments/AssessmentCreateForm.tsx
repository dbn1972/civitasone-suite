"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

const FY_PATTERN = /^\d{4}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FieldErrors = {
  assesseeId?: string;
  rateHeadId?: string;
  financialYear?: string;
  baseValue?: string;
};

function rupeesToPaiseString(val: string): string {
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.round(n * 100).toString();
}

export function AssessmentCreateForm() {
  const router = useRouter();

  const [assesseeId, setAssesseeId] = useState("");
  const [rateHeadId, setRateHeadId] = useState("");
  const [financialYear, setFinancialYear] = useState("");
  const [baseValue, setBaseValue] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const assesseeIdField = useId();
  const rateHeadIdField = useId();
  const fyField = useId();
  const baseValueField = useId();
  const assesseeErrId = useId();
  const rateHeadErrId = useId();
  const fyErrId = useId();
  const baseValueErrId = useId();

  const assesseeRef = useRef<HTMLInputElement>(null);
  const rateHeadRef = useRef<HTMLInputElement>(null);
  const fyRef = useRef<HTMLInputElement>(null);
  const baseValueRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!UUID_PATTERN.test(assesseeId.trim())) next.assesseeId = "Enter a valid assessee ID (UUID).";
    if (!UUID_PATTERN.test(rateHeadId.trim())) next.rateHeadId = "Enter a valid rate head ID (UUID).";
    if (!FY_PATTERN.test(financialYear.trim())) next.financialYear = "Financial year must be in YYYY-YY format, e.g. 2026-27.";
    if (!baseValue.trim() || Number.isNaN(parseFloat(baseValue)) || parseFloat(baseValue) < 0) {
      next.baseValue = "Enter a valid non-negative base value (₹).";
    }
    setErrors(next);
    if (next.assesseeId) { assesseeRef.current?.focus(); return false; }
    if (next.rateHeadId) { rateHeadRef.current?.focus(); return false; }
    if (next.financialYear) { fyRef.current?.focus(); return false; }
    if (next.baseValue) { baseValueRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createAssessment() {
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson<{ status: string }>("v1/revenue/assessments", {
        method: "POST",
        body: JSON.stringify({
          assesseeId: assesseeId.trim(),
          rateHeadId: rateHeadId.trim(),
          financialYear: financialYear.trim(),
          baseValue: rupeesToPaiseString(baseValue),
        }),
      });
      setConfirmOpen(false);
      setMessage(`Assessment for FY ${financialYear.trim()} submitted — a demand will be raised.`);
      setAssesseeId("");
      setRateHeadId("");
      setFinancialYear("");
      setBaseValue("");
      setErrors({});
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Create Assessment" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={assesseeIdField} style={{ fontSize: 13, fontWeight: 600 }}>
                Assessee ID <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={assesseeIdField}
                ref={assesseeRef}
                value={assesseeId}
                onChange={(e) => setAssesseeId(e.target.value)}
                placeholder="UUID from the Assessee Register"
                aria-required="true"
                aria-invalid={!!errors.assesseeId || undefined}
                aria-describedby={errors.assesseeId ? assesseeErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.assesseeId && <p id={assesseeErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.assesseeId}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={rateHeadIdField} style={{ fontSize: 13, fontWeight: 600 }}>
                Rate Head ID <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={rateHeadIdField}
                ref={rateHeadRef}
                value={rateHeadId}
                onChange={(e) => setRateHeadId(e.target.value)}
                placeholder="UUID for the applicable rate head"
                aria-required="true"
                aria-invalid={!!errors.rateHeadId || undefined}
                aria-describedby={errors.rateHeadId ? rateHeadErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.rateHeadId && <p id={rateHeadErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.rateHeadId}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fyField} style={{ fontSize: 13, fontWeight: 600 }}>
                Financial Year <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={fyField}
                ref={fyRef}
                value={financialYear}
                onChange={(e) => setFinancialYear(e.target.value)}
                placeholder="2026-27"
                maxLength={9}
                aria-required="true"
                aria-invalid={!!errors.financialYear || undefined}
                aria-describedby={errors.financialYear ? fyErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.financialYear && <p id={fyErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.financialYear}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={baseValueField} style={{ fontSize: 13, fontWeight: 600 }}>
                Base Value (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={baseValueField}
                ref={baseValueRef}
                inputMode="decimal"
                value={baseValue}
                onChange={(e) => setBaseValue(e.target.value)}
                placeholder="e.g. 850000"
                aria-required="true"
                aria-invalid={!!errors.baseValue || undefined}
                aria-describedby={errors.baseValue ? baseValueErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.baseValue && <p id={baseValueErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.baseValue}</p>}
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Create Assessment
            </button>
          </div>

          {message && (
            <p role="status" className="pill good" style={{ width: "fit-content" }}>
              {message}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Create this assessment?"
        confirmLabel="Create assessment"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create a FY <strong>{financialYear}</strong> assessment with base value <strong>₹{baseValue || "0"}</strong>{" "}
            for assessee <strong className="mono">{assesseeId.slice(0, 8)}…</strong>. This immediately raises a demand
            computed from the rate engine.
          </>
        }
        onConfirm={() => void createAssessment()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
