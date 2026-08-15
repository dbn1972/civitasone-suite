"use client";

import { useId, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";

/**
 * AdvanceSlideOver — slide-over form to raise a government advance.
 * GFR 2017 Rule 290: advance type, amount, purpose and repayment schedule
 * must be recorded. Max repayment: 24 months.
 */

const ADVANCE_TYPES = ["TA", "Medical", "Festival", "HBA"] as const;
type AdvanceType = (typeof ADVANCE_TYPES)[number];

const inputBase: CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--bg2)",
  color: "var(--ink)",
  fontSize: 14,
  boxSizing: "border-box",
};
const inputErr: CSSProperties = { ...inputBase, border: "1px solid #ef4444" };
const fieldErr: CSSProperties = { color: "#b91c1c", fontSize: 12, marginTop: 3 };
const label14: CSSProperties = { fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 };
const required = <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>;

export function AdvanceSlideOver() {
  const router = useRouter();
  const ids = {
    type: useId(),
    amount: useId(),
    purpose: useId(),
    months: useId(),
    employee: useId(),
  };

  const [open, setOpen] = useState(false);
  const [advanceType, setAdvanceType] = useState<AdvanceType | "">("");
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [months, setMonths] = useState("12");
  const [errs, setErrs] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function clearErr(f: string) {
    setErrs((s) => { const n = new Set(s); n.delete(f); return n; });
  }

  function validate() {
    const e = new Set<string>();
    if (!advanceType) e.add("type");
    if (!employeeId.trim()) e.add("employee");
    const amt = Number(amount);
    if (!amount || isNaN(amt) || amt <= 0) e.add("amount");
    if (!purpose.trim() || purpose.trim().length < 5) e.add("purpose");
    const mo = parseInt(months, 10);
    if (!months || isNaN(mo) || mo < 1 || mo > 24) e.add("months");
    setErrs(e);
    return e.size === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/proxy/v1/finance/advances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employeeId: employeeId.trim(),
          advanceType,
          amountMinor: Math.round(Number(amount) * 100),
          purpose: purpose.trim(),
          recoveryMonths: parseInt(months, 10),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        setMessage({ tone: "bad", text: body.message ?? `Failed (${res.status})` });
        return;
      }
      setMessage({ tone: "good", text: "Advance request submitted successfully." });
      setAdvanceType(""); setEmployeeId(""); setAmount(""); setPurpose(""); setMonths("12");
      router.refresh();
      setTimeout(() => setOpen(false), 1400);
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn primary"
        onClick={() => { setOpen(true); setMessage(null); }}
        aria-haspopup="dialog"
        style={{ minHeight: 44 }}
      >
        + New Advance
      </button>

      {open && (
        /* Backdrop */
        <div
          role="presentation"
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
            zIndex: 50, display: "flex", justifyContent: "flex-end",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          {/* Panel */}
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="adv-panel-title"
            style={{
              width: "min(520px, 96vw)",
              height: "100%",
              background: "var(--bg)",
              overflowY: "auto",
              padding: "28px 24px 40px",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 id="adv-panel-title" style={{ fontSize: 18, fontWeight: 700 }}>New Advance</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                style={{ fontSize: 20, background: "none", border: "none", cursor: "pointer", color: "var(--mut)" }}
              >
                ✕
              </button>
            </div>

            <p role="note" style={{ fontSize: 13, color: "var(--mut)", margin: 0 }}>
              GFR 2017 Rule 290 — advance must be sanctioned by an authorised officer.
              Maximum repayment period: 24 months.
            </p>

            {message && (
              <p role="alert" className={`pill ${message.tone}`}>{message.text}</p>
            )}

            <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Advance Type */}
              <div>
                <label htmlFor={ids.type} style={label14}>Advance Type {required}</label>
                <select
                  id={ids.type}
                  value={advanceType}
                  onChange={(e) => { setAdvanceType(e.target.value as AdvanceType); clearErr("type"); }}
                  style={errs.has("type") ? inputErr : inputBase}
                  aria-invalid={errs.has("type")}
                >
                  <option value="">— Select type —</option>
                  {ADVANCE_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                {errs.has("type") && <p role="alert" style={fieldErr}>Select an advance type.</p>}
              </div>

              {/* Employee ID */}
              <div>
                <label htmlFor={ids.employee} style={label14}>Employee ID {required}</label>
                <input
                  id={ids.employee}
                  type="text"
                  value={employeeId}
                  onChange={(e) => { setEmployeeId(e.target.value); clearErr("employee"); }}
                  placeholder="e.g. EMP00123"
                  style={errs.has("employee") ? inputErr : inputBase}
                  aria-invalid={errs.has("employee")}
                />
                {errs.has("employee") && <p role="alert" style={fieldErr}>Enter employee ID.</p>}
              </div>

              {/* Amount + Months */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label htmlFor={ids.amount} style={label14}>Amount (₹) {required}</label>
                  <input
                    id={ids.amount}
                    type="number"
                    min={1}
                    step={1}
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); clearErr("amount"); }}
                    placeholder="e.g. 50000"
                    style={errs.has("amount") ? inputErr : inputBase}
                    aria-invalid={errs.has("amount")}
                  />
                  {errs.has("amount") && <p role="alert" style={fieldErr}>Enter a valid amount.</p>}
                </div>
                <div>
                  <label htmlFor={ids.months} style={label14}>Repayment Months {required}</label>
                  <input
                    id={ids.months}
                    type="number"
                    min={1}
                    max={24}
                    step={1}
                    value={months}
                    onChange={(e) => { setMonths(e.target.value); clearErr("months"); }}
                    style={errs.has("months") ? inputErr : inputBase}
                    aria-invalid={errs.has("months")}
                  />
                  {errs.has("months") ? (
                    <p role="alert" style={fieldErr}>Enter 1–24 months.</p>
                  ) : (
                    <p style={{ fontSize: 11, color: "var(--mut)", marginTop: 3 }}>Max 24 months (Rule 290)</p>
                  )}
                </div>
              </div>

              {/* Purpose */}
              <div>
                <label htmlFor={ids.purpose} style={label14}>Purpose {required}</label>
                <textarea
                  id={ids.purpose}
                  value={purpose}
                  onChange={(e) => { setPurpose(e.target.value); clearErr("purpose"); }}
                  placeholder="Describe the purpose of this advance (min 5 chars)"
                  rows={3}
                  style={errs.has("purpose") ? inputErr : inputBase}
                  aria-invalid={errs.has("purpose")}
                />
                {errs.has("purpose") && <p role="alert" style={fieldErr}>Purpose must be at least 5 characters.</p>}
              </div>

              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setOpen(false)}
                  style={{ minHeight: 44 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={busy}
                  style={{ minHeight: 44, minWidth: 160 }}
                >
                  {busy ? "Submitting…" : "Submit Advance"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
