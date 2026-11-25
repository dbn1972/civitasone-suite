"use client";

import { AuditActionDialog } from "../_components/AuditActionDialog";

export const CLOSE_OUTCOME_OPTIONS = [
  { value: "substantiated", label: "Substantiated" },
  { value: "unsubstantiated", label: "Unsubstantiated" },
  { value: "inconclusive", label: "Inconclusive" },
  { value: "referred", label: "Referred onward" },
] as const;

/**
 * GAP-AUDIT-INVESTIGATION-05: assign an officer / close with outcome + reason.
 * PATCH /v1/audit/investigations/:id/assign { assignedTo } and .../close { outcome, reason }.
 * Server gate (owner decision B4): audit_admin, audit_officer, vigilance_admin only; closed is terminal.
 */
export function InvestigationActions({ id, caseId, status }: { id: string; caseId: string; status: string }) {
  if (status === "closed") return null;
  const base = `/v1/audit/investigations/${encodeURIComponent(id)}`;
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <AuditActionDialog
        triggerLabel="Assign"
        title={`Assign ${caseId}`}
        endpoint={`${base}/assign`}
        fields={[{ name: "assignedTo", label: "Assign to (officer)", kind: "text", maxLength: 128 }]}
        submitLabel="Assign"
        area="investigation"
      />
      <AuditActionDialog
        triggerLabel="Close case"
        title={`Close ${caseId}`}
        description="Closing is final. Record the outcome and the reason."
        endpoint={`${base}/close`}
        fields={[
          { name: "outcome", label: "Outcome", kind: "select", options: CLOSE_OUTCOME_OPTIONS },
          { name: "reason", label: "Close reason", kind: "textarea", minLength: 3 },
        ]}
        submitLabel="Close case"
        area="investigation"
      />
    </div>
  );
}
