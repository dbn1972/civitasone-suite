import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ADMIN_TENANT_ROLES } from "@/lib/auth/adminRoles";
import { IntegrationsClient } from "./_components/IntegrationsClient";

// GAP-ADMIN-INTEGRATIONS-01: this screen proposes third-party credential changes
// (API keys, SMTP passwords, PFMS certificate, SFTP key). admin-service gates
// every /v1/admin/integrations route to tenant_admin or higher, enforces
// maker-checker (approver != proposer), masks secrets on read and audits each
// write; the page now matches that gate instead of rendering for everyone.
//
// e-Sign, DSC, bank API and PFMS providers are configured on the sibling screen
// /admin/integrations/platform (schema-driven, platform-catalogue backed).
export default async function IntegrationsPage() {
  requireAnyRole(ADMIN_TENANT_ROLES);
  const t = await getTranslations("platformIntegrations");
  return (
    <>
      <div className="wrap" style={{ paddingTop: 12 }}>
        <div className="alert" role="note">
          <Link href="/admin/integrations/platform">{t("tenant.title")}</Link>
          {" "}
          <span className="muted">{t("tenant.subtitle")}</span>
        </div>
      </div>
      <IntegrationsClient />
    </>
  );
}
