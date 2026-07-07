import Link from "next/link";
import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "../../_components/ds";
import { getMyApprovals, type MyApprovalItem } from "../../_data/loaders";
import { ApprovalsTable } from "./_components/ApprovalsTable";

export default async function MyApprovalsPage() {
  const { data: approvals, source } = await getMyApprovals();

  const overdue = approvals.filter(
    (a) => a.dueDate && new Date(a.dueDate).getTime() < Date.now(),
  ).length;

  const modules = new Set(approvals.map((a) => a.module));

  return (
    <>
      <PageHeader
        title="My Approvals"
        subtitle="All pending items requiring your action across modules."
        back="/dashboard"
        backLabel="Dashboard"
        help="approvals"
        actions={
          source === "error" ? <DataSourceBadge source={source} /> : null
        }
      />

      <StatGrid>
        <StatCard icon="⏳" iconBg="#e7edfd" label="Pending" value={approvals.length} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Overdue" value={overdue} />
        <StatCard icon="📋" iconBg="#eff6ff" label="Modules" value={modules.size} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Action Required" value={approvals.length} />
      </StatGrid>

      <Card title="Pending Approvals">
        {source === "error" ? (
          <EmptyState
            icon="⚠️"
            title="Couldn't load approvals"
            message="The workflow service didn't respond. Check your connection and try again."
            action={<Link href="/approvals" className="btn ghost">Retry</Link>}
          />
        ) : approvals.length === 0 ? (
          <EmptyState
            icon="✅"
            title="No pending approvals"
            message="You're all caught up. No items need your attention right now."
          />
        ) : (
          <ApprovalsTable initialData={approvals} source={source} />
        )}
      </Card>
    </>
  );
}
