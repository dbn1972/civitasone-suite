"use client";

import { useId, useRef, useState } from "react";
import { Card } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type VerifyResponse = {
  data: {
    valid: boolean;
    signerCN: string | null;
    signedAt: string | null;
    certificateExpiry: string | null;
    issues: string[];
  };
};

const MAX_BYTES = 2 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the data: URL prefix, keep the base64 payload only
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function VerifyForm16Form() {
  const fileRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResponse["data"] | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a Form-16 PDF to verify.");
      fileRef.current?.focus();
      return;
    }
    if (file.type && file.type !== "application/pdf") {
      setError("Only PDF files can be verified.");
      fileRef.current?.focus();
      return;
    }
    if (file.size === 0) {
      setError("The selected file is empty.");
      fileRef.current?.focus();
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("PDF exceeds the 2 MB verification limit.");
      fileRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const pdfBase64 = await fileToBase64(file);
      const res = await browserJson<VerifyResponse>("v1/payroll/tax/form16/verify", {
        method: "POST",
        body: JSON.stringify({ pdfBase64 }),
      });
      setResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={{ marginTop: 16 }}>
      <Card title="Verify a Form-16" padding>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 600 }}>
              Form-16 PDF <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={inputId}
              ref={fileRef}
              type="file"
              accept="application/pdf"
              aria-required="true"
              aria-invalid={!!error || undefined}
              aria-describedby={error ? errId : undefined}
              style={{ fontSize: 13 }}
            />
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              {busy ? "Verifying…" : "Verify signature"}
            </button>
          </div>

          {error && (
            <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
              {error}
            </p>
          )}

          {result && (
            <div
              role="status"
              aria-live="polite"
              style={{
                borderRadius: 8,
                padding: 12,
                border: `1px solid ${result.valid ? "#abefc6" : "#fecdca"}`,
                background: result.valid ? "#f6fef9" : "#fffbfa",
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {result.valid ? (
                  <><span aria-hidden="true">✅</span> Signature valid</>
                ) : (
                  <><span aria-hidden="true">⚠️</span> Signature invalid or unsigned</>
                )}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
                {result.signerCN && <li>Signer: {result.signerCN}</li>}
                {result.signedAt && <li>Signed at: {result.signedAt}</li>}
                {result.certificateExpiry && <li>Certificate expiry: {result.certificateExpiry}</li>}
                {result.issues.length > 0 && (
                  <li>
                    Issues:
                    <ul>
                      {result.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </Card>
    </form>
  );
}
