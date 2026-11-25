"use client";

import { AuditActionDialog } from "../_components/AuditActionDialog";

/**
 * GAP-AUDIT-RISK-REGISTER-04: close a risk with a required reason.
 * PATCH /v1/audit/risks/:id { status: "closed", closeReason } (validator rejects a close without a reason).
 */
export function RiskActions({ riskId, riskCode, status }: { riskId: string; riskCode: string; status: string }) {
  if (status === "closed") return <span style={{ color: "var(--ink2)" }}>—</span>;
  return (
    <AuditActionDialog
      triggerLabel="Close"
      title={`Close risk ${riskCode}`}
      description="Closing a risk removes it from the open register. Record why it is being closed."
      endpoint={`/v1/audit/risks/${encodeURIComponent(riskId)}`}
      staticBody={{ status: "closed" }}
      fields={[{ name: "closeReason", label: "Close reason", kind: "textarea", minLength: 3 }]}
      submitLabel="Close risk"
      area="risk"
    />
  );
}
