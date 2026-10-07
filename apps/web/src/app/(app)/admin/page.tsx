import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";
import { getTranslations } from "next-intl/server";
import { requireAnyRole, getSessionRoles } from "@/lib/auth/roleGuard";
import { ADMIN_TENANT_ROLES } from "@/lib/auth/adminRoles";
import { visibleAdminTiles } from "./adminTiles";

export default async function AdminPage() {
  // GAP-ADMIN-HOME-01: the hub is admitted to tenant_admin and above; each tile is shown only
  // to roles its destination page admits (GAP-ADMIN-HOME-02: every admin route now has a tile).
  requireAnyRole(ADMIN_TENANT_ROLES);
  const t = await getTranslations("admin");
  const tiles = visibleAdminTiles(getSessionRoles(), (key) => t(key));
  return (
    <div className="page-main">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <LinkTiles tiles={tiles} columns="four" />
    </div>
  );
}
