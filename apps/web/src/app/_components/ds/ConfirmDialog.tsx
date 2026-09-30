"use client";
/**
 * ConfirmDialog — accessible, dependency-free confirmation modal.
 *
 * Built on the generic `Modal` shell (see ./Modal.tsx), which owns the
 * portal/focus-trap/inert-background/ESC/focus-restore mechanics. This file
 * adds only what's specific to a confirmation prompt: the confirm/cancel
 * button pair, `danger` styling, busy state, the aria-live error region, and
 * the optional required-reason (maker-checker) field.
 *
 * WCAG 2.2 AA:
 *  - role="alertdialog" with aria-labelledby / aria-describedby (via Modal)
 *  - focus is moved into the dialog on open and trapped (Tab / Shift+Tab
 *    cycle); ESC and overlay-click cancel; focus returns to the trigger on
 *    close (all via Modal)
 *  - optional required-reason input (maker-checker), busy state, aria-live result
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Body text or nodes describing the irreversible action. */
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
  /** Require the user to type a reason before confirming (maker-checker). */
  requireReason?: boolean;
  /**
   * GAP-HR-LEAVE-APPROVALS-05: shows the same reason textarea as
   * `requireReason`, but never gates Confirm on it — for a decision where a
   * remark is welcome but shouldn't add friction to the common case (e.g. a
   * routine approval, unlike a rejection). Ignored when `requireReason` is
   * also true (that already shows the field). Confirm still passes the
   * trimmed reason through to `onConfirm` when the user typed one, empty
   * string dropped to `undefined` the same way an untouched required field
   * would never be.
   */
  optionalReason?: boolean;
  reasonLabel?: string;
  /**
   * Minimum trimmed-reason length required before Confirm enables. Defaults to
   * 1 (i.e. "non-empty"), matching every existing caller. Only set this above
   * 1 when a specific backend route enforces a longer minimum (e.g. CRM deal
   * close requires >=10 chars for a non-won outcome) — otherwise the dialog
   * lets a too-short reason through and the user only finds out from a raw
   * server error after round-tripping.
   */
  minReasonLength?: number;
  /**
   * Maximum reason length, enforced both as the textarea's native maxLength
   * (blocks typing/paste past the limit in the browser) and defensively in
   * the Confirm-disabled check. Unset by default (no cap) — set this when a
   * specific backend route enforces a hard cap (e.g. contract-service's bond
   * transition notes: 1000 chars; milestone notes: 500 chars) so a too-long
   * reason is caught here instead of round-tripping to a raw server error.
   */
  maxReasonLength?: number;
  /** Disable the confirm button & show a busy state. */
  busy?: boolean;
  /** Error message shown via aria-live after a failed attempt. */
  errorMessage?: string;
  /** Called with the (optional) reason when confirmed. */
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  requireReason = false,
  optionalReason = false,
  reasonLabel = "Reason",
  minReasonLength = 1,
  maxReasonLength,
  busy = false,
  errorMessage,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState("");
  const descId = useId();
  const errId = useId();
  const reasonFieldId = useId();
  const reasonHintId = useId();

  // Reset the reason whenever the dialog (re)opens.
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!open) return null;

  const trimmedLen = reason.trim().length;
  const reasonTooShort = requireReason && trimmedLen > 0 && trimmedLen < minReasonLength;
  const reasonTooLong = maxReasonLength !== undefined && trimmedLen > maxReasonLength;
  const confirmDisabled =
    busy || (requireReason && (trimmedLen < minReasonLength || reasonTooLong));

  return (
    <Modal
      open={open}
      onClose={onCancel}
      role="alertdialog"
      title={
        <>
          {danger && <span aria-hidden="true">⚠️</span>}
          {title}
        </>
      }
      describedById={description ? descId : undefined}
      closeOnOverlayClick={!busy}
      overlayClassName="cd-overlay"
      panelClassName="cd-panel"
      titleClassName="cd-title"
    >
      {description && (
        <div className="cd-desc" id={descId}>
          {description}
        </div>
      )}

      {(requireReason || optionalReason) && (
        <div className="cd-field">
          <label htmlFor={reasonFieldId}>{reasonLabel}</label>
          <textarea
            id={reasonFieldId}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-required={requireReason}
            {...(maxReasonLength !== undefined ? { maxLength: maxReasonLength } : {})}
            aria-describedby={requireReason && (minReasonLength > 1 || maxReasonLength !== undefined) ? reasonHintId : undefined}
          />
          {requireReason && (minReasonLength > 1 || maxReasonLength !== undefined) && (
            <p
              id={reasonHintId}
              style={{
                fontSize: 12,
                color: reasonTooShort || reasonTooLong ? "#b42318" : "var(--muted)",
                margin: "4px 0 0",
              }}
            >
              {minReasonLength > 1
                ? `At least ${minReasonLength} characters required${reasonTooShort ? ` (${trimmedLen}/${minReasonLength})` : ""}.`
                : null}
              {minReasonLength > 1 && maxReasonLength !== undefined ? " " : null}
              {maxReasonLength !== undefined ? `${trimmedLen}/${maxReasonLength} characters.` : null}
            </p>
          )}
        </div>
      )}

      <div className="cd-error" id={errId} role="alert" aria-live="assertive">
        {errorMessage ?? ""}
      </div>

      <div className="cd-actions">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          onClick={() => onConfirm((requireReason || optionalReason) ? (reason.trim() || undefined) : undefined)}
          disabled={confirmDisabled}
          aria-busy={busy}
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
