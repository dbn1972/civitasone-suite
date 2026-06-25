import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getFixedAssets } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, DataTable } from "../../../_components/ds";
import { formatMoney } from "@/lib/formatters";

export default async function FixedAssetsPage() {
  const { data: allAssets, source } = await getFixedAssets();
  const assets = allAssets.filter((a) => a.type === "fixed");
  const totalActive = assets.filter((a) => a.status === "active" || a.status === "in_use").length;
  const grossBlock = assets.reduce((sum, a) => sum + a.purchaseCost, 0);
  const netBlock = assets.reduce((sum, a) => sum + a.currentValue, 0);
  const tagged = assets.length > 0 ? Math.round((totalActive / assets.length) * 100) : 0;

  const rows = assets.map((a) => ({
    id: a.id,
    assetCode: a.assetCode,
    name: a.name,
    location: a.location ?? "—",
    currentValue: a.currentValue,
    status: a.status.replace(/_/g, " "),
  }));

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Fixed Asset Register"
        subtitle="Register, tag (QR) and value fixed assets."
        actions={
          <>
            <a href="/assets/bulk-import" className="btn ghost">Bulk tag</a>
            <a href="/assets/register" className="btn primary">+ Register Asset</a>
          </>
        }
      />
      <div
        className="banner"
        style={{
          background: "#fdf0e3",
          border: "1px solid #fcd9b6",
          color: "#9a3412",
          borderRadius: 12,
          padding: "13px 16px",
          marginBottom: 18,
          fontSize: 13,
        }}
      >
        <span aria-hidden="true">🔗</span> <b>Auto-capitalised from Procurement GRN.</b> Accepted capital goods create asset records here; depreciation posts to Finance.
      </div>
      <StatGrid>
        <StatCard icon="🖥️" iconBg="#fdf0e3" label="Fixed Assets" value={assets.length.toLocaleString("en-IN")} />
        <StatCard icon="🔖" iconBg="#eff6ff" label="Tagged (QR)" value={`${tagged}%`} />
        <StatCard icon="💰" iconBg="#ecfdf3" label="Gross Block" value={formatMoney(grossBlock)} />
        <StatCard icon="📉" iconBg="#fffaeb" label="Net Book Value" value={formatMoney(netBlock)} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Fixed asset register</h3>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="🖥️" title="No fixed assets found" message="Fixed assets will appear here once registered." />
        ) : (
          <DataTable
            columns={[
              { key: "assetCode", label: "Asset" },
              { key: "name", label: "Item" },
              { key: "location", label: "Location" },
              { key: "currentValue", label: "Net value", align: "right", cellType: "amount" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/assets/"
            sortable
            filterable
            filterPlaceholder="Filter fixed assets…"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
