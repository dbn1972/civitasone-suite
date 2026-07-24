"use client";

import { useState } from "react";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

interface Reason { ruleId: string; passed: boolean; message: string }
interface Result { outcome: string; reasons: Reason[]; reviewStatus: string }

/** SVC-083 — run an eligibility check against a published rule set. */
export function EligibilityCheck() {
  const [serviceId, setServiceId] = useState("");
  const [subject, setSubject] = useState('{\n  "age": 65,\n  "income_proof": "x"\n}');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setResult(null);
    try {
      let parsed: unknown = {};
      try { parsed = JSON.parse(subject); } catch { throw new Error("Subject must be valid JSON."); }
      const res = await fetch("/api/proxy/v1/citizen/eligibility/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceId, subject: parsed }),
      });
      if (!res.ok) throw new Error((await res.text()) || "Evaluation failed.");
      setResult((await res.json()) as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluation failed.");
    } finally {
      setBusy(false);
    }
  }

  const badge = result
    ? result.outcome === "eligible" ? "#ecfdf3"
      : result.outcome === "not_eligible" ? "#fef3f2" : "#fffaeb"
    : "";

  return (
    <div className="card">
      <form onSubmit={run} className="pad" style={{ maxWidth: 620 }}>
        <h4 style={{ marginTop: 0 }}>Check eligibility</h4>
        <label htmlFor="elig-service" style={labelStyle}>Service ID (UUID)</label>
        <input id="elig-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)} style={inputStyle} placeholder="00000000-0000-4000-8000-000000000000" />
        <label htmlFor="elig-subject" style={labelStyle}>Applicant attributes (JSON)</label>
        <textarea id="elig-subject" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ ...inputStyle, minHeight: 120, fontFamily: "monospace" }} />
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy || !serviceId}>
          {busy ? "Checking…" : "Run check"}
        </button>
        {error ? <p role="alert" style={{ color: "#b42318", fontSize: 13 }}>{error}</p> : null}
      </form>

      {result ? (
        <div className="pad" style={{ borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "inline-block", padding: "4px 12px", borderRadius: 999, background: badge, fontWeight: 600 }}>
            Outcome: {result.outcome}
            {result.reviewStatus === "pending" ? " (manual review queued)" : ""}
          </div>
          <ul style={{ marginTop: 12, fontSize: 13 }}>
            {result.reasons.map((r) => (
              <li key={r.ruleId} style={{ color: r.passed ? "#067647" : "#b42318" }}>{r.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
