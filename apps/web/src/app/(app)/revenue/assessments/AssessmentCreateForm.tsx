"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { rupeesToMinorString } from "@/lib/money";
import { AssesseeSelect, type AssesseeOption } from "../_components/AssesseeSelect";
import { RateHeadSelect, type RateHeadOption } from "../_components/RateHeadSelect";

const FY_PATTERN = /^\d{4}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FieldErrors = {
  assesseeId?: string;
  rateHeadId?: string;
  financialYear?: string;
  baseValue?: string;
};

export function AssessmentCreateForm({
  assessees = [],
  rateHeads = [],
}: {
  assessees?: AssesseeOption[];
  rateHeads?: RateHeadOption[];
}) {
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

  const assesseeRef = useRef<HTMLSelectElement>(null);
  const rateHeadRef = useRef<HTMLSelectElement>(null);
  const fyRef = useRef<HTMLInputElement>(null);
  const baseValueRef = useRef<HTMLInputElement>(null);

  const selectedAssessee = assessees.find((a) => a.id === assesseeId);
  const selectedAssesseeLabel = selectedAssessee
    ? `${selectedAssessee.ownerName} — ${selectedAssessee.identifierNo}`
    : assesseeId
      ? `${assesseeId.slice(0, 8)}…`
      : "—";

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!UUID_PATTERN.test(assesseeId.trim())) next.assesseeId = "Select an assessee.";
    if (!UUID_PATTERN.test(rateHeadId.trim())) next.rateHeadId = "Select a rate head.";
    if (!FY_PATTERN.test(financialYear.trim())) next.financialYear = "Financial year must be in YYYY-YY format, e.g. 2026-27.";
    if (rupeesToMinorString(baseValue) === null) {
      next.baseValue = "Enter an amount in rupees with up to 2 decimals, e.g. 850000 or 8500.50.";
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
    const baseValueMinor = rupeesToMinorString(baseValue);
    if (baseValueMinor === null) {
      setBusy(false);
      setConfirmOpen(false);
      setErrors((e) => ({ ...e, baseValue: "Enter an amount in rupees with up to 2 decimals, e.g. 850000 or 8500.50." }));
      return;
    }
    try {
      await browserJson<{ status: string }>("v1/revenue/assessments", {
        method: "POST",
        body: JSON.stringify({
          assesseeId: assesseeId.trim(),
          rateHeadId: rateHeadId.trim(),
          financialYear: financialYear.trim(),
          baseValue: baseValueMinor,
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
                Assessee <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <AssesseeSelect
                id={assesseeIdField}
                ref={assesseeRef}
                value={assesseeId}
                onChange={setAssesseeId}
                options={assessees}
                required
                invalid={!!errors.assesseeId}
                describedBy={errors.assesseeId ? assesseeErrId : undefined}
              />
              {errors.assesseeId && <p id={assesseeErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.assesseeId}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={rateHeadIdField} style={{ fontSize: 13, fontWeight: 600 }}>
                Rate Head <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <RateHeadSelect
                id={rateHeadIdField}
                ref={rateHeadRef}
                value={rateHeadId}
                onChange={setRateHeadId}
                options={rateHeads}
                required
                invalid={!!errors.rateHeadId}
                describedBy={errors.rateHeadId ? rateHeadErrId : undefined}
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
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy} loading={busy}>
              Create Assessment
            </Button>
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
            for assessee <strong>{selectedAssesseeLabel}</strong>. This immediately raises a demand
            computed from the rate engine.
          </>
        }
        onConfirm={() => void createAssessment()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
