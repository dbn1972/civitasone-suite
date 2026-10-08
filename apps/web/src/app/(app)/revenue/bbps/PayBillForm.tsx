"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, ConfirmDialog } from "@/app/_components/ds";
import { StatusPill } from "@/app/_components/ds/StatusPill";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import { BBPS_CHANNELS, channelLabel } from "@/lib/revenue/channels";
import { useBbpsRequestStatus } from "./useBbpsRequestStatus";

type AcceptedResponse = { data?: { messageId?: string } };

const CHANNELS = BBPS_CHANNELS;

export function PayBillForm() {
  const [assesseeIdentifier, setAssesseeIdentifier] = useState("");
  const [amount, setAmount] = useState("");
  const [bbpsTxnId, setBbpsTxnId] = useState("");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("online");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lastAssesseeId, setLastAssesseeId] = useState<string>("");
  const [messageId, setMessageId] = useState<string | null>(null);
  const { status, pollFailed, reset: resetStatus } = useBbpsRequestStatus(messageId);

  const identifierId = useId();
  const amountId = useId();
  const txnId = useId();
  const channelId = useId();
  const summaryId = useId();

  const identifierErrorId = `${identifierId}-error`;
  const amountErrorId = `${amountId}-error`;
  const txnErrorId = `${txnId}-error`;

  const identifierRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const txnRef = useRef<HTMLInputElement>(null);

  const minorAmount = rupeesToMinorString(amount);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errors: Record<string, string> = {};
    const trimmedIdentifier = assesseeIdentifier.trim();
    const trimmedTxn = bbpsTxnId.trim();
    if (!trimmedIdentifier) errors.assesseeIdentifier = "Enter the assessee identifier.";
    if (!minorAmount) errors.amount = "Enter a valid payment amount greater than zero.";
    if (!trimmedTxn) errors.bbpsTxnId = "Enter the BBPS transaction ID from the biller.";
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setTone("bad");
      setMessage("Please correct the highlighted fields.");
      if (errors.assesseeIdentifier) {
        identifierRef.current?.focus();
      } else if (errors.amount) {
        amountRef.current?.focus();
      } else if (errors.bbpsTxnId) {
        txnRef.current?.focus();
      }
      return;
    }

    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function payBill() {
    if (!minorAmount) return;
    setBusy(true);
    setDialogError(undefined);
    resetStatus();
    setMessageId(null);
    const submittedIdentifier = assesseeIdentifier.trim();
    try {
      const res = await browserJson<AcceptedResponse>("v1/revenue/bbps/pay-bill", {
        method: "POST",
        body: JSON.stringify({
          assesseeIdentifier: submittedIdentifier,
          amountMinor: minorAmount,
          bbpsTxnId: bbpsTxnId.trim(),
          channel,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setLastAssesseeId(submittedIdentifier);
      const id = res.data?.messageId ?? null;
      setMessageId(id);
      setMessage(
        id
          ? "Payment request submitted — tracking its outcome below."
          : "Payment request submitted.",
      );
      setAssesseeIdentifier("");
      setAmount("");
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
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={identifierId} style={{ fontSize: 13, fontWeight: 600 }}>
                Assessee Identifier{" "}
                <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
                  *
                </span>
              </label>
              <input
                id={identifierId}
                ref={identifierRef}
                value={assesseeIdentifier}
                onChange={(e) => setAssesseeIdentifier(e.target.value)}
                maxLength={100}
                aria-required="true"
                aria-invalid={!!fieldErrors.assesseeIdentifier || undefined}
                aria-describedby={fieldErrors.assesseeIdentifier ? identifierErrorId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {fieldErrors.assesseeIdentifier && (
                <p id={identifierErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                  {fieldErrors.assesseeIdentifier}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={amountId} style={{ fontSize: 13, fontWeight: 600 }}>
                Amount (₹){" "}
                <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
                  *
                </span>
              </label>
              <input
                id={amountId}
                ref={amountRef}
                type="number"
                step="any"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-required="true"
                aria-invalid={!!fieldErrors.amount || undefined}
                aria-describedby={fieldErrors.amount ? amountErrorId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {fieldErrors.amount && (
                <p id={amountErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                  {fieldErrors.amount}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={txnId} style={{ fontSize: 13, fontWeight: 600 }}>
                BBPS Transaction ID{" "}
                <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
                  *
                </span>
              </label>
              <input
                id={txnId}
                ref={txnRef}
                value={bbpsTxnId}
                onChange={(e) => setBbpsTxnId(e.target.value)}
                maxLength={50}
                aria-required="true"
                aria-invalid={!!fieldErrors.bbpsTxnId || undefined}
                aria-describedby={fieldErrors.bbpsTxnId ? txnErrorId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {fieldErrors.bbpsTxnId && (
                <p id={txnErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                  {fieldErrors.bbpsTxnId}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={channelId} style={{ fontSize: 13, fontWeight: 600 }}>
                Channel{" "}
                <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
                  *
                </span>
              </label>
              <select
                id={channelId}
                value={channel}
                onChange={(e) => setChannel(e.target.value as (typeof CHANNELS)[number])}
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
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy} loading={busy}>
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
              {status.status === "pending" && (
                <span style={{ color: "var(--ink2)" }}>Checking with the biller…</span>
              )}
              {status.status === "success" && (
                <Link href={`/revenue/receipts?assesseeId=${encodeURIComponent(lastAssesseeId)}`} className="link">
                  View the receipt
                </Link>
              )}
              {status.status === "failed" && (
                <span role="alert" style={{ color: "var(--bad, #c0392b)" }}>
                  {status.failureReason || "The payment could not be processed."} You can submit it again.
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
          minorAmount ? (
            <>
              Record a BBPS payment of <strong>{formatMoney(minorAmount)}</strong> via{" "}
              <strong>{channelLabel(channel)}</strong> for assessee{" "}
              <strong>{assesseeIdentifier.trim()}</strong>, using BBPS transaction ID{" "}
              <strong>{bbpsTxnId.trim()}</strong>. This records a payment already made at the biller and
              credits the assessee — it cannot be undone from this screen.
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
