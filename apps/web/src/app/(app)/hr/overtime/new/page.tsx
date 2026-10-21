import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { HR_STAFF_ROLES, OVERTIME_REQUEST_ROLES } from "@/lib/auth/workRoles";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import OvertimeNewForm from "./OvertimeNewForm";

/**
 * GAP-HR-OVERTIME-NEW-02 / GAP-HR-OVERTIME-03: this page used to render the
 * form for every role the /hr layout admits, including a bare manager --
 * but POST /v1/hrms/overtime-requests is HR staff + employee only
 * (attendance/routes.ts), so a manager filled the whole form in and then hit
 * a 403 on submit. The route's decision (managers stay excluded) is now
 * reflected up front: a role that cannot file sees the standard "access
 * restricted" card with a way back, not a form that cannot succeed. The
 * server remains the authority; this is the honest UI for it.
 *
 * Only HR staff may file on someone else's behalf (assertSelfOrHr), so only
 * they get the employee picker; an employee's own record is locked in.
 */
export default async function OvertimeNewPage() {
  const t = await getTranslations("overtimeNew");
  const roles = getSessionRoles();
  if (!roles.some((r) => OVERTIME_REQUEST_ROLES.includes(r))) {
    return (
      <PermissionDenied
        module="overtime requests"
        requiredRoles={OVERTIME_REQUEST_ROLES}
        backHref="/hr/overtime"
        backLabel={t("backToOvertime")}
      />
    );
  }
  return <OvertimeNewForm canFileForOthers={roles.some((r) => HR_STAFF_ROLES.includes(r))} />;
}
