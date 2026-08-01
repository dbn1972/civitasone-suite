"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

type CreateResponse = {
  data: {
    id: string;
    employeeId: string;
    component: string;
    effectiveFrom: string;
    affectedPeriods: number;
    arrearsMinor: number;
    status: string;
  };
};

export function CreateCorrectionForm() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [component, setComponent] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [oldValue, setOldValue] = useState("");
  const [newValue, setNewValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const empId = useId();
  const compId = useId();
  const dateId = useId();
  const oldId = useId();
  const newId = useId();
  const reasonId = useId();
  const errId = useId();

  const empRef = useRef<HTMLInputElement>(null);
  const compRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const oldRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);

  const empInvalid = tone === "bad" && message === "Employee ID is required.";
  const compInvalid = tone === "bad" && message === "Component is required.";
  const dateInvalid = tone === "bad" && !!message && message.startsWith("Effective from");
  const oldInvalid = tone === "bad" && !!message && message.startsWith("Old value");
  const newInvalid = tone === "bad" && !!message && message.startsWith("New value");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!employeeId.trim()) {
      setTone("bad");
      setMessage("Employee ID is required.");
      empRef.current?.focus();
      return;
    }
    if (!component.trim()) {
      setTone("bad");
      setMessage("Component is required.");
      compRef.current?.focus();
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom.trim())) {
      setTone("bad");
      setMessage("Effective from must be in YYYY-MM-DD format.");
      dateRef.current?.focus();
      return;
    }
    const oldRupees = parseFloat(oldValue);
    if (Number.isNaN(oldRupees) || oldRupees < 0) {
      setTone("bad");
      setMessage("Old value must be a non-negative amount in rupees.");
      oldRef.current?.focus();
      return;
    }
    const newRupees = parseFloat(newValue);
    if (Number.isNaN(newRupees) || newRupees < 0) {
      setTone("bad");
      setMessage("New value must be a non-negative amount in rupees.");
      newRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createCorrection() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const oldValueMinor = Math.round(parseFloat(oldValue) * 100);
      const newValueMinor = Math.round(parseFloat(newValue) * 100);
      const res = await browserJson<CreateResponse>("v1/payroll/corrections", {
        method: "POST",
        body: JSON.stringify({
          employeeId: employeeId.trim(),
          component: component.trim(),
          effectiveFrom: effectiveFrom.trim(),
          oldValueMinor,
          newValueMinor,
          reason: reason.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        `Correction recorded for ${component.trim()} — ${res.data.affectedPeriods} period(s) affected, arrears ${formatMoney(
          res.data.arrearsMinor,
        )}.`,
      );
      setEmployeeId("");
      setComponent("");
      setEffectiveFrom("");
      setOldValue("");
      setNewValue("");
      setReason("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Record Salary Correction" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={empId} style={{ fontSize: 13, fontWeight: 600 }}>
                Employee ID <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={empId}
                ref={empRef}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                aria-required="true"
                aria-invalid={empInvalid || undefined}
                aria-describedby={empInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={compId} style={{ fontSize: 13, fontWeight: 600 }}>
                Component <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={compId}
                ref={compRef}
                value={component}
                onChange={(e) => setComponent(e.target.value)}
                maxLength={32}
                placeholder="BASIC, HRA, DA…"
                aria-required="true"
                aria-invalid={compInvalid || undefined}
                aria-describedby={compInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={dateId} style={{ fontSize: 13, fontWeight: 600 }}>
                Effective From <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={dateId}
                ref={dateRef}
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                placeholder="2025-04-01"
                aria-required="true"
                aria-invalid={dateInvalid || undefined}
                aria-describedby={dateInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={oldId} style={{ fontSize: 13, fontWeight: 600 }}>
                Old Value (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={oldId}
                ref={oldRef}
                type="number"
                min="0"
                step="0.01"
                value={oldValue}
                onChange={(e) => setOldValue(e.target.value)}
                aria-required="true"
                aria-invalid={oldInvalid || undefined}
                aria-describedby={oldInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={newId} style={{ fontSize: 13, fontWeight: 600 }}>
                New Value (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={newId}
                ref={newRef}
                type="number"
                min="0"
                step="0.01"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                aria-required="true"
                aria-invalid={newInvalid || undefined}
                aria-describedby={newInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={reasonId} style={{ fontSize: 13, fontWeight: 600 }}>Reason</label>
              <input
                id={reasonId}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={512}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Record Correction
            </button>
          </div>

          {message && (
            <p
              id={errId}
              role={tone === "bad" ? "alert" : "status"}
              aria-live={tone === "bad" ? undefined : "polite"}
              className={`pill ${tone}`}
              style={{ width: "fit-content" }}
            >
              {message}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Record this salary correction?"
        confirmLabel="Record correction"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Correct <strong>{component}</strong> for employee <strong>{employeeId}</strong> from{" "}
            {formatMoney(Math.round((parseFloat(oldValue) || 0) * 100))} to{" "}
            {formatMoney(Math.round((parseFloat(newValue) || 0) * 100))}, effective {effectiveFrom}. This computes
            arrears for every affected period and creates a pending correction record.
          </>
        }
        onConfirm={() => void createCorrection()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
