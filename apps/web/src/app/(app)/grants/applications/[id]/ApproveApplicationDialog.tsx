"use client";
/**
 * ApproveApplicationDialog — COMP-012. Approves a grant application with a
 * sanctioned amount: `PATCH /v1/grants/applications/:id/approve`, validated
 * server-side by approveApplicationBody (grant-service validators.ts) as
 * { amountApprovedMinor: positive integer }. The clerk enters rupees; converted
 * with rupeesToMinorString (no float multiplication — see lib/money.ts) the
 * same way every other money input in this app does.
 */
import { useEffect, useId, useState } from "react";
import { rupeesToMinorString } from "@/lib/money";
import type { ApproveApplicationRequest } from "@/lib/grants/application";

interface ApproveApplicationDialogProps {
  open: boolean;
  busy?: boolean;
  errorMessage?: string;
  onCancel: () => void;
  onSubmit: (req: ApproveApplicationRequest) => void;
}

export function ApproveApplicationDialog({ open, busy = false, errorMessage, onCancel, onSubmit }: ApproveApplicationDialogProps) {
  const [amount, setAmount] = useState("");
  const [validationError, setValidationError] = useState("");
  const titleId = useId();

  useEffect(() => {
    if (open) {
      setAmount("");
      setValidationError("");
    }
  }, [open]);

  if (!open) return null;

  function submit() {
    const minor = rupeesToMinorString(amount);
    if (!minor) {
      setValidationError("Enter a valid sanctioned amount (e.g. 50000 or 50000.50).");
      return;
    }
    setValidationError("");
    onSubmit({ amountApprovedMinor: Number(minor) });
  }

  return (
    <div className="cd-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="cd-panel" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 className="cd-title" id={titleId}>Approve application</h2>

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

        <div className="cd-error" role="alert" aria-live="assertive">
          {validationError || errorMessage || ""}
        </div>

        <div className="cd-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={submit} disabled={busy} aria-busy={busy}>
            {busy ? "Approving…" : "Approve application"}
          </button>
        </div>
      </div>
    </div>
  );
}
