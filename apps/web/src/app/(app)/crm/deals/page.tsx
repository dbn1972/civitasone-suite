import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getDeals } from "../../../_data/loaders";
import { DealsTable } from "./DealsTable";

function fmtAmount(paise: number): string {
  const crore = paise / 10_000_000;
  return crore >= 1 ? `₹${crore.toFixed(1)} Cr` : `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export default async function Page() {
  const { data: deals, source } = await getDeals();

  const openDeals = deals.filter((d) => d.status === "open").length;
  const pipelineValue = deals.filter((d) => d.status === "open").reduce((s, d) => s + d.amount, 0);
  const wonValue = deals.filter((d) => d.status === "won").reduce((s, d) => s + d.amount, 0);

  return (
    <>
      <PageHeader
        title="Deal Pipeline"
        subtitle="Track high-value opportunities across stages."
        back="/crm"
        actions={
          <>
            <button className="btn ghost">Export</button>
            <button className="btn primary">+ New Deal</button>
          </>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🎯" iconBg="#fce7ee" label="Total Deals" value={deals.length.toLocaleString("en-IN")} />
        <StatCard icon="🎯" iconBg="#fce7ee" label="Deals Open" value={openDeals.toLocaleString("en-IN")} delta="+22" up />
        <StatCard icon="🎯" iconBg="#fce7ee" label="Pipeline" value={fmtAmount(pipelineValue)} delta="+13%" up />
        <StatCard icon="🎯" iconBg="#fce7ee" label="Won Value" value={fmtAmount(wonValue)} />
      </StatGrid>
      <DealsTable deals={deals} source={source} />
    </>
  );
}
