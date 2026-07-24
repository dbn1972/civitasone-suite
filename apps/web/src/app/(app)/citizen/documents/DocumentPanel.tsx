"use client";

import { useState } from "react";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

interface ChecklistItem { docType: string; label?: string; mandatory: boolean; provided: boolean; verified: boolean }
interface Checklist { source: string; items: ChecklistItem[]; complete: boolean }
interface Uploaded { id: string; verificationStatus: string; providerStatus?: string; configured?: boolean }

/** SVC-084 — upload / DigiLocker fetch + required-document checklist. */
export function DocumentPanel() {
  const [serviceId, setServiceId] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [docType, setDocType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`/api/proxy${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.text()) || "Request failed.");
    return (await res.json()) as T;
  }

  async function upload(source: "upload" | "digilocker") {
    setBusy(true); setError(""); setUploaded(null);
    try {
      const body = source === "upload"
        ? { applicationId, serviceId, docType }
        : { applicationId, serviceId, docType, docUri: `digilocker://${docType}` };
      setUploaded(await post<Uploaded>(`/v1/citizen/documents/${source === "upload" ? "upload" : "digilocker-fetch"}`, body));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  }

  async function loadChecklist(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setChecklist(null);
    try {
      const qs = new URLSearchParams({ serviceId, ...(applicationId ? { applicationId } : {}) });
      const res = await fetch(`/api/proxy/v1/citizen/documents/checklist?${qs.toString()}`);
      if (!res.ok) throw new Error((await res.text()) || "Failed.");
      setChecklist((await res.json()) as Checklist);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed."); } finally { setBusy(false); }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div className="pad" style={{ maxWidth: 640 }}>
          <h4 style={{ marginTop: 0 }}>Submit a document</h4>
          <label htmlFor="d-svc" style={labelStyle}>Service ID (UUID)</label>
          <input id="d-svc" value={serviceId} onChange={(e) => setServiceId(e.target.value)} style={inputStyle} />
          <label htmlFor="d-app" style={labelStyle}>Application ID (UUID, optional)</label>
          <input id="d-app" value={applicationId} onChange={(e) => setApplicationId(e.target.value)} style={inputStyle} />
          <label htmlFor="d-type" style={labelStyle}>Document type</label>
          <input id="d-type" value={docType} onChange={(e) => setDocType(e.target.value)} style={inputStyle} placeholder="id_proof" />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn primary" style={{ minHeight: 44 }} disabled={busy || !docType || !serviceId} onClick={() => upload("upload")}>Upload</button>
            <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy || !docType || !serviceId} onClick={() => upload("digilocker")}>Fetch from DigiLocker</button>
          </div>
          {uploaded ? (
            <div className="pad" style={{ marginTop: 12, background: "var(--surface, #f8fafc)", borderRadius: 8, fontSize: 13 }}>
              Submitted — verification {uploaded.verificationStatus}
              {uploaded.providerStatus ? ` (DigiLocker: ${uploaded.providerStatus}${uploaded.configured === false ? " — provider not configured" : ""})` : ""}.
            </div>
          ) : null}
          {error ? <p role="alert" style={{ color: "#b42318", fontSize: 13 }}>{error}</p> : null}
        </div>
      </div>

      <div className="card">
        <form onSubmit={loadChecklist} className="pad" style={{ maxWidth: 640 }}>
          <h4 style={{ marginTop: 0 }}>Required-document checklist</h4>
          <button type="submit" className="btn" style={{ minHeight: 44 }} disabled={busy || !serviceId}>Load checklist</button>
          {checklist ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                Source: {checklist.source} · {checklist.complete ? "complete" : "incomplete"}
              </div>
              <ul style={{ fontSize: 13, listStyle: "none", padding: 0 }}>
                {checklist.items.map((i) => (
                  <li key={i.docType} style={{ padding: "4px 0" }}>
                    <span style={{ color: i.verified ? "#067647" : i.provided ? "#b54708" : "#b42318" }}>
                      {i.verified ? "✔ verified" : i.provided ? "• provided (pending)" : "✗ missing"}
                    </span>{" "}
                    {i.label ?? i.docType}{i.mandatory ? " (required)" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
