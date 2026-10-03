"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog } from "../../../../_components/ds";
import { patchWithErrorCode } from "../_lib/postWithErrorCode";

export type ActiveToggleCopy = {
  deactivateBtn: string;
  reactivateBtn: string;
  deactivateTitle: string;
  reactivateTitle: string;
  deactivateDescription: string;
  reactivateDescription: string;
  reasonLabel: string;
  deactivatedMessage: string;
  reactivatedMessage: string;
  /** Shown for the server's 409 DDO_IN_USE / INVALID_STATE answers. */
  conflictMessage: string;
  networkError: string;
};

/**
 * Deactivate / reactivate a payroll master record (a DDO, a pay group):
 * PATCH <path> { active, reason }. The reason (min 10 chars, the server's own
 * minimum) goes on the audit event. 409s are shown as one plain sentence;
 * everything else falls back to the catalogue message -- backend text is never
 * displayed (UX-020).
 */
export function ActiveToggle({
  path, active, copy, area, conflictCodes = ["DDO_IN_USE", "INVALID_STATE"],
}: {
  /** PATCH path relative to the BFF proxy, e.g. v1/payroll/ddos/<code>/status. */
  path: string;
  active: boolean;
  copy: ActiveToggleCopy;
  /** Plain noun for the generic failure message. */
  area?: string;
  conflictCodes?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function submit(reason?: string) {
    setBusy(true);
    setDialogError(undefined);
    try {
      await patchWithErrorCode(
        path,
        { active: !active, reason },
        Object.fromEntries(conflictCodes.map((c) => [c, copy.conflictMessage])),
        { ...(area ? { area } : {}), statusAware: true },
      );
      setOpen(false);
      setMessage(active ? copy.deactivatedMessage : copy.reactivatedMessage);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : copy.networkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <Button
        type="button"
        variant={active ? "ghost" : "primary"}
        style={{ minHeight: 44 }}
        onClick={() => { setDialogError(undefined); setMessage(null); setOpen(true); }}
      >
        {active ? copy.deactivateBtn : copy.reactivateBtn}
      </Button>
      {message && <p role="status" className="pill good" style={{ margin: 0, width: "fit-content" }}>{message}</p>}
      <ConfirmDialog
        open={open}
        title={active ? copy.deactivateTitle : copy.reactivateTitle}
        description={active ? copy.deactivateDescription : copy.reactivateDescription}
        confirmLabel={active ? copy.deactivateBtn : copy.reactivateBtn}
        danger={active}
        requireReason
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel={copy.reasonLabel}
        busy={busy}
        errorMessage={dialogError}
        onConfirm={(reason) => void submit(reason)}
        onCancel={() => !busy && setOpen(false)}
      />
    </div>
  );
}
