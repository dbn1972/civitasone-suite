"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid var(--line)",
  borderRadius: 8, background: "var(--bg2)", color: "var(--ink)", fontSize: 14,
};
const inputErrStyle: React.CSSProperties = { ...inputStyle, border: "1px solid #ef4444" };
const fieldErrStyle: React.CSSProperties = { color: "#b91c1c", fontSize: 12, margin: "3px 0 0" };

type Fields = { name: string; date: string; type: string; applicableTo: string };
const INITIAL: Fields = { name: "", date: "", type: "gazetted", applicableTo: "all" };

export function AddHolidayForm() {
  const ids = { name: useId(), date: useId(), type: useId(), applicableTo: useId() };
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(INITIAL);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);

  function set(key: keyof Fields, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    setInvalid((s) => { const n = new Set(s); n.delete(key); return n; });
  }

  function validate(): boolean {
    const errs = new Set<string>();
    if (!fields.name.trim()) errs.add("name");
    if (!fields.date) errs.add("date");
    setInvalid(errs);
    return errs.size === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/proxy/v1/hrms/holidays", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: fields.name.trim(),
          date: fields.date,
          type: fields.type,
          applicableTo: fields.applicableTo,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        setMessage({ tone: "bad", text: err.message ?? `Failed (${res.status})` });
        return;
      }
      setMessage({ tone: "good", text: `Holiday "${fields.name.trim()}" added.` });
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
        <h3>Add Holiday</h3>
        <button
          type="button"
          className="btn primary sm"
          style={{ minHeight: 36 }}
          onClick={() => { setOpen((o) => !o); setMessage(null); }}
          aria-expanded={open}
        >
          {open ? "✕ Cancel" : "+ Add Holiday"}
        </button>
      </div>

      {open && (
        <form onSubmit={handleSubmit} noValidate style={{ padding: "16px 20px 20px", display: "grid", gap: 14 }}>
          {message && (
            <p role="alert" className={`pill ${message.tone}`} style={{ margin: 0 }}>
              {message.text}
            </p>
          )}

          <div>
            <label htmlFor={ids.name} style={{ fontSize: 13, fontWeight: 500 }}>
              Holiday Name <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              id={ids.name}
              ref={nameRef}
              type="text"
              placeholder="e.g. Republic Day"
              value={fields.name}
              onChange={(e) => set("name", e.target.value)}
              style={invalid.has("name") ? inputErrStyle : inputStyle}
              aria-invalid={invalid.has("name")}
              aria-describedby={invalid.has("name") ? `${ids.name}-err` : undefined}
              maxLength={120}
            />
            {invalid.has("name") && (
              <p id={`${ids.name}-err`} role="alert" style={fieldErrStyle}>
                Holiday name is required.
              </p>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label htmlFor={ids.date} style={{ fontSize: 13, fontWeight: 500 }}>
                Date <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>
              </label>
              <input
                id={ids.date}
                type="date"
                value={fields.date}
                onChange={(e) => set("date", e.target.value)}
                style={invalid.has("date") ? inputErrStyle : inputStyle}
                aria-invalid={invalid.has("date")}
                aria-describedby={invalid.has("date") ? `${ids.date}-err` : undefined}
              />
              {invalid.has("date") && (
                <p id={`${ids.date}-err`} role="alert" style={fieldErrStyle}>
                  Date is required.
                </p>
              )}
            </div>

            <div>
              <label htmlFor={ids.type} style={{ fontSize: 13, fontWeight: 500 }}>Type</label>
              <select
                id={ids.type}
                value={fields.type}
                onChange={(e) => set("type", e.target.value)}
                style={inputStyle}
              >
                <option value="gazetted">Gazetted</option>
                <option value="restricted">Restricted</option>
                <option value="optional">Optional</option>
                <option value="weekly_off">Weekly Off</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor={ids.applicableTo} style={{ fontSize: 13, fontWeight: 500 }}>Applicable To</label>
            <input
              id={ids.applicableTo}
              type="text"
              placeholder="all"
              value={fields.applicableTo}
              onChange={(e) => set("applicableTo", e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              className="btn primary"
              disabled={busy}
              style={{ minHeight: 44, minWidth: 140 }}
            >
              {busy ? "Saving…" : "Add Holiday"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
