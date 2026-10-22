import { LegacyDelegationsTable } from "../../_components/LegacyDelegationsTable";
import { requireAnyRole, WORKFLOW_DELEGATION_ADMIN_ROLES } from "@/lib/auth/roleGuard";

export const dynamic = "force-dynamic";

/**
 * Admin report of legacy (unscoped) delegations. Mirrors the service gate on GET /v1/workflow/delegations/legacy-report
 * (workflow_admin, super_admin, tenant_admin): anyone else is redirected before the page renders.
 */
export default function LegacyDelegationsPage() {
  requireAnyRole(WORKFLOW_DELEGATION_ADMIN_ROLES, "/workflow/delegations");
  return <LegacyDelegationsTable />;
}
