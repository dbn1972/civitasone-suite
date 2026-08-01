"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog, StatusPill, EmptyState } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import type { EInvoiceStatus } from "./page";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

export function InvoiceActions({ invoiceId, einvoice }: { invoiceId: string; einvoice: EInvoiceStatus | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [generateError, setGenerateError] = useState<string | undefined>();
  const [cancelError, setCancelError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  // Status enum (services/billing-service/src/modules/einvoice/schema.ts + consumer.ts):
  // "pending" (in flight) | "generated" (active IRN) | "failed" | "cancelled".
  const canGenerate = !einvoice || einvoice.status === "cancelled" || einvoice.status === "failed";
  const canCancel = einvoice?.status === "generated";

  async function generateIrn() {
    setBusy(true);
    setGenerateError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>(`v1/billing/invoices/${invoiceId}/generate-irn`, {
        method: "POST",
      });
      setGenerateOpen(false);
      setTone("good");
      setMessage(
        res.id
          ? `E-invoice (IRN) generation submitted (request ${res.id}). GSTN processing is asynchronous — refresh shortly to see the IRN.`
          : "E-invoice (IRN) generation submitted. GSTN processing is asynchronous — refresh shortly to see the IRN.",
      );
      router.refresh();
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelIrn(reason?: string) {
    setBusy(true);
    setCancelError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>(`v1/billing/invoices/${invoiceId}/cancel-irn`, {
        method: "POST",
        body: JSON.stringify({ reason: reason ?? "" }),
      });
      setCancelOpen(false);
      setTone("good");
      setMessage(
        res.id
          ? `IRN cancellation submitted (request ${res.id}). This is irreversible once GSTN confirms.`
          : "IRN cancellation submitted. This is irreversible once GSTN confirms.",
      );
      router.refresh();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {einvoice ? (
        <div className="fields">
          <div className="field"><span className="label">E-invoice Status</span><span><StatusPill status={einvoice.status} /></span></div>
          {einvoice.irn && <div className="field"><span className="label">IRN</span><span className="mono">{einvoice.irn}</span></div>}
          {einvoice.ackNo && <div className="field"><span className="label">Ack No.</span><span className="mono">{einvoice.ackNo}</span></div>}
          {einvoice.ackDate && <div className="field"><span className="label">Ack Date</span><span>{einvoice.ackDate}</span></div>}
          {einvoice.errorMessage && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Last Error</span>
              <span role="alert">{einvoice.errorMessage}</span>
            </div>
          )}
          {einvoice.cancelledAt && (
            <div className="field"><span className="label">Cancelled</span><span>{einvoice.cancelledAt}</span></div>
          )}
          {einvoice.cancelReason && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Cancel Reason</span><span>{einvoice.cancelReason}</span>
            </div>
          )}
          {einvoice.signedQrCode && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Signed QR Payload</span>
              <span className="mono" style={{ wordBreak: "break-all", fontSize: 11 }}>{einvoice.signedQrCode}</span>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon="🧾"
          title="No e-invoice generated"
          message="No GST e-invoice (IRN) has been requested for this invoice yet."
        />
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn primary"
          style={{ minHeight: 44 }}
          disabled={busy || !canGenerate}
          aria-label={`Generate e-invoice (IRN) for invoice ${invoiceId}`}
          onClick={() => {
            setGenerateError(undefined);
            setGenerateOpen(true);
          }}
        >
          Generate e-invoice / IRN
        </button>
        <button
          type="button"
          className="btn danger"
          style={{ minHeight: 44 }}
          disabled={busy || !canCancel}
          aria-label={`Cancel IRN for invoice ${invoiceId}`}
          onClick={() => {
            setCancelError(undefined);
            setCancelOpen(true);
          }}
        >
          Cancel IRN
        </button>
      </div>

      {message && (
        <p role={tone === "bad" ? "alert" : "status"} className={`pill ${tone}`} style={{ width: "fit-content" }}>
          {message}
        </p>
      )}

      <ConfirmDialog
        open={generateOpen}
        title="Generate e-invoice (IRN)?"
        confirmLabel="Generate IRN"
        busy={busy}
        errorMessage={generateError}
        description={
          <>
            Request a GST e-invoice (IRN) for invoice <strong>{invoiceId}</strong> from the GSTN Invoice Registration
            Portal. This calls an external government system and is processed asynchronously.
          </>
        }
        onConfirm={() => void generateIrn()}
        onCancel={() => !busy && setGenerateOpen(false)}
      />

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this IRN?"
        confirmLabel="Cancel IRN"
        danger
        requireReason
        reasonLabel="Reason for cancellation"
        busy={busy}
        errorMessage={cancelError}
        description={
          <>
            Cancelling IRN <strong>{einvoice?.irn ?? "(pending)"}</strong> for invoice <strong>{invoiceId}</strong> is{" "}
            <strong>irreversible</strong> and must be done within 24 hours per NIC rules. A reason is required for the
            audit trail.
          </>
        }
        onConfirm={(reason) => void cancelIrn(reason)}
        onCancel={() => !busy && setCancelOpen(false)}
      />
    </div>
  );
}
