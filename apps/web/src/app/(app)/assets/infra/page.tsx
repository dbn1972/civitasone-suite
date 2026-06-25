import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getInfraAssets } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, DataTable } from "../../../_components/ds";
import { formatMoney } from "@/lib/formatters";

export default async function InfraAssetsPage() {
  const { data: allAssets, source } = await getInfraAssets();
  const assets = allAssets.filter((a) => a.type === "infra");
  const buildings = assets.filter((a) => a.category?.toLowerCase().includes("build")).length;
  const needsRepair = assets.filter((a) => a.condition === "poor").length;
  const netBlock = assets.reduce((sum, a) => sum + a.currentValue, 0);

  const rows = assets.map((a) => ({
    id: a.id,
    assetCode: a.assetCode,
    name: a.name,
    category: a.category ?? "—",
    currentValue: a.currentValue,
    condition: (a.condition ?? a.status.replace(/_/g, " ")),
  }));

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Infrastructure Assets"
        subtitle="Buildings, roads, utilities & public infrastructure register."
        actions={
          <>
            <a href="/assets/locations" className="btn ghost">Map view</a>
            <a href="/assets/register" className="btn primary">+ Add Infra</a>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="🏗️" iconBg="#fdf0e3" label="Infra Assets" value={assets.length.toLocaleString("en-IN")} />
        <StatCard icon="🏢" iconBg="#eff6ff" label="Buildings" value={buildings.toLocaleString("en-IN")} />
        <StatCard icon="💰" iconBg="#ecfdf3" label="Net Block" value={formatMoney(netBlock)} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Needs Repair" value={needsRepair.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Infrastructure asset register</h3>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="🏗️" title="No infrastructure assets" message="Infrastructure assets will appear here once added." />
        ) : (
          <DataTable
            columns={[
              { key: "assetCode", label: "ID" },
              { key: "name", label: "Asset" },
              { key: "category", label: "Type" },
              { key: "currentValue", label: "Value", align: "right", cellType: "amount" },
              { key: "condition", label: "Condition", cellType: "status" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/assets/"
            sortable
            filterable
            filterPlaceholder="Filter infrastructure…"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
