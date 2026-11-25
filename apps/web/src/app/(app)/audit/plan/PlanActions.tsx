"use client";

import { AuditActionDialog } from "../_components/AuditActionDialog";
import { useAuditT } from "@/lib/audit/useAuditT";

/**
 * GAP-AUDIT-PLAN-05: plan-level Defer (reason required) and Complete. The audit-service routes are
 * PATCH /v1/audit/plans/:id/defer { reason } and PATCH /v1/audit/plans/:id/complete; the server enforces
 * the status rules (defer: draft/in_progress, complete: in_progress) and answers 409 otherwise.
 */
export function PlanActions({ planId, planNo, status }: { planId: string; planNo?: string; status: string }) {
  const t = useAuditT();
  const label = planNo ? t("actPlanNamed", { planNo }) : t("actPlanBare");
  const canDefer = status === "planned" || status === "in_progress";
  const canComplete = status === "in_progress";
  if (!canDefer && !canComplete) return <span style={{ color: "var(--ink2)" }}>—</span>;
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {canComplete ? (
        <AuditActionDialog
          triggerLabel={t("actBtnComplete")}
          title={t("actPlanCompleteTitle", { label })}
          description={t("actPlanCompleteDesc")}
          endpoint={`/v1/audit/plans/${encodeURIComponent(planId)}/complete`}
          fields={[]}
          submitLabel={t("actPlanCompleteSubmit")}
          area="audit plan"
        />
      ) : null}
      {canDefer ? (
        <AuditActionDialog
          triggerLabel={t("actBtnDefer")}
          title={t("actPlanDeferTitle", { label })}
          endpoint={`/v1/audit/plans/${encodeURIComponent(planId)}/defer`}
          fields={[{ name: "reason", label: t("actPlanDeferReason"), kind: "textarea", minLength: 3 }]}
          submitLabel={t("actPlanDeferSubmit")}
          area="audit plan"
        />
      ) : null}
    </div>
  );
}
