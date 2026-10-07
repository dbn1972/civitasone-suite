"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog, EntityPicker, Field, Input } from "@/app/_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { browserJson } from "@/lib/api/browserClient";

type FieldErrors = {
  employeeRef?: string;
  seniorityMonths?: string;
};

export function ApplyAllotmentForm({ quarterId }: { quarterId: string }) {
  const router = useRouter();

  const [employeeRef, setEmployeeRef] = useState<string | null>(null);
  const [designation, setDesignation] = useState("");
  const [payLevel, setPayLevel] = useState("");
  const [seniorityMonths, setSeniorityMonths] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const seniorityField = useId();
  const seniorityErrId = useId();
  const designationField = useId();
  const payLevelField = useId();

  const seniorityRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!employeeRef) next.employeeRef = "Select the applying employee.";
    if (seniorityMonths.trim()) {
      const n = parseInt(seniorityMonths, 10);
      if (!Number.isFinite(n) || n < 0) next.seniorityMonths = "Seniority (months) must be zero or a positive whole number.";
    }
    setErrors(next);
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
          employeeRef,
          designation: designation.trim() || undefined,
          payLevel: payLevel.trim() || undefined,
          seniorityMonths: seniorityMonths.trim() ? parseInt(seniorityMonths, 10) : 0,
        }),
      });
      setConfirmOpen(false);
      setMessage("Allotment application submitted.");
      setEmployeeRef(null);
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
    <form onSubmit={handleSubmit} noValidate style={{ marginBottom: 16 }}>
      <Card title="Apply for allotment" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            {/* GAP-ESTAB-QUARTERS-DETAIL-02: searchable employee picker
                (name + designation) instead of a UUID text input. */}
            <Field
              label="Employee"
              required
              error={errors.employeeRef}
            >
              <EntityPicker
                value={employeeRef}
                onChange={(v) => {
                  setEmployeeRef(typeof v === "string" ? v : null);
                  setErrors((prev) => ({ ...prev, employeeRef: undefined }));
                }}
                search={searchEmployees}
                resolve={resolveEmployees}
                placeholder="Search by name or employee ID…"
              />
            </Field>

            <Field label="Designation">
              <Input
                id={designationField}
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="e.g. Section Officer"
              />
            </Field>

            <Field label="Pay Level">
              <Input
                id={payLevelField}
                value={payLevel}
                onChange={(e) => setPayLevel(e.target.value)}
                placeholder="e.g. 7"
              />
            </Field>

            <Field
              label="Seniority (months)"
              error={errors.seniorityMonths}
            >
              <Input
                id={seniorityField}
                ref={seniorityRef}
                inputMode="numeric"
                value={seniorityMonths}
                onChange={(e) => setSeniorityMonths(e.target.value)}
                placeholder="0"
                aria-invalid={!!errors.seniorityMonths || undefined}
                aria-describedby={errors.seniorityMonths ? seniorityErrId : undefined}
              />
            </Field>
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
              Apply for allotment
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
        title="Apply for this quarter?"
        confirmLabel="Submit application"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Submit an allotment application for{" "}
            {/* GAP-ESTAB-QUARTERS-DETAIL-02: the employee is chosen from the
                searchable picker (shows name + designation), so this is a
                verified directory id rather than a hand-typed UUID. */}
            <strong>the selected employee</strong> against this quarter. A designated
            allotting officer (not the applicant) must approve it before it becomes effective.
          </>
        }
        onConfirm={() => void applyForAllotment()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
