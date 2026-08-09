import { PageHeader } from "../../../../_components/ds";
import { LeaveApprovalsPanel } from "./LeaveApprovalsPanel";

export default function LeaveApprovalsPage() {
  return (
    <>
      <PageHeader title="Leave Approvals" subtitle="Review and approve pending leave requests." back="/hr/leave" />
      <LeaveApprovalsPanel />
    </>
  );
}
