"use client";

import { useId, useRef, useState } from "react";
import { Button, StatusPill } from "@/app/_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { isValidGstin } from "@/lib/gstin";

interface GstinVerificationResult {
  gstin: string;
  legalName: string;
  tradeName: string;
  status: "active" | "inactive" | "cancelled" | "suspended";
  registrationDate: string;
  lastUpdated: string;
}

// Structure + mod-36 checksum validation lives in lib/gstin (GAP-BILLING-GSTN-06).

export function VerifyGstinPanel({ disabled = false }: { disabled?: boolean } = {}) {
  const [gstin, setGstin] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GstinVerificationResult | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [lookupError, setLookupError] = useState<string | null>(null);

  const gstinId = useId();
  const gstinErrorId = `${gstinId}-error`;
  const gstinRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLookupError(null);
    setResult(null);

    if (!isValidGstin(gstin)) {
      setFieldError("Enter a valid 15-character GSTIN (checksum must match, e.g. 27AAPFU0939F1ZV).");
      gstinRef.current?.focus();
      return;
    }
    setFieldError(undefined);

    setBusy(true);
    try {
      const res = await browserFetch(`v1/billing/gstn/gstin/${encodeURIComponent(gstin)}/verify`);
      if (!res.ok) {
        setLookupError(await errorMessageFromResponse(res));
        return;
      }
      const body = (await res.json()) as { data: GstinVerificationResult };
      setResult(body.data);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Verify GSTIN" style={{ display: "grid", gap: 14, maxWidth: 480 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor={gstinId} style={{ fontSize: 13, fontWeight: 600 }}>
          GSTIN <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
        </label>
        <input
          id={gstinId}
          ref={gstinRef}
          value={gstin}
          onChange={(e) => setGstin(e.target.value.toUpperCase())}
          maxLength={15}
          aria-required="true"
          aria-invalid={!!fieldError || undefined}
          aria-describedby={fieldError ? gstinErrorId : undefined}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
        />
        {fieldError && (
          <p id={gstinErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
            {fieldError}
          </p>
        )}
      </div>

      <div>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={busy || disabled}>
          {busy ? "Verifying…" : "Verify GSTIN"}
        </Button>
      </div>

      {lookupError && (
        <p role="alert" className="pill bad" style={{ width: "fit-content" }}>
          {lookupError}
        </p>
      )}

      {result && (
        <div className="fields" role="status">
          <div className="field"><span className="label">GSTIN</span><span className="mono">{result.gstin}</span></div>
          <div className="field"><span className="label">Legal Name</span><span>{result.legalName}</span></div>
          <div className="field"><span className="label">Trade Name</span><span>{result.tradeName}</span></div>
          <div className="field"><span className="label">Status</span><span><StatusPill status={result.status} /></span></div>
          <div className="field"><span className="label">Registration Date</span><span>{result.registrationDate}</span></div>
          <div className="field"><span className="label">Last Updated</span><span>{result.lastUpdated}</span></div>
        </div>
      )}
    </form>
  );
}
