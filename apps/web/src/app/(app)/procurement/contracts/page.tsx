import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, StatusPill, EmptyState } from "../../../_components/ds";
import { getContracts } from "../../../_data/loaders";

export default async function ProcurementContractsPage() {
  const { data: contracts, source } = await getContracts();

  const active = contracts.filter((c) => c.status === "active").length;
  const expiring = contracts.filter((c) => c.status === "expiring").length;
  const expired = contracts.filter((c) => c.status === "expired").length;

  return (
    <>
      <PageHeader
        title="Contracts Register"
        subtitle="Active and historical procurement contracts with renewal tracking."
        actions={
          <>
            <button className="btn ghost">Templates</button>
            <button className="btn primary">+ New Contract</button>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📄" iconBg="#e7edfd" label="Total Contracts" value={contracts.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Expiring Soon" value={expiring} />
        <StatCard icon="🔒" iconBg="#f1f5f9" label="Expired" value={expired} />
      </StatGrid>

      <Card
        title="Contracts list"
        link={
          <div className="seg">
            <span className="on">All</span>
            <span>Active</span>
            <span>Expiring</span>
          </div>
        }
      >
        {contracts.length === 0 ? (
          <EmptyState icon="📄" title="No contracts found" message="Create a new contract to get started." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Vendor / Counter-party</th>
                <th>Type</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td>{c.sublabel ?? "—"}</td>
                  <td>{c.meta ?? "—"}</td>
                  <td>{c.status ? <StatusPill status={c.status} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
