"use client";
/**
 * ConfirmDialog — accessible, dependency-free confirmation modal.
 *
 * WCAG 2.2 AA:
 *  - role="alertdialog" with aria-labelledby / aria-describedby
 *  - focus is moved into the dialog on open and trapped (Tab / Shift+Tab cycle)
 *  - ESC and overlay-click cancel; focus returns to the trigger on close
 *  - optional required-reason input (maker-checker), busy state, aria-live result
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
  reasonLabel?: string;
  /** Disable the confirm button & show a busy state. */
  busy?: boolean;
  /** Error message shown via aria-live after a failed attempt. */
  errorMessage?: string;
  /** Called with the (optional) reason when confirmed. */
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  requireReason = false,
  reasonLabel = "Reason",
  busy = false,
  errorMessage,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [reason, setReason] = useState("");
  const titleId = useId();
  const descId = useId();
  const errId = useId();

  // Reset the reason whenever the dialog (re)opens.
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  // Move focus in on open, restore on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const node = panelRef.current;
    if (node) {
      const first = node.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? node).focus();
    }
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const node = panelRef.current;
      if (!node) return;
      const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onCancel],
  );

  if (!open) return null;

  const confirmDisabled = busy || (requireReason && reason.trim().length === 0);

  return (
    <div
      className="cd-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={panelRef}
        className="cd-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onKeyDown={handleKeyDown}
      >
        <h2 className="cd-title" id={titleId}>
          {danger && <span aria-hidden="true">⚠️</span>}
          {title}
        </h2>
        {description && (
          <div className="cd-desc" id={descId}>
            {description}
          </div>
        )}

        {requireReason && (
          <div className="cd-field">
            <label htmlFor={`${titleId}-reason`}>{reasonLabel}</label>
            <textarea
              id={`${titleId}-reason`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-required="true"
            />
          </div>
        )}

        <div className="cd-error" id={errId} role="alert" aria-live="assertive">
          {errorMessage ?? ""}
        </div>

        <div className="cd-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? "danger" : "primary"}`}
            onClick={() => onConfirm(requireReason ? reason.trim() : undefined)}
            disabled={confirmDisabled}
            aria-busy={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
