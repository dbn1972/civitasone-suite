"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog, EmptyState } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import type { ReceiptRow } from "./page";

const REFUND_FLAG_LABEL: Record<string, string> = {
  pending: "refund pending",
  approved: "refund approved",
  processed: "already refunded",
};

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

export function RefundCreateForm({
  assesseeId,
  receipts,
  pendingRefundReceiptIds = [],
  refundStatusByReceiptId = {},
}: {
  assesseeId: string;
  receipts: ReceiptRow[];
  pendingRefundReceiptIds?: string[];
  /** receiptId -> status of its live (non-rejected) refund; advisory, the server 409/no-op is the real guard. */
  refundStatusByReceiptId?: Record<string, string>;
}) {
  const router = useRouter();
  const [receiptId, setReceiptId] = useState("");
  const [reason, setReason] = useState("");
  // Owner decision #1: optional partial amount (rupees); blank = full receipt.
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<{ receipt?: string; reason?: string; amount?: string }>({});

  const receiptSelId = useId();
  const reasonId = useId();
  const amountId = useId();
  const summaryId = useId();

  const receiptErrorId = `${receiptSelId}-error`;
  const reasonErrorId = `${reasonId}-error`;
  const amountErrorId = `${amountId}-error`;

  const receiptSelRef = useRef<HTMLSelectElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const selectedReceipt = receipts.find((r) => r.id === receiptId);
  const pendingSet = new Set(pendingRefundReceiptIds);
  const partialMinor = amount.trim() ? rupeesToMinorString(amount) : null;
  const refundMinor = partialMinor ?? selectedReceipt?.amountMinor;

  if (receipts.length === 0) {
    return (
      <Card title="Raise Refund" padding>
        <EmptyState
          icon="🧾"
          title="No receipts on record"
          message="This assessee has no collection receipts to refund yet."
        />
      </Card>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errors: { receipt?: string; reason?: string; amount?: string } = {};
    if (!receiptId) errors.receipt = "Select a receipt to refund.";
    if (!reason.trim()) errors.reason = "Reason is required.";
    if (amount.trim()) {
      if (!partialMinor) errors.amount = "Enter a valid amount greater than zero, with at most 2 decimal places.";
      else if (selectedReceipt && BigInt(partialMinor) > BigInt(selectedReceipt.amountMinor)) {
        errors.amount = "Refund amount cannot exceed the receipt amount.";
      }
    }
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setTone("bad");
      setMessage("Please correct the highlighted fields.");
      if (errors.receipt) {
        receiptSelRef.current?.focus();
      } else if (errors.reason) {
        reasonRef.current?.focus();
      } else if (errors.amount) {
        amountRef.current?.focus();
      }
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submitRefund() {
    if (!selectedReceipt) return;
    // Capture the receipt number before we reset the selection, so the success
    // copy can name the receipt instead of printing a raw UUID (REFUNDS-04).
    const receiptNo = selectedReceipt.receiptNo;
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson<AcceptedResponse>("v1/revenue/refunds", {
        method: "POST",
        body: JSON.stringify({
          receiptId: selectedReceipt.id,
          reason: reason.trim(),
          ...(partialMinor ? { amountMinor: partialMinor } : {}),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        `Refund raised for receipt ${receiptNo} and sent for checker approval. A different officer must approve it.`,
      );
      setReceiptId("");
      setReason("");
      setAmount("");
      setFieldErrors({});
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }} aria-label={`Raise refund for assessee ${assesseeId}`}>
      <Card title="Raise Refund" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={receiptSelId} style={{ fontSize: 13, fontWeight: 600 }}>
                Receipt{" "}
                <span aria-hidden="true" style={{ color: "var(--bad)" }}>
                  *
                </span>
              </label>
              <select
                id={receiptSelId}
                ref={receiptSelRef}
                value={receiptId}
                onChange={(e) => setReceiptId(e.target.value)}
                aria-required="true"
                aria-invalid={!!fieldErrors.receipt || undefined}
                aria-describedby={fieldErrors.receipt ? receiptErrorId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                <option value="">Select a receipt…</option>
                {receipts.map((r) => {
                  // GAP-REVENUE-REFUNDS-02: any live (pending/approved/processed) refund
                  // occupies the receipt; flag and disable it, with the right wording.
                  const refundStatus = refundStatusByReceiptId[r.id] ?? (pendingSet.has(r.id) ? "pending" : undefined);
                  const flagged = refundStatus !== undefined;
                  return (
                    <option key={r.id} value={r.id} disabled={flagged}>
                      {r.receiptNo} — {formatMoney(r.amountMinor)} ({r.channel}, {r.status})
                      {flagged ? ` (${REFUND_FLAG_LABEL[refundStatus] ?? "refund exists"})` : ""}
                    </option>
                  );
                })}
              </select>
              {fieldErrors.receipt && (
                <p id={receiptErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>
                  {fieldErrors.receipt}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={amountId} style={{ fontSize: 13, fontWeight: 600 }}>
                Refund amount (₹) — optional
              </label>
              <input
                id={amountId}
                ref={amountRef}
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={selectedReceipt ? `Leave blank to refund the full ${formatMoney(selectedReceipt.amountMinor)}` : "Leave blank for a full refund"}
                aria-invalid={!!fieldErrors.amount || undefined}
                aria-describedby={fieldErrors.amount ? amountErrorId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {fieldErrors.amount && (
                <p id={amountErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>
                  {fieldErrors.amount}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <label htmlFor={reasonId} style={{ fontSize: 13, fontWeight: 600 }}>
                Reason{" "}
                <span aria-hidden="true" style={{ color: "var(--bad)" }}>
                  *
                </span>
              </label>
              <textarea
                id={reasonId}
                ref={reasonRef}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                aria-required="true"
                aria-invalid={!!fieldErrors.reason || undefined}
                aria-describedby={fieldErrors.reason ? reasonErrorId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)" }}
              />
              {fieldErrors.reason && (
                <p id={reasonErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>
                  {fieldErrors.reason}
                </p>
              )}
            </div>
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy} loading={busy}>
              Raise Refund
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
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Raise this refund?"
        confirmLabel="Raise refund"
        requireReason={false}
        busy={busy}
        errorMessage={dialogError}
        description={
          selectedReceipt ? (
            <>
              Raise a refund of <strong>{formatMoney(refundMinor ?? selectedReceipt.amountMinor)}</strong>{partialMinor ? " (partial)" : ""} against receipt{" "}
              <strong>{selectedReceipt.receiptNo}</strong>. This is money leaving the treasury and requires a
              distinct checker's approval before it takes effect.
            </>
          ) : (
            "Raise this refund?"
          )
        }
        onConfirm={() => void submitRefund()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
