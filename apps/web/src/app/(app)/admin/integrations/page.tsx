import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ADMIN_TENANT_ROLES } from "@/lib/auth/adminRoles";
import { IntegrationsClient } from "./_components/IntegrationsClient";

// GAP-ADMIN-INTEGRATIONS-01: this screen proposes third-party credential changes
// (API keys, SMTP passwords, PFMS certificate, SFTP key). admin-service gates
// every /v1/admin/integrations route to tenant_admin or higher, enforces
// maker-checker (approver != proposer), masks secrets on read and audits each
// write; the page now matches that gate instead of rendering for everyone.
export default function IntegrationsPage() {
  requireAnyRole(ADMIN_TENANT_ROLES);
  return <IntegrationsClient />;
}
