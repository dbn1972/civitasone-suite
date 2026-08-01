"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

const CODE_PATTERN = /^\d{4}-\d{2}$/;

type FieldErrors = {
  code?: string;
  label?: string;
  startDate?: string;
  endDate?: string;
};

export function FiscalYearForm() {
  const router = useRouter();

  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const codeId = useId();
  const labelId = useId();
  const startId = useId();
  const endId = useId();
  const codeErrId = useId();
  const labelErrId = useId();
  const startErrId = useId();
  const endErrId = useId();

  const codeRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!CODE_PATTERN.test(code.trim())) next.code = "Code must be in YYYY-YY format, e.g. 2026-27.";
    if (!label.trim()) next.label = "Label is required.";
    if (!startDate) next.startDate = "Start date is required.";
    if (!endDate) next.endDate = "End date is required.";
    if (startDate && endDate && endDate <= startDate) next.endDate = "End date must be after the start date.";

    setErrors(next);
    if (next.code) { codeRef.current?.focus(); return false; }
    if (next.label) { labelRef.current?.focus(); return false; }
    if (next.startDate) { startRef.current?.focus(); return false; }
    if (next.endDate) { endRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createFiscalYear() {
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson<{ id: string; status: string }>("v1/finance/fiscal-years", {
        method: "POST",
        body: JSON.stringify({
          code: code.trim(),
          label: label.trim(),
          startDate,
          endDate,
        }),
      });
      setConfirmOpen(false);
      setMessage(`Fiscal year ${code.trim()} created.`);
      setCode("");
      setLabel("");
      setStartDate("");
      setEndDate("");
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
      <Card title="Create Fiscal Year" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={codeId} style={{ fontSize: 13, fontWeight: 600 }}>
                Code <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={codeId}
                ref={codeRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="2026-27"
                maxLength={7}
                aria-required="true"
                aria-invalid={!!errors.code || undefined}
                aria-describedby={errors.code ? codeErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.code && <p id={codeErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.code}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={labelId} style={{ fontSize: 13, fontWeight: 600 }}>
                Label <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={labelId}
                ref={labelRef}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={64}
                aria-required="true"
                aria-invalid={!!errors.label || undefined}
                aria-describedby={errors.label ? labelErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.label && <p id={labelErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.label}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={startId} style={{ fontSize: 13, fontWeight: 600 }}>
                Start Date <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={startId}
                ref={startRef}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.startDate || undefined}
                aria-describedby={errors.startDate ? startErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.startDate && <p id={startErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.startDate}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={endId} style={{ fontSize: 13, fontWeight: 600 }}>
                End Date <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={endId}
                ref={endRef}
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.endDate || undefined}
                aria-describedby={errors.endDate ? endErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.endDate && <p id={endErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.endDate}</p>}
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Create Fiscal Year
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
        title="Create this fiscal year?"
        confirmLabel="Create fiscal year"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create fiscal year <strong>{code}</strong> (<strong>{label}</strong>) running from {startDate} to{" "}
            {endDate}. The server marks newly created fiscal years active immediately — use the Activate action
            afterwards if you need to switch back to a different year.
          </>
        }
        onConfirm={() => void createFiscalYear()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
