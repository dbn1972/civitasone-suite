"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../../../_components/ds";

/**
 * Form-24Q is blocked (409 TDS_RECONCILIATION_FAILED) when TDS deducted does
 * not match deposited challans for the quarter. This lets a payroll/finance
 * officer explicitly bypass that gate (?force=1) — the server records a
 * force_file_24q audit event with the actor and per-period variance, so the
 * override is never silent. Irreversible filing consequence → ConfirmDialog.
 *
 * KNOWN GAP (see PR "BACKEND FOLLOW-UPS"): this is a GET with force=1, not a
 * POST mutation, so it is not idempotent and the audit event isn't deduped
 * server-side. ReturnsPage renders <StripForceParam/> after landing here so a
 * manual page refresh at least can't silently re-trigger it via the address
 * bar — but a true fix needs a POST endpoint on payroll-service.
 */
export function ForceFileButton({ fy, quarter }: { fy: string; quarter: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function confirm() {
    setBusy(true);
    router.push(`/hr/payroll/returns?fy=${encodeURIComponent(fy)}&quarter=${quarter}&force=1`);
    setOpen(false);
    setBusy(false);
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
        File anyway — bypass reconciliation (force)
      </button>

      <ConfirmDialog
        open={open}
        title="File Form-24Q despite unreconciled TDS?"
        confirmLabel="File with force=1"
        danger
        busy={busy}
        description={
          <>
            TDS deducted for FY <strong>{fy}</strong> {quarter} does not match deposited challans (or no
            challans have been ingested yet). Filing anyway records a{" "}
            <strong>force_file_24q</strong> audit event with your identity and the per-period variance.
            This does not fix the underlying discrepancy — reconcile challans in TRACES before the
            statutory due date.
          </>
        }
        onConfirm={confirm}
        onCancel={() => !busy && setOpen(false)}
      />
    </div>
  );
}
