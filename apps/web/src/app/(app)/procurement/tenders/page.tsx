import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, StatusPill, EmptyState } from "../../../_components/ds";
import { getProcurementTenders } from "../../../_data/loaders";

const TYPE_LABELS: Record<string, string> = {
  open: "Open",
  limited: "Limited",
  single_source: "Single Source",
  gem: "GeM",
};

export default async function TendersPage() {
  const { data: tenders, source } = await getProcurementTenders();

  const published = tenders.filter((t) => t.status === "published").length;
  const underEvaluation = tenders.filter((t) => t.status === "evaluation").length;
  const awarded = tenders.filter((t) => t.status === "awarded").length;

  return (
    <>
      <PageHeader
        title="Tender Management"
        subtitle="Manage open, limited, and GeM tenders with bid tracking."
        actions={
          <>
            <button className="btn ghost">CPPP Portal</button>
            <button className="btn primary">+ New Tender</button>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🏛️" iconBg="#e7edfd" label="Total Tenders" value={tenders.length} />
        <StatCard icon="📢" iconBg="#ecfdf3" label="Published" value={published} />
        <StatCard icon="🔍" iconBg="#fffaeb" label="Under Evaluation" value={underEvaluation} />
        <StatCard icon="🏆" iconBg="#eff6ff" label="Awarded" value={awarded} />
      </StatGrid>

      <Card
        title="Tenders register"
        link={
          <div className="seg">
            <span className="on">All</span>
            <span>Open</span>
            <span>GeM</span>
          </div>
        }
      >
        {tenders.length === 0 ? (
          <EmptyState icon="🏛️" title="No tenders found" message="Create a new tender to start the procurement process." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Tender No</th>
                <th>Title</th>
                <th>Type</th>
                <th className="num">Est. Value</th>
                <th>Published</th>
                <th>Bid Close</th>
                <th className="num">Bids</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tenders.map((tender) => (
                <tr key={tender.id}>
                  <td><span className="mono">{tender.tenderNo}</span></td>
                  <td>{tender.title}</td>
                  <td>{TYPE_LABELS[tender.type] ?? tender.type}</td>
                  <td className="num">₹{(tender.estimatedValue / 100).toLocaleString("en-IN")}</td>
                  <td>{tender.publishDate ?? "—"}</td>
                  <td>{tender.bidClosingDate}</td>
                  <td className="num">{tender.bidsReceived}</td>
                  <td><StatusPill status={tender.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
