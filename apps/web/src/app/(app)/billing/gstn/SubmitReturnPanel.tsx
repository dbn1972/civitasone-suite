"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Button, ConfirmDialog, StatusPill } from "@/app/_components/ds";
import type { PillVariant } from "@/app/_components/ds/StatusPill";
import { browserFetch, browserJson, errorMessageFromResponse } from "@/lib/api/browserClient";
import type { FiledReturn } from "./FilingHistoryPanel";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString, minorToDecimalString } from "@/lib/money";
import { isValidGstin } from "@/lib/gstin";

const RETURN_TYPES = ["GSTR1", "GSTR3B", "GSTR9", "GSTR9C"] as const;

// GAP-BILLING-GSTN-07: GSTN "filed" means the return was accepted by the portal —
// a terminal success state (like "paid"/"completed"). STATUS_MAP maps "filed"
// to "warn" for the RTI module (a filed RTI case is still in-progress). Carry an
// explicit variant override here so the pill reads green only in this GSTN context.
const GSTN_RESULT_TONE: Partial<Record<string, PillVariant>> = { filed: "good" };

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

/** GAP-BILLING-GSTN-03: server-computed totals from the officer's own issued invoices (paise strings). */
interface ReturnPreparation {
  gstin: string;
  period: string;
  invoiceCount: number;
  totalTaxableMinor: string;
  totalCgstMinor: string;
  totalSgstMinor: string;
  totalIgstMinor: string;
  unsplitTaxMinor: string;
  unsplitTaxInvoiceCount: number;
}

const PREPARED_MINOR: Record<string, keyof ReturnPreparation> = {
  totalTaxableValue: "totalTaxableMinor",
  totalCgst: "totalCgstMinor",
  totalSgst: "totalSgstMinor",
  totalIgst: "totalIgstMinor",
};

const MONEY_FIELDS = [
  { key: "totalTaxableValue", label: "Total Taxable Value (₹)" },
  { key: "totalCgst", label: "Total CGST (₹)" },
  { key: "totalSgst", label: "Total SGST (₹)" },
  { key: "totalIgst", label: "Total IGST (₹)" },
] as const;

