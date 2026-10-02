import { getInfraAssets } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, DataTable, RefreshErrorState } from "../../../_components/ds";
import Link from "next/link";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

export default async function InfraAssetsPage() {
  const { data: allAssets, source } = await getInfraAssets();
  const assets = allAssets.filter((a) => a.type === "infra");
  // GAP-ASSETS-INFRA-01: asset-service has no condition field (and returns
  // only a category id, not its name), so "Needs Repair" and "Buildings" were
  // permanent zeros. They are not shown, and the status column is labelled
  // Status -- never status text passed off as a condition.
  const netBlock = assets.reduce((sum, a) => sum + a.currentValue, 0);

  const rows = assets.map((a) => ({
    id: a.id,
    assetCode: a.assetCode,
    name: a.name,
    category: a.category ?? "—",
    currentValue: a.currentValue,
    status: a.status.replace(/_/g, " "),
  }));

  return (
    <>
      <PageHeader
        title="Infrastructure Assets"
        subtitle="Buildings, roads, utilities & public infrastructure register."
        actions={
          <>
            {/* GAP-ASSETS-INFRA-02: /assets/locations is a code/name list, not a map. */}
            <Link href="/assets/locations" className="btn ghost">Locations</Link>
            <a href="/assets/register" className="btn primary">+ Add Infra</a>
          </>
        }
      />
      {/* GAP-ASSETS-INFRA-04: a failed load must not read as "0 assets, net block zero". */}
      <StatGrid>
        <StatCard icon="🏗️" tone="warn" label="Infra Assets" value={source === "error" ? "—" : assets.length.toLocaleString("en-IN")} />
        <StatCard icon="💰" tone="good" label="Net Block" value={source === "error" ? "—" : formatMoney(netBlock)} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Infrastructure asset register</h3>
        </div>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "infrastructure asset register" })} />
        ) : rows.length === 0 ? (
          <EmptyState icon="🏗️" title="No infrastructure assets" message="Infrastructure assets will appear here once added." />
        ) : (
          <DataTable
            columns={[
              { key: "assetCode", label: "ID" },
              { key: "name", label: "Asset" },
              { key: "category", label: "Type" },
              { key: "currentValue", label: "Value", align: "right", cellType: "amount" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/assets/"
            identifyingColumnKey="name"
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
