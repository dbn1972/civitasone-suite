import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader } from "../../../../_components/ds";
import { getEmployees, getMyProfile } from "../../../../_data/loaders";
import { ApplyLeaveForm } from "./ApplyLeaveForm";
import { getTranslations } from "next-intl/server";

export default async function ApplyLeavePage({
  searchParams,
}: {
  searchParams?: { empId?: string };
}) {
  const t = await getTranslations("leaveApply");
  const tc = await getTranslations("common");
  // Try the admin employees list first (works for hr_admin / hr_officer / manager).
  // A plain `employee` role is correctly 403'd from that endpoint (see
  // READER_ROLES in hrms-service's employee/routes.ts — by design, they have
  // no business browsing the full roster) and never needs it: they can only
  // ever apply for their own leave. When the admin list comes back empty,
  // fall back to the self-service profile endpoint so a regular employee can
  // still apply, without needing (or ever seeing) the employee-list dropdown.
  const [{ data: employees, source, status }, { data: myProfile, source: myProfileSourceEarly }] = await Promise.all([
    getEmployees(),
    // GAP-HR-LEAVE-APPLY-03: fetched unconditionally now (previously only as
    // the employees.length===0 self-service fallback below) so the "myself"
    // default/indicator works for HR/manager viewing the full roster too,
    // not only the single-row self-service path.
    getMyProfile(),
  ]);

  let resolvedEmployees = employees;
  let resolvedSource = source;
  let noLinkedProfile = false;
  const myEmployeeId = myProfile?.id;
  // GAP-HR-LEAVE-APPLY-03: the admin list came back with people in it, so this
  // viewer is HR or a manager choosing WHO the leave is for -- the form then
  // starts with nobody selected and a searchable picker. Everyone else only
  // ever applies for themselves (the single-row fallback below).
  const canPickEmployee = employees.length > 0;

  if (employees.length === 0) {
    const mySource = myProfileSourceEarly;

    // A 403 on the admin list is the expected, by-design response for a
    // plain `employee` role, not a real failure — and getMyProfile() already
    // normalizes a genuine 404 ("no employee record linked to this account")
    // the same way, rather than reporting it as source:"error" (see that
    // loader's own doc comment). So once both calls have resolved, either
    // way, this is a known, honest state — not a fetch failure. Only a REAL
    // failure on either call (network/5xx — a genuine problem, especially
    // for the HR/manager roles the admin list is meant for) should still
    // surface the error badge.
    const employeesListReallyFailed = source === "error" && status !== 403;
    const profileReallyFailed = mySource === "error";
    resolvedSource = employeesListReallyFailed || profileReallyFailed ? "error" : "api";

    if (myProfile) {
      resolvedEmployees = [{
        id: myProfile.id,
        name: myProfile.name ?? "",
        department: myProfile.department ?? "",
        status: myProfile.status ?? "active",
      }];
    } else if (!profileReallyFailed) {
      // Genuinely no employee record linked to this account — a normal,
      // expected 404, not a failure. ApplyLeaveForm shows its own honest
      // "contact HR" message for this instead of a bare, unexplained empty
      // dropdown (previously: "No employees loaded" with no way forward).
      noLinkedProfile = true;
    }
  } else if (myProfile && !employees.some((e) => e.id === myProfile.id)) {
    // GAP-HR-LEAVE-APPLY-03: a manager's roster holds only their direct
    // reports, never the manager -- without this their "Apply for myself"
    // shortcut would point at a row the form has no label for. (Department is
    // left blank: the self-service profile carries a department ID, not a
    // name, and a UUID is not something to show a person.)
    resolvedEmployees = [
      { id: myProfile.id, name: myProfile.name ?? "", department: "", status: myProfile.status ?? "active" },
      ...employees,
    ];
  }

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/leave" backLabel={tc("backToLeave")}
      />
      <DataSourceBadge source={resolvedSource} />
      {/* The employee profile's "Apply Leave" quick action links here with
          ?empId= — previously ignored entirely, so it always defaulted to
          whichever employee happened to be first in the list. HR / managers
          now start with nobody selected unless that link names someone. */}
      <ApplyLeaveForm
        employees={resolvedEmployees}
        initialEmployeeId={searchParams?.empId}
        myEmployeeId={myEmployeeId}
        noLinkedProfile={noLinkedProfile}
        canPickEmployee={canPickEmployee}
      />
    </div>
  );
}