const DUPLICATE_STATUS_LABEL: Record<string, string> = {
  submitted: "submitted",
  processing: "being processed",
  filed: "filed",
  rejected: "rejected",
};

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
  // GAP-BILLING-GSTN-05: returns already filed for this GSTIN + period + type (not rejected).
  const [duplicates, setDuplicates] = useState<FiledReturn[]>([]);
  // GAP-BILLING-GSTN-03: invoice-derived totals for the GSTIN + period they were fetched for.
  const [prepared, setPrepared] = useState<ReturnPreparation | null>(null);
  const [prepareBusy, setPrepareBusy] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  // The variance signature the officer has explicitly acknowledged; any change to the typed
  // totals or the invoice totals changes the signature and invalidates the acknowledgement.
  const [ackedSig, setAckedSig] = useState<string>("");
  const ackRef = useRef<HTMLInputElement>(null);

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

  // Only compare against invoice totals that were fetched for what is typed now.
  const activePrepared = prepared && prepared.gstin === gstin && prepared.period === returnPeriod ? prepared : null;
  const variance = useMemo(() => {
    if (!activePrepared) return [] as Array<{ key: string; label: string; typed: string | null; invoices: string }>;
    return MONEY_FIELDS.flatMap((f) => {
      const invoices = activePrepared[PREPARED_MINOR[f.key]] as string;
      const typed = paise[f.key] ?? null;
      return typed !== null && typed === invoices ? [] : [{ key: f.key, label: f.label.replace(" (₹)", ""), typed, invoices }];
    });
  }, [activePrepared, paise]);
  const varianceSig = variance.map((v) => `${v.key}:${v.typed ?? "-"}:${v.invoices}`).join("|");

  async function prefillFromInvoices() {
    setPrepareError(null);
    const errors: Record<string, string> = {};
    if (!isValidGstin(gstin)) errors.gstin = "Enter a valid 15-character GSTIN (checksum must match, e.g. 27AAPFU0939F1ZV).";
    if (!PERIOD_RE.test(returnPeriod)) errors.returnPeriod = "Enter the return period as MM/YYYY, e.g. 04/2026.";
    if (Object.keys(errors).length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...errors }));
      return;
    }
    setPrepareBusy(true);
    try {
      const res = await browserFetch(`v1/billing/gstn/returns/prepare?gstin=${encodeURIComponent(gstin)}&period=${encodeURIComponent(returnPeriod)}`);
      if (!res.ok) {
        setPrepareError(await errorMessageFromResponse(res));
        return;
      }
      const body = (await res.json()) as { data?: ReturnPreparation };
      const d = body.data;
      if (!d) {
        setPrepareError("Could not read the invoice totals. Please try again.");
        return;
      }
      setPrepared(d);
      setMoney({
        totalTaxableValue: minorToDecimalString(d.totalTaxableMinor) ?? "",
        totalCgst: minorToDecimalString(d.totalCgstMinor) ?? "",
        totalSgst: minorToDecimalString(d.totalSgstMinor) ?? "",
        totalIgst: minorToDecimalString(d.totalIgstMinor) ?? "",
      });
      setFieldErrors({});
    } catch {
      setPrepareError("Network error. Please try again.");
    } finally {
      setPrepareBusy(false);
    }
  }

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

  /**
   * GAP-BILLING-GSTN-05: look up returns already filed for exactly this GSTIN, period and type
   * (local history, read-only). A failed lookup shows no warning rather than blocking the filing.
   */
  async function findDuplicates(): Promise<FiledReturn[]> {
    try {
      const qs = `gstin=${encodeURIComponent(gstin)}&period=${encodeURIComponent(returnPeriod)}&returnType=${returnType}&limit=5`;
      const res = await browserFetch(`v1/billing/gstn/returns?${qs}`);
      if (!res.ok) return [];
      const body = (await res.clone().json()) as { data?: unknown };
      return Array.isArray(body.data) ? (body.data as FiledReturn[]).filter((r) => r.status !== "rejected") : [];
    } catch {
      return [];
    }
  }

  async function handleReview(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setResult(null);
    const errors = validate();
    // GAP-BILLING-GSTN-03: filing totals that differ from the invoice totals needs an explicit acknowledgement.
    if (Object.keys(errors).length === 0 && variance.length > 0 && ackedSig !== varianceSig) {
      errors.variance = "These totals differ from your issued invoices. Tick the box to confirm the difference is intended.";
    }
    setFieldErrors(errors);
    if (errors.variance && Object.keys(errors).length === 1) {
      ackRef.current?.focus();
      return;
    }
    if (Object.keys(errors).length > 0) return;
    setDuplicates(await findDuplicates());
    // Open the confirm/review step; nothing is filed until the user confirms.
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
    <form onSubmit={(e) => void handleReview(e)} aria-label="Submit GST return" style={{ display: "grid", gap: 14, maxWidth: 560 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor={gstinId} style={{ fontSize: 13, fontWeight: 600 }}>
          GSTIN <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
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
          <p id={`${gstinId}-error`} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>
            {fieldErrors.gstin}
          </p>
        )}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor={periodId} style={{ fontSize: 13, fontWeight: 600 }}>
          Return Period (MM/YYYY) <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
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
          <p id={`${periodId}-error`} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>
            {fieldErrors.returnPeriod}
          </p>
        )}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor={typeId} style={{ fontSize: 13, fontWeight: 600 }}>
          Return Type <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
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
              {f.label} <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
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
              <p id={errId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>
                {fieldErrors[f.key]}
              </p>
            )}
          </div>
        );
      })}

      {/* GAP-BILLING-GSTN-03: prefill from the officer's own issued invoices, then reconcile. */}
      <div style={{ display: "grid", gap: 8 }}>
        <div>
          <Button type="button" variant="ghost" onClick={() => void prefillFromInvoices()} disabled={prepareBusy || disabled}>
            {prepareBusy ? "Fetching invoice totals…" : "Prefill from invoices"}
          </Button>
        </div>
        {prepareError && <p role="alert" className="pill bad" style={{ width: "fit-content", margin: 0 }}>{prepareError}</p>}
        {activePrepared && (
          <div role="status" style={{ display: "grid", gap: 4, fontSize: 12.5, color: "var(--ink2)" }}>
            <span>
              Invoice totals for {activePrepared.period}: {activePrepared.invoiceCount} issued invoice{activePrepared.invoiceCount === 1 ? "" : "s"}.
            </span>
            {BigInt(activePrepared.unsplitTaxMinor) > 0n && (
              <span>
                {activePrepared.unsplitTaxInvoiceCount} invoice{activePrepared.unsplitTaxInvoiceCount === 1 ? " has" : "s have"} tax of{" "}
                {formatMoney(activePrepared.unsplitTaxMinor)} with no CGST/SGST/IGST split; it is not in the CGST, SGST or IGST totals.
              </span>
            )}
          </div>
        )}
        {variance.length > 0 && (
          <div role="alert" className="pill warn" style={{ display: "grid", gap: 4, width: "fit-content", margin: 0 }}>
            <strong>Differs from invoices</strong>
            {variance.map((v) => (
              <span key={v.key}>{v.label}: entered {v.typed !== null ? formatMoney(v.typed) : "—"}, invoices {formatMoney(v.invoices)}</span>
            ))}
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5 }}>
              <input
                ref={ackRef}
                type="checkbox"
                checked={ackedSig === varianceSig}
                onChange={(e) => setAckedSig(e.target.checked ? varianceSig : "")}
                aria-describedby={fieldErrors.variance ? `${baseId}-variance-error` : undefined}
              />
              <span>I have checked the difference and want to file these totals.</span>
            </label>
            {fieldErrors.variance && (
              <span id={`${baseId}-variance-error`} role="alert" style={{ color: "var(--bad)" }}>{fieldErrors.variance}</span>
            )}
          </div>
        )}
      </div>

      <div>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={busy || disabled}>
          Submit Return
        </Button>
      </div>

      {/* GAP-BILLING-GSTN-03: these totals are hand-keyed and are NOT reconciled
          against this office's billing invoices/ledger unless the officer uses
          "Prefill from invoices" (UAT B4: backend return-preparation endpoint
          GET v1/billing/gstn/returns/prepare), which then reconciles the typed
          totals against the invoice totals and requires an acknowledgement of
          any variance. */}
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
          <div className="field"><span className="label">Status</span><span><StatusPill status={result.status} variant={GSTN_RESULT_TONE[result.status]} /></span></div>
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
            {duplicates.length > 0 && (
              <p role="alert" className="pill warn" style={{ width: "fit-content", margin: 0 }}>
                A {returnType} return for {returnPeriod} was already filed for this GSTIN (reference{" "}
                <span className="mono">{duplicates[0]?.referenceId}</span>, status {DUPLICATE_STATUS_LABEL[duplicates[0]?.status ?? ""] ?? "recorded"}). Filing again may create a duplicate.
              </p>
            )}
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
