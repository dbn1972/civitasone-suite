"use client";

import { AuditActionDialog } from "../_components/AuditActionDialog";
import { useAuditT } from "@/lib/audit/useAuditT";

/**
 * GAP-AUDIT-RISK-REGISTER-04: close a risk with a required reason.
 * PATCH /v1/audit/risks/:id { status: "closed", closeReason } (validator rejects a close without a reason).
 */
export function RiskActions({ riskId, riskCode, status }: { riskId: string; riskCode: string; status: string }) {
  const t = useAuditT();
  if (status === "closed") return <span style={{ color: "var(--ink2)" }}>—</span>;
  return (
    <AuditActionDialog
      triggerLabel={t("actBtnClose")}
      title={t("actRiskTitle", { riskCode })}
      description={t("actRiskDesc")}
      endpoint={`/v1/audit/risks/${encodeURIComponent(riskId)}`}
      staticBody={{ status: "closed" }}
      fields={[{ name: "closeReason", label: t("actRiskReason"), kind: "textarea", minLength: 3 }]}
      submitLabel={t("actRiskSubmit")}
      area="risk"
    />
  );
}
