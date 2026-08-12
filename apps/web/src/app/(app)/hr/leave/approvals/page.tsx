import { PageHeader } from "../../../../_components/ds";
import { LeaveApprovalsPanel } from "./LeaveApprovalsPanel";

export default function LeaveApprovalsPage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Leave Approvals" subtitle="Review and approve pending leave requests." back="/hr/leave" />
      <LeaveApprovalsPanel />
    </main>
  );
}
