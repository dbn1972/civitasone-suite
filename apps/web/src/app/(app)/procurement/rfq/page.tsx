import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, StatusPill, EmptyState } from "../../../_components/ds";
import { getRFQs } from "../../../_data/loaders";

export default async function RFQPage() {
  const { data: rfqs, source } = await getRFQs();

  const issued = rfqs.filter((r) => r.status === "issued").length;
  const totalResponses = rfqs.reduce((sum, r) => sum + r.responsesReceived, 0);
  const awarded = rfqs.filter((r) => r.status === "awarded").length;

  return (
    <>
      <PageHeader
        title="Request for Quotation"
        subtitle="Manage RFQs issued to vendors and track responses received."
        actions={
          <>
            <button className="btn ghost">Templates</button>
            <button className="btn primary">+ New RFQ</button>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📝" iconBg="#e7edfd" label="Total RFQs" value={rfqs.length} />
        <StatCard icon="📤" iconBg="#eff6ff" label="Issued" value={issued} />
        <StatCard icon="📥" iconBg="#ecfdf3" label="Responses" value={totalResponses} />
        <StatCard icon="🏆" iconBg="#fffaeb" label="Awarded" value={awarded} />
      </StatGrid>

      <Card
        title="Requests for quotation"
        link={
          <div className="seg">
            <span className="on">All</span>
            <span>Open</span>
            <span>Closed</span>
          </div>
        }
      >
        {rfqs.length === 0 ? (
          <EmptyState icon="📝" title="No RFQs found" message="Create a new RFQ to start collecting vendor quotes." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>RFQ No</th>
                <th>Title</th>
                <th>Indent Ref</th>
                <th className="num">Invited</th>
                <th className="num">Responses</th>
                <th>Closing Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rfqs.map((rfq) => (
                <tr key={rfq.id} className="clickable">
                  <td>
                    <Link href={`/procurement/rfq/${rfq.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                      <span className="mono">{rfq.rfqNo}</span>
                    </Link>
                  </td>
                  <td>{rfq.title}</td>
                  <td><span className="mono">{rfq.indentRef ?? "—"}</span></td>
                  <td className="num">{rfq.vendorsInvited}</td>
                  <td className="num">{rfq.responsesReceived}</td>
                  <td>{rfq.closingDate}</td>
                  <td><StatusPill status={rfq.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
