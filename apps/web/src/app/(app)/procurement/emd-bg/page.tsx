import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getProcurementEMD, getProcurementPBG } from "../../../_data/loaders";
import { EmdBgTable } from "./EmdBgTable";

export default async function EmdBgPage() {
  const [{ data: emdEntries, source: emdSource }, { data: pbgEntries, source: pbgSource }] = await Promise.all([
    getProcurementEMD(),
    getProcurementPBG(),
  ]);
  const entries = [...emdEntries, ...pbgEntries];
  const source = emdSource === "error" || pbgSource === "error" ? "error" : "api";

  const active = entries.filter((e) => e.status === "Active").length;
  const expired = entries.filter((e) => e.status === "Expired").length;
  const forfeited = entries.filter((e) => e.status === "Forfeited").length;
  const totalValuePaise = entries.filter((e) => e.status === "Active").reduce((sum, e) => sum + e.amount, 0);
  const totalValueDisplay = totalValuePaise > 0 ? `₹${(totalValuePaise / 100).toLocaleString("en-IN")}` : "₹0";

  return (
    <>
      <PageHeader
        title="EMD & Bank Guarantees"
        subtitle="Earnest money deposits and bank guarantee register for procurement security."
        actions={source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
      />

      <StatGrid>
        <StatCard icon="🏦" iconBg="#eef2ff" label="Active Guarantees" value={active} />
        <StatCard icon="💵" iconBg="#ecfdf3" label="Total Active Value" value={totalValueDisplay} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Expired" value={expired} />
        <StatCard icon="🚫" iconBg="#fce7ee" label="Forfeited" value={forfeited} />
      </StatGrid>

      <EmdBgTable entries={entries} source={source} />
    </>
  );
}
