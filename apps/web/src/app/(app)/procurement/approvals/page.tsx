import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "../../../_components/ds";
import { getProcurementApprovals } from "../../../_data/loaders";
import { ProcurementApprovalsPanel } from "./ProcurementApprovalsPanel";

export default async function ApprovalsPage() {
  const { data: approvals, source } = await getProcurementApprovals();

  const overdue = approvals.filter((a) => a.dueDisplay.toLowerCase().includes("overdue") || a.dueDisplay.toLowerCase().includes("today")).length;

  return (
    <>
      <PageHeader
        title="Procurement Approvals"
        subtitle="Pending items requiring policy and budget sign-off."
        actions={
          <>
            <button className="btn ghost">Escalation Rules</button>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="⏳" iconBg="#e7edfd" label="Pending Approvals" value={approvals.length} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Overdue / Today" value={overdue} />
        <StatCard icon="👥" iconBg="#eff6ff" label="Unique Owners" value={new Set(approvals.map((a) => a.owner)).size} />
        <StatCard icon="📋" iconBg="#ecfdf3" label="Action Required" value={approvals.length} />
      </StatGrid>

      <Card
        title="Pending approvals"
        link={
          <div className="seg">
            <span className="on">All</span>
            <span>Indent</span>
            <span>PO</span>
          </div>
        }
      >
        {approvals.length === 0 ? (
          <EmptyState icon="✅" title="No pending approvals" message="All items are up to date." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Approval ID</th>
                <th>Reference</th>
                <th>Owner</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {approvals.map((item) => (
                <tr key={item.id}>
                  <td><span className="mono">{item.id}</span></td>
                  <td><span className="mono">{item.referenceId}</span></td>
                  <td>{item.owner}</td>
                  <td>{item.dueDisplay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <ProcurementApprovalsPanel />
    </>
  );
}
