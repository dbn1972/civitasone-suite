"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FieldErrors = {
  employeeRef?: string;
  seniorityMonths?: string;
};

export function ApplyAllotmentForm({ quarterId }: { quarterId: string }) {
  const router = useRouter();

  const [employeeRef, setEmployeeRef] = useState("");
  const [designation, setDesignation] = useState("");
  const [payLevel, setPayLevel] = useState("");
  const [seniorityMonths, setSeniorityMonths] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const employeeRefField = useId();
  const employeeRefErrId = useId();
  const seniorityField = useId();
  const seniorityErrId = useId();
  const designationField = useId();
  const payLevelField = useId();

  const employeeRefRef = useRef<HTMLInputElement>(null);
  const seniorityRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!UUID_PATTERN.test(employeeRef.trim())) next.employeeRef = "Enter a valid employee ID (UUID).";
    if (seniorityMonths.trim()) {
      const n = parseInt(seniorityMonths, 10);
      if (!Number.isFinite(n) || n < 0) next.seniorityMonths = "Seniority (months) must be zero or a positive whole number.";
    }
    setErrors(next);
    if (next.employeeRef) { employeeRefRef.current?.focus(); return false; }
    if (next.seniorityMonths) { seniorityRef.current?.focus(); return false; }
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function applyForAllotment() {
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson<{ status: string }>("v1/estab/quarter-allotments", {
        method: "POST",
        body: JSON.stringify({
          quarterId,
          employeeRef: employeeRef.trim(),
          designation: designation.trim() || undefined,
          payLevel: payLevel.trim() || undefined,
          seniorityMonths: seniorityMonths.trim() ? parseInt(seniorityMonths, 10) : 0,
        }),
      });
      setConfirmOpen(false);
      setMessage("Allotment application submitted.");
      setEmployeeRef("");
      setDesignation("");
      setPayLevel("");
      setSeniorityMonths("");
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
      <Card title="Apply for allotment" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={employeeRefField} style={{ fontSize: 13, fontWeight: 600 }}>
                Employee ID <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={employeeRefField}
                ref={employeeRefRef}
                value={employeeRef}
                onChange={(e) => setEmployeeRef(e.target.value)}
                placeholder="UUID of the applying employee"
                aria-required="true"
                aria-invalid={!!errors.employeeRef || undefined}
                aria-describedby={errors.employeeRef ? employeeRefErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.employeeRef && <p id={employeeRefErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.employeeRef}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={designationField} style={{ fontSize: 13, fontWeight: 600 }}>Designation</label>
              <input
                id={designationField}
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="e.g. Section Officer"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={payLevelField} style={{ fontSize: 13, fontWeight: 600 }}>Pay Level</label>
              <input
                id={payLevelField}
                value={payLevel}
                onChange={(e) => setPayLevel(e.target.value)}
                placeholder="e.g. 7"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={seniorityField} style={{ fontSize: 13, fontWeight: 600 }}>Seniority (months)</label>
              <input
                id={seniorityField}
                ref={seniorityRef}
                inputMode="numeric"
                value={seniorityMonths}
                onChange={(e) => setSeniorityMonths(e.target.value)}
                placeholder="0"
                aria-invalid={!!errors.seniorityMonths || undefined}
                aria-describedby={errors.seniorityMonths ? seniorityErrId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {errors.seniorityMonths && <p id={seniorityErrId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 12, margin: 0 }}>{errors.seniorityMonths}</p>}
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Apply for allotment
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
        title="Apply for this quarter?"
        confirmLabel="Submit application"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Submit an allotment application for employee{" "}
            <strong className="mono">{employeeRef.slice(0, 8)}…</strong> against this quarter. A designated
            allotting officer (not the applicant) must approve it before it becomes effective.
          </>
        }
        onConfirm={() => void applyForAllotment()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
