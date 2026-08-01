"use client";

import { useId, useRef, useState } from "react";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";

type AcceptedResponse = { data?: { messageId?: string } };

const CHANNELS = ["online", "counter", "upi", "netbanking", "card"] as const;

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
    try {
      const res = await browserJson<AcceptedResponse>("v1/revenue/bbps/pay-bill", {
        method: "POST",
        body: JSON.stringify({
          assesseeIdentifier: assesseeIdentifier.trim(),
          amountMinor: minorAmount,
          bbpsTxnId: bbpsTxnId.trim(),
          channel,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        res.data?.messageId
          ? `Payment request submitted (message ID ${res.data.messageId}). It is processed asynchronously — check Collection Receipts once it settles.`
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
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }} aria-label="Pay BBPS bill">
      <Card title="Pay Bill" padding>
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
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Pay Bill
            </button>
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
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Submit this BBPS payment?"
        confirmLabel="Pay bill"
        danger
        busy={busy}
        errorMessage={dialogError}
        description={
          minorAmount ? (
            <>
              Submit a BBPS payment of <strong>{formatMoney(minorAmount)}</strong> via <strong>{channel}</strong> for
              assessee <strong>{assesseeIdentifier.trim()}</strong>. This dispatches money movement through the BBPS
              biller adapter and cannot be recalled from this screen.
            </>
          ) : (
            "Submit this BBPS payment?"
          )
        }
        onConfirm={() => void payBill()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
