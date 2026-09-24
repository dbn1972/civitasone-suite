import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getAttendanceRegularisations } from "../../../../_data/loaders";
import { RegularisationTable } from "./RegularisationTable";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";

/**
 * Mirrors attendance/routes.ts: approve/reject regularisation routes
 * require HR_ROLES (hr_admin, hr_officer, super_admin). The manager role
 * can view but not act.
 */
const REGULARISATION_APPROVE_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default async function AttendanceRegularisationPage() {
  const t = await getTranslations("attendanceRegularisation");
  const { data: regs, source } = await getAttendanceRegularisations();
  const roles = getSessionRoles();
  const canApprove = roles.some((r: string) => REGULARISATION_APPROVE_ROLES.includes(r));

  const pending = regs.filter((r) => r.status === "pending").length;
  const approved = regs.filter((r) => r.status === "approved").length;
  const rejected = regs.filter((r) => r.status === "rejected").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitlePage")}
        back="/hr/attendance" backLabel="Back to Attendance"
        actions={<span />}
      />
      {/* UX-012: the data-source badge now lives inside RegularisationTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotal")} value={regs.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={pending} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statApproved")} value={approved} />
        <StatCard icon="🔴" iconBg="var(--badbg)" label={t("statRejected")} value={rejected} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        <RegularisationTable regs={regs} source={source} canApprove={canApprove} />
      </Card>
    </div>
  );
}
