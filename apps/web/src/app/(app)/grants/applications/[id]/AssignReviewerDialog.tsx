"use client";
/**
 * AssignReviewerDialog -- GAP-GRANTS-APPLICATIONS-DETAIL-05. The reviewer is chosen from the tenant
 * user directory (DirectoryPicker, name search; the id is never typed or read by a person) and sent as
 * the opaque "identity_user:<uuid>" ref grant-service stores. grant-service rejects the submitter as
 * reviewer (separation of duties).
 */
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@/app/_components/ds";
import { DirectoryPicker } from "@/app/_components/DirectoryPicker";
import type { AssignReviewerRequest } from "@/lib/grants/application";

export const REVIEWER_REF_PREFIX = "identity_user:";

interface AssignReviewerDialogProps {
  open: boolean;
  busy?: boolean;
  errorMessage?: string;
  onCancel: () => void;
  onSubmit: (req: AssignReviewerRequest) => void;
}

export function AssignReviewerDialog({ open, busy = false, errorMessage, onCancel, onSubmit }: AssignReviewerDialogProps) {
  const t = useTranslations("grantsB4Review");
  const [reviewerId, setReviewerId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState("");
  const titleId = useId();

  useEffect(() => {
    if (open) {
      setReviewerId(null);
      setValidationError("");
    }
  }, [open]);

  if (!open) return null;

  function submit() {
    if (!reviewerId) {
      setValidationError(t("reviewerRequired"));
      return;
    }
    setValidationError("");
    onSubmit({ reviewerRef: `${REVIEWER_REF_PREFIX}${reviewerId}` });
  }

  return (
    <Modal
      open
      role="alertdialog"
      title={t("assignTitle")}
      onClose={() => { if (!busy) onCancel(); }}
      closeOnOverlayClick={!busy}
      overlayClassName="cd-overlay"
      panelClassName="cd-panel"
      titleClassName="cd-title"
    >
      <p style={{ fontSize: 13, color: "var(--ink2)", marginBlockEnd: 12 }}>{t("assignDescription")}</p>
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
      <div className="cd-error" role="alert" aria-live="assertive">
        {validationError || errorMessage || ""}
      </div>
      <div className="cd-actions">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button type="button" variant="primary" onClick={submit} disabled={busy} aria-busy={busy}>
          {busy ? t("assigning") : t("assignConfirm")}
        </Button>
      </div>
    </Modal>
  );
}
