"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import type { DemandOption } from "./page";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

const CHANNELS = ["online", "counter", "cheque", "dd", "pos"] as const;

/** Convert a rupees-and-paise decimal string (clerk input) into a minor-unit integer string. */
function rupeesToMinorString(v: string): string | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100).toString();
}

export function RecordReceiptForm({ assesseeId, demands }: { assesseeId: string; demands: DemandOption[] }) {
  const router = useRouter();
  const [demandId, setDemandId] = useState("");
  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("online");
  const [reference, setReference] = useState("");
  const [instrumentNo, setInstrumentNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const demandSelId = useId();
  const amountId = useId();
  const channelId = useId();
  const referenceId = useId();
  const instrumentId = useId();
  const bankId = useId();
  const summaryId = useId();
  const noDemandsHelpId = useId();

  const demandErrorId = `${demandSelId}-error`;
  const amountErrorId = `${amountId}-error`;
  const referenceErrorId = `${referenceId}-error`;

  const demandSelRef = useRef<HTMLSelectElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const referenceRef = useRef<HTMLInputElement>(null);

  const eligibleDemands = demands.filter((d) => d.status !== "paid");
  const selectedDemand = eligibleDemands.find((d) => d.id === demandId);
  const minorAmount = rupeesToMinorString(amount);
  const noEligibleDemands = eligibleDemands.length === 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errors: Record<string, string> = {};
    if (!demandId) errors.demand = "Select a demand.";
    if (!minorAmount) errors.amount = "Enter a valid amount greater than zero.";
    if (!reference.trim()) errors.reference = "Reference / UTR is required.";
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setTone("bad");
      setMessage("Please correct the highlighted fields.");
      // Focus the first invalid field in DOM order: demand -> amount -> reference.
      if (errors.demand) {
        demandSelRef.current?.focus();
      } else if (errors.amount) {
        amountRef.current?.focus();
      } else if (errors.reference) {
        referenceRef.current?.focus();
      }
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function recordReceipt() {
    if (!selectedDemand || !minorAmount) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/revenue/receipts", {
        method: "POST",
        body: JSON.stringify({
          assesseeId,
          demandId: selectedDemand.id,
          amountMinor: minorAmount,
          channel,
          reference: reference.trim(),
          instrumentNo: instrumentNo.trim() || undefined,
          bankName: bankName.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        res.id
          ? `Receipt submitted (id ${res.id}). It is processed asynchronously and will appear below shortly.`
          : "Receipt submitted.",
      );
      setDemandId("");
      setAmount("");
      setReference("");
      setInstrumentNo("");
      setBankName("");
      setFieldErrors({});
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }} aria-label={`Record receipt for assessee ${assesseeId}`}>
      <Card title="Record Receipt" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={demandSelId} style={{ fontSize: 13, fontWeight: 600 }}>
                Demand{" "}
                <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
                  *
                </span>
              </label>
              <select
                id={demandSelId}
                ref={demandSelRef}
                value={demandId}
                onChange={(e) => setDemandId(e.target.value)}
                aria-required="true"
                aria-invalid={!!fieldErrors.demand || undefined}
                aria-describedby={fieldErrors.demand ? demandErrorId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                <option value="">Select a demand…</option>
                {eligibleDemands.map((d) => (
                  <option key={d.id} value={d.id}>
                    FY {d.financialYear} — {formatMoney(d.netMinor)} ({d.status})
                  </option>
                ))}
              </select>
              {fieldErrors.demand && (
                <p id={demandErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                  {fieldErrors.demand}
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

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={referenceId} style={{ fontSize: 13, fontWeight: 600 }}>
                Reference / UTR{" "}
                <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
                  *
                </span>
              </label>
              <input
                id={referenceId}
                ref={referenceRef}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={128}
                aria-required="true"
                aria-invalid={!!fieldErrors.reference || undefined}
                aria-describedby={fieldErrors.reference ? referenceErrorId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
              {fieldErrors.reference && (
                <p id={referenceErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                  {fieldErrors.reference}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={instrumentId} style={{ fontSize: 13, fontWeight: 600 }}>
                Instrument No. (optional)
              </label>
              <input
                id={instrumentId}
                value={instrumentNo}
                onChange={(e) => setInstrumentNo(e.target.value)}
                maxLength={64}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={bankId} style={{ fontSize: 13, fontWeight: 600 }}>
                Bank Name (optional)
              </label>
              <input
                id={bankId}
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                maxLength={128}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              className="btn primary"
              style={{ minHeight: 44 }}
              disabled={busy || noEligibleDemands}
              aria-describedby={noEligibleDemands ? noDemandsHelpId : undefined}
            >
              Record Receipt
            </button>
            {noEligibleDemands && (
              <p id={noDemandsHelpId} style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink2)" }}>
                No outstanding demands for this assessee.
              </p>
            )}
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
        title="Record this receipt?"
        confirmLabel="Record receipt"
        busy={busy}
        errorMessage={dialogError}
        description={
          selectedDemand && minorAmount ? (
            <>
              Record a receipt of <strong>{formatMoney(minorAmount)}</strong> via <strong>{channel}</strong> against
              demand FY <strong>{selectedDemand.financialYear}</strong>.
            </>
          ) : (
            "Record this receipt?"
          )
        }
        onConfirm={() => void recordReceipt()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
