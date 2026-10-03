"use client";

import { useState } from "react";
import { Button, ConfirmDialog } from "../../../../../_components/ds";
import { postWithErrorCode } from "../../_lib/postWithErrorCode";

export type RevealCopy = {
  revealBtn: string;
  hideBtn: string;
  revealTitle: string;
  revealDescription: string;
  reasonLabel: string;
  forbiddenError: string;
  networkError: string;
};

/**
 * GAP-PAYROLL-PENSIONERS-04: one masked identifier with an AUDITED reveal.
 * POST <path> { field, reason } -- payroll-service records who revealed what
 * and why (reason >= 10 characters) BEFORE returning the value, so a reveal
 * that could not be audited is never shown. The revealed value lives only in
 * this component's state (gone on Hide / navigation), never in a URL.
 */
export function RevealValue({
  path, field, masked, copy, area,
}: {
  path: string;
  field: "ppoNo" | "pan" | "bankAccountNo";
  masked: string;
  copy: RevealCopy;
  area: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [value, setValue] = useState<string | null>(null);

  async function reveal(reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await postWithErrorCode<{ value?: string }>(path, { field, reason }, { FORBIDDEN: copy.forbiddenError }, { area, statusAware: true });
      setValue(typeof res.value === "string" ? res.value : null);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.networkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontFamily: "monospace" }} data-testid={`value-${field}`}>{value ?? masked}</span>
      {value === null ? (
        <Button type="button" variant="ghost" style={{ minHeight: 32, padding: "2px 10px" }} onClick={() => { setError(undefined); setOpen(true); }}>
          {copy.revealBtn}
        </Button>
      ) : (
        <Button type="button" variant="ghost" style={{ minHeight: 32, padding: "2px 10px" }} onClick={() => setValue(null)}>
          {copy.hideBtn}
        </Button>
      )}
      <ConfirmDialog
        open={open}
        title={copy.revealTitle}
        description={copy.revealDescription}
        confirmLabel={copy.revealBtn}
        requireReason
        minReasonLength={10}
        maxReasonLength={500}
        reasonLabel={copy.reasonLabel}
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void reveal(reason)}
        onCancel={() => !busy && setOpen(false)}
      />
    </span>
  );
}
