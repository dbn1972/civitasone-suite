import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { getLeaveRequestDetails } from "../../../_data/loaders";
import type { LeaveRequestDetail } from "@civitasone/types";
import { serverT } from "@/lib/i18n/server";

export default async function LeaveManagementPage() {
  const t = serverT();
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
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title={t("leave.title")}
        subtitle={t("leave.subtitle")}
        back="/hr"
        backLabel="HR"
        help="hr"
        actions={
          <>
            <Link href="/hr/leave/balance" className="btn">Balance</Link>
            <Link href="/hr/leave/history" className="btn">History</Link>
            <Link href="/hr/leave/allocate" className="btn">Allocate</Link>
            <Link href="/hr/leave-policies" className="btn">Policies</Link>
            <Link href="/hr/leave/approvals" className="btn">{t("leave.approvals")}</Link>
            <Link href="/hr/leave/apply" className="btn primary">{t("leave.newLeave")}</Link>
          </>
        }
      />
      {source === "error" && <DataSourceBadge source="error" />}

      {/* Pending approval nudge */}
      {pending > 0 && (
        <div style={{ padding: "10px 14px", marginBottom: 12, borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden="true">⏳</span>
          <span><strong>{pending}</strong> request{pending > 1 ? "s" : ""} awaiting approval.</span>
          <Link href="/hr/leave/approvals" style={{ marginLeft: "auto", color: "var(--primary-d)", fontWeight: 500 }}>Review now →</Link>
        </div>
      )}

      <StatGrid>
        <StatCard icon="📋" iconBg="#f5f5f5" label={t("leave.total")} value={total} />
        <StatCard icon="⏳" iconBg="#fffbe6" label={t("leave.pending")} value={pending} />
        <StatCard icon="✅" iconBg="#e6f7f0" label={t("leave.approved")} value={approved} />
        <StatCard icon="❌" iconBg="#fff0f0" label={t("leave.rejected")} value={rejected} />
      </StatGrid>
      <Card title={t("leave.requests")}>
        <DataTable<LeaveRequestDetail>
          columns={columns}
          rows={leaveRequests}
          sortable
          filterable
          filterPlaceholder="Search by employee, type or status…"
          pageSize={15}
          emptyIcon="🌴"
          emptyTitle="No leave requests yet"
          emptyMessage="When employees apply for leave, their requests will appear here for you to review."
          emptyAction={<Link href="/hr/leave/apply" className="btn primary" style={{ marginTop: 8 }}>+ Apply Leave</Link>}
        />
      </Card>
    </main>
  );
}
