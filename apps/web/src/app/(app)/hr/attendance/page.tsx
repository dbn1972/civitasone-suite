import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { getAttendanceList, getMyProfile } from "../../../_data/loaders";
import { AttendanceTable } from "./AttendanceTable";
import { GeoCheckInCard } from "./_components/GeoCheckInCard";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { canViewAttendanceRecords, canConfigureAttendance, computeAttendanceStats } from "./access";

export default async function AttendancePage() {
  const t = await getTranslations("attendance");
  const tCheckIn = await getTranslations("geoCheckIn");
  // HIGH fix: geo-fenced check-in/out had a complete backend
  // (geo-attendance/routes.ts) but zero reachable UI -- see
  // GeoCheckInCard's own doc comment. Self-service resolution mirrors
  // leave/apply and hr/wfh exactly (getMyProfile server-side, passed down
  // as a prop -- the client component never resolves or receives any other
  // employee's id).
  const { data: myProfile } = await getMyProfile();

  // GAP-HR-ATTENDANCE-03: hr/layout.tsx's HR_ROLES admits every /hr role
  // (including a bare "employee") onto this page, but GET /v1/hrms/attendance
  // itself is guarded to hr_admin/hr_officer/super_admin/manager
  // (attendance/routes.ts's ALL_ROLES, mirrored by access.ts's
  // ATTENDANCE_VIEW_ROLES). A plain employee used to trigger the fetch
  // anyway, get 403'd, and see a fabricated 0-stat error badge plus a dead
  // "Configure check-in" link pointing at a page they also can't open --
  // instead of just the self-service check-in card below, which they DO
  // have a legitimate use for.
  const roles = getSessionRoles();
  const canView = canViewAttendanceRecords(roles);
  const canConfigure = canConfigureAttendance(roles);

  const { data: attendance, source } = canView
    ? await getAttendanceList()
    : { data: [], source: "api" as const };
  const errored = canView && source === "error";
  const stats = computeAttendanceStats(attendance, errored);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      {/* UX-012: the data-source badge now lives inside AttendanceTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      {canView && (
        <StatGrid>
          <StatCard icon="📋" iconBg="var(--panel)" label={t("total")} value={stats.total} />
          <StatCard icon="✅" iconBg="var(--goodbg)" label={t("present")} value={stats.present} />
          <StatCard icon="❌" iconBg="var(--badbg)" label={t("absent")} value={stats.absent} />
          <StatCard icon="🌴" iconBg="var(--warnbg)" label={t("onLeave")} value={stats.onLeave} />
        </StatGrid>
      )}
      <Card title={tCheckIn("cardTitle")}>
        <GeoCheckInCard employeeId={myProfile?.id ?? null} employeeStatus={myProfile?.status} />
        {!canView && (
          <p role="note" style={{ fontSize: 13, color: "var(--mut)", padding: "0 20px 16px", margin: 0 }}>
            {t("selfOnlyNote")}
          </p>
        )}
      </Card>
      {canView && (
        <div style={{ marginTop: 16 }}>
          <Card title={t("recordsCardTitle")}>
            {errored ? (
              <RefreshErrorState error={toHumanError("load", { area: "attendance" })} backHref="/hr" />
            ) : (
              <AttendanceTable attendance={attendance} source={source} canConfigure={canConfigure} />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
