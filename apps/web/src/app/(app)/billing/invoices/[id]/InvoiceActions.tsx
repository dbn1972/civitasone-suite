"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, StatusPill, EmptyState } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatIndianDateTime, irnCancelDeadline } from "@/lib/formatters";
import { qrMatrix } from "@/lib/qr";
import type { EInvoiceStatus } from "./page";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

/** GAP-BILLING-INVOICES-DETAIL-09: render the signed QR payload as a real,
 *  scannable QR image (not an 11px wall of mono text). Uses the existing
 *  lib/qr qrMatrix (qrcode-generator) — no new dependency. The payload is only
 *  ever INPUT to the encoder; the SVG is built from integer coordinates, so no
 *  user text is parsed as markup. */
function SignedQr({ value, size = 160 }: { value: string; size?: number }) {
  const matrix = qrMatrix(value);
  const quiet = 4;
  const dim = matrix.length + quiet * 2;
  let d = "";
  matrix.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }),
  );
  return (
    <svg
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      role="img"
      aria-label="E-invoice signed QR code"
      shapeRendering="crispEdges"
    >
      <rect width={dim} height={dim} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

const POLL_INTERVAL_MS = 8000;
const MAX_POLLS = 20;

export function InvoiceActions({
  invoiceId,
  einvoice,
  einvoiceUnknown = false,
}: {
  invoiceId: string;
  einvoice: EInvoiceStatus | null;
  /** GAP-BILLING-INVOICES-DETAIL-04: the e-invoice fetch failed with a non-404
   *  (outage) — GSTN status is UNKNOWN, so neither generate nor cancel is safe. */
  einvoiceUnknown?: boolean;
}) {
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
  const status = einvoice?.status;
  const isPending = status === "pending";

  // GAP-BILLING-INVOICES-DETAIL-02: NIC allows IRN cancellation only within 24h
  // of the acknowledgement. Compute the client-side deadline; when ackDate is
  // known and past, keep Cancel disabled with honest copy. When ackDate is
  // unknown (null), allow and let the server decide. The server stays
  // authoritative either way.
  const deadline = irnCancelDeadline(einvoice?.ackDate);
  const windowClosed = deadline !== null && Date.now() >= deadline.getTime();

  // GAP-BILLING-INVOICES-DETAIL-04: when GSTN status is unknown, disable both
  // actions to prevent a duplicate IRN request against an unknown real state.
  const canGenerate =
    !einvoiceUnknown && (!einvoice || status === "cancelled" || status === "failed");
  const canCancel = !einvoiceUnknown && status === "generated" && !windowClosed;

  // GAP-BILLING-INVOICES-DETAIL-05: while the IRN is pending, poll via
  // router.refresh() so the IRN appears without a manual reload — capped,
  // and paused when the tab is hidden to avoid needless gateway load.
  const pollsRef = useRef(0);
  useEffect(() => {
    if (!isPending) {
      pollsRef.current = 0;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (document.hidden) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }
      if (pollsRef.current >= MAX_POLLS) return;
      pollsRef.current += 1;
      router.refresh();
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isPending, router]);

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
          ? `E-invoice (IRN) generation submitted (request ${res.id}). GSTN processing is asynchronous — this page will refresh as the IRN lands.`
          : "E-invoice (IRN) generation submitted. GSTN processing is asynchronous — this page will refresh as the IRN lands.",
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
      {einvoiceUnknown ? (
        // GAP-BILLING-INVOICES-DETAIL-04: outage, not "not generated".
        <div role="status" style={{ display: "grid", gap: 10 }}>
          <p className="pill warn" style={{ width: "fit-content" }}>
            GSTN status unknown — couldn&apos;t reach the e-invoice service.
          </p>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>
            We can&apos;t tell whether an IRN already exists for this invoice, so generating or
            cancelling one is disabled until the status loads. Retry to try again.
          </p>
          <div>
            <Button variant="ghost" style={{ minHeight: 44 }} onClick={() => router.refresh()}>
              Retry status
            </Button>
          </div>
        </div>
      ) : einvoice ? (
        <div className="fields">
          <div className="field"><span className="label">E-invoice Status</span><span><StatusPill status={einvoice.status} /></span></div>
          {einvoice.irn && <div className="field"><span className="label">IRN</span><span className="mono">{einvoice.irn}</span></div>}
          {einvoice.ackNo && <div className="field"><span className="label">Ack No.</span><span className="mono">{einvoice.ackNo}</span></div>}
          {einvoice.ackDate && <div className="field"><span className="label">Ack Date</span><span>{formatIndianDateTime(einvoice.ackDate)}</span></div>}
          {einvoice.errorMessage && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Last Error</span>
              <span role="alert">{einvoice.errorMessage}</span>
            </div>
          )}
          {einvoice.cancelledAt && (
            <div className="field"><span className="label">Cancelled</span><span>{formatIndianDateTime(einvoice.cancelledAt)}</span></div>
          )}
          {einvoice.cancelReason && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Cancel Reason</span><span>{einvoice.cancelReason}</span>
            </div>
          )}
          {einvoice.signedQrCode && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Signed QR Code</span>
              <span>
                <figure style={{ margin: 0 }}>
                  <SignedQr value={einvoice.signedQrCode} />
                  <figcaption className="sr-only">E-invoice signed QR code</figcaption>
                </figure>
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12 }}>Show signed payload</summary>
                  <span className="mono" style={{ wordBreak: "break-all", fontSize: 11 }}>{einvoice.signedQrCode}</span>
                </details>
              </span>
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

      {/* GAP-BILLING-INVOICES-DETAIL-05: pending guidance + manual refresh. */}
      {isPending && !einvoiceUnknown && (
        <div role="status" style={{ display: "grid", gap: 8 }}>
          <p className="pill warn" style={{ width: "fit-content" }}>Awaiting GSTN response…</p>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>
            {einvoice?.createdAt ? `Requested ${formatIndianDateTime(einvoice.createdAt)}. ` : ""}
            This page refreshes automatically; you can also refresh now.
          </p>
          <div>
            <Button variant="ghost" style={{ minHeight: 44 }} onClick={() => router.refresh()}>
              Refresh status
            </Button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button
          variant="primary"
          style={{ minHeight: 44 }}
          disabled={busy || !canGenerate}
          aria-label={`Generate e-invoice (IRN) for invoice ${invoiceId}`}
          onClick={() => {
            setGenerateError(undefined);
            setGenerateOpen(true);
          }}
        >
          Generate e-invoice / IRN
        </Button>
        <Button
          variant="danger"
          style={{ minHeight: 44 }}
          disabled={busy || !canCancel}
          aria-label={`Cancel IRN for invoice ${invoiceId}`}
          onClick={() => {
            setCancelError(undefined);
            setCancelOpen(true);
          }}
        >
          Cancel IRN
        </Button>
      </div>

      {/* GAP-BILLING-INVOICES-DETAIL-02: honest closed-window copy. */}
      {status === "generated" && windowClosed && deadline && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>
          IRN cancellation window closed on {formatIndianDateTime(deadline)} (24 hours after
          acknowledgement, per NIC rules); issue a credit note instead.
        </p>
      )}

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
            <strong>irreversible</strong> and must be done within 24 hours per NIC rules
            {deadline ? <> (by <strong>{formatIndianDateTime(deadline)}</strong>)</> : null}. A reason is required for the
            audit trail.
          </>
        }
        onConfirm={(reason) => void cancelIrn(reason)}
        onCancel={() => !busy && setCancelOpen(false)}
      />
    </div>
  );
}
