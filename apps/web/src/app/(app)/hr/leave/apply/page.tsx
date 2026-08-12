import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader } from "../../../../_components/ds";
import { getEmployees, getMyProfile } from "../../../../_data/loaders";
import { ApplyLeaveForm } from "./ApplyLeaveForm";

export default async function ApplyLeavePage() {
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
      resolvedSource = mySource;
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
      <ApplyLeaveForm employees={resolvedEmployees} />
    </main>
  );
}
