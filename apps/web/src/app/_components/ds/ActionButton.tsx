"use client";
/**
 * ActionButton + useConfirmAction — gate an irreversible action behind an
 * accessible ConfirmDialog (maker-checker pattern).
 *
 *   <ActionButton
 *     label="Approve voucher"
 *     confirmTitle="Approve this voucher?"
 *     confirmDescription="This posts to PFMS and cannot be undone."
 *     requireReason
 *     onConfirm={async (reason) => { await approve(id, reason); }}
 *   />
 */
import { useCallback, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

export interface UseConfirmActionOptions {
  /** The irreversible work; may be async. Throw to surface an error. */
  onConfirm: (reason?: string) => void | Promise<void>;
  /** Called after a successful confirm. */
  onSuccess?: () => void;
}

export function useConfirmAction({ onConfirm, onSuccess }: UseConfirmActionOptions) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const trigger = useCallback(() => {
    setError(undefined);
    setOpen(true);
  }, []);

  const cancel = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setError(undefined);
  }, [busy]);

  const confirm = useCallback(
    async (reason?: string) => {
      setBusy(true);
      setError(undefined);
      try {
        await onConfirm(reason);
        setOpen(false);
        onSuccess?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [onConfirm, onSuccess],
  );

  return { open, busy, error, trigger, cancel, confirm };
}

export interface ActionButtonProps {
  /** Visible button label. */
  label: ReactNode;
  className?: string;
  disabled?: boolean;
  /** The irreversible work; may be async. */
  onConfirm: (reason?: string) => void | Promise<void>;
  onSuccess?: () => void;
  // Dialog config (forwarded to ConfirmDialog)
  confirmTitle: string;
  confirmDescription?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  /** Forwarded to ConfirmDialog — see its doc comment. Defaults to 1 (non-empty). */
  minReasonLength?: number;
}

export function ActionButton({
  label,
  className,
  disabled,
  onConfirm,
  onSuccess,
  confirmTitle,
  confirmDescription,
  confirmLabel,
  cancelLabel,
  danger = false,
  requireReason = false,
  reasonLabel,
  minReasonLength,
}: ActionButtonProps) {
  const { open, busy, error, trigger, cancel, confirm } = useConfirmAction({
    onConfirm,
    onSuccess,
  });

  return (
    <>
      <button
        type="button"
        className={className ?? `btn ${danger ? "danger" : "primary"}`}
        onClick={trigger}
        disabled={disabled}
      >
        {label}
      </button>
      <ConfirmDialog
        open={open}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        danger={danger}
        requireReason={requireReason}
        reasonLabel={reasonLabel}
        {...(minReasonLength !== undefined ? { minReasonLength } : {})}
        busy={busy}
        errorMessage={error}
        onConfirm={confirm}
        onCancel={cancel}
      />
    </>
  );
}
