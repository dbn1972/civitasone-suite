"use client";

import { useId, useRef, useState } from "react";
import { Card, ConfirmDialog } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

type SalaryBillResult = {
  billRef: string;
  pfmsBillNo: string;
  month: string;
  departmentId: string;
  totalAmountMinor: number;
  employeeCount: number;
  status: string;
  submittedAt: string;
  message?: string;
};

type FieldKey = "month" | "departmentId" | "totalAmountMinor" | "employeeCount" | "ddoCode";

const FIELD_ERRORS: Record<FieldKey, string> = {
  month: "Month must be in YYYY-MM format.",
  departmentId: "Department ID must be a valid UUID.",
  totalAmountMinor: "Total amount must be a whole number of paise, at least 1.",
  employeeCount: "Employee count must be a whole number, at least 1.",
  ddoCode: "DDO code is required.",
};

/**
 * POST /v1/finance/pfms/salary-bill — submits a monthly salary bill to
 * treasury. Backend note: this is registered as an INTEGRATION STUB
 * (services/finance-service/src/modules/pfms/treasury-stubs.ts) — it returns a
 * synthetic bill reference rather than a real treasury submission; the route is
 * real and reachable, but the integration itself is documented as not yet live.
 * `totalAmountMinor` is paise (minor units) per the backend schema comment.
 */
