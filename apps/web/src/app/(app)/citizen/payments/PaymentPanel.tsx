"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

/** SVC-085 — compute a fee then record an offline payment (issues a receipt). */
export function PaymentPanel({ schedules }: { schedules: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [scheduleId, setScheduleId] = useState(schedules[0]?.id ?? "");
  const [applicationId, setApplicationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function record(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/citizen/payments/offline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ applicationId, scheduleId, subject: {} }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Could not record payment.");
      const body = await res.json();
      setMessage(`Receipt ${body.receiptNo} issued for ${body.currency} ${body.amount}.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <form onSubmit={record} className="pad" style={{ maxWidth: 620 }}>
        <h4 style={{ marginTop: 0 }}>Record offline payment</h4>
        <label htmlFor="pay-schedule" style={labelStyle}>Fee schedule</label>
        <select id="pay-schedule" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} style={inputStyle}>
          {schedules.length === 0 ? <option value="">No schedules</option> : null}
          {schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label htmlFor="pay-app" style={labelStyle}>Application ID (UUID)</label>
        <input id="pay-app" value={applicationId} onChange={(e) => setApplicationId(e.target.value)} style={inputStyle} placeholder="00000000-0000-4000-8000-000000000000" />
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy || !scheduleId || !applicationId}>
          {busy ? "Recording…" : "Record & issue receipt"}
        </button>
        {message ? <p role="status" style={{ color: "#067647", fontSize: 13 }}>{message}</p> : null}
        {error ? <p role="alert" style={{ color: "#b42318", fontSize: 13 }}>{error}</p> : null}
      </form>
    </div>
  );
}
