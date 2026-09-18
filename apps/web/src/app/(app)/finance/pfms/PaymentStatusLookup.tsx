"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import type { PfmsMode } from "./types";

type StatusResult = {
  referenceId: string;
  pfmsTransactionId: string;
  status: "pending" | "processing" | "completed" | "failed" | "rejected";
  utrNumber?: string;
  processedAt?: string;
  failureReason?: string;
  mode?: PfmsMode;
};

interface PaymentStatusLookupProps {
  /** Reports the `mode` field of a successful response, once the backend adapter rollout starts sending it. */
  onModeObserved?: (mode: PfmsMode) => void;
}

/** GET /v1/finance/pfms/payments/:ref/status — e-Kuber payment status enquiry. */
export function PaymentStatusLookup({ onModeObserved }: PaymentStatusLookupProps) {
  const t = useTranslations("pfmsPaymentStatusLookup");
  const [ref, setRef] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StatusResult | null>(null);
  const refId = useId();
  const errId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!ref.trim()) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setBusy(true);
    try {
      const res = await browserJson<{ data: StatusResult }>(
        `v1/finance/pfms/payments/${encodeURIComponent(ref.trim())}/status`,
        { method: "GET" },
      );
      setResult(res.data);
      if (res.data.mode) onModeObserved?.(res.data.mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("fetchError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("title")} padding>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6, flex: "1 1 240px" }}>
            <label htmlFor={refId} style={{ fontSize: 13, fontWeight: 600 }}>
              {t("label")} <span aria-hidden="true">*</span>
            </label>
            <input
              id={refId}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              maxLength={64}
              aria-required="true"
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
            {busy ? t("checking") : t("checkStatus")}
          </Button>
        </div>

        {invalid && (
          <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
            {t("invalidMessage")}
          </p>
        )}
        {error && (
          <p role="alert" className="pill bad" style={{ width: "fit-content" }}>
            {error}
          </p>
        )}
        {result && (
          <dl className="fields">
            <div className="fld"><dt className="l">{t("colReference")}</dt><dd className="v" style={{ margin: 0 }}>{result.referenceId}</dd></div>
            <div className="fld"><dt className="l">{t("colTxnId")}</dt><dd className="v" style={{ margin: 0 }}>{result.pfmsTransactionId}</dd></div>
            <div className="fld"><dt className="l">{t("colStatus")}</dt><dd className="v" style={{ margin: 0 }}>{result.status}</dd></div>
            {result.utrNumber && <div className="fld"><dt className="l">{t("colUtr")}</dt><dd className="v" style={{ margin: 0 }}>{result.utrNumber}</dd></div>}
            {result.processedAt && <div className="fld"><dt className="l">{t("colProcessedAt")}</dt><dd className="v" style={{ margin: 0 }}>{result.processedAt}</dd></div>}
            {result.failureReason && <div className="fld"><dt className="l">{t("colFailureReason")}</dt><dd className="v" style={{ margin: 0 }}>{result.failureReason}</dd></div>}
          </dl>
        )}
      </form>
    </Card>
  );
}
