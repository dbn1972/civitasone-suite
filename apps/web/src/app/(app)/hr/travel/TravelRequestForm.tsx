"use client";

import { useId, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";

const inputStyle: CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid var(--line)",
  borderRadius: 8, background: "var(--bg2)", color: "var(--ink)", fontSize: 14,
};
const inputErrStyle: CSSProperties = { ...inputStyle, border: "1px solid #ef4444" };
const fieldErrStyle: CSSProperties = { color: "#b91c1c", fontSize: 12, margin: "3px 0 0" };

type Fields = {
  purpose: string;
  destination: string;
  fromDate: string;
  toDate: string;
  mode: string;
  advanceRequired: string;
};

const INITIAL: Fields = {
  purpose: "", destination: "", fromDate: "", toDate: "",
  mode: "road", advanceRequired: "",
};

export function TravelRequestForm() {
  const ids = {
    purpose: useId(), destination: useId(), fromDate: useId(),
    toDate: useId(), mode: useId(), advanceRequired: useId(),
  };
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(INITIAL);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  function set(key: keyof Fields, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    setInvalid((s) => { const n = new Set(s); n.delete(key); return n; });
  }

  function validate(): boolean {
    const errs = new Set<string>();
    if (!fields.purpose.trim()) errs.add("purpose");
    if (!fields.destination.trim()) errs.add("destination");
    if (!fields.fromDate) errs.add("fromDate");
    if (!fields.toDate) errs.add("toDate");
    if (fields.fromDate && fields.toDate && fields.toDate < fields.fromDate) errs.add("toDate");
    if (fields.advanceRequired && (isNaN(Number(fields.advanceRequired)) || Number(fields.advanceRequired) <= 0)) errs.add("advanceRequired");
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
        purpose: fields.purpose.trim(),
        destination: fields.destination.trim(),
        fromDate: fields.fromDate,
        toDate: fields.toDate,
        mode: fields.mode,
      };
      if (fields.advanceRequired) {
        body.advanceRequired = Math.round(Number(fields.advanceRequired) * 100);
      }
      const res = await fetch("/api/proxy/v1/hrms/travel-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        setMessage({ tone: "bad", text: err.message ?? `Failed (${res.status})` });
        return;
      }
      setMessage({ tone: "good", text: "Travel request submitted." });
      setFields(INITIAL);
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
        <h3>Submit Travel Request</h3>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label htmlFor={ids.purpose} style={{ fontSize: 13, fontWeight: 500 }}>
                Purpose <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
              </label>
              <input id={ids.purpose} type="text" maxLength={200} value={fields.purpose}
                onChange={(e) => set("purpose", e.target.value)}
                placeholder="e.g. Field inspection — Pune"
                style={invalid.has("purpose") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("purpose")}
                aria-describedby={invalid.has("purpose") ? `${ids.purpose}-err` : undefined} />
              {invalid.has("purpose") && <p id={`${ids.purpose}-err`} role="alert" style={fieldErrStyle}>Purpose is required.</p>}
            </div>
            <div>
              <label htmlFor={ids.destination} style={{ fontSize: 13, fontWeight: 500 }}>
                Destination <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
              </label>
              <input id={ids.destination} type="text" maxLength={128} value={fields.destination}
                onChange={(e) => set("destination", e.target.value)}
                placeholder="e.g. Pune, Maharashtra"
                style={invalid.has("destination") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("destination")}
                aria-describedby={invalid.has("destination") ? `${ids.destination}-err` : undefined} />
              {invalid.has("destination") && <p id={`${ids.destination}-err`} role="alert" style={fieldErrStyle}>Destination is required.</p>}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
            <div>
              <label htmlFor={ids.fromDate} style={{ fontSize: 13, fontWeight: 500 }}>
                From Date <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
              </label>
              <input id={ids.fromDate} type="date" value={fields.fromDate}
                onChange={(e) => set("fromDate", e.target.value)}
                style={invalid.has("fromDate") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("fromDate")} />
              {invalid.has("fromDate") && <p role="alert" style={fieldErrStyle}>From date required.</p>}
            </div>
            <div>
              <label htmlFor={ids.toDate} style={{ fontSize: 13, fontWeight: 500 }}>
                To Date <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
              </label>
              <input id={ids.toDate} type="date" value={fields.toDate}
                onChange={(e) => set("toDate", e.target.value)}
                style={invalid.has("toDate") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("toDate")} />
              {invalid.has("toDate") && <p role="alert" style={fieldErrStyle}>To date must be on or after From date.</p>}
            </div>
            <div>
              <label htmlFor={ids.mode} style={{ fontSize: 13, fontWeight: 500 }}>Mode</label>
              <select id={ids.mode} value={fields.mode} onChange={(e) => set("mode", e.target.value)} style={inputStyle}>
                <option value="road">Road</option>
                <option value="rail">Rail</option>
                <option value="air">Air</option>
              </select>
            </div>
            <div>
              <label htmlFor={ids.advanceRequired} style={{ fontSize: 13, fontWeight: 500 }}>Advance Required (₹)</label>
              <input id={ids.advanceRequired} type="number" min={0} step={1} value={fields.advanceRequired}
                onChange={(e) => set("advanceRequired", e.target.value)}
                placeholder="0"
                style={invalid.has("advanceRequired") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("advanceRequired")} />
              {invalid.has("advanceRequired") && <p role="alert" style={fieldErrStyle}>Enter a valid amount.</p>}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44, minWidth: 160 }}>
              {busy ? "Submitting…" : "Submit Request"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
