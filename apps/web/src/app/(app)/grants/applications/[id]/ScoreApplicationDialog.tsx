"use client";
/**
 * ScoreApplicationDialog — COMP-012. Submits a reviewer's evaluation of a grant
 * application: `PATCH /v1/grants/applications/:id/score`, validated server-side
 * by scoreApplicationBody (grant-service validators.ts) as
 * { reviewerRef: string(min 1), technicalScore: 0-100, financialScore: 0-100,
 *   recommendation?: string }. Mirrors the CloseOpportunityDialog form-modal
 * convention (local field state, submit-time validation, inline error).
 */
import { useEffect, useId, useState } from "react";
import type { ScoreApplicationRequest } from "@/lib/grants/application";

interface ScoreApplicationDialogProps {
  open: boolean;
  busy?: boolean;
  errorMessage?: string;
  onCancel: () => void;
  onSubmit: (req: ScoreApplicationRequest) => void;
}

function parseScore(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

export function ScoreApplicationDialog({ open, busy = false, errorMessage, onCancel, onSubmit }: ScoreApplicationDialogProps) {
  const [reviewerRef, setReviewerRef] = useState("");
  const [technicalScore, setTechnicalScore] = useState("");
  const [financialScore, setFinancialScore] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [validationError, setValidationError] = useState("");
  const titleId = useId();

  useEffect(() => {
    if (open) {
      setReviewerRef("");
      setTechnicalScore("");
      setFinancialScore("");
      setRecommendation("");
      setValidationError("");
    }
  }, [open]);

  if (!open) return null;

  function submit() {
    const technical = parseScore(technicalScore);
    const financial = parseScore(financialScore);
    if (!reviewerRef.trim()) {
      setValidationError("Enter the reviewer's reference/ID.");
      return;
    }
    if (technical === null || financial === null) {
      setValidationError("Both scores must be numbers between 0 and 100.");
      return;
    }
    setValidationError("");
    onSubmit({
      reviewerRef: reviewerRef.trim(),
      technicalScore: technical,
      financialScore: financial,
      recommendation: recommendation.trim() || undefined,
    });
  }

  return (
    <div className="cd-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="cd-panel" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 className="cd-title" id={titleId}>Submit evaluation</h2>

        <div className="cd-field">
          <label htmlFor={`${titleId}-reviewer`}>Reviewer reference</label>
          <input
            id={`${titleId}-reviewer`}
            value={reviewerRef}
            aria-required="true"
            onChange={(e) => setReviewerRef(e.target.value)}
          />
        </div>

        <div className="cd-field">
          <label htmlFor={`${titleId}-technical`}>Technical score (0–100)</label>
          <input
            id={`${titleId}-technical`}
            type="number"
            min={0}
            max={100}
            value={technicalScore}
            aria-required="true"
            onChange={(e) => setTechnicalScore(e.target.value)}
          />
        </div>

        <div className="cd-field">
          <label htmlFor={`${titleId}-financial`}>Financial score (0–100)</label>
          <input
            id={`${titleId}-financial`}
            type="number"
            min={0}
            max={100}
            value={financialScore}
            aria-required="true"
            onChange={(e) => setFinancialScore(e.target.value)}
          />
        </div>

        <div className="cd-field">
          <label htmlFor={`${titleId}-recommendation`}>Recommendation (optional)</label>
          <textarea
            id={`${titleId}-recommendation`}
            rows={3}
            value={recommendation}
            onChange={(e) => setRecommendation(e.target.value)}
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
            {busy ? "Submitting…" : "Submit evaluation"}
          </button>
        </div>
      </div>
    </div>
  );
}
