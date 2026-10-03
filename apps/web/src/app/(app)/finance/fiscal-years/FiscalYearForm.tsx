"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { currentFinancialYear, findFiscalYearConflicts, standardFiscalYear, validateFiscalYear } from "@/lib/fiscalYear";
import { formatIndianDate } from "@/lib/formatters";
import type { FiscalYearRow } from "./FiscalYearsTable";

type FieldErrors = {
  code?: string;
  label?: string;
  startDate?: string;
  endDate?: string;
};

/** Minimum length of the stated reason (matches finance-service's reasonField). */
export const FY_REASON_MIN = 10;

/**
 * `createsAsDraft` (per-tenant setting, default on): while another year is
 * active a new year is created as a DRAFT and the posting year does not change;
 * activation is a separate, approved step in the table below
 * (GAP-FINANCE-FISCAL-YEARS-01). The very first year of a tenant is active at once.
 */
export function FiscalYearForm({ rows = [], createsAsDraft = true }: { rows?: FiscalYearRow[]; createsAsDraft?: boolean }) {
  const router = useRouter();

  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // GAP-FINANCE-FISCAL-YEARS-05: picking a start year prefills code, label and
  // the standard 1 Apr - 31 Mar dates; the dates are only editable behind the
  // "Non-standard year" override (short first year, other year-end).
  const [startYear, setStartYear] = useState("");
  const [nonStandard, setNonStandard] = useState(false);
  const currentStart = Number(currentFinancialYear().slice(0, 4));
  const startYearOptions = [currentStart - 2, currentStart - 1, currentStart, currentStart + 1, currentStart + 2];

  function chooseStartYear(value: string) {
    setStartYear(value);
    if (!value) return;
    const std = standardFiscalYear(Number(value));
    setCode(std.code);
    setLabel(std.label);
    setStartDate(std.startDate);
    setEndDate(std.endDate);
    setNonStandard(false);
    setErrors({});
  }

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const yearId = useId();
  const nonStdId = useId();
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
    const next: FieldErrors = validateFiscalYear({ code, label, startDate, endDate }, { nonStandard });
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
  // Mirrors the server rule: a draft only while another year is active.
  const asDraft = createsAsDraft && activeYear !== null;
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
      setMessage(asDraft
        ? `Fiscal year ${code.trim()} created as a draft. Activate it from the table below when the current year is closed.`
        : `Fiscal year ${code.trim()} created.`);
      setCode("");
      setLabel("");
      setStartDate("");
      setEndDate("");
      setStartYear("");
      setNonStandard(false);
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
              <label htmlFor={yearId} style={{ fontSize: 13, fontWeight: 600 }}>Start year</label>
              <select
                id={yearId}
                value={startYear}
                onChange={(e) => chooseStartYear(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                <option value="">— pick to prefill —</option>
                {startYearOptions.map((y) => (
                  <option key={y} value={y}>{y}-{String((y + 1) % 100).padStart(2, "0")}</option>
                ))}
              </select>
            </div>

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
                readOnly={!nonStandard && !!startYear}
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
                readOnly={!nonStandard && !!startYear}
                aria-required="true"
                aria-invalid={!!errors.endDate || undefined}
                aria-describedby={errors.endDate ? endErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.endDate && <p id={endErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.endDate}</p>}
            </div>
          </div>

          <label htmlFor={nonStdId} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input id={nonStdId} type="checkbox" checked={nonStandard} onChange={(e) => setNonStandard(e.target.checked)} />
            Non-standard year (dates other than 1 April to 31 March)
          </label>

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
        danger={!asDraft}
        requireReason
        reasonLabel={asDraft ? "Reason for creating this year" : "Reason for creating and activating this year"}
        minReasonLength={FY_REASON_MIN}
        maxReasonLength={500}
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Create fiscal year <strong>{code}</strong> (<strong>{label}</strong>) running from{" "}
            <strong>{formatIndianDate(startDate)}</strong> to <strong>{formatIndianDate(endDate)}</strong>.{" "}
            {asDraft && activeYear ? (
              <>
                It is created as a <strong>draft</strong>: fiscal year <strong>{activeYear.code}</strong> ({activeYear.label}) stays the
                active posting year. Activating {code} is a separate step that needs a clean period close and a second approver.
              </>
            ) : activeYear ? (
              <>
                It becomes the <strong>active posting year immediately</strong> and fiscal year <strong>{activeYear.code}</strong> ({activeYear.label}){" "}
                <strong>will be closed</strong>. Every new posting will land in {code}.
              </>
            ) : (
              <>As the first fiscal year it becomes the <strong>active posting year</strong>; every new posting will land in {code}.</>
            )}{" "}
            Your reason is recorded in the audit trail.
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
