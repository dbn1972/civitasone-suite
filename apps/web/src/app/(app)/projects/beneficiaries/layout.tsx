import type { ReactNode } from "react";
import { requireAnyRole, PROJECT_READER_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-PROJECTS-BENEFICIARIES-01 (DPDP): the beneficiary register exposes
 * beneficiary names, district, social category and disbursement. It was gated
 * only by the tenant module flag (projects/layout.tsx ModuleGate) with no role
 * check, so any module user could load it. This layout adds a role gate
 * mirroring READER_ROLES of project-service mock-elimination-routes.ts (the module serving the beneficiaries endpoint); a user outside the set is redirected
 * to /projects instead of loading PII. The service remains the authority (it
 * 403s others) and must also enforce row-level scoping before real beneficiary
 * data is served — see HUMAN REVIEW.
 */
export default function BeneficiariesLayout({ children }: { children: ReactNode }) {
  requireAnyRole(PROJECT_READER_ROLES, "/projects");
  return <>{children}</>;
}
