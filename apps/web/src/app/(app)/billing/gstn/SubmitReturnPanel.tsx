"use client";

import { useId, useRef, useState } from "react";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

const RETURN_TYPES = ["GSTR1", "GSTR3B", "GSTR9", "GSTR9C"] as const;

interface GstReturnResult {
  referenceId: string;
  status: "submitted" | "processing" | "filed" | "rejected";
  gstin: string;
  returnPeriod: string;
  submittedAt: string;
}

// Standard 15-char GSTIN structure: 2-digit state code, 10-char PAN
// (5 letters + 4 digits + 1 letter), 1-char entity number, literal "Z", 1-char checksum.
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PERIOD_RE = /^\d{2}\/\d{4}$/;
const DIGITS_RE = /^\d+$/;

export function SubmitReturnPanel() {
  const [gstin, setGstin] = useState("");
  const [returnPeriod, setReturnPeriod] = useState("");
  const [returnType, setReturnType] = useState<(typeof RETURN_TYPES)[number]>("GSTR1");
  const [totalTaxableValue, setTotalTaxableValue] = useState("");
  const [totalCgst, setTotalCgst] = useState("");
  const [totalSgst, setTotalSgst] = useState("");
  const [totalIgst, setTotalIgst] = useState("");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GstReturnResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const gstinId = useId();
  const periodId = useId();
  const typeId = useId();
  const taxableId = useId();
  const cgstId = useId();
  const sgstId = useId();
  const igstId = useId();

  const gstinErrorId = `${gstinId}-error`;
  const periodErrorId = `${periodId}-error`;
  const taxableErrorId = `${taxableId}-error`;
  const cgstErrorId = `${cgstId}-error`;
  const sgstErrorId = `${sgstId}-error`;
  const igstErrorId = `${igstId}-error`;

  const gstinRef = useRef<HTMLInputElement>(null);
  const periodRef = useRef<HTMLInputElement>(null);
  const taxableRef = useRef<HTMLInputElement>(null);
  const cgstRef = useRef<HTMLInputElement>(null);
  const sgstRef = useRef<HTMLInputElement>(null);
  const igstRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setResult(null);

    const errors: Record<string, string> = {};
    if (!GSTIN_RE.test(gstin.toUpperCase())) errors.gstin = "Enter a valid 15-character GSTIN (e.g. 22AAAAA0000A1Z5).";
    if (!PERIOD_RE.test(returnPeriod)) errors.returnPeriod = "Enter the return period as MM/YYYY, e.g. 04/2026.";
    if (!DIGITS_RE.test(totalTaxableValue)) errors.totalTaxableValue = "Enter the taxable value in paise as digits only.";
    if (!DIGITS_RE.test(totalCgst)) errors.totalCgst = "Enter CGST in paise as digits only.";
    if (!DIGITS_RE.test(totalSgst)) errors.totalSgst = "Enter SGST in paise as digits only.";
    if (!DIGITS_RE.test(totalIgst)) errors.totalIgst = "Enter IGST in paise as digits only.";
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      const firstRef = errors.gstin ? gstinRef
        : errors.returnPeriod ? periodRef
        : errors.totalTaxableValue ? taxableRef
        : errors.totalCgst ? cgstRef
        : errors.totalSgst ? sgstRef
        : igstRef;
      firstRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const res = await browserJson<{ data: GstReturnResult }>("v1/billing/gstn/returns", {
        method: "POST",
        body: JSON.stringify({
          gstin,
          returnPeriod,
          returnType,
          totalTaxableValue,
          totalCgst,
          totalSgst,
          totalIgst,
        }),
      });
      setResult(res.data);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Submit GST return" style={{ display: "grid", gap: 14, maxWidth: 560 }}>
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
          aria-invalid={!!fieldErrors.gstin || undefined}
          aria-describedby={fieldErrors.gstin ? gstinErrorId : undefined}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
        />
        {fieldErrors.gstin && (
          <p id={gstinErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
            {fieldErrors.gstin}
          </p>
        )}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor={periodId} style={{ fontSize: 13, fontWeight: 600 }}>
          Return Period (MM/YYYY) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
        </label>
        <input
          id={periodId}
          ref={periodRef}
          value={returnPeriod}
          onChange={(e) => setReturnPeriod(e.target.value)}
          placeholder="04/2026"
          aria-required="true"
          aria-invalid={!!fieldErrors.returnPeriod || undefined}
          aria-describedby={fieldErrors.returnPeriod ? periodErrorId : undefined}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
        />
        {fieldErrors.returnPeriod && (
          <p id={periodErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
            {fieldErrors.returnPeriod}
          </p>
        )}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor={typeId} style={{ fontSize: 13, fontWeight: 600 }}>
          Return Type <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
        </label>
        <select
          id={typeId}
          value={returnType}
          onChange={(e) => setReturnType(e.target.value as (typeof RETURN_TYPES)[number])}
          aria-required="true"
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
        >
          {RETURN_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {(
        [
          { id: taxableId, ref: taxableRef, errId: taxableErrorId, label: "Total Taxable Value (paise)", value: totalTaxableValue, set: setTotalTaxableValue, err: fieldErrors.totalTaxableValue },
          { id: cgstId, ref: cgstRef, errId: cgstErrorId, label: "Total CGST (paise)", value: totalCgst, set: setTotalCgst, err: fieldErrors.totalCgst },
          { id: sgstId, ref: sgstRef, errId: sgstErrorId, label: "Total SGST (paise)", value: totalSgst, set: setTotalSgst, err: fieldErrors.totalSgst },
          { id: igstId, ref: igstRef, errId: igstErrorId, label: "Total IGST (paise)", value: totalIgst, set: setTotalIgst, err: fieldErrors.totalIgst },
        ] as const
      ).map((f) => (
        <div key={f.id} style={{ display: "grid", gap: 6 }}>
          <label htmlFor={f.id} style={{ fontSize: 13, fontWeight: 600 }}>
            {f.label} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
          </label>
          <input
            id={f.id}
            ref={f.ref}
            inputMode="numeric"
            value={f.value}
            onChange={(e) => f.set(e.target.value.replace(/[^\d]/g, ""))}
            aria-required="true"
            aria-invalid={!!f.err || undefined}
            aria-describedby={f.err ? f.errId : undefined}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
          />
          {f.value && DIGITS_RE.test(f.value) && (
            <span style={{ fontSize: 12, color: "var(--ink2)" }}>{formatMoney(f.value)}</span>
          )}
          {f.err && (
            <p id={f.errId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
              {f.err}
            </p>
          )}
        </div>
      ))}

      <div>
        <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
          {busy ? "Submitting…" : "Submit Return"}
        </button>
      </div>

      {submitError && (
        <p role="alert" className="pill bad" style={{ width: "fit-content" }}>
          {submitError}
        </p>
      )}

      {result && (
        <div className="fields" role="status">
          <div className="field"><span className="label">Reference ID</span><span className="mono">{result.referenceId}</span></div>
          <div className="field"><span className="label">Status</span><span>{result.status}</span></div>
          <div className="field"><span className="label">GSTIN</span><span className="mono">{result.gstin}</span></div>
          <div className="field"><span className="label">Return Period</span><span>{result.returnPeriod}</span></div>
          <div className="field"><span className="label">Submitted</span><span>{result.submittedAt}</span></div>
        </div>
      )}
    </form>
  );
}
