import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getDeals } from "../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { DealsTable } from "./DealsTable";

export default async function Page() {
  const { data: deals, source } = await getDeals();

  const openDeals = deals.filter((d) => d.status === "active").length;
  const pipelineValue = deals.filter((d) => d.status === "active").reduce((s, d) => s + d.amount, 0);
  const wonValue = deals.filter((d) => d.status === "won").reduce((s, d) => s + d.amount, 0);

  return (
    <>
      <PageHeader
        title="Vendor / Stakeholder Engagements"
        subtitle="Track high-value vendor engagements, procurement opportunities, and stakeholder interactions."
        back="/crm"
        actions={
          <a className="btn primary" href="/crm/deals/new">+ New Engagement</a>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🤝" iconBg="#fce7ee" label="Total Engagements" value={deals.length.toLocaleString("en-IN")} />
        <StatCard icon="🔄" iconBg="#fce7ee" label="Active Engagements" value={openDeals.toLocaleString("en-IN")} />
        <StatCard icon="📊" iconBg="#fce7ee" label="Pipeline Value" value={formatMoney(pipelineValue)} />
        <StatCard icon="✅" iconBg="#fce7ee" label="Completed Value" value={formatMoney(wonValue)} />
      </StatGrid>
      <DealsTable deals={deals} source={source} />
    </>
  );
}
