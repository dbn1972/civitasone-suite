import { PageHeader } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";
import { getSessionRoles, hasAnyRole, PROCUREMENT_WRITE_ROLES } from "@/lib/auth/roleGuard";
import { BlacklistRegister } from "./BlacklistRegister";

// Mirrors procurement-service vendor-blacklist/routes.ts: the registers are
// readable by PROC_ROLES (= PROCUREMENT_WRITE_ROLES); central debarment is
// created by super_admin only. The server stays the authority.
export default async function VendorBlacklistPage() {
  const t = await getTranslations("procurement.w2.blacklist");
  const roles = getSessionRoles();
  const canView = hasAnyRole(roles, PROCUREMENT_WRITE_ROLES);
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/procurement/vendors" />
      {canView ? (
        <BlacklistRegister canCentralDebar={roles.includes("super_admin")} />
      ) : (
        <p className="muted" role="note">{t("noAccess")}</p>
      )}
    </>
  );
}
