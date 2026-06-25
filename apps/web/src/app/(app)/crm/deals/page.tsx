import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getDeals } from "../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { DealsTable } from "./DealsTable";

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
          <a className="btn primary" href="/crm/deals/new">+ New Deal</a>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🎯" iconBg="#fce7ee" label="Total Deals" value={deals.length.toLocaleString("en-IN")} />
        <StatCard icon="🎯" iconBg="#fce7ee" label="Deals Open" value={openDeals.toLocaleString("en-IN")} />
        <StatCard icon="🎯" iconBg="#fce7ee" label="Pipeline" value={formatMoney(pipelineValue)} />
        <StatCard icon="🎯" iconBg="#fce7ee" label="Won Value" value={formatMoney(wonValue)} />
      </StatGrid>
      <DealsTable deals={deals} source={source} />
    </>
  );
}
