"use client";

import { useEffect, useId, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";

const inputStyle: CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid var(--line)",
  borderRadius: 8, background: "var(--bg2)", color: "var(--ink)", fontSize: 14,
};
const inputErrStyle: CSSProperties = { ...inputStyle, border: "1px solid #ef4444" };
const fieldErrStyle: CSSProperties = { color: "#b91c1c", fontSize: 12, margin: "3px 0 0" };

type EmployeeOption = { id: string; name: string; employeeNo: string };

export function RequestAdvanceForm() {
  const ids = {
    employee: useId(), amount: useId(), purpose: useId(),
    months: useId(), date: useId(),
  };
  const [open, setOpen] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [months, setMonths] = useState("3");
  const [requestDate, setRequestDate] = useState("");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/proxy/v1/hrms/employees?limit=500")
      .then((r) => r.json())
      .then((body) => {
        const rows: EmployeeOption[] = Array.isArray(body) ? body : (body.data ?? []);
        setEmployees(rows);
        if (rows[0]) setEmployeeId(rows[0].id);
      })
      .catch(() => {});
  }, []);

  function clearErr(field: string) {
    setInvalid((s) => { const n = new Set(s); n.delete(field); return n; });
  }

  function validate(): boolean {
    const errs = new Set<string>();
    if (!employeeId) errs.add("employee");
    const amtVal = Number(amount);
    if (!amount || isNaN(amtVal) || amtVal <= 0) errs.add("amount");
    if (!purpose.trim() || purpose.trim().length < 2) errs.add("purpose");
    const mo = parseInt(months, 10);
    if (!months || isNaN(mo) || mo < 1 || mo > 12) errs.add("months");
    setInvalid(errs);
    return errs.size === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = {
        employeeId,
        amountMinor: Math.round(Number(amount) * 100),
        purpose: purpose.trim(),
        recoveryMonths: parseInt(months, 10),
      };
      if (requestDate) body.requestDate = requestDate;
      const res = await fetch("/api/proxy/v1/hrms/salary-advances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        setMessage({ tone: "bad", text: err.message ?? `Failed (${res.status})` });
        return;
      }
      setMessage({ tone: "good", text: "Advance request submitted." });
      setAmount(""); setPurpose(""); setMonths("3"); setRequestDate("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="card-h" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3>Request Advance</h3>
        <button
          type="button"
          className="btn primary sm"
          style={{ minHeight: 36 }}
          onClick={() => { setOpen((o) => !o); setMessage(null); }}
          aria-expanded={open}
        >
          {open ? "✕ Cancel" : "+ New Request"}
        </button>
      </div>

      {message && (
        <p role="alert" className={`pill ${message.tone}`} style={{ margin: "0 20px 8px" }}>
          {message.text}
        </p>
      )}

      {open && (
        <form onSubmit={handleSubmit} noValidate style={{ padding: "0 20px 20px", display: "grid", gap: 14 }}>
          <div>
            <label htmlFor={ids.employee} style={{ fontSize: 13, fontWeight: 500 }}>
              Employee <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
            </label>
            <select id={ids.employee} value={employeeId}
              onChange={(e) => { setEmployeeId(e.target.value); clearErr("employee"); }}
              style={invalid.has("employee") ? inputErrStyle : inputStyle}
              aria-invalid={invalid.has("employee")}>
              {employees.length === 0
                ? <option value="">Loading…</option>
                : employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name} ({emp.employeeNo})</option>
                  ))}
            </select>
            {invalid.has("employee") && <p role="alert" style={fieldErrStyle}>Please select an employee.</p>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
            <div>
              <label htmlFor={ids.amount} style={{ fontSize: 13, fontWeight: 500 }}>
                Amount (₹) <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
              </label>
              <input id={ids.amount} type="number" min={1} step={1} value={amount}
                onChange={(e) => { setAmount(e.target.value); clearErr("amount"); }}
                placeholder="e.g. 10000"
                style={invalid.has("amount") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("amount")} />
              {invalid.has("amount") && <p role="alert" style={fieldErrStyle}>Enter a valid amount.</p>}
            </div>
            <div>
              <label htmlFor={ids.months} style={{ fontSize: 13, fontWeight: 500 }}>
                Recovery Months <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
              </label>
              <input id={ids.months} type="number" min={1} max={12} step={1} value={months}
                onChange={(e) => { setMonths(e.target.value); clearErr("months"); }}
                style={invalid.has("months") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("months")} />
              {invalid.has("months") ? (
                <p role="alert" style={fieldErrStyle}>Enter 1–12 months.</p>
              ) : (
                <p style={{ fontSize: 11, color: "var(--mut)", margin: "3px 0 0" }}>Max 12 months</p>
              )}
            </div>
            <div>
              <label htmlFor={ids.date} style={{ fontSize: 13, fontWeight: 500 }}>Request Date</label>
              <input id={ids.date} type="date" value={requestDate}
                onChange={(e) => setRequestDate(e.target.value)}
                style={inputStyle} />
            </div>
          </div>

          <div>
            <label htmlFor={ids.purpose} style={{ fontSize: 13, fontWeight: 500 }}>
              Purpose <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
            </label>
            <input id={ids.purpose} type="text" minLength={2} maxLength={200} value={purpose}
              onChange={(e) => { setPurpose(e.target.value); clearErr("purpose"); }}
              placeholder="Reason for advance request (min 2 chars)"
              style={invalid.has("purpose") ? inputErrStyle : inputStyle}
              aria-invalid={invalid.has("purpose")}
              aria-describedby={invalid.has("purpose") ? `${ids.purpose}-err` : undefined} />
            {invalid.has("purpose") && <p id={`${ids.purpose}-err`} role="alert" style={fieldErrStyle}>Purpose must be at least 2 characters.</p>}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" className="btn primary" disabled={busy || employees.length === 0} style={{ minHeight: 44, minWidth: 160 }}>
              {busy ? "Submitting…" : "Submit Request"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
