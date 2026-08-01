"use client";

import { useId, useRef, useState } from "react";
import { ConfirmDialog } from "../../../../_components/ds";
import { browserJson, browserFetch } from "@/lib/api/browserClient";

type MandateResult = { umrn?: string; status?: string; message?: string } & Record<string, unknown>;

const FREQUENCIES = ["monthly", "quarterly", "yearly", "one-time"] as const;

export function NachMandateForm() {
  const [employeeRef, setEmployeeRef] = useState("");
  const [amountRupees, setAmountRupees] = useState("");
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number]>("monthly");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [accountType, setAccountType] = useState<"savings" | "current">("savings");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [employeeRefInvalid, setEmployeeRefInvalid] = useState(false);
  const [amountInvalid, setAmountInvalid] = useState(false);
  const [startInvalid, setStartInvalid] = useState(false);
  const [endInvalid, setEndInvalid] = useState(false);

  const [statusRef, setStatusRef] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusResult, setStatusResult] = useState<MandateResult | null>(null);
  const [statusRefInvalid, setStatusRefInvalid] = useState(false);

  const empIdField = useId();
  const amtField = useId();
  const freqField = useId();
  const startField = useId();
  const endField = useId();
  const acctField = useId();
  const errId = useId();
  const refField = useId();
  const statusErrId = useId();

  const employeeRefFieldRef = useRef<HTMLInputElement>(null);
  const amountFieldRef = useRef<HTMLInputElement>(null);
  const startFieldRef = useRef<HTMLInputElement>(null);
  const endFieldRef = useRef<HTMLInputElement>(null);
  const statusRefFieldRef = useRef<HTMLInputElement>(null);

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    const empMissing = !employeeRef.trim();
    const amtMissing = !amountRupees.trim();
    const startMissing = !startDate;
    const endMissing = !endDate;
    setEmployeeRefInvalid(empMissing);
    setAmountInvalid(amtMissing);
    setStartInvalid(startMissing);
    setEndInvalid(endMissing);
    if (empMissing || amtMissing || startMissing || endMissing) {
      setError("Employee reference, amount, start date and end date are required.");
      if (empMissing) {
        employeeRefFieldRef.current?.focus();
      } else if (amtMissing) {
        amountFieldRef.current?.focus();
      } else if (startMissing) {
        startFieldRef.current?.focus();
      } else {
        endFieldRef.current?.focus();
      }
      return;
    }
    setConfirmOpen(true);
  }

  async function submitMandate() {
    setBusy(true);
    setError(undefined);
    try {
      const amountMinor = Math.round(Number(amountRupees) * 100);
      const res = await browserJson<{ data: MandateResult }>("v1/payroll/nach/mandates", {
        method: "POST",
        body: JSON.stringify({
          employeeRef: employeeRef.trim(),
          amountMinor,
          frequency,
          startDate,
          endDate,
          accountType,
        }),
      });
      setConfirmOpen(false);
      setMessage(`Mandate submitted (UMRN ${res.data.umrn ?? "pending"}, status ${res.data.status ?? "submitted"}).`);
      setEmployeeRef("");
      setAmountRupees("");
      setStartDate("");
      setEndDate("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus(e: React.FormEvent) {
    e.preventDefault();
    setStatusError(null);
    setStatusResult(null);
    if (!statusRef.trim()) {
      setStatusRefInvalid(true);
      setStatusError("Enter a mandate reference to check its status.");
      statusRefFieldRef.current?.focus();
      return;
    }
    setStatusRefInvalid(false);
    setStatusBusy(true);
    try {
      const res = await browserFetch(`v1/payroll/nach/mandates/${encodeURIComponent(statusRef.trim())}/status`, {
        method: "GET",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const code = (body as { error?: { message?: string; code?: string } })?.error;
        setStatusError(code?.message ?? code?.code ?? `Status check failed (${res.status}).`);
        return;
      }
      const body = (await res.json()) as { data: MandateResult };
      setStatusResult(body.data);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <form onSubmit={openConfirm}>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={empIdField} style={{ fontSize: 13, fontWeight: 600 }}>
              Employee Reference (UUID) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={empIdField}
              ref={employeeRefFieldRef}
              value={employeeRef}
              onChange={(e) => {
                setEmployeeRef(e.target.value);
                setEmployeeRefInvalid(false);
              }}
              aria-required="true"
              aria-invalid={employeeRefInvalid || undefined}
              aria-describedby={employeeRefInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={amtField} style={{ fontSize: 13, fontWeight: 600 }}>
              Amount (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={amtField}
              ref={amountFieldRef}
              type="number"
              min="0"
              step="0.01"
              value={amountRupees}
              onChange={(e) => {
                setAmountRupees(e.target.value);
                setAmountInvalid(false);
              }}
              aria-required="true"
              aria-invalid={amountInvalid || undefined}
              aria-describedby={amountInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={freqField} style={{ fontSize: 13, fontWeight: 600 }}>Frequency</label>
            <select
              id={freqField}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as (typeof FREQUENCIES)[number])}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={acctField} style={{ fontSize: 13, fontWeight: 600 }}>Account Type</label>
            <select
              id={acctField}
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as "savings" | "current")}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            >
              <option value="savings">Savings</option>
              <option value="current">Current</option>
            </select>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={startField} style={{ fontSize: 13, fontWeight: 600 }}>
              Start Date <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={startField}
              ref={startFieldRef}
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setStartInvalid(false);
              }}
              aria-required="true"
              aria-invalid={startInvalid || undefined}
              aria-describedby={startInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={endField} style={{ fontSize: 13, fontWeight: 600 }}>
              End Date <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={endField}
              ref={endFieldRef}
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setEndInvalid(false);
              }}
              aria-required="true"
              aria-invalid={endInvalid || undefined}
              aria-describedby={endInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
            Submit NACH Mandate
          </button>
        </div>
        {error && !confirmOpen && (
          <p id={errId} role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>
            {message}
          </p>
        )}

        <ConfirmDialog
          open={confirmOpen}
          title="Submit this NACH mandate?"
          danger
          confirmLabel="Submit mandate"
          busy={busy}
          errorMessage={error}
          description={
            <>
              Submit a {frequency} NACH mandate of ₹{amountRupees || "0"} for employee reference{" "}
              <strong>{employeeRef}</strong>, valid {startDate} to {endDate}.
            </>
          }
          onConfirm={() => void submitMandate()}
          onCancel={() => !busy && setConfirmOpen(false)}
        />
      </form>

      <form onSubmit={checkStatus} style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6, flex: 1, minWidth: 200 }}>
            <label htmlFor={refField} style={{ fontSize: 13, fontWeight: 600 }}>Check Mandate Status by Reference</label>
            <input
              id={refField}
              ref={statusRefFieldRef}
              value={statusRef}
              onChange={(e) => {
                setStatusRef(e.target.value);
                setStatusRefInvalid(false);
              }}
              aria-invalid={statusRefInvalid || undefined}
              aria-describedby={statusRefInvalid ? statusErrId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <button type="submit" className="btn secondary" style={{ minHeight: 44 }} disabled={statusBusy}>
            Check Status
          </button>
        </div>
        {statusError && (
          <p id={statusErrId} role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>
            {statusError}
          </p>
        )}
        {statusResult && (
          <p role="status" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>
            Status: {statusResult.status ?? "unknown"}
          </p>
        )}
      </form>
    </div>
  );
}
