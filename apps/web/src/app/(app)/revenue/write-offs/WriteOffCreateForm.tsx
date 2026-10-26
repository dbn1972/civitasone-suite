"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

export function WriteOffCreateForm({
  assesseeId,
  assesseeName,
  outstandingMinor,
  dcbUnavailable,
  demands,
}: {
  assesseeId: string;
  assesseeName?: string | null;
  /** Outstanding arrears (paise) to cap the write-off at; null when unknown. */
  outstandingMinor?: string | null;
  /** True when the DCB could not be loaded — fail closed, keep the form disabled. */
  dcbUnavailable?: boolean;
  /** GAP-REVENUE-WRITE-OFFS-03: demands to reference the specific year reduced. */
  demands?: ReadonlyArray<{ id: string; financialYear: string; netMinor: string; status: string; outstandingMinor?: string }>;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [demandId, setDemandId] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string; reason?: string; demand?: string }>({});

  const amountId = useId();
  const reasonId = useId();
  const demandSelectId = useId();
  const summaryId = useId();

  const amountErrorId = `${amountId}-error`;
  const reasonErrorId = `${reasonId}-error`;

  const amountRef = useRef<HTMLInputElement>(null);
  const demandRef = useRef<HTMLSelectElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const demandList = demands ?? [];
  const selectedDemand = demandList.find((d) => d.id === demandId) ?? null;

  const minorAmount = rupeesToMinorString(amount);
  // Owner decision #6: the cap is the SELECTED DEMAND's live balance (server-issued),
  // not the assessee total. The server re-enforces it.
  const demandCapMinor =
    selectedDemand && typeof selectedDemand.outstandingMinor === "string" && /^\d+$/.test(selectedDemand.outstandingMinor)
      ? selectedDemand.outstandingMinor
      : null;
  const overDemandCap = demandCapMinor !== null && minorAmount !== null && BigInt(minorAmount) > BigInt(demandCapMinor);
  const noDemands = demandList.length === 0;
  // GAP-REVENUE-WRITE-OFFS-01: cap at outstanding arrears (BigInt compare), like
  // AdjustmentCreateForm. The server must still enforce the cap; this is the
  // first line of defence and the clerk's live feedback.
  const hasCap = typeof outstandingMinor === "string" && /^\d+$/.test(outstandingMinor);
  const overCap = hasCap && minorAmount !== null && BigInt(minorAmount) > BigInt(outstandingMinor as string);
  const afterMinor =
    hasCap && minorAmount !== null
      ? (BigInt(outstandingMinor as string) - BigInt(minorAmount)).toString()
      : null;
  // Fail closed: if we could not load the balance, do not allow a blind,
  // uncapped write-off.
  const formDisabled = !!dcbUnavailable || noDemands;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errors: { amount?: string; reason?: string; demand?: string } = {};
    if (!selectedDemand) errors.demand = "Select the demand this write-off reduces.";
    if (!minorAmount) errors.amount = "Enter a valid amount greater than zero, with at most 2 decimal places.";
    else if (overCap) errors.amount = "Amount cannot exceed the outstanding arrears shown above.";
    else if (overDemandCap) errors.amount = `Amount cannot exceed the balance of the selected demand (${formatMoney(demandCapMinor)}).`;
    if (!reason.trim()) errors.reason = "Reason is required.";
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) {
      setTone("bad");
      setMessage("Please correct the highlighted fields.");
      if (errors.demand) {
        demandRef.current?.focus();
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

  async function submitWriteOff() {
    if (!minorAmount || overCap || overDemandCap || !selectedDemand) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/revenue/write-offs", {
        method: "POST",
        body: JSON.stringify({
          assesseeId,
          amountMinor: minorAmount,
          reason: reason.trim(),
          demandId: selectedDemand.id,
          financialYear: selectedDemand.financialYear,
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
      setDemandId("");
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
          {/* GAP-REVENUE-WRITE-OFFS-01: show the arrears the write-off reduces. */}
          {dcbUnavailable ? (
            <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--bad)" }}>
              We couldn't load this assessee's outstanding balance, so a write-off can't be raised safely right now.
              Try again in a moment.
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: 13.5 }}>
              Outstanding arrears:{" "}
              <strong>{formatMoney(outstandingMinor)}</strong>
              {afterMinor !== null && !overCap && (
                <>
                  {"  ·  Balance after write-off: "}
                  <strong>{formatMoney(afterMinor)}</strong>
                </>
              )}
            </p>
          )}
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            {noDemands ? (
              <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--bad)", gridColumn: "1 / -1" }}>
                This assessee has no demand on record, so there is nothing to write off against.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={demandSelectId} style={{ fontSize: 13, fontWeight: 600 }}>
                  Demand{" "}
                  <span aria-hidden="true" style={{ color: "var(--bad)" }}>
                    *
                  </span>
                </label>
                <select
                  id={demandSelectId}
                  ref={demandRef}
                  value={demandId}
                  onChange={(e) => setDemandId(e.target.value)}
                  aria-required="true"
                  aria-invalid={!!fieldErrors.demand || undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, appearance: "auto" }}
                >
                  <option value="">Select the demand…</option>
                  {demandList.map((d) => (
                    <option key={d.id} value={d.id}>
                      FY {d.financialYear} · bal {formatMoney(d.outstandingMinor ?? d.netMinor)}
                    </option>
                  ))}
                </select>
                {fieldErrors.demand && (
                  <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad)" }}>
                    {fieldErrors.demand}
                  </p>
                )}
              </div>
            )}
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={amountId} style={{ fontSize: 13, fontWeight: 600 }}>
                Amount (₹){" "}
                <span aria-hidden="true" style={{ color: "var(--bad)" }}>
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
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy || formDisabled} loading={busy}>
              Raise Write-off
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
        title="Raise this write-off?"
        confirmLabel="Raise write-off"
        busy={busy}
        errorMessage={dialogError}
        description={
          minorAmount ? (
            <>
              Write off <strong>{formatMoney(minorAmount)}</strong> of{" "}
              <strong>{assesseeName ?? "this assessee"}</strong>&apos;s outstanding arrears
              {hasCap && (
                <>
                  {" (currently "}
                  <strong>{formatMoney(outstandingMinor)}</strong>
                  {afterMinor !== null && (
                    <>
                      {", leaving "}
                      <strong>{formatMoney(afterMinor)}</strong>
                    </>
                  )}
                  {")"}
                </>
              )}
              . This permanently reduces the demand balance once approved and requires a distinct checker&apos;s
              approval.
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
