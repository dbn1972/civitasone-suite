"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog, EmptyState } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import type { ReceiptRow } from "./page";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

export function RefundCreateForm({ assesseeId, receipts }: { assesseeId: string; receipts: ReceiptRow[] }) {
  const router = useRouter();
  const [receiptId, setReceiptId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<{ receipt?: string; reason?: string }>({});

  const receiptSelId = useId();
  const reasonId = useId();
  const summaryId = useId();

  const receiptErrorId = `${receiptSelId}-error`;
  const reasonErrorId = `${reasonId}-error`;

  const receiptSelRef = useRef<HTMLSelectElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const selectedReceipt = receipts.find((r) => r.id === receiptId);

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
    const errors: { receipt?: string; reason?: string } = {};
    if (!receiptId) errors.receipt = "Select a receipt to refund.";
    if (!reason.trim()) errors.reason = "Reason is required.";
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setTone("bad");
      setMessage("Please correct the highlighted fields.");
      if (errors.receipt) {
        receiptSelRef.current?.focus();
      } else if (errors.reason) {
        reasonRef.current?.focus();
      }
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submitRefund() {
    if (!selectedReceipt) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/revenue/refunds", {
        method: "POST",
        body: JSON.stringify({
          receiptId: selectedReceipt.id,
          reason: reason.trim(),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        res.id
          ? `Refund raised (id ${res.id}), pending checker approval. Use the refund register lookup below to decide on it.`
          : "Refund raised, pending checker approval.",
      );
      setReceiptId("");
      setReason("");
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
                <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
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
                {receipts.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.receiptNo} — {formatMoney(r.amountMinor)} ({r.channel}, {r.status})
                  </option>
                ))}
              </select>
              {fieldErrors.receipt && (
                <p id={receiptErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                  {fieldErrors.receipt}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <label htmlFor={reasonId} style={{ fontSize: 13, fontWeight: 600 }}>
                Reason{" "}
                <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
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
                <p id={reasonErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                  {fieldErrors.reason}
                </p>
              )}
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Raise Refund
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
        title="Raise this refund?"
        confirmLabel="Raise refund"
        requireReason={false}
        busy={busy}
        errorMessage={dialogError}
        description={
          selectedReceipt ? (
            <>
              Raise a refund of <strong>{formatMoney(selectedReceipt.amountMinor)}</strong> against receipt{" "}
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
