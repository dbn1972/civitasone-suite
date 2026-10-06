"use client";
/**
 * ApproveApplicationDialog — COMP-012 + GAP-GRANTS-APPLICATIONS-DETAIL-04.
 * Approves a grant application with a sanctioned amount: `PATCH
 * /v1/grants/applications/:id/approve`, validated server-side by
 * approveApplicationBody (grant-service validators.ts) as
 * { amountApprovedMinor: positive integer, reason?: string }.
 *
 * The clerk enters rupees; converted with rupeesToMinorString (no float
 * multiplication). DETAIL-04: the dialog now SHOWS the requested amount and the
 * scheme's min/max, prefills with the requested value, blocks submit when the
 * amount is outside the scheme range (bigint/minor-string comparison), and
 * carries an optional sanction reason. The grant-service still validates
 * server-side; this is a guard + context, not the authority.
 */
import { useEffect, useId, useState } from "react";
import { Button } from "@/app/_components/ds";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";
import type { ApproveApplicationRequest } from "@/lib/grants/application";

interface ApproveApplicationDialogProps {
  open: boolean;
  busy?: boolean;
  errorMessage?: string;
  /** Requested amount in minor units (paise), for display + prefill. */
  requestedMinor?: number | null;
  /** Scheme min/max sanction bounds in minor units (paise), when known. */
  minMinor?: number | null;
  maxMinor?: number | null;
  onCancel: () => void;
  onSubmit: (req: ApproveApplicationRequest) => void;
}

function minorToRupeeInput(minor: number | null | undefined): string {
  if (minor == null || !Number.isFinite(minor) || minor <= 0) return "";
  // minor paise → "rupees.pp" without float drift.
  const n = BigInt(Math.round(minor));
  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}

export function ApproveApplicationDialog({
  open, busy = false, errorMessage, requestedMinor, minMinor, maxMinor, onCancel, onSubmit,
}: ApproveApplicationDialogProps) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [validationError, setValidationError] = useState("");
  const titleId = useId();

  useEffect(() => {
    if (open) {
      // GAP-GRANTS-APPLICATIONS-DETAIL-04: prefill with the requested amount.
      setAmount(minorToRupeeInput(requestedMinor));
      setReason("");
      setValidationError("");
    }
  }, [open, requestedMinor]);

  if (!open) return null;

  function submit() {
    const minor = rupeesToMinorString(amount);
    if (!minor) {
      setValidationError("Enter a valid sanctioned amount (e.g. 50000 or 50000.50).");
      return;
    }
    // Range guard in bigint (minor units) — never float rupees.
    const minorBig = BigInt(minor);
    if (minMinor != null && minorBig < BigInt(Math.round(minMinor))) {
      setValidationError(`Sanctioned amount is below the scheme minimum (${formatMoney(minMinor)}).`);
      return;
    }
    if (maxMinor != null && minorBig > BigInt(Math.round(maxMinor))) {
      setValidationError(`Sanctioned amount exceeds the scheme maximum (${formatMoney(maxMinor)}).`);
      return;
    }
    setValidationError("");
    onSubmit({ amountApprovedMinor: Number(minor), ...(reason.trim() ? { reason: reason.trim() } : {}) });
  }

  const rangeLabel =
    minMinor != null || maxMinor != null
      ? `Scheme range ${minMinor != null ? formatMoney(minMinor) : "—"} – ${maxMinor != null ? formatMoney(maxMinor) : "—"}`
      : null;

  return (
    <div className="cd-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="cd-panel" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 className="cd-title" id={titleId}>Approve application</h2>

        <p style={{ fontSize: 13, color: "var(--ink2)", margin: "0 0 10px" }}>
          {requestedMinor != null ? <>Requested <strong>{formatMoney(requestedMinor)}</strong>. </> : null}
          {rangeLabel}
        </p>

        <div className="cd-field">
          <label htmlFor={`${titleId}-amount`}>Sanctioned amount (₹)</label>
          <input
            id={`${titleId}-amount`}
            inputMode="decimal"
            value={amount}
            aria-required="true"
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 50000"
          />
        </div>

        <div className="cd-field">
          <label htmlFor={`${titleId}-reason`}>Reason / remarks (optional)</label>
          <textarea
            id={`${titleId}-reason`}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Sanction reference / remarks for the audit trail"
          />
        </div>

        <div className="cd-error" role="alert" aria-live="assertive">
          {validationError || errorMessage || ""}
        </div>

        <div className="cd-actions">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={submit} disabled={busy} aria-busy={busy}>
            {busy ? "Approving…" : "Approve application"}
          </Button>
        </div>
      </div>
    </div>
  );
}
