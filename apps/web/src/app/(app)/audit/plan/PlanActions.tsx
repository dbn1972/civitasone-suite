"use client";

import { AuditActionDialog } from "../_components/AuditActionDialog";

/**
 * GAP-AUDIT-PLAN-05: plan-level Defer (reason required) and Complete. The audit-service routes are
 * PATCH /v1/audit/plans/:id/defer { reason } and PATCH /v1/audit/plans/:id/complete; the server enforces
 * the status rules (defer: draft/in_progress, complete: in_progress) and answers 409 otherwise.
 */
export function PlanActions({ planId, planNo, status }: { planId: string; planNo?: string; status: string }) {
  const label = planNo ? `plan ${planNo}` : "plan";
  const canDefer = status === "planned" || status === "in_progress";
  const canComplete = status === "in_progress";
  if (!canDefer && !canComplete) return <span style={{ color: "var(--ink2)" }}>—</span>;
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {canComplete ? (
        <AuditActionDialog
          triggerLabel="Complete"
          title={`Complete ${label}`}
          description="Mark this audit plan as completed. This cannot be undone."
          endpoint={`/v1/audit/plans/${encodeURIComponent(planId)}/complete`}
          fields={[]}
          submitLabel="Complete plan"
          area="audit plan"
        />
      ) : null}
      {canDefer ? (
        <AuditActionDialog
          triggerLabel="Defer"
          title={`Defer ${label}`}
          endpoint={`/v1/audit/plans/${encodeURIComponent(planId)}/defer`}
          fields={[{ name: "reason", label: "Defer reason", kind: "textarea", minLength: 3 }]}
          submitLabel="Defer plan"
          area="audit plan"
        />
      ) : null}
    </div>
  );
}
