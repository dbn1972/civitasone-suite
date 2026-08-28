import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader } from "../../../../_components/ds";
import { getEmployees, getMyProfile } from "../../../../_data/loaders";
import { ApplyLeaveForm } from "./ApplyLeaveForm";

export default async function ApplyLeavePage({
  searchParams,
}: {
  searchParams?: { empId?: string };
}) {
  // Try the admin employees list first (works for hr_admin / hr_officer / manager).
  // If it returns empty (403 for employee role), fall back to the self-service
  // profile endpoint so a regular employee can apply for their own leave.
  const { data: employees, source } = await getEmployees();

  let resolvedEmployees = employees;
  let resolvedSource = source;

  if (employees.length === 0) {
    const { data: myProfile, source: mySource } = await getMyProfile();
    if (myProfile) {
      resolvedEmployees = [{
        id: myProfile.id,
        name: myProfile.name ?? "",
        department: myProfile.department ?? "",
        status: myProfile.status ?? "active",
      }];
      // Only adopt the fallback's source if the primary call didn't itself fail —
      // a real fetch failure on the admin list must still show the error badge,
      // even though the self-service fallback happened to succeed.
      resolvedSource = source === "error" ? "error" : mySource;
    }
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Apply for Leave"
        subtitle="Submit a leave request for approval."
        back="/hr/leave"
      />
      <DataSourceBadge source={resolvedSource} />
      {/* The employee profile's "Apply Leave" quick action links here with
          ?empId= — previously ignored entirely, so it always defaulted to
          whichever employee happened to be first in the list. */}
      <ApplyLeaveForm employees={resolvedEmployees} initialEmployeeId={searchParams?.empId} />
    </main>
  );
}
