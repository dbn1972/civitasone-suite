"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button, StatusPill } from "@/app/_components/ds";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

interface ReturnStatusResult {
  referenceId: string;
  status: "submitted" | "processing" | "filed" | "rejected";
  returnPeriod: string;
  filedAt?: string;
  rejectionReason?: string;
  lastUpdated: string;
}

export function ReturnStatusPanel({ initialRef = "" }: { initialRef?: string } = {}) {
  const [ref, setRef] = useState(initialRef);
  const lastSeeded = useRef(initialRef);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReturnStatusResult | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [lookupError, setLookupError] = useState<string | null>(null);

  // GAP-BILLING-GSTN-04: when the console hands us a fresh reference id (after a
  // successful submit + "Check status"), prefill the field — but never clobber
  // what the user is actively typing: only seed when the incoming id changes.
  useEffect(() => {
    if (initialRef && initialRef !== lastSeeded.current) {
      lastSeeded.current = initialRef;
      setRef(initialRef);
    }
  }, [initialRef]);

  const refId = useId();
  const refErrorId = `${refId}-error`;
  const refRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLookupError(null);
    setResult(null);

    if (!ref.trim()) {
      setFieldError("Enter a GST return reference ID.");
      refRef.current?.focus();
      return;
    }
    setFieldError(undefined);

    setBusy(true);
    try {
      const res = await browserFetch(`v1/billing/gstn/returns/${encodeURIComponent(ref.trim())}/status`);
      if (!res.ok) {
        setLookupError(await errorMessageFromResponse(res));
        return;
      }
      const body = (await res.json()) as { data: ReturnStatusResult };
      setResult(body.data);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Check GST return status" style={{ display: "grid", gap: 14, maxWidth: 480 }}>
      {/* GAP-BILLING-GSTN-05: there is no per-GSTIN/period filing-history list yet
          — status can only be looked up by a specific reference id. A history
          list needs a backend endpoint that persists past filings (billing-service
          has no gstn_returns table today); flagged for review. Until then, be
          honest that this is a single-reference lookup. */}
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }} role="note">
        Look up a return by its reference ID. A full filing history for a GSTIN/period is not
        available here yet — keep a note of each reference ID when you file.
      </p>
      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor={refId} style={{ fontSize: 13, fontWeight: 600 }}>
          Return Reference ID <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
        </label>
        <input
          id={refId}
          ref={refRef}
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          aria-required="true"
          aria-invalid={!!fieldError || undefined}
          aria-describedby={fieldError ? refErrorId : undefined}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
        />
        {fieldError && (
          <p id={refErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
            {fieldError}
          </p>
        )}
      </div>

      <div>
        <Button type="submit" variant="primary" style={{ minHeight: 44 }} disabled={busy}>
          {busy ? "Checking…" : "Check Status"}
        </Button>
      </div>

      {lookupError && (
        <p role="alert" className="pill bad" style={{ width: "fit-content" }}>
          {lookupError}
        </p>
      )}

      {result && (
        <div className="fields" role="status">
          <div className="field"><span className="label">Reference ID</span><span className="mono">{result.referenceId}</span></div>
          <div className="field"><span className="label">Status</span><span><StatusPill status={result.status} /></span></div>
          <div className="field"><span className="label">Return Period</span><span>{result.returnPeriod}</span></div>
          {result.filedAt && <div className="field"><span className="label">Filed At</span><span>{result.filedAt}</span></div>}
          {result.rejectionReason && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Rejection Reason</span><span role="alert">{result.rejectionReason}</span>
            </div>
          )}
          <div className="field"><span className="label">Last Updated</span><span>{result.lastUpdated}</span></div>
        </div>
      )}
    </form>
  );
}
