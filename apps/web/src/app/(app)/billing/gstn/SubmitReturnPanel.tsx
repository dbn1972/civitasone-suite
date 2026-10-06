"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Button, ConfirmDialog, StatusPill } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import { isValidGstin } from "@/lib/gstin";

const RETURN_TYPES = ["GSTR1", "GSTR3B", "GSTR9", "GSTR9C"] as const;

interface GstReturnResult {
  referenceId: string;
  status: "submitted" | "processing" | "filed" | "rejected";
  gstin: string;
  returnPeriod: string;
  submittedAt: string;
}

const PERIOD_RE = /^\d{2}\/\d{4}$/;
// A clerk types rupees with up to 2 decimals; rupeesToMinorString does the
// float-free paise conversion. Reject >2 decimals etc. there.
const RUPEE_INPUT_RE = /^\d+(\.\d{1,2})?$/;

const MONEY_FIELDS = [
  { key: "totalTaxableValue", label: "Total Taxable Value (₹)" },
  { key: "totalCgst", label: "Total CGST (₹)" },
  { key: "totalSgst", label: "Total SGST (₹)" },
  { key: "totalIgst", label: "Total IGST (₹)" },
] as const;

export function SubmitReturnPanel({
  onSubmitted,
  onCheckStatus,
  disabled = false,
}: {
  onSubmitted?: (referenceId: string) => void;
  onCheckStatus?: (referenceId: string) => void;
  disabled?: boolean;
} = {}) {
  const [gstin, setGstin] = useState("");
  const [returnPeriod, setReturnPeriod] = useState("");
  const [returnType, setReturnType] = useState<(typeof RETURN_TYPES)[number]>("GSTR1");
  const [money, setMoney] = useState<Record<string, string>>({
    totalTaxableValue: "",
    totalCgst: "",
    totalSgst: "",
    totalIgst: "",
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<GstReturnResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const idempotencyKeyRef = useRef<string | null>(null);

  const gstinId = useId();
  const periodId = useId();
  const typeId = useId();
  const baseId = useId();

  // Convert each rupee entry to a paise string; invalid -> null.
  const paise = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const f of MONEY_FIELDS) out[f.key] = money[f.key] ? rupeesToMinorString(money[f.key], { allowZero: true }) : null;
    return out;
  }, [money]);

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!isValidGstin(gstin)) errors.gstin = "Enter a valid 15-character GSTIN (checksum must match, e.g. 27AAPFU0939F1ZV).";
    if (!PERIOD_RE.test(returnPeriod)) errors.returnPeriod = "Enter the return period as MM/YYYY, e.g. 04/2026.";
    for (const f of MONEY_FIELDS) {
      const v = money[f.key];
      if (!v || !RUPEE_INPUT_RE.test(v)) errors[f.key] = `Enter ${f.label.replace(" (₹)", "")} in rupees (max 2 decimals).`;
      else if (rupeesToMinorString(v, { allowZero: true }) === null) errors[f.key] = "Amount can have at most 2 decimal places.";
    }
    return errors;
  }

  function handleReview(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setResult(null);
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    // Open the confirm/review step; nothing is POSTed until the user confirms.
    setConfirmOpen(true);
  }

  async function doSubmit() {
    setBusy(true);
    setSubmitError(null);
    // Stable idempotency key per confirmed submission so a double-click/retry
    // of the SAME filing doesn't file twice (proxy forwards x-idempotency-key).
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    }
    try {
      const res = await browserJson<{ data: GstReturnResult }>("v1/billing/gstn/returns", {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKeyRef.current },
        body: JSON.stringify({
          gstin,
          returnPeriod,
          returnType,
          totalTaxableValue: paise.totalTaxableValue,
          totalCgst: paise.totalCgst,
          totalSgst: paise.totalSgst,
          totalIgst: paise.totalIgst,
        }),
      });
      setConfirmOpen(false);
      setResult(res.data);
      idempotencyKeyRef.current = null; // next distinct filing gets a fresh key
      onSubmitted?.(res.data.referenceId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyRef() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.referenceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

  return (
    <form onSubmit={handleReview} aria-label="Submit GST return" style={{ display: "grid", gap: 14, maxWidth: 560 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor={gstinId} style={{ fontSize: 13, fontWeight: 600 }}>
          GSTIN <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
        </label>
        <input
          id={gstinId}
          value={gstin}
          onChange={(e) => setGstin(e.target.value.toUpperCase())}
          maxLength={15}
          aria-required="true"
          aria-invalid={!!fieldErrors.gstin || undefined}
          aria-describedby={fieldErrors.gstin ? `${gstinId}-error` : undefined}
          style={inputStyle}
        />
        {fieldErrors.gstin && (
          <p id={`${gstinId}-error`} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
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
          value={returnPeriod}
          onChange={(e) => setReturnPeriod(e.target.value)}
          placeholder="04/2026"
          aria-required="true"
          aria-invalid={!!fieldErrors.returnPeriod || undefined}
          aria-describedby={fieldErrors.returnPeriod ? `${periodId}-error` : undefined}
          style={inputStyle}
        />
        {fieldErrors.returnPeriod && (
          <p id={`${periodId}-error`} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
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
          style={inputStyle}
        >
          {RETURN_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {MONEY_FIELDS.map((f, i) => {
        const errId = `${baseId}-${i}-error`;
        const value = money[f.key];
        const minor = value && RUPEE_INPUT_RE.test(value) ? rupeesToMinorString(value, { allowZero: true }) : null;
        return (
          <div key={f.key} style={{ display: "grid", gap: 6 }}>
            <label htmlFor={`${baseId}-${i}`} style={{ fontSize: 13, fontWeight: 600 }}>
              {f.label} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={`${baseId}-${i}`}
              inputMode="decimal"
              value={value}
              onChange={(e) => setMoney((m) => ({ ...m, [f.key]: e.target.value.replace(/[^\d.]/g, "") }))}
              aria-required="true"
              aria-invalid={!!fieldErrors[f.key] || undefined}
              aria-describedby={fieldErrors[f.key] ? errId : undefined}
              style={inputStyle}
            />
            {minor !== null && (
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>{formatMoney(minor)}</span>
            )}
            {fieldErrors[f.key] && (
              <p id={errId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                {fieldErrors[f.key]}
              </p>
            )}
          </div>
        );
      })}

      <div>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={busy || disabled}>
          Submit Return
        </Button>
      </div>

      {/* GAP-BILLING-GSTN-03: these totals are hand-keyed and are NOT reconciled
          against this office's billing invoices/ledger — be explicit so an
          officer doesn't assume the figures were derived or cross-checked.
          Prefill-from-invoices + variance reconciliation needs a backend
          return-preparation endpoint (keyed by buyer GSTIN + period, which the
          invoice records don't yet carry); flagged for finance/tax sign-off. */}
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }} role="note">
        These amounts are entered by you and are not automatically checked against your billing
        invoices or ledger. Verify them before filing.
      </p>

      {submitError && (
        <p role="alert" className="pill bad" style={{ width: "fit-content" }}>
          {submitError}
        </p>
      )}

      {result && (
        <div className="fields" role="status">
          <div className="field">
            <span className="label">Reference ID</span>
            <span>
              <span className="mono">{result.referenceId}</span>{" "}
              <Button variant="ghost" size="sm" onClick={copyRef} type="button" aria-label="Copy reference ID">
                {copied ? "Copied" : "Copy"}
              </Button>
            </span>
          </div>
          <div className="field"><span className="label">Status</span><span><StatusPill status={result.status} /></span></div>
          <div className="field"><span className="label">GSTIN</span><span className="mono">{result.gstin}</span></div>
          <div className="field"><span className="label">Return Period</span><span>{result.returnPeriod}</span></div>
          <div className="field"><span className="label">Submitted</span><span>{result.submittedAt}</span></div>
          {onCheckStatus && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <Button variant="ghost" size="sm" type="button" onClick={() => onCheckStatus(result.referenceId)}>
                Check status →
              </Button>
            </div>
          )}
        </div>
      )}

      {/* GAP-BILLING-GSTN-01: review step — a summary of exactly what will be
          filed; nothing is POSTed until the officer confirms. */}
      <ConfirmDialog
        open={confirmOpen}
        title={`File ${returnType} for ${returnPeriod}?`}
        confirmLabel="File return"
        danger
        busy={busy}
        description={
          <div style={{ display: "grid", gap: 4 }}>
            <p style={{ margin: 0 }}>
              This files a GST return to the external GSTN portal and is effectively irreversible. Please confirm:
            </p>
            <div className="fields">
              <div className="field"><span className="label">GSTIN</span><span className="mono">{gstin}</span></div>
              <div className="field"><span className="label">Period</span><span>{returnPeriod}</span></div>
              <div className="field"><span className="label">Type</span><span>{returnType}</span></div>
              <div className="field"><span className="label">Taxable Value</span><span>{formatMoney(paise.totalTaxableValue)}</span></div>
              <div className="field"><span className="label">CGST</span><span>{formatMoney(paise.totalCgst)}</span></div>
              <div className="field"><span className="label">SGST</span><span>{formatMoney(paise.totalSgst)}</span></div>
              <div className="field"><span className="label">IGST</span><span>{formatMoney(paise.totalIgst)}</span></div>
            </div>
          </div>
        }
        onConfirm={() => void doSubmit()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
