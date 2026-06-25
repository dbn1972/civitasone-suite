import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getAssets } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { formatMoney } from "@/lib/formatters";
import { AssetsTable } from "./AssetsTable";

export default async function AssetListPage() {
  const { data: assets, source } = await getAssets();
  const totalActive = assets.filter((a) => a.status === "active" || a.status === "in_use").length;
  const tagged = Math.round((totalActive / Math.max(assets.length, 1)) * 100);
  const grossBlock = assets.reduce((sum, a) => sum + a.purchaseCost, 0);
  const netBlock = assets.reduce((sum, a) => sum + a.currentValue, 0);

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Fixed Asset Register"
        subtitle="Register, tag (QR) and value fixed assets."
        actions={
          <>
            <button className="btn ghost">Bulk tag</button>
            <button className="btn primary">+ Register Asset</button>
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
        🔗 <b>Auto-capitalised from Procurement GRN.</b> Accepted capital goods create asset records here; depreciation posts to Finance.
      </div>
      <StatGrid>
        <StatCard icon="🖥️" iconBg="#fdf0e3" label="Fixed Assets" value={assets.length.toLocaleString("en-IN")} />
        <StatCard icon="🔖" iconBg="#eff6ff" label="Tagged (QR)" value={`${tagged}%`} />
        <StatCard icon="💰" iconBg="#ecfdf3" label="Gross Block" value={formatMoney(grossBlock)} />
        <StatCard icon="📉" iconBg="#fffaeb" label="Net Book Value" value={formatMoney(netBlock)} />
      </StatGrid>
      <AssetsTable assets={assets} source={source} />
    </>
  );
}
