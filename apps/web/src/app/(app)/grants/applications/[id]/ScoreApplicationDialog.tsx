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
import { useTranslations } from "next-intl";
import { Button, Modal } from "@/app/_components/ds";
import { DirectoryPicker } from "@/app/_components/DirectoryPicker";
import type { ScoreApplicationRequest } from "@/lib/grants/application";
import { REVIEWER_REF_PREFIX } from "./AssignReviewerDialog";

interface ScoreApplicationDialogProps {
  open: boolean;
  busy?: boolean;
  errorMessage?: string;
  onCancel: () => void;
  onSubmit: (req: ScoreApplicationRequest) => void;
  /**
   * GAP-GRANTS-APPLICATIONS-DETAIL-05: user id the reviewer picker starts on -- the reviewer already
   * assigned to this application, else the signed-in user. The picker can still be changed.
   */
  defaultReviewerId?: string | null;
}

function parseScore(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

export function ScoreApplicationDialog({ open, busy = false, errorMessage, onCancel, onSubmit, defaultReviewerId = null }: ScoreApplicationDialogProps) {
  const t = useTranslations("grantsB4Review");
  const [reviewerId, setReviewerId] = useState<string | null>(defaultReviewerId);
  const [technicalScore, setTechnicalScore] = useState("");
  const [financialScore, setFinancialScore] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [validationError, setValidationError] = useState("");
  const titleId = useId();

  useEffect(() => {
    if (open) {
      setReviewerId(defaultReviewerId);
      setTechnicalScore("");
      setFinancialScore("");
      setRecommendation("");
      setValidationError("");
    }
  }, [open, defaultReviewerId]);

  if (!open) return null;

  function submit() {
    const technical = parseScore(technicalScore);
    const financial = parseScore(financialScore);
    if (!reviewerId) {
      setValidationError(t("reviewerRequired"));
      return;
    }
    if (technical === null || financial === null) {
      setValidationError("Both scores must be numbers between 0 and 100.");
      return;
    }
    setValidationError("");
    onSubmit({
      reviewerRef: `${REVIEWER_REF_PREFIX}${reviewerId}`,
      technicalScore: technical,
      financialScore: financial,
      recommendation: recommendation.trim() || undefined,
    });
  }

  return (
    // SF-19: ds/Modal (focus trap, inert background, Escape) instead of a hand-rolled overlay.
    <Modal
      open
      role="alertdialog"
      title="Submit evaluation"
      onClose={() => { if (!busy) onCancel(); }}
      closeOnOverlayClick={!busy}
      overlayClassName="cd-overlay"
      panelClassName="cd-panel"
      titleClassName="cd-title"
    >

        <div className="cd-field">
          <label htmlFor={`${titleId}-reviewer`}>{t("reviewerLabel")}</label>
          <DirectoryPicker
            source="user"
            id={`${titleId}-reviewer`}
            aria-label={t("reviewerLabel")}
            placeholder={t("reviewerPlaceholder")}
            value={reviewerId}
            onChange={setReviewerId}
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
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={submit} disabled={busy} aria-busy={busy}>
            {busy ? "Submitting…" : "Submit evaluation"}
          </Button>
        </div>
    </Modal>
  );
}
