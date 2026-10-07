import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/app/_components/ds";
import { getSAOperators } from "@/app/_data/loaders";
import { OperatorsTable } from "./OperatorsTable";
import { getSessionRoles, getSessionUserId, requireAnyRole } from "@/lib/auth/roleGuard";
import { ADMIN_PLATFORM_ROLES } from "@/lib/auth/adminRoles";

export default async function OperatorsPage() {
  // GAP-ADMIN-OPERATORS-01: platform-operator console.
  requireAnyRole(ADMIN_PLATFORM_ROLES);
  const { data: operators, source, status, errorMessage } = await getSAOperators();
  const t = await getTranslations("adminOperators");

  return (
    <div className="page-main wrap">
      {/* GAP-ADMIN-OPERATORS-03/-04: stat cards, badge and failure state live inside
          OperatorsTable, driven by the same useSeededResource call as its rows.
          GAP-ADMIN-OPERATORS-05: changes to privileged accounts are requests a second super
          admin approves; every step is traced in the audit log, linked here. */}
      <PageHeader
        title="Platform Operators"
        subtitle="Super admin and platform team accounts. Suspending, reactivating or changing a role needs a second super admin's approval."
        back="/admin"
        actions={<Link className="btn ghost" href="/admin/audit-log">View audit log</Link>}
      />
      <OperatorsTable operators={operators} source={source === "error" ? "error" : "api"} errorStatus={status} errorMessage={errorMessage} canExport canManage actionsLabel={t("actions")} viewerId={getSessionUserId()} viewerRoles={getSessionRoles()} />
    </div>
  );
}
