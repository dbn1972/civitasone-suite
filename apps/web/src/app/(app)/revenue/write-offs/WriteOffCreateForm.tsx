"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

/** Convert a rupees-and-paise decimal string (clerk input) into a minor-unit integer string. */
function rupeesToMinorString(v: string): string | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100).toString();
}

export function WriteOffCreateForm({ assesseeId }: { assesseeId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string; reason?: string }>({});

  const amountId = useId();
  const reasonId = useId();
  const summaryId = useId();

  const amountErrorId = `${amountId}-error`;
  const reasonErrorId = `${reasonId}-error`;

  const amountRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const minorAmount = rupeesToMinorString(amount);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errors: { amount?: string; reason?: string } = {};
    if (!minorAmount) errors.amount = "Enter a valid amount greater than zero.";
    if (!reason.trim()) errors.reason = "Reason is required.";
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setTone("bad");
      setMessage("Please correct the highlighted fields.");
      if (errors.amount) {
        amountRef.current?.focus();
      } else if (errors.reason) {
        reasonRef.current?.focus();
      }
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submitWriteOff() {
    if (!minorAmount) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/revenue/write-offs", {
        method: "POST",
        body: JSON.stringify({
          assesseeId,
          amountMinor: minorAmount,
          reason: reason.trim(),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        res.id
          ? `Write-off raised (id ${res.id}), pending checker approval. Use the write-off register lookup below to decide on it.`
          : "Write-off raised, pending checker approval.",
      );
      setAmount("");
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
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }} aria-label={`Raise write-off for assessee ${assesseeId}`}>
      <Card title="Raise Write-off" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
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
                min="0.01"
                step="0.01"
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
              Raise Write-off
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
        title="Raise this write-off?"
        confirmLabel="Raise write-off"
        busy={busy}
        errorMessage={dialogError}
        description={
          minorAmount ? (
            <>
              Write off <strong>{formatMoney(minorAmount)}</strong> of this assessee's outstanding arrears. This
              permanently reduces the demand balance once approved and requires a distinct checker's approval.
            </>
          ) : (
            "Raise this write-off?"
          )
        }
        onConfirm={() => void submitWriteOff()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
