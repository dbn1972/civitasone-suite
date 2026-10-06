"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ConfirmDialog } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import type { DemandOption } from "./page";

type AcceptedResponse = { id?: string; status?: string; correlationId?: string };

type WaiverType = "penalty" | "interest" | "both";

type FieldErrors = { demandId?: string; waiverType?: string; amount?: string; reason?: string };

/**
 * GAP-REVENUE-WAIVERS-01/02/04: a waiver is a financial remission, so this form
 * replaces the old raw-UUID + paise-digits inputs with:
 *  - an assessee+demand picker (server-loaded), no UUID typed;
 *  - a RUPEES amount (rupeesToMinorString), never paise;
 *  - a cap against the chosen demand's penalty/interest outstanding;
 *  - a ConfirmDialog echoing names, FY, type and formatMoney(amount);
 *  - helper text for the 'both' type explaining how the single amount applies.
 */
export function WaiverForm({
  assesseeId,
  assesseeName,
  demands,
}: {
  assesseeId: string;
  assesseeName: string | null;
  demands: DemandOption[];
}) {
  const router = useRouter();
  const [demandId, setDemandId] = useState("");
  const [waiverType, setWaiverType] = useState<WaiverType | "">("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const demandSelectId = useId();
  const typeId = useId();
  const amountId = useId();
  const reasonId = useId();

  const selectedDemand = demands.find((d) => d.id === demandId) ?? null;
  const minorAmount = rupeesToMinorString(amount);

  // GAP-REVENUE-WAIVERS-01: cap against the component(s) being waived on the
  // chosen demand. 'both' caps at penalty + interest combined.
  function capFor(type: WaiverType | "", demand: DemandOption | null): bigint | null {
    if (!demand || !type) return null;
    try {
      const penalty = BigInt(demand.penaltyMinor);
      const interest = BigInt(demand.interestMinor);
      if (type === "penalty") return penalty;
      if (type === "interest") return interest;
      return penalty + interest; // both
    } catch {
      return null;
    }
  }
  const cap = capFor(waiverType, selectedDemand);
  const overCap = cap !== null && minorAmount !== null && BigInt(minorAmount) > cap;

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!demandId) next.demandId = "Select the demand to waive against.";
    if (!waiverType) next.waiverType = "Select a waiver type.";
    if (!minorAmount) next.amount = "Enter an amount greater than zero (e.g. 500 or 500.50).";
    else if (overCap) next.amount = "Amount cannot exceed the outstanding penalty/interest for this demand.";
    if (!reason.trim()) next.reason = "Reason is required.";
    setErrors(next);
    return Object.keys(next).length === 0; // ux-001-ok: synchronous client-side field validation, no loader
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!validate()) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submitWaiver() {
    if (!minorAmount || !waiverType || overCap) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/revenue/waivers", {
        method: "POST",
        body: JSON.stringify({
          assesseeId,
          demandId,
          waiverType,
          amountMinor: minorAmount,
          reason: reason.trim(),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(
        res.id
          ? `Waiver submitted for checker approval (id ${res.id}).`
          : "Waiver submitted for checker approval.",
      );
      setDemandId(""); setWaiverType(""); setAmount(""); setReason("");
      setErrors({});
      router.refresh();
    } catch (err) {
      setTone("bad");
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, width: "100%", boxSizing: "border-box" as const };
  const labelStyle = { fontSize: 13, fontWeight: 600 as const };
  const errStyle = { color: "var(--bad)", fontSize: 12, margin: 0 };
  const req = <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>;

  return (
    <form onSubmit={handleSubmit} aria-label={`Raise waiver for assessee ${assesseeId}`}>
      <Card title={`Raise Waiver${assesseeName ? ` — ${assesseeName}` : ""}`} padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={demandSelectId} style={labelStyle}>Demand {req}</label>
              <select id={demandSelectId} value={demandId} onChange={(e) => setDemandId(e.target.value)}
                aria-required="true" aria-invalid={!!errors.demandId || undefined} style={{ ...inputStyle, appearance: "auto" }}>
                <option value="">Select a demand…</option>
                {demands.map((d) => (
                  <option key={d.id} value={d.id}>
                    FY {d.financialYear} · due {formatIndianDate(d.dueDate)} · bal {formatMoney(d.netMinor)}
                  </option>
                ))}
              </select>
              {errors.demandId && <p role="alert" style={errStyle}>{errors.demandId}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={typeId} style={labelStyle}>Waiver Type {req}</label>
              <select id={typeId} value={waiverType} onChange={(e) => setWaiverType(e.target.value as WaiverType)}
                aria-required="true" aria-invalid={!!errors.waiverType || undefined} style={{ ...inputStyle, appearance: "auto" }}>
                <option value="" disabled>Select…</option>
                <option value="penalty">Penalty</option>
                <option value="interest">Interest</option>
                <option value="both">Both (Penalty + Interest)</option>
              </select>
              {errors.waiverType && <p role="alert" style={errStyle}>{errors.waiverType}</p>}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={amountId} style={labelStyle}>Amount (₹) {req}</label>
              <input id={amountId} value={amount} onChange={(e) => setAmount(e.target.value)}
                type="text" inputMode="decimal" placeholder="e.g. 500.00"
                aria-required="true" aria-invalid={!!errors.amount || undefined} style={inputStyle} />
              {selectedDemand && cap !== null && (
                <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>
                  {minorAmount && !errors.amount ? <>= {formatMoney(minorAmount)} · </> : null}
                  Max waivable ({waiverType === "both" ? "penalty + interest" : waiverType}): {formatMoney(cap.toString())}
                </p>
              )}
              {errors.amount && <p role="alert" style={errStyle}>{errors.amount}</p>}
            </div>
          </div>

          {/* GAP-REVENUE-WAIVERS-04 DECISION (safest default, flagged for revenue
              owners): the backend waiver command takes a single amountMinor + a
              waiverType, with no per-component split. Rather than invent a split
              the server cannot record, 'both' applies the single amount against
              the combined penalty+interest outstanding, and this helper text
              states that explicitly. A true penalty/interest split needs a
              backend schema change and is recorded as a follow-up. */}
          {waiverType === "both" && (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>
              &ldquo;Both&rdquo; applies this single amount against the demand&apos;s combined penalty and interest
              outstanding; the apportionment between the two is handled by the backend rule, not split here.
            </p>
          )}

          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={reasonId} style={labelStyle}>Reason {req}</label>
            <textarea id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)}
              maxLength={500} rows={3} aria-required="true" aria-invalid={!!errors.reason || undefined}
              style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} />
            {errors.reason && <p role="alert" style={errStyle}>{errors.reason}</p>}
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy} loading={busy}>
              {busy ? "Submitting…" : "Submit Waiver"}
            </Button>
          </div>

          {message && (
            <p role={tone === "bad" ? "alert" : "status"} className={`pill ${tone}`} style={{ width: "fit-content" }}>
              {message}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Submit this waiver for approval?"
        confirmLabel="Submit waiver"
        busy={busy}
        errorMessage={dialogError}
        description={
          minorAmount && selectedDemand ? (
            <>
              Waive <strong>{formatMoney(minorAmount)}</strong> of{" "}
              <strong>{waiverType === "both" ? "penalty + interest" : waiverType}</strong> on{" "}
              <strong>{assesseeName ?? "this assessee"}</strong>&apos;s FY{" "}
              <strong>{selectedDemand.financialYear}</strong> demand. A waiver is a partial remission of penalty or
              interest — it does not write off the principal — and requires a distinct checker&apos;s approval.
            </>
          ) : (
            "Submit this waiver for approval?"
          )
        }
        onConfirm={() => void submitWaiver()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
