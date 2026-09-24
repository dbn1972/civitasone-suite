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
  // Try the admin employees list first (works for hr_admin / hr_officer / manager).
  // A plain `employee` role is correctly 403'd from that endpoint (see
  // READER_ROLES in hrms-service's employee/routes.ts — by design, they have
  // no business browsing the full roster) and never needs it: they can only
  // ever apply for their own leave. When the admin list comes back empty,
  // fall back to the self-service profile endpoint so a regular employee can
  // still apply, without needing (or ever seeing) the employee-list dropdown.
  const { data: employees, source, status } = await getEmployees();

  let resolvedEmployees = employees;
  let resolvedSource = source;
  let noLinkedProfile = false;

  if (employees.length === 0) {
    const { data: myProfile, source: mySource } = await getMyProfile();

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
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/leave" backLabel="Back to Leave"
      />
      <DataSourceBadge source={resolvedSource} />
      {/* The employee profile's "Apply Leave" quick action links here with
          ?empId= — previously ignored entirely, so it always defaulted to
          whichever employee happened to be first in the list. */}
      <ApplyLeaveForm
        employees={resolvedEmployees}
        initialEmployeeId={searchParams?.empId}
        noLinkedProfile={noLinkedProfile}
      />
    </main>
  );
}
