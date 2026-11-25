"use client";

import { AuditActionDialog } from "../_components/AuditActionDialog";
import { useAuditT } from "@/lib/audit/useAuditT";

const OUTCOMES = [
  ["substantiated", "actOutcomeSubstantiated"],
  ["unsubstantiated", "actOutcomeUnsubstantiated"],
  ["inconclusive", "actOutcomeInconclusive"],
  ["referred", "actOutcomeReferred"],
] as const;

/**
 * GAP-AUDIT-INVESTIGATION-05: assign an officer / close with outcome + reason.
 * PATCH /v1/audit/investigations/:id/assign { assignedTo } and .../close { outcome, reason }.
 * Server gate: INVESTIGATION_ACT_ROLES (audit_admin, audit_officer, vigilance_admin, super_admin); closed is terminal.
 */
export function InvestigationActions({ id, caseId, status }: { id: string; caseId: string; status: string }) {
  const t = useAuditT();
  if (status === "closed") return null;
  const base = `/v1/audit/investigations/${encodeURIComponent(id)}`;
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <AuditActionDialog
        triggerLabel={t("actBtnAssign")}
        title={t("actInvAssignTitle", { caseId })}
        endpoint={`${base}/assign`}
        fields={[{ name: "assignedTo", label: t("actInvAssignField"), kind: "text", maxLength: 128 }]}
        submitLabel={t("actInvAssignSubmit")}
        area="investigation"
      />
      <AuditActionDialog
        triggerLabel={t("actBtnCloseCase")}
        title={t("actInvCloseTitle", { caseId })}
        description={t("actInvCloseDesc")}
        endpoint={`${base}/close`}
        fields={[
          { name: "outcome", label: t("actInvOutcome"), kind: "select", options: OUTCOMES.map(([value, key]) => ({ value, label: t(key) })) },
          { name: "reason", label: t("actInvCloseReason"), kind: "textarea", minLength: 3 },
        ]}
        submitLabel={t("actInvCloseSubmit")}
        area="investigation"
      />
    </div>
  );
}
