"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

type SalaryRevisionResponse = {
  data: {
    id: string;
    employee_id: string;
    effective_date: string;
    old_basic_minor: number | string;
    new_basic_minor: number | string;
    revision_type: string;
  };
};

const REVISION_TYPES = [
  { value: "annual_increment", label: "Annual Increment" },
  { value: "promotion", label: "Promotion" },
  { value: "special", label: "Special" },
  { value: "pay_commission", label: "Pay Commission" },
  { value: "market_correction", label: "Market Correction" },
] as const;

export function CreateSalaryRevisionForm() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [oldBasic, setOldBasic] = useState("");
  const [newBasic, setNewBasic] = useState("");
  const [oldGross, setOldGross] = useState("");
  const [newGross, setNewGross] = useState("");
  const [revisionType, setRevisionType] = useState<(typeof REVISION_TYPES)[number]["value"]>("annual_increment");
  const [orderNo, setOrderNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const empId = useId();
  const dateId = useId();
  const oldBasicId = useId();
  const newBasicId = useId();
  const oldGrossId = useId();
  const newGrossId = useId();
  const typeId = useId();
  const orderId = useId();
  const errId = useId();
  const empRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const oldBasicRef = useRef<HTMLInputElement>(null);
  const newBasicRef = useRef<HTMLInputElement>(null);
  const oldGrossRef = useRef<HTMLInputElement>(null);
  const newGrossRef = useRef<HTMLInputElement>(null);

  const empInvalid = tone === "bad" && message === "Employee ID is required.";
  const dateInvalid = tone === "bad" && !!message && message.startsWith("Effective date");
  const oldBasicInvalid = tone === "bad" && !!message && message.startsWith("Old basic");
  const newBasicInvalid = tone === "bad" && !!message && message.startsWith("New basic");
  const oldGrossInvalid = tone === "bad" && !!message && message.startsWith("Old gross");
  const newGrossInvalid = tone === "bad" && !!message && message.startsWith("New gross");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!employeeId.trim()) {
      setTone("bad");
      setMessage("Employee ID is required.");
      empRef.current?.focus();
      return;
    }
    if (!effectiveDate) {
      setTone("bad");
      setMessage("Effective date is required.");
      dateRef.current?.focus();
      return;
    }
    const oldB = parseFloat(oldBasic);
    if (Number.isNaN(oldB) || oldB < 0) {
      setTone("bad");
      setMessage("Old basic salary must be a non-negative amount in rupees.");
      oldBasicRef.current?.focus();
      return;
    }
    const newB = parseFloat(newBasic);
    if (Number.isNaN(newB) || newB < 0) {
      setTone("bad");
      setMessage("New basic salary must be a non-negative amount in rupees.");
      newBasicRef.current?.focus();
      return;
    }
    const oldG = parseFloat(oldGross);
    if (Number.isNaN(oldG) || oldG < 0) {
      setTone("bad");
      setMessage("Old gross salary must be a non-negative amount in rupees.");
      oldGrossRef.current?.focus();
      return;
    }
    const newG = parseFloat(newGross);
    if (Number.isNaN(newG) || newG < 0) {
      setTone("bad");
      setMessage("New gross salary must be a non-negative amount in rupees.");
      newGrossRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createRevision() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<SalaryRevisionResponse>("v1/payroll/salary-revisions", {
        method: "POST",
        body: JSON.stringify({
          employeeId: employeeId.trim(),
          effectiveDate,
          oldBasicMinor: Math.round(parseFloat(oldBasic) * 100),
          newBasicMinor: Math.round(parseFloat(newBasic) * 100),
          oldGrossMinor: Math.round(parseFloat(oldGross) * 100),
          newGrossMinor: Math.round(parseFloat(newGross) * 100),
          revisionType,
          orderNo: orderNo.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(`Salary revision for employee "${res.data.employee_id}" created.`);
      setEmployeeId("");
      setOldBasic("");
      setNewBasic("");
      setOldGross("");
      setNewGross("");
      setOrderNo("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Create Salary Revision" padding>
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
              <label htmlFor={dateId} style={{ fontSize: 13, fontWeight: 600 }}>
                Effective Date <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={dateId}
                ref={dateRef}
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                aria-required="true"
                aria-invalid={dateInvalid || undefined}
                aria-describedby={dateInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={typeId} style={{ fontSize: 13, fontWeight: 600 }}>Revision Type</label>
              <select
                id={typeId}
                value={revisionType}
                onChange={(e) => setRevisionType(e.target.value as typeof revisionType)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "#fff" }}
              >
                {REVISION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={orderId} style={{ fontSize: 13, fontWeight: 600 }}>Order No.</label>
              <input
                id={orderId}
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                maxLength={64}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={oldBasicId} style={{ fontSize: 13, fontWeight: 600 }}>
                Old Basic (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={oldBasicId}
                ref={oldBasicRef}
                type="number"
                min="0"
                step="0.01"
                value={oldBasic}
                onChange={(e) => setOldBasic(e.target.value)}
                aria-required="true"
                aria-invalid={oldBasicInvalid || undefined}
                aria-describedby={oldBasicInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={newBasicId} style={{ fontSize: 13, fontWeight: 600 }}>
                New Basic (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={newBasicId}
                ref={newBasicRef}
                type="number"
                min="0"
                step="0.01"
                value={newBasic}
                onChange={(e) => setNewBasic(e.target.value)}
                aria-required="true"
                aria-invalid={newBasicInvalid || undefined}
                aria-describedby={newBasicInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={oldGrossId} style={{ fontSize: 13, fontWeight: 600 }}>
                Old Gross (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={oldGrossId}
                ref={oldGrossRef}
                type="number"
                min="0"
                step="0.01"
                value={oldGross}
                onChange={(e) => setOldGross(e.target.value)}
                aria-required="true"
                aria-invalid={oldGrossInvalid || undefined}
                aria-describedby={oldGrossInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={newGrossId} style={{ fontSize: 13, fontWeight: 600 }}>
                New Gross (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={newGrossId}
                ref={newGrossRef}
                type="number"
                min="0"
                step="0.01"
                value={newGross}
                onChange={(e) => setNewGross(e.target.value)}
                aria-required="true"
                aria-invalid={newGrossInvalid || undefined}
                aria-describedby={newGrossInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Create Revision
            </button>
          </div>

          {message && (
            <p
              id={errId}
              role={tone === "bad" ? "alert" : "status"}
              aria-live={tone === "bad" ? "assertive" : "polite"}
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
        title="Create this salary revision?"
        confirmLabel="Create revision"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Revise basic salary for employee <strong>{employeeId}</strong> from{" "}
            {formatMoney(Math.round((parseFloat(oldBasic) || 0) * 100))} to{" "}
            {formatMoney(Math.round((parseFloat(newBasic) || 0) * 100))}, effective {effectiveDate}.
          </>
        }
        onConfirm={() => void createRevision()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
