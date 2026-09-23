import { PageHeader, Card } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";

/**
 * No backend endpoint serves or accepts attendance-config values (nothing
 * under services/hrms-service/src/modules/attendance exposes a config
 * GET/PUT) -- everything on this page is the attendance engine's
 * compiled-in defaults, not a per-tenant setting a clerk could have
 * changed. Gated at the same admin tier as this module's other sensitive,
 * policy-level action (LOCK_ROLES on POST /v1/hrms/attendance/locks in
 * attendance/routes.ts) rather than the broader HR_ROLES/ALL_ROLES used for
 * day-to-day attendance operations, since viewing "the rules" is policy
 * visibility, not routine attendance work.
 */
const ATTENDANCE_CONFIG_ROLES = ["hr_admin", "super_admin"];

/**
 * Attendance Rules Configuration — defines how the system marks attendance:
 * late, half-day, overtime, weekly-off, flexi-time.
 */
export default async function AttendanceConfigPage() {
  const t = await getTranslations("attendanceConfig");

  const roles = getSessionRoles();
  const canAccess = roles.some((r) => ATTENDANCE_CONFIG_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="attendance configuration" requiredRoles={ATTENDANCE_CONFIG_ROLES} />;
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/attendance" backLabel={t("backLabel")} />

      {/*
        No backend config endpoint exists (see role-gate comment above) --
        these are compiled-in engine defaults, not this tenant's actual
        configuration. Say so plainly instead of presenting them as live
        settings.
      */}
      <div
        role="note"
        className="rounded-lg border px-4 py-3 text-sm"
        style={{ background: "var(--warnbg, #fffbeb)", borderColor: "var(--warnbd, #fde68a)", color: "var(--warn, #92400e)" }}
        style={{ marginBottom: 16 }}
      >
        {t("defaultsNotice")}
      </div>

      <div className="grid g-2">
        <Card title={t("cardWorkingHours")} padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>{t("whOfficeStart")}</td><td><strong>{t("whOfficeStartVal")}</strong></td></tr>
              <tr><td>{t("whOfficeEnd")}</td><td><strong>{t("whOfficeEndVal")}</strong></td></tr>
              <tr><td>{t("whGracePeriod")}</td><td><strong>{t("whGracePeriodVal")}</strong></td></tr>
              <tr><td>{t("whHalfDayCutoff")}</td><td><strong>{t("whHalfDayCutoffVal")}</strong></td></tr>
              <tr><td>{t("whMinHours")}</td><td><strong>{t("whMinHoursVal")}</strong></td></tr>
              <tr><td>{t("whWeeklyOff")}</td><td><strong>{t("whWeeklyOffVal")}</strong></td></tr>
            </tbody>
          </table>
        </Card>

        <Card title={t("cardLateMarkRules")} padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>{t("lmGracePeriod")}</td><td>{t("lmGracePeriodVal")}</td></tr>
              <tr><td>{t("lmTrigger")}</td><td>{t("lmTriggerVal")}</td></tr>
              <tr><td>{t("lmHalfDayIf")}</td><td>{t("lmHalfDayIfVal")}</td></tr>
              <tr><td>{t("lmAbsentIf")}</td><td>{t("lmAbsentIfVal")}</td></tr>
              <tr><td>{t("lmDeduction")}</td><td>{t("lmDeductionVal")}</td></tr>
            </tbody>
          </table>
        </Card>

        <Card title={t("cardOvertimeRules")} padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>{t("otEligible")}</td><td>{t("otEligibleVal")}</td></tr>
              <tr><td>{t("otRateWeekday")}</td><td>{t("otRateWeekdayVal")}</td></tr>
              <tr><td>{t("otRateWeeklyOff")}</td><td>{t("otRateWeeklyOffVal")}</td></tr>
              <tr><td>{t("otMaxPerDay")}</td><td>{t("otMaxPerDayVal")}</td></tr>
              <tr><td>{t("otRequiresApproval")}</td><td>{t("otRequiresApprovalVal")}</td></tr>
            </tbody>
          </table>
        </Card>

        <Card title={t("cardCompOff")} padding>
          <table className="tbl" style={{ fontSize: 13 }}>
            <tbody>
              <tr><td>{t("coEarnedWhen")}</td><td>{t("coEarnedWhenVal")}</td></tr>
              <tr><td>{t("coMustAvail")}</td><td>{t("coMustAvailVal")}</td></tr>
              <tr><td>{t("coMaxAccumulation")}</td><td>{t("coMaxAccumulationVal")}</td></tr>
              <tr><td>{t("coApprovalRequired")}</td><td>{t("coApprovalRequiredVal")}</td></tr>
            </tbody>
          </table>
        </Card>
      </div>

      <p style={{ marginTop: 16, color: "var(--mut)", fontSize: 13 }}>
        {t("footerNote")}
      </p>
    </main>
  );
}
