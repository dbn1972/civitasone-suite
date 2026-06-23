import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { getLeaveRequestDetails } from "../../../_data/loaders";
import type { LeaveRequestDetail } from "@civitasone/types";

export default async function LeaveManagementPage() {
  const { data: leaveRequests, source } = await getLeaveRequestDetails();

  const total = leaveRequests.length;
  const pending = leaveRequests.filter((r) => r.status === "pending").length;
  const approved = leaveRequests.filter((r) => r.status === "approved").length;
  const rejected = leaveRequests.filter((r) => r.status === "rejected").length;

  const columns: { key: keyof LeaveRequestDetail & string; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
    { key: "employeeName", label: "Employee" },
    { key: "leaveType", label: "Leave Type" },
    { key: "fromDate", label: "From Date" },
    { key: "toDate", label: "To Date" },
    { key: "days", label: "Days", align: "right" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <>
      <PageHeader
        title="Leave Management"
        subtitle="Review and process employee leave requests."
        actions={
          <>
            <Link href="/hr/leave/approvals" className="btn">Approvals</Link>
            <Link href="/hr/leave/apply" className="btn primary">+ New Leave</Link>
          </>
        }
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#f5f5f5" label="Total" value={total} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="❌" iconBg="#fff0f0" label="Rejected" value={rejected} />
      </StatGrid>
      <Card title="Leave Requests">
        <DataTable<LeaveRequestDetail>
          columns={columns}
          rows={leaveRequests}
        />
      </Card>
    </>
  );
}
