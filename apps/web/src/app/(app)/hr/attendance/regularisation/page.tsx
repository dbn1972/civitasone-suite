import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../../_components/ds";
import { getAttendanceRegularisations } from "../../../../_data/loaders";
import { RegularisationTable } from "./RegularisationTable";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";
import { canViewRegularisations, canPickRegularisationEmployee, computeRegularisationStats, REGULARISATION_VIEW_ROLES } from "./access";
import { RaiseRegularisation } from "./RaiseRegularisation";

/**
 * Mirrors attendance/routes.ts: approve/reject regularisation routes
 * require HR_ROLES (hr_admin, hr_officer, super_admin). The manager role
 * can view but not act.
 */
const REGULARISATION_APPROVE_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default async function AttendanceRegularisationPage() {
  const t = await getTranslations("attendanceRegularisation");
  const roles = getSessionRoles();

  // GAP-HR-ATTENDANCE-REGULARISATION-02: hr/layout.tsx's HR_ROLES admits
  // every /hr role (including a bare "employee") onto this page, but GET
  // /v1/hrms/attendance/regularisations itself is guarded to hr_admin/
  // hr_officer/super_admin/manager (attendance/routes.ts's ALL_ROLES,
  // mirrored by access.ts's REGULARISATION_VIEW_ROLES). A plain employee
  // used to land on a fabricated 0-stat error badge with no page-level gate
  // at all -- unlike attendance/config/page.tsx, which already has one.
  if (!canViewRegularisations(roles)) {
    return <PermissionDenied module="attendance regularisation" requiredRoles={REGULARISATION_VIEW_ROLES} />;
  }

  const { data: regs, source } = await getAttendanceRegularisations();
  const canApprove = roles.some((r: string) => REGULARISATION_APPROVE_ROLES.includes(r));
  // GAP-HR-ATTENDANCE-REGULARISATION-04: see access.ts#computeRegularisationStats.
  const errored = source === "error";
  const stats = computeRegularisationStats(regs, errored);

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitlePage")}
        back="/hr/attendance" backLabel="Back to Attendance"
        actions={<RaiseRegularisation canPickEmployee={canPickRegularisationEmployee(roles)} />}
      />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotal")} value={stats.total} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={stats.pending} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statApproved")} value={stats.approved} />
        <StatCard icon="🔴" iconBg="var(--badbg)" label={t("statRejected")} value={stats.rejected} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "attendance regularisation" })} backHref="/hr/attendance" />
        ) : (
          // UX-012: the data-source badge lives inside RegularisationTable,
          // driven by the same useSeededResource call that produces its
          // rows -- not a second, independent read of `source` here.
          <RegularisationTable regs={regs} source={source} canApprove={canApprove} />
        )}
      </Card>
    </div>
  );
}
