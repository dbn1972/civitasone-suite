import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, DataTable } from "@/app/_components/ds";
import { getHrAuditLog } from "@/app/_data/loaders";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "@/app/_components/PermissionDenied";

/**
 * Mirrors services/audit-service/src/modules/events/routes.ts's role guard
 * on GET /audit/events (and /v1/audit/events) exactly -- audit trail access
 * is restricted to dedicated audit roles and platform/super admins, NOT the
 * general hr_admin/hr_officer roles used elsewhere under /hr. A plain HR
 * admin has neither audit_officer nor audit_admin and would get a 403 from
 * the backend despite this page otherwise rendering fine for them.
 */
const AUDIT_LOG_ROLES = ["audit_officer", "audit_admin", "super_admin", "platform_admin"];

export const dynamic = "force-dynamic";

export default async function HrAuditLogPage() {
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => AUDIT_LOG_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="the audit log" requiredRoles={AUDIT_LOG_ROLES} />;
  }

  const t = await getTranslations("hrAuditLog");
  const { data: events, source } = await getHrAuditLog();

  const rows = events.map((e, i) => ({
    id: String(i),
    action: e.action ?? "—",
    resource: e.resource ?? "—",
    actor: e.actor ?? "—",
    outcome: e.outcome ?? "—",
  }));

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <Card title={t("cardTitle")}>
        <DataTable
          columns={[
            { key: "action", label: t("colAction") },
            { key: "resource", label: t("colResource") },
            { key: "actor", label: t("colActor") },
            { key: "outcome", label: t("colOutcome") },
          ]}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={20}
          exportable
          exportFilename="hr-audit-log"
          emptyIcon="📋"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
      </Card>
    </>
  );
}
