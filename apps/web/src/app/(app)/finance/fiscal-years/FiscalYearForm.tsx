"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { findFiscalYearConflicts } from "@/lib/fiscalYear";
import type { FiscalYearRow } from "./FiscalYearsTable";

const CODE_PATTERN = /^\d{4}-\d{2}$/;

type FieldErrors = {
  code?: string;
  label?: string;
  startDate?: string;
  endDate?: string;
};

/** Minimum length of the stated reason (matches finance-service's reasonField). */
export const FY_REASON_MIN = 10;

export function FiscalYearForm({ rows = [] }: { rows?: FiscalYearRow[] }) {
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
    // GAP-FINANCE-FISCAL-YEARS-01: a duplicate or overlapping year is
    // rejected before the confirm dialog opens (the server rejects it too).
    if (!next.code && !next.startDate && !next.endDate) {
      const c = findFiscalYearConflicts({ code: code.trim(), startDate, endDate }, rows);
      if (c.duplicateOf) next.code = `Fiscal year ${c.duplicateOf} already exists.`;
      else if (c.overlapsWith) next.startDate = `These dates overlap fiscal year ${c.overlapsWith}.`;
    }

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

  const activeYear = rows.find((r) => r.status === "active") ?? null;
  const gap = confirmOpen ? findFiscalYearConflicts({ code: code.trim(), startDate, endDate }, rows).gapAfter : undefined;

  async function createFiscalYear(reason?: string) {
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
          reason,
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
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
              Create Fiscal Year
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
        title="Create this fiscal year?"
        confirmLabel="Create fiscal year"
        danger
        requireReason
        reasonLabel="Reason for creating and activating this year"
        minReasonLength={FY_REASON_MIN}
        maxReasonLength={500}
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create fiscal year <strong>{code}</strong> (<strong>{label}</strong>) running from {startDate} to{" "}
            {endDate}. It becomes the <strong>active posting year immediately</strong>
            {activeYear ? (
              <>
                {" "}and fiscal year <strong>{activeYear.code}</strong> ({activeYear.label}) <strong>will be closed</strong>
              </>
            ) : null}
            . Every new posting will land in {code}. Your reason is recorded in the audit trail.
            {gap ? (
              <>
                {" "}<strong>Note:</strong> {gap.days} day{gap.days === 1 ? "" : "s"} between the end of {gap.code} and
                this year&apos;s start are not covered by any fiscal year.
              </>
            ) : null}
          </>
        }
        onConfirm={(reason) => void createFiscalYear(reason)}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
