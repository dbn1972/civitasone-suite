"use client";

import { useState } from "react";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

interface VerifyResult {
  found: boolean;
  validity?: string;
  certNo?: string | null;
  certType?: string;
  status?: string;
  validTo?: string | null;
  payloadHash?: string | null;
}

/**
 * SVC-086 — public QR/token verification. A citizen or third party pastes the
 * token embedded in the certificate's QR code to confirm authenticity.
 */
export function CertificateVerify() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setResult(null);
    try {
      const res = await fetch(`/api/proxy/v1/citizen/certificates/verify/${encodeURIComponent(token)}`);
      if (res.status === 404) { setResult({ found: false, validity: "invalid" }); return; }
      if (!res.ok) throw new Error((await res.text()) || "Verification failed.");
      setResult((await res.json()) as VerifyResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  const color = result?.validity === "valid" ? "#ecfdf3" : result?.validity === "expired" ? "#fffaeb" : "#fef3f2";

  return (
    <div className="card">
      <form onSubmit={verify} className="pad" style={{ maxWidth: 620 }}>
        <h4 style={{ marginTop: 0 }}>Verify a certificate</h4>
        <label htmlFor="verify-token" style={labelStyle}>Verification token (from QR code)</label>
        <input id="verify-token" value={token} onChange={(e) => setToken(e.target.value)} style={inputStyle} placeholder="paste token" />
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy || !token}>
          {busy ? "Verifying…" : "Verify"}
        </button>
        {error ? <p role="alert" style={{ color: "#b42318", fontSize: 13 }}>{error}</p> : null}
      </form>

      {result ? (
        <div className="pad" style={{ borderTop: "1px solid var(--line)" }}>
          <div style={{ display: "inline-block", padding: "4px 12px", borderRadius: 999, background: color, fontWeight: 600 }}>
            {result.found ? `Certificate is ${result.validity}` : "Certificate not found"}
          </div>
          {result.found ? (
            <dl style={{ fontSize: 13, marginTop: 12 }}>
              <div><strong>Number:</strong> {result.certNo}</div>
              <div><strong>Type:</strong> {result.certType}</div>
              <div><strong>Status:</strong> {result.status}</div>
              <div><strong>Valid to:</strong> {result.validTo || "—"}</div>
              <div style={{ wordBreak: "break-all" }}><strong>Payload hash:</strong> {result.payloadHash}</div>
            </dl>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
