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
  demands?: ReadonlyArray<{ id: string; financialYear: string; netMinor: string; status: string }>;
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
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string; reason?: string }>({});

  const amountId = useId();
  const reasonId = useId();
  const demandSelectId = useId();
  const summaryId = useId();

  const amountErrorId = `${amountId}-error`;
  const reasonErrorId = `${reasonId}-error`;

  const amountRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const demandList = demands ?? [];
  const selectedDemand = demandList.find((d) => d.id === demandId) ?? null;

  const minorAmount = rupeesToMinorString(amount);
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
  const formDisabled = !!dcbUnavailable;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errors: { amount?: string; reason?: string } = {};
    if (!minorAmount) errors.amount = "Enter a valid amount greater than zero, with at most 2 decimal places.";
    else if (overCap) errors.amount = "Amount cannot exceed the outstanding arrears shown above.";
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
    if (!minorAmount || overCap) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/revenue/write-offs", {
        method: "POST",
        body: JSON.stringify({
          assesseeId,
          amountMinor: minorAmount,
          reason: reason.trim(),
          ...(selectedDemand ? { demandId: selectedDemand.id, financialYear: selectedDemand.financialYear } : {}),
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
            <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--bad, #c0392b)" }}>
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
            {demandList.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={demandSelectId} style={{ fontSize: 13, fontWeight: 600 }}>
                  Demand (optional)
                </label>
                <select
                  id={demandSelectId}
                  value={demandId}
                  onChange={(e) => setDemandId(e.target.value)}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, appearance: "auto" }}
                >
                  <option value="">Against the assessee (no specific demand)</option>
                  {demandList.map((d) => (
                    <option key={d.id} value={d.id}>
                      FY {d.financialYear} · bal {formatMoney(d.netMinor)}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
