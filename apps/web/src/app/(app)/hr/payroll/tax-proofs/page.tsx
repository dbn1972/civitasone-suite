import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import {
  hasAnyRole, TAX_PROOF_VIEWER_ROLES, TAX_PROOF_DECIDER_ROLES, TAX_PROOF_HOLD_ROLES, TAX_PROOF_RETENTION_ROLES,
} from "@/lib/payroll/taxProofs";
import { TaxProofQueue } from "./TaxProofQueue";
import { TaxProofSettingsCard } from "./TaxProofSettingsCard";

export const metadata = {
  title: "Investment proof verification",
  description: "Verify employees' supporting documents for income tax declarations",
};

/**
 * GAP-PAYROLL-TAX-DECLARATION-02: payroll_officer / payroll_admin verify
 * proofs, the read-only auditor may look; hr, managers and finance get an
 * explanation (the API would 403 them anyway).
 */
export default async function TaxProofsPage() {
  const t = await getTranslations("taxProofs");
  const roles = getSessionRoles();
  const canView = hasAnyRole(roles, TAX_PROOF_VIEWER_ROLES);
  const canSetRetention = hasAnyRole(roles, TAX_PROOF_RETENTION_ROLES);

  if (!canView && !canSetRetention) {
    return (
      <div className="page-main wrap">
        <PageHeader title={t("queue.title")} subtitle={t("queue.subtitle")} back="/hr/payroll/tax-declaration" backLabel={t("backLabel")} />
        <PermissionDenied module="investment proof verification" requiredRoles={TAX_PROOF_VIEWER_ROLES} backHref="/hr/payroll" backLabel={t("backLabel")} />
      </div>
    );
  }

  return (
    <div className="page-main wrap">
      <PageHeader title={t("queue.title")} subtitle={t("queue.subtitle")} back="/hr/payroll/tax-declaration" backLabel={t("backLabel")} />
      {canView && (
        <TaxProofQueue
          canDecide={hasAnyRole(roles, TAX_PROOF_DECIDER_ROLES)}
          canHold={hasAnyRole(roles, TAX_PROOF_HOLD_ROLES)}
        />
      )}
      <TaxProofSettingsCard />
    </div>
  );
}
