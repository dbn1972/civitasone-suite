"use client";
/**
 * CloseOpportunityDialog — OP-006. Closes an opportunity with a mandatory
 * outcome (won | lost | cancelled | on_hold) and reason; a competitor is
 * additionally required when the outcome is "lost". The close is irreversible,
 * so it is gated behind an accessible confirmation and blocks submit until the
 * mandatory inputs are present (never fires a half-filled close). A 422 from the
 * backend (missing mandatory fields) is surfaced inline, not swallowed.
 */
import { useEffect, useId, useState } from "react";
import {
  closeOpportunity,
  CLOSE_OUTCOMES,
  CLOSE_OUTCOME_LABELS,
  MandatoryFieldsError,
  OPP_FIELD_LABELS,
  type CloseOutcome,
  type OppFieldKey,
} from "@/lib/crm/opportunity";

interface CloseOpportunityDialogProps {
  opportunityId: string;
  opportunityName: string;
  open: boolean;
  onClose: () => void;
  /** Called after a successful close so the parent can reload. */
  onClosed?: () => void;
}

export function CloseOpportunityDialog({
  opportunityId,
  opportunityName,
  open,
  onClose,
  onClosed,
}: CloseOpportunityDialogProps) {
  const [outcome, setOutcome] = useState<CloseOutcome>("won");
  const [reason, setReason] = useState("");
  const [competitor, setCompetitor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      setOutcome("won");
      setReason("");
      setCompetitor("");
      setError("");
      setMissing([]);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const competitorRequired = outcome === "lost";
  const canSubmit =
    reason.trim().length > 0 && (!competitorRequired || competitor.trim().length > 0) && !busy;

  async function submit() {
    setError("");
    setMissing([]);
    if (!canSubmit) {
      setError(
        competitorRequired && competitor.trim().length === 0
          ? "A competitor is required when an opportunity is marked lost."
          : "A reason is required to close an opportunity.",
      );
      return;
    }
    setBusy(true);
    try {
      await closeOpportunity(opportunityId, {
        outcome,
        reason: reason.trim(),
        competitor: competitor.trim() || undefined,
      });
      onClosed?.();
      onClose();
    } catch (e) {
      if (e instanceof MandatoryFieldsError) {
        setMissing(e.missingFields);
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : "Could not close the opportunity.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cd-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="cd-panel" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 className="cd-title" id={titleId}>
          Close “{opportunityName}”
        </h2>

        <div className="cd-field">
          <label htmlFor={`${titleId}-outcome`}>Outcome</label>
          <select
            id={`${titleId}-outcome`}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as CloseOutcome)}
          >
            {CLOSE_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {CLOSE_OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
        </div>

        <div className="cd-field">
          <label htmlFor={`${titleId}-reason`}>Reason</label>
          <textarea
            id={`${titleId}-reason`}
            rows={3}
            value={reason}
            aria-required="true"
            aria-invalid={reason.trim() ? undefined : true}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <div className="cd-field">
          <label htmlFor={`${titleId}-competitor`}>
            Competitor{competitorRequired ? "" : " (optional)"}
          </label>
          <input
            id={`${titleId}-competitor`}
            value={competitor}
            aria-required={competitorRequired || undefined}
            aria-invalid={competitorRequired && !competitor.trim() ? true : undefined}
            onChange={(e) => setCompetitor(e.target.value)}
            placeholder={competitorRequired ? "Who did we lose to?" : ""}
          />
        </div>

        {missing.length > 0 && (
          <p style={{ fontSize: 13, color: "#b42318", padding: "0 4px" }}>
            Complete these first:{" "}
            {missing
              .map((f) => OPP_FIELD_LABELS[f as OppFieldKey] ?? f)
              .join(", ")}
            .
          </p>
        )}

        <div className="cd-error" role="alert" aria-live="assertive">
          {error}
        </div>

        <div className="cd-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void submit()}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Closing…" : "Close opportunity"}
          </button>
        </div>
      </div>
    </div>
  );
}
