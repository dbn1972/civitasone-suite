import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../_components/ds";
import { getProcurementApprovals } from "../../../_data/loaders";
import { ProcurementApprovalsPanel } from "./ProcurementApprovalsPanel";

type ApprovalRow = {
  id: string;
  referenceId: string;
  owner: string;
  dueDisplay: string;
} & Record<string, unknown>;

export default async function ApprovalsPage() {
  const { data: approvals, source } = await getProcurementApprovals();

  const overdue = approvals.filter((a) => a.dueDisplay.toLowerCase().includes("overdue") || a.dueDisplay.toLowerCase().includes("today")).length;

  const rows: ApprovalRow[] = approvals.map((a) => ({
    id: a.id,
    referenceId: a.referenceId,
    owner: a.owner,
    dueDisplay: a.dueDisplay,
  }));

  return (
    <>
      <PageHeader
        title="Procurement Approvals"
        subtitle="Pending items requiring policy and budget sign-off."
        actions={
          <>
            <Link href="/procurement/approvals/escalation" className="btn ghost">Escalation Rules</Link>
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="⏳" iconBg="#e7edfd" label="Pending Approvals" value={approvals.length} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Overdue / Today" value={overdue} />
        <StatCard icon="👥" iconBg="#eff6ff" label="Unique Owners" value={new Set(approvals.map((a) => a.owner)).size} />
        <StatCard icon="📋" iconBg="#ecfdf3" label="Action Required" value={approvals.length} />
      </StatGrid>

      <Card title="Pending approvals">
        {source === "error" ? (
          <EmptyState
            icon="⚠️"
            title="Couldn’t load approvals"
            message="The approvals service didn’t respond. Check your connection and try again."
            action={<Link href="/procurement/approvals" className="btn ghost">Retry</Link>}
          />
        ) : rows.length === 0 ? (
          <EmptyState icon="✅" title="No pending approvals" message="All items are up to date." />
        ) : (
          <DataTable<ApprovalRow>
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter by reference, owner, due…"
            pageSize={10}
            columns={[
              { key: "id", label: "Approval ID" },
              { key: "referenceId", label: "Reference" },
              { key: "owner", label: "Owner" },
              { key: "dueDisplay", label: "Due" },
            ]}
          />
        )}
      </Card>

      <ProcurementApprovalsPanel />
    </>
  );
}
