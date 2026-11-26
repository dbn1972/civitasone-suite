import type { ReactNode } from "react";
import { PageHeader, Card } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { ATTENDANCE_DEFAULTS } from "@/lib/attendanceDefaults";
import { formatClockTime12h } from "@/lib/formatters";
import { HR_ADMIN_TIER_ROLES } from "@/lib/auth/workRoles";

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
const ATTENDANCE_CONFIG_ROLES = HR_ADMIN_TIER_ROLES;

/**
 * GAP-HR-ATTENDANCE-CONFIG-04: shared row renderer so every card gets the
 * same <th scope="row"> + <caption> structure and the same value weight --
 * previously only the Working Hours card wrapped its values in <strong>,
 * the other three didn't, and none had a <caption> or real header cells (a
 * screen reader announced only the bare cell text, not "<label>: <value>").
 */
function KeyValueTable({ caption, rows }: { caption: string; rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <table className="tbl" style={{ fontSize: 13 }}>
      <caption className="sr-only">{caption}</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row" style={{ fontWeight: 400, textAlign: "left", padding: "4px 8px 4px 0" }}>{row.label}</th>
            <td style={{ fontWeight: 600 }}>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Attendance Rules Configuration — reference defaults for how attendance is marked.
 *
 * GAP-HR-ATTENDANCE-CONFIG-01 (owner decision, 26 Nov 2026): the page stays read-only with
 * the "not verified" banner, and the rows that cannot be traced to any engine code are
 * DROPPED rather than shown as policy: the late-mark trigger time, the late-marks -> CL
 * deduction, both overtime rates (weekday / weekly-off) and the whole compensatory-off
 * card. A repo-wide search of services/ and packages/ finds no such constants. A
 * per-tenant setting can bring them back later; nothing is invented here.
 */
export default async function AttendanceConfigPage() {
  const t = await getTranslations("attendanceConfig");

  const roles = getSessionRoles();
  const canAccess = roles.some((r) => ATTENDANCE_CONFIG_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="attendance configuration" requiredRoles={ATTENDANCE_CONFIG_ROLES} />;
  }

  const d = ATTENDANCE_DEFAULTS;

  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/attendance" backLabel={t("backLabel")} />

      {/*
        GAP-HR-ATTENDANCE-CONFIG-01 (HR decision packet, theme 5: "Keep it
        read-only for now, but reword the banner honestly... rather than
        build a full config-editor screen in this campaign") and
        GAP-HR-ATTENDANCE-CONFIG-03 (the old copy told even an hr_admin --
        the actual administrator, with nowhere else to customize this --
        to "contact your administrator to customize"). One notice now
        covers both: no backend config endpoint exists (see role-gate
        comment above), these are compiled-in engine defaults that may not
        match this tenant's real policy, and there is nothing to configure
        from this screen at all -- not even for the roles gated in here.
      */}
      <div
        role="note"
        className="rounded-lg border px-4 py-3 text-sm"
        style={{ background: "var(--warnbg)", borderColor: "var(--warnbd)", color: "var(--warn)", marginBottom: 16 }}
      >
        {t("defaultsNotice")}
      </div>

      <div className="grid g-2">
        <Card title={t("cardWorkingHours")} padding>
          <KeyValueTable
            caption={t("cardWorkingHours")}
            rows={[
              { label: t("whOfficeStart"), value: t("whOfficeStartTpl", { value: formatClockTime12h(d.officeStartTime) }) },
              { label: t("whOfficeEnd"), value: t("whOfficeEndTpl", { value: formatClockTime12h(d.officeEndTime) }) },
              { label: t("whGracePeriod"), value: t("whGracePeriodTpl", { mins: d.graceMinutes }) },
              { label: t("whHalfDayCutoff"), value: t("whHalfDayCutoffTpl", { value: formatClockTime12h(d.halfDayCutoffTime) }) },
              { label: t("whMinHours"), value: t("whMinHoursTpl", { hours: d.minHoursForFullDay }) },
              { label: t("whWeeklyOff"), value: t("whWeeklyOffTpl", { pattern: d.weeklyOffPattern }) },
            ]}
          />
        </Card>

        <Card title={t("cardLateMarkRules")} padding>
          <KeyValueTable
            caption={t("cardLateMarkRules")}
            rows={[
              { label: t("lmGracePeriod"), value: t("lmGracePeriodTpl", { mins: d.lateMarkGraceMinutes }) },
              { label: t("lmHalfDayIf"), value: t("lmHalfDayIfTpl", { value: formatClockTime12h(d.halfDayIfAfterTime) }) },
              { label: t("lmAbsentIf"), value: t("lmAbsentIfTpl", { value: formatClockTime12h(d.absentIfNoCheckInAfterTime) }) },
            ]}
          />
        </Card>

        <Card title={t("cardOvertimeRules")} padding>
          <KeyValueTable
            caption={t("cardOvertimeRules")}
            rows={[
              { label: t("otEligible"), value: t("otEligibleTpl", { hours: d.otEligibleAfterHours }) },
              { label: t("otMaxPerDay"), value: t("otMaxPerDayTpl", { hours: d.otMaxHoursPerDay }) },
              { label: t("otRequiresApproval"), value: t("otRequiresApprovalTpl", { approver: d.otApprovedBy }) },
            ]}
          />
        </Card>
      </div>

      <p style={{ marginTop: 16, color: "var(--mut)", fontSize: 13 }}>
        {t("footerNote")}
      </p>
    </div>
  );
}
