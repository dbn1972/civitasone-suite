"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, ConfirmDialog } from "@/app/_components/ds";
import { StatusPill } from "@/app/_components/ds/StatusPill";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { BBPS_CHANNELS, channelLabel } from "@/lib/revenue/channels";
import { useBbpsRequestStatus } from "./useBbpsRequestStatus";

type AcceptedResponse = { data?: { messageId?: string } };

const CHANNELS = BBPS_CHANNELS;

/**
 * Owner decision #7 (2026-10-26): a bill the SERVER issued via fetch-bill. The
 * token is single-use and expiring; the assessee and the amount are read from
 * it server-side, so this form never sends — or lets the clerk type — either.
 */
export type IssuedBill = {
  token: string;
  identifierNo: string;
  ownerName: string | null;
  /** Bill amount in paise, as issued by the server. */
  amountMinor: string;
  expiresAt: string | null;
};

interface PayBillFormProps {
  /** The bill issued by the most recent successful fetch-bill; null until one is fetched. */
  bill?: IssuedBill | null;
}

export function PayBillForm({ bill = null }: PayBillFormProps) {
  const [bbpsTxnId, setBbpsTxnId] = useState("");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("online");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lastIdentifier, setLastIdentifier] = useState<string>("");
  const [messageId, setMessageId] = useState<string | null>(null);
  const { status, pollFailed, reset: resetStatus } = useBbpsRequestStatus(messageId);

  const txnId = useId();
  const channelId = useId();
  const summaryId = useId();
  const txnErrorId = `${txnId}-error`;
  const txnRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!bill) return;
    const errors: Record<string, string> = {};
    if (!bbpsTxnId.trim()) errors.bbpsTxnId = "Enter the BBPS transaction ID from the biller.";
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setTone("bad");
      setMessage("Please correct the highlighted fields.");
      txnRef.current?.focus();
      return;
    }

    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function payBill() {
    if (!bill) return;
    setBusy(true);
    setDialogError(undefined);
    resetStatus();
    setMessageId(null);
    try {
      // Only the server-issued token goes over the wire (plus the biller's txn
      // id and the channel). The server derives assessee and amount from it.
      const res = await browserJson<AcceptedResponse>("v1/revenue/bbps/pay-bill", {
        method: "POST",
        body: JSON.stringify({ billToken: bill.token, bbpsTxnId: bbpsTxnId.trim(), channel }),
      });
      setConfirmOpen(false);
      setTone("good");
      setLastIdentifier(bill.identifierNo);
      const id = res.data?.messageId ?? null;
      setMessageId(id);
      setMessage(id ? "Payment request submitted — tracking its outcome below." : "Payment request submitted.");
      setBbpsTxnId("");
      setFieldErrors({});
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }} aria-label="Record BBPS payment">
      <Card title="Record BBPS Payment" padding>
        <div style={{ display: "grid", gap: 14 }}>
          {bill ? (
            <dl
              aria-label="Fetched bill"
              style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 14px", fontSize: 13.5 }}
            >
              <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Assessee</dt>
              <dd style={{ margin: 0 }}>
                {bill.ownerName ? <strong>{bill.ownerName}</strong> : null}
                {bill.ownerName ? " " : null}
                <span className="mono">({bill.identifierNo})</span>
              </dd>
              <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Bill amount</dt>
              <dd style={{ margin: 0, fontWeight: 700 }}>{formatMoney(bill.amountMinor)}</dd>
            </dl>
          ) : (
            <p role="status" style={{ margin: 0, fontSize: 13.5, color: "var(--ink2)" }}>
              Fetch a bill above first. A payment can only be recorded against a bill issued by the server — the
              assessee and amount are taken from it and cannot be typed here.
            </p>
          )}

          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={txnId} style={{ fontSize: 13, fontWeight: 600 }}>
                BBPS Transaction ID{" "}
                <span aria-hidden="true" style={{ color: "var(--bad)" }}>
                  *
                </span>
              </label>
              <input
                id={txnId}
                ref={txnRef}
                value={bbpsTxnId}
                onChange={(e) => setBbpsTxnId(e.target.value)}
                maxLength={50}
                disabled={!bill}
                aria-required="true"
                aria-invalid={!!fieldErrors.bbpsTxnId || undefined}
                aria-describedby={fieldErrors.bbpsTxnId ? txnErrorId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {fieldErrors.bbpsTxnId && (
                <p id={txnErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>
                  {fieldErrors.bbpsTxnId}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={channelId} style={{ fontSize: 13, fontWeight: 600 }}>
                Channel{" "}
                <span aria-hidden="true" style={{ color: "var(--bad)" }}>
                  *
                </span>
              </label>
              <select
                id={channelId}
                value={channel}
                onChange={(e) => setChannel(e.target.value as (typeof CHANNELS)[number])}
                disabled={!bill}
                aria-required="true"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {channelLabel(c)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy || !bill} loading={busy}>
              Record BBPS payment
            </Button>
          </div>

          {message && (
            <p
              id={summaryId}
              role={tone === "bad" ? "alert" : "status"}
              className={`pill ${tone}`}
              style={{ width: "fit-content" }}
            >
              {message}
            </p>
          )}

          {messageId && status && (
            <div aria-live="polite" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13.5 }}>
              <span style={{ fontWeight: 600 }}>Payment status:</span>
              <StatusPill status={status.status} />
              {status.status === "pending" && <span style={{ color: "var(--ink2)" }}>Checking with the biller…</span>}
              {status.status === "success" && (
                <Link href={`/revenue/receipts?assesseeId=${encodeURIComponent(lastIdentifier)}`} className="link">
                  View the receipt
                </Link>
              )}
              {status.status === "failed" && (
                <span role="alert" style={{ color: "var(--bad)" }}>
                  {status.failureReason || "The payment could not be processed."} Fetch the bill again to retry.
                </span>
              )}
            </div>
          )}

          {messageId && status?.status === "pending" && pollFailed && (
            <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>
              Still checking — the status service is slow to respond; retrying automatically.
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Record this BBPS payment?"
        confirmLabel="Record payment"
        danger
        busy={busy}
        errorMessage={dialogError}
        description={
          bill ? (
            <>
              Record the fetched bill of <strong>{formatMoney(bill.amountMinor)}</strong> via{" "}
              <strong>{channelLabel(channel)}</strong> for assessee{" "}
              {bill.ownerName ? (
                <>
                  <strong>{bill.ownerName}</strong> ({bill.identifierNo})
                </>
              ) : (
                <strong>{bill.identifierNo}</strong>
              )}
              , using BBPS transaction ID <strong>{bbpsTxnId.trim()}</strong>. This records a payment already made
              at the biller and credits the assessee — it cannot be undone from this screen.
            </>
          ) : (
            "Record this BBPS payment?"
          )
        }
        onConfirm={() => void payBill()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
