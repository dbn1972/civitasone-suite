"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog } from "../../../../../_components/ds";
import { patchWithErrorCode } from "../../_lib/postWithErrorCode";

export type PensionerStatusCopy = {
  stopBtn: string;
  deceasedBtn: string;
  stopTitle: string;
  deceasedTitle: string;
  stopDescription: string;
  deceasedDescription: string;
  reasonLabel: string;
  dateOfDeathLabel: string;
  stoppedMessage: string;
  deceasedMessage: string;
  invalidStateError: string;
  networkError: string;
};

/**
 * GAP-PAYROLL-PENSIONERS-03: stop a pension / mark a pensioner deceased.
 * PATCH /v1/payroll/pensioners/:id/status { status, reason, dateOfDeath? }.
 * Both change what the next pension run pays, so each needs a reason (>= 10
 * characters, on the audit event) and a confirmation; "deceased" also needs the
 * date of death (not in the future). The server refuses a stale transition
 * (409) and applies it with a conditional update, so two admins cannot both win.
 */
export function PensionerStatusActions({
  id, status, today, copy,
}: {
  id: string;
  status: string;
  /** YYYY-MM-DD, supplied by the server so the browser clock cannot disagree with it. */
  today: string;
  copy: PensionerStatusCopy;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<"stopped" | "deceased" | null>(null);
  const [dateOfDeath, setDateOfDeath] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  async function submit(reason?: string) {
    if (!target) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await patchWithErrorCode(
        `v1/payroll/pensioners/${id}/status`,
        { status: target, reason, ...(target === "deceased" ? { dateOfDeath } : {}) },
        { INVALID_STATE: copy.invalidStateError },
        { statusAware: true },
      );
      setMessage(target === "deceased" ? copy.deceasedMessage : copy.stoppedMessage);
      setTarget(null);
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : copy.networkError);
    } finally {
      setBusy(false);
    }
  }

  const canStop = status === "active";
  const canMarkDeceased = status === "active" || status === "stopped";
  if (!canStop && !canMarkDeceased && !message) return null;

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      {canStop && (
        <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={() => { setDialogError(undefined); setMessage(null); setTarget("stopped"); }}>
          {copy.stopBtn}
        </Button>
      )}
      {canMarkDeceased && (
        <Button type="button" variant="ghost" style={{ minHeight: 44 }} onClick={() => { setDialogError(undefined); setMessage(null); setDateOfDeath(""); setTarget("deceased"); }}>
          {copy.deceasedBtn}
        </Button>
      )}
      {message && <p role="status" className="pill good" style={{ margin: 0, width: "fit-content" }}>{message}</p>}
      <ConfirmDialog
        open={target !== null}
        title={target === "deceased" ? copy.deceasedTitle : copy.stopTitle}
        description={target === "deceased" ? copy.deceasedDescription : copy.stopDescription}
        confirmLabel={target === "deceased" ? copy.deceasedBtn : copy.stopBtn}
        danger
        requireReason
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel={copy.reasonLabel}
        confirmDisabled={target === "deceased" && (!dateOfDeath || dateOfDeath > today)}
        busy={busy}
        errorMessage={dialogError}
        onConfirm={(reason) => void submit(reason)}
        onCancel={() => !busy && setTarget(null)}
      >
        {target === "deceased" && (
          <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
            <label htmlFor="pensioner-dod" style={{ fontSize: 13, fontWeight: 600 }}>{copy.dateOfDeathLabel}</label>
            <input
              id="pensioner-dod"
              type="date"
              max={today}
              value={dateOfDeath}
              onChange={(e) => setDateOfDeath(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
