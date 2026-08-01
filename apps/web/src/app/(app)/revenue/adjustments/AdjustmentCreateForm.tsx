"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog, EmptyState } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import type { DemandOption } from "./page";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

export function AdjustmentCreateForm({ assesseeId, demands }: { assesseeId: string; demands: DemandOption[] }) {
  const router = useRouter();
  const [fromDemandId, setFromDemandId] = useState("");
  const [toDemandId, setToDemandId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<{ from?: string; to?: string; amount?: string; reason?: string }>({});

  const fromId = useId();
  const toId = useId();
  const amountId = useId();
  const reasonId = useId();
  const summaryId = useId();

  const fromErrorId = `${fromId}-error`;
  const toErrorId = `${toId}-error`;
  const amountErrorId = `${amountId}-error`;
  const reasonErrorId = `${reasonId}-error`;

  const fromRef = useRef<HTMLSelectElement>(null);
  const toRef = useRef<HTMLSelectElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const fromDemand = demands.find((d) => d.id === fromDemandId);
  const toDemand = demands.find((d) => d.id === toDemandId);
  const minorAmount = rupeesToMinorString(amount);

  if (demands.length < 2) {
    return (
      <Card title="Raise Adjustment" padding>
        <EmptyState
          icon="🔀"
          title="Not enough demands"
          message="This assessee needs at least two demands on record to move a balance between them."
        />
      </Card>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errors: { from?: string; to?: string; amount?: string; reason?: string } = {};
    if (!fromDemandId) errors.from = "Select the source demand.";
    if (!toDemandId) errors.to = "Select the destination demand.";
    if (fromDemandId && toDemandId && fromDemandId === toDemandId) {
      errors.to = "Destination demand must differ from the source demand.";
    }
    if (!minorAmount) {
      errors.amount = "Enter a valid amount greater than zero, with at most 2 decimal places.";
    } else if (fromDemand) {
      try {
        if (BigInt(minorAmount) > BigInt(fromDemand.netMinor)) {
          errors.amount = `Amount cannot exceed the source demand's outstanding balance of ${formatMoney(fromDemand.netMinor)}.`;
        }
      } catch {
        // fromDemand.netMinor failed to parse as a bigint — let the server validate.
      }
    }
    if (!reason.trim()) errors.reason = "Reason is required.";
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setTone("bad");
      setMessage("Please correct the highlighted fields.");
      if (errors.from) {
        fromRef.current?.focus();
      } else if (errors.to) {
        toRef.current?.focus();
      } else if (errors.amount) {
        amountRef.current?.focus();
      } else if (errors.reason) {
        reasonRef.current?.focus();
      }
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submitAdjustment() {
    if (!fromDemand || !toDemand || !minorAmount) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/revenue/adjustments", {
        method: "POST",
        body: JSON.stringify({
          assesseeId,
          fromDemandId: fromDemand.id,
          toDemandId: toDemand.id,
          amountMinor: minorAmount,
          reason: reason.trim(),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(res.id ? `Adjustment applied (id ${res.id}).` : "Adjustment applied.");
      setFromDemandId("");
      setToDemandId("");
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
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }} aria-label={`Raise adjustment for assessee ${assesseeId}`}>
      <Card title="Raise Adjustment" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fromId} style={{ fontSize: 13, fontWeight: 600 }}>
                From Demand{" "}
                <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
                  *
                </span>
              </label>
              <select
                id={fromId}
                ref={fromRef}
                value={fromDemandId}
                onChange={(e) => setFromDemandId(e.target.value)}
                aria-required="true"
                aria-invalid={!!fieldErrors.from || undefined}
                aria-describedby={fieldErrors.from ? fromErrorId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                <option value="">Select source demand…</option>
                {demands.map((d) => (
                  <option key={d.id} value={d.id}>
                    FY {d.financialYear} — {formatMoney(d.netMinor)} ({d.status})
                  </option>
                ))}
              </select>
              {fieldErrors.from && (
                <p id={fromErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                  {fieldErrors.from}
                </p>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={toId} style={{ fontSize: 13, fontWeight: 600 }}>
                To Demand{" "}
                <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
                  *
                </span>
              </label>
              <select
                id={toId}
                ref={toRef}
                value={toDemandId}
                onChange={(e) => setToDemandId(e.target.value)}
                aria-required="true"
                aria-invalid={!!fieldErrors.to || undefined}
                aria-describedby={fieldErrors.to ? toErrorId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                <option value="">Select destination demand…</option>
                {demands.map((d) => (
                  <option key={d.id} value={d.id}>
                    FY {d.financialYear} — {formatMoney(d.netMinor)} ({d.status})
                  </option>
                ))}
              </select>
              {fieldErrors.to && (
                <p id={toErrorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
                  {fieldErrors.to}
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
              Raise Adjustment
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
        title="Apply this adjustment?"
        confirmLabel="Apply adjustment"
        busy={busy}
        errorMessage={dialogError}
        description={
          fromDemand && toDemand && minorAmount ? (
            <>
              Move <strong>{formatMoney(minorAmount)}</strong> from FY <strong>{fromDemand.financialYear}</strong> to
              FY <strong>{toDemand.financialYear}</strong>. This applies immediately and updates both demand
              balances — there is no separate checker approval step for adjustments.
            </>
          ) : (
            "Apply this adjustment?"
          )
        }
        onConfirm={() => void submitAdjustment()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