export function SalaryBillForm() {
  const [month, setMonth] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [totalAmountMinor, setTotalAmountMinor] = useState("");
  const [employeeCount, setEmployeeCount] = useState("");
  const [ddoCode, setDdoCode] = useState("");
  const [schemeCode, setSchemeCode] = useState("");
  const [remarks, setRemarks] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const monthId = useId();
  const deptId = useId();
  const amountId = useId();
  const countId = useId();
  const ddoId = useId();
  const schemeId = useId();
  const remarksId = useId();

  const monthRef = useRef<HTMLInputElement>(null);
  const deptRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const countRef = useRef<HTMLInputElement>(null);
  const ddoRef = useRef<HTMLInputElement>(null);
  const focusRefs: Record<FieldKey, React.RefObject<HTMLInputElement | null>> = {
    month: monthRef,
    departmentId: deptRef,
    totalAmountMinor: amountRef,
    employeeCount: countRef,
    ddoCode: ddoRef,
  };

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const nextErrors: Partial<Record<FieldKey, string>> = {};
    if (!/^\d{4}-\d{2}$/.test(month.trim())) nextErrors.month = FIELD_ERRORS.month;
    if (!uuidRe.test(departmentId.trim())) nextErrors.departmentId = FIELD_ERRORS.departmentId;
    if (!/^\d+$/.test(totalAmountMinor.trim()) || Number(totalAmountMinor) < 1) {
      nextErrors.totalAmountMinor = FIELD_ERRORS.totalAmountMinor;
    }
    if (!/^\d+$/.test(employeeCount.trim()) || Number(employeeCount) < 1) {
      nextErrors.employeeCount = FIELD_ERRORS.employeeCount;
    }
    if (!ddoCode.trim()) nextErrors.ddoCode = FIELD_ERRORS.ddoCode;
    setErrors(nextErrors);
    const firstInvalid = (Object.keys(nextErrors) as FieldKey[])[0];
    if (firstInvalid) {
      focusRefs[firstInvalid].current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submit() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<{ data: SalaryBillResult }>("v1/finance/pfms/salary-bill", {
        method: "POST",
        body: JSON.stringify({
          month: month.trim(),
          departmentId: departmentId.trim(),
          totalAmountMinor: Number(totalAmountMinor.trim()),
          employeeCount: Number(employeeCount.trim()),
          ddoCode: ddoCode.trim(),
          schemeCode: schemeCode.trim() || undefined,
          remarks: remarks.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setMessage(`Salary bill ${res.data.pfmsBillNo} submitted for ${res.data.month} — status: ${res.data.status}.`);
      setMonth("");
      setDepartmentId("");
      setTotalAmountMinor("");
      setEmployeeCount("");
      setDdoCode("");
      setSchemeCode("");
      setRemarks("");
      setErrors({});
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const previewAmount = /^\d+$/.test(totalAmountMinor.trim()) ? formatMoney(totalAmountMinor.trim()) : null;

  return (
    <form onSubmit={handleSubmit}>
      <Card title="Generate Salary Bill" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={monthId} style={{ fontSize: 13, fontWeight: 600 }}>
                Month (YYYY-MM) <span aria-hidden="true">*</span>
              </label>
              <input
                id={monthId}
                ref={monthRef}
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                placeholder="2026-08"
                maxLength={7}
                aria-required="true"
                aria-invalid={!!errors.month || undefined}
                aria-describedby={errors.month ? `${monthId}-error` : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.month && (
                <p id={`${monthId}-error`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {errors.month}
                </p>
              )}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={deptId} style={{ fontSize: 13, fontWeight: 600 }}>
                Department ID (UUID) <span aria-hidden="true">*</span>
              </label>
              <input
                id={deptId}
                ref={deptRef}
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                aria-required="true"
                aria-invalid={!!errors.departmentId || undefined}
                aria-describedby={errors.departmentId ? `${deptId}-error` : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.departmentId && (
                <p id={`${deptId}-error`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {errors.departmentId}
                </p>
              )}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={amountId} style={{ fontSize: 13, fontWeight: 600 }}>
                Total Amount, in paise <span aria-hidden="true">*</span>
              </label>
              <input
                id={amountId}
                ref={amountRef}
                value={totalAmountMinor}
                onChange={(e) => setTotalAmountMinor(e.target.value)}
                inputMode="numeric"
                aria-required="true"
                aria-invalid={!!errors.totalAmountMinor || undefined}
                aria-describedby={errors.totalAmountMinor ? `${amountId}-error` : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {previewAmount && <span style={{ fontSize: 12, color: "var(--muted, #666)" }}>{previewAmount}</span>}
              {errors.totalAmountMinor && (
                <p id={`${amountId}-error`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {errors.totalAmountMinor}
                </p>
              )}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={countId} style={{ fontSize: 13, fontWeight: 600 }}>
                Employee Count <span aria-hidden="true">*</span>
              </label>
              <input
                id={countId}
                ref={countRef}
                value={employeeCount}
                onChange={(e) => setEmployeeCount(e.target.value)}
                inputMode="numeric"
                aria-required="true"
                aria-invalid={!!errors.employeeCount || undefined}
                aria-describedby={errors.employeeCount ? `${countId}-error` : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.employeeCount && (
                <p id={`${countId}-error`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {errors.employeeCount}
                </p>
              )}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ddoId} style={{ fontSize: 13, fontWeight: 600 }}>
                DDO Code <span aria-hidden="true">*</span>
              </label>
              <input
                id={ddoId}
                ref={ddoRef}
                value={ddoCode}
                onChange={(e) => setDdoCode(e.target.value)}
                maxLength={32}
                aria-required="true"
                aria-invalid={!!errors.ddoCode || undefined}
                aria-describedby={errors.ddoCode ? `${ddoId}-error` : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.ddoCode && (
                <p id={`${ddoId}-error`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                  {errors.ddoCode}
                </p>
              )}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={schemeId} style={{ fontSize: 13, fontWeight: 600 }}>Scheme Code</label>
              <input
                id={schemeId}
                value={schemeCode}
                onChange={(e) => setSchemeCode(e.target.value)}
                maxLength={32}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={remarksId} style={{ fontSize: 13, fontWeight: 600 }}>Remarks</label>
            <input
              id={remarksId}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              maxLength={2000}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Generate Salary Bill
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
        title="Submit this salary bill to treasury?"
        confirmLabel="Submit salary bill"
        danger
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Submit the salary bill for <strong>{month}</strong> covering{" "}
            <strong>{employeeCount}</strong> employees ({previewAmount ?? "amount above"}). This
            action cannot be undone.
          </>
        }
        onConfirm={() => void submit()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
