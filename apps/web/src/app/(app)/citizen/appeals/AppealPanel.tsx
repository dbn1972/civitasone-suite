"use client";

import { useState } from "react";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

interface Filed { id: string; status: string; filingDeadline: string }

/** SVC-089 — file an appeal against a decision within the filing window. */
export function AppealPanel() {
  const [applicationId, setApplicationId] = useState("");
  const [grounds, setGrounds] = useState("");
  const [decisionDate, setDecisionDate] = useState("");
  const [windowDays, setWindowDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filed, setFiled] = useState<Filed | null>(null);

  async function file(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setFiled(null);
    try {
      const res = await fetch("/api/proxy/v1/citizen/appeals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ applicationId: applicationId || undefined, grounds, decisionDate, windowDays: Number(windowDays) }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt.includes("FILING_WINDOW_EXPIRED") ? "The filing window for this decision has expired." : (txt || "Filing failed."));
      }
      setFiled((await res.json()) as Filed);
    } catch (e) { setError(e instanceof Error ? e.message : "Filing failed."); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <form onSubmit={file} className="pad" style={{ maxWidth: 640 }}>
        <h4 style={{ marginTop: 0 }}>File an appeal</h4>
        <label htmlFor="ap-app" style={labelStyle}>Application ID (UUID, optional)</label>
        <input id="ap-app" value={applicationId} onChange={(e) => setApplicationId(e.target.value)} style={inputStyle} />
        <label htmlFor="ap-date" style={labelStyle}>Decision date</label>
        <input id="ap-date" type="date" value={decisionDate} onChange={(e) => setDecisionDate(e.target.value)} style={inputStyle} />
        <label htmlFor="ap-win" style={labelStyle}>Filing window (days)</label>
        <input id="ap-win" type="number" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} style={inputStyle} />
        <label htmlFor="ap-grounds" style={labelStyle}>Grounds for appeal</label>
        <textarea id="ap-grounds" value={grounds} onChange={(e) => setGrounds(e.target.value)} style={{ ...inputStyle, minHeight: 96 }} />
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy || !grounds || !decisionDate}>
          {busy ? "Filing…" : "File appeal"}
        </button>
        {filed ? (
          <div role="status" className="pad" style={{ marginTop: 12, background: "#ecfdf3", borderRadius: 8 }}>
            Appeal filed — status {filed.status}. Filing deadline was {filed.filingDeadline}.
          </div>
        ) : null}
        {error ? <p role="alert" style={{ color: "#b42318", fontSize: 13 }}>{error}</p> : null}
      </form>
    </div>
  );
}
