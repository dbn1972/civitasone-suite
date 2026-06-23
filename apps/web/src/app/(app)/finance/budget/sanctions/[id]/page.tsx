import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState } from "../../../../../_components/ds";
import { getFinanceSanctionById } from "../../../../../_data/loaders";

export default async function SanctionDetailPage({ params }: { params: { id: string } }) {
  const { data: sanction, source } = await getFinanceSanctionById(params.id);

  if (!sanction) {
    return (
      <>
        <PageHeader title="Sanction Detail" back="/finance/budget/sanctions" />
        <EmptyState icon="🖊️" title="Sanction not found" message="This sanction may have been removed or the ID is invalid." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={sanction.sanctionNo}
        subtitle={sanction.subject}
        back="/finance/budget/sanctions"
        actions={
          <>
            <StatusPill status={sanction.status} />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard
          icon="₹"
          iconBg="#ecfdf5"
          label="Amount"
          value={"₹" + (sanction.amount / 100).toLocaleString("en-IN")}
        />
        <StatCard
          icon="📋"
          iconBg="#eff6ff"
          label="Status"
          value={sanction.status.replace(/_/g, " ")}
        />
        <StatCard
          icon="👤"
          iconBg="#faf5ff"
          label="Sanctioned By"
          value={sanction.sanctionedBy}
        />
        <StatCard
          icon="📅"
          iconBg="#fff7ed"
          label="Date"
          value={sanction.date}
        />
      </StatGrid>

      <Card title="Sanction details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">Sanction No</span>
            <span className="mono">{sanction.sanctionNo}</span>
          </div>
          <div className="field">
            <span className="label">Major Head</span>
            <span>{sanction.majorHead}</span>
          </div>
          <div className="field">
            <span className="label">Amount</span>
            <span>₹{(sanction.amount / 100).toLocaleString("en-IN")}</span>
          </div>
          <div className="field">
            <span className="label">Sanctioned By</span>
            <span>{sanction.sanctionedBy}</span>
          </div>
          <div className="field">
            <span className="label">Date</span>
            <span>{sanction.date}</span>
          </div>
          <div className="field">
            <span className="label">Status</span>
            <StatusPill status={sanction.status} />
          </div>
          {sanction.remarks && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Remarks</span>
              <span>{sanction.remarks}</span>
            </div>
          )}
        </div>
      </Card>

      {sanction.lineItems.length > 0 && (
        <Card title="Line items">
          <table className="tbl">
            <thead>
              <tr>
                <th>Description</th>
                <th>Head</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sanction.lineItems.map((item: { description: string; amount: number; head: string }, i: number) => (
                <tr key={i}>
                  <td>{item.description}</td>
                  <td>{item.head}</td>
                  <td className="num">₹{(item.amount / 100).toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {sanction.approvalTrail.length > 0 && (
        <Card title="Approval trail" padding>
          <ol className="tl">
            {sanction.approvalTrail.map((step: { actor: string; action: string; timestamp: string }, i: number) => (
              <li key={i}>
                <div className="tl-dot" />
                <div className="tl-body">
                  <div className="tl-title">{step.actor} — {step.action}</div>
                  <div className="tl-sub">{step.timestamp}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}
