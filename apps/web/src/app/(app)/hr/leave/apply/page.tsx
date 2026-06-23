import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader } from "../../../../_components/ds";
import { getEmployees } from "../../../../_data/loaders";
import { ApplyLeaveForm } from "./ApplyLeaveForm";

export default async function ApplyLeavePage() {
  const { data: employees, source } = await getEmployees();

  return (
    <>
      <PageHeader
        title="Apply for Leave"
        subtitle="Submit a leave request for approval."
        back="/hr/leave"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <ApplyLeaveForm employees={employees} />
    </>
  );
}
