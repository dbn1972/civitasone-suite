import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { getLeaveRequestDetails } from "../../../_data/loaders";
import type { LeaveRequestDetail } from "@civitasone/types";
import { getTranslations } from "next-intl/server";

export default async function LeaveManagementPage() {
  const t = await getTranslations("leave");
  const { data: leaveRequests, source } = await getLeaveRequestDetails();

  const total = leaveRequests.length;
  const pending = leaveRequests.filter((r) => r.status === "pending").length;
  const approved = leaveRequests.filter((r) => r.status === "approved").length;
  const rejected = leaveRequests.filter((r) => r.status === "rejected").length;

  const columns: { key: keyof LeaveRequestDetail & string; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
    { key: "employeeName", label: t("colEmployee") },
    { key: "leaveType", label: t("colLeaveType") },
    { key: "fromDate", label: t("colFromDate") },
    { key: "toDate", label: t("colToDate") },
    { key: "days", label: t("colDays"), align: "right" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel="HR"
        help="hr"
        actions={
          <>
            <Link href="/hr/leave/balance" className="btn">{t("navBalance")}</Link>
            <Link href="/hr/leave/history" className="btn">{t("navHistory")}</Link>
            <Link href="/hr/leave/allocate" className="btn">{t("navAllocate")}</Link>
            <Link href="/hr/leave-policies" className="btn">{t("navPolicies")}</Link>
            <Link href="/hr/leave/approvals" className="btn">{t("approvals")}</Link>
            <Link href="/hr/leave/apply" className="btn primary">{t("newLeave")}</Link>
          </>
        }
      />
      <DataSourceBadge source={source} />

      {/* Pending approval nudge */}
      {pending > 0 && (
        <div style={{ padding: "10px 14px", marginBottom: 12, borderRadius: 8, background: "var(--warnbg)", border: "1px solid var(--warn)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden="true">⏳</span>
          <span><strong>{pending}</strong> {t("pendingSuffix", { count: pending })}</span>
          <Link href="/hr/leave/approvals" style={{ marginLeft: "auto", color: "var(--primary-d)", fontWeight: 500 }}>{t("reviewNow")}</Link>
        </div>
      )}

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--panel)" label={t("total")} value={total} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("pending")} value={pending} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("approved")} value={approved} />
        <StatCard icon="❌" iconBg="var(--badbg)" label={t("rejected")} value={rejected} />
      </StatGrid>
      <Card title={t("requests")}>
        <DataTable<LeaveRequestDetail>
          columns={columns}
          rows={leaveRequests}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🌴"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
          emptyAction={
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <Link href="/hr/leave/apply" className="btn primary">{t("applyLeaveCta")}</Link>
              <Link href="/hr/leave/approvals" className="btn ghost">{t("viewApprovalsCta")}</Link>
            </div>
          }
        />
      </Card>
    </main>
  );
}
