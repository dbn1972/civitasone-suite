"use client";

import { useState } from "react";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

interface Match { id: string; serviceId: string; outcome: string; strength?: string }

/**
 * SVC-090 — consent-gated discovery: grant consent, then run matching against
 * published eligibility rule sets. No run is possible without an active consent
 * (the API returns 403 CONSENT_REQUIRED, surfaced here).
 */
export function DiscoveryPanel() {
  const [citizenId, setCitizenId] = useState("");
  const [profile, setProfile] = useState('{\n  "age": 65,\n  "income_proof": "x"\n}');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);

  async function grant() {
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/citizen/discovery/consent", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ citizenId }),
      });
      if (!res.ok && res.status !== 409) throw new Error((await res.text()) || "Could not grant consent.");
      setMessage("Consent recorded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not grant consent.");
    } finally { setBusy(false); }
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setMessage(""); setMatches([]);
    try {
      let parsed: unknown = {};
      try { parsed = JSON.parse(profile); } catch { throw new Error("Profile must be valid JSON."); }
      const res = await fetch("/api/proxy/v1/citizen/discovery/run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ citizenId, profile: parsed }),
      });
      if (res.status === 403) throw new Error("Consent required — grant consent before running discovery.");
      if (!res.ok) throw new Error((await res.text()) || "Discovery failed.");
      const body = await res.json();
      setMatches(Array.isArray(body.matches) ? body.matches : []);
      setMessage(`${body.notified ?? 0} likely-eligible service(s) found and notified.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Discovery failed.");
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <form onSubmit={run} className="pad" style={{ maxWidth: 620 }}>
        <label htmlFor="disc-citizen" style={labelStyle}>Citizen ID (UUID)</label>
        <input id="disc-citizen" value={citizenId} onChange={(e) => setCitizenId(e.target.value)} style={inputStyle} placeholder="00000000-0000-4000-8000-000000000000" />
        <label htmlFor="disc-profile" style={labelStyle}>Citizen profile (JSON)</label>
        <textarea id="disc-profile" value={profile} onChange={(e) => setProfile(e.target.value)} style={{ ...inputStyle, minHeight: 120, fontFamily: "monospace" }} />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy || !citizenId} onClick={grant}>Grant consent</button>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy || !citizenId}>{busy ? "Running…" : "Run discovery"}</button>
        </div>
        {message ? <p role="status" style={{ color: "#067647", fontSize: 13 }}>{message}</p> : null}
        {error ? <p role="alert" style={{ color: "#b42318", fontSize: 13 }}>{error}</p> : null}
      </form>

      {matches.length > 0 ? (
        <div className="pad" style={{ borderTop: "1px solid var(--line)" }}>
          <strong style={{ fontSize: 13 }}>Likely-eligible services</strong>
          <ul style={{ marginTop: 8, fontSize: 13 }}>
            {matches.map((m) => (
              <li key={m.id}>{m.serviceId} — {m.outcome}{m.strength ? ` (${m.strength})` : ""}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
