"use client";

import { useState } from "react";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

interface Draft { id: string; status: string; channel: string; assistedBy: string | null }
interface Ack { applicationId: string; trackingNo: string; status: string; channel: string; acknowledgedAt: string }
interface Track { trackingNo: string; status: string; channel: string; applicationId: string }

/** SVC-082 — draft → submit (acknowledgement + tracking) → track. */
export function IntakePanel() {
  const [serviceId, setServiceId] = useState("");
  const [channel, setChannel] = useState("portal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ack, setAck] = useState<Ack | null>(null);
  const [trackNo, setTrackNo] = useState("");
  const [track, setTrack] = useState<Track | null>(null);

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`/api/proxy${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.text()) || "Request failed.");
    return (await res.json()) as T;
  }

  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setAck(null);
    try {
      setDraft(await post<Draft>("/v1/citizen/intake/drafts", { serviceId, channel }));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  }

  async function submitDraft() {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const a = await post<Ack>(`/v1/citizen/intake/drafts/${draft.id}/submit`, {});
      setAck(a); setTrackNo(a.trackingNo); setDraft(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  }

  async function doTrack(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setTrack(null);
    try {
      const res = await fetch(`/api/proxy/v1/citizen/intake/track/${encodeURIComponent(trackNo)}`);
      if (!res.ok) throw new Error((await res.text()) || "Not found.");
      setTrack((await res.json()) as Track);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <form onSubmit={saveDraft} className="pad" style={{ maxWidth: 620 }}>
          <h4 style={{ marginTop: 0 }}>New application draft</h4>
          <label htmlFor="in-svc" style={labelStyle}>Service ID (UUID)</label>
          <input id="in-svc" value={serviceId} onChange={(e) => setServiceId(e.target.value)} style={inputStyle} placeholder="00000000-0000-4000-8000-000000000000" />
          <label htmlFor="in-ch" style={labelStyle}>Channel</label>
          <select id="in-ch" value={channel} onChange={(e) => setChannel(e.target.value)} style={inputStyle}>
            <option value="portal">Portal (self-service)</option>
            <option value="mobile">Mobile</option>
            <option value="counter">Counter (assisted)</option>
            <option value="assisted">Assisted</option>
          </select>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy || !serviceId}>
            {busy ? "Saving…" : "Save draft"}
          </button>
          {draft ? (
            <div className="pad" style={{ marginTop: 12, background: "var(--surface, #f8fafc)", borderRadius: 8 }}>
              Draft saved ({draft.channel}{draft.assistedBy ? `, assisted by ${draft.assistedBy}` : ""}).{" "}
              <button type="button" className="btn" style={{ minHeight: 40 }} onClick={submitDraft} disabled={busy}>Submit for acknowledgement</button>
            </div>
          ) : null}
          {ack ? (
            <div role="status" className="pad" style={{ marginTop: 12, background: "#ecfdf3", borderRadius: 8 }}>
              Acknowledged. Tracking number <strong>{ack.trackingNo}</strong> — status {ack.status}.
            </div>
          ) : null}
          {error ? <p role="alert" style={{ color: "#b42318", fontSize: 13 }}>{error}</p> : null}
        </form>
      </div>

      <div className="card">
        <form onSubmit={doTrack} className="pad" style={{ maxWidth: 620 }}>
          <h4 style={{ marginTop: 0 }}>Track an application</h4>
          <label htmlFor="in-track" style={labelStyle}>Tracking number</label>
          <input id="in-track" value={trackNo} onChange={(e) => setTrackNo(e.target.value)} style={inputStyle} placeholder="CIT-2026-XXXXXXXX" />
          <button type="submit" className="btn" style={{ minHeight: 44 }} disabled={busy || !trackNo}>Track</button>
          {track ? (
            <div className="pad" style={{ marginTop: 12 }}>
              <strong>{track.trackingNo}</strong> — status {track.status} ({track.channel})
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
