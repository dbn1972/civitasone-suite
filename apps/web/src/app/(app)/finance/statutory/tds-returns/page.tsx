import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceTDSReturns } from "@/app/_data/loaders";
import { TDSReturnsTable } from "./TDSReturnsTable";

export default async function TDSReturnsPage() {
  const { data: returns, source } = await getFinanceTDSReturns();
  const filed = returns.filter((r) => String(r.status).toLowerCase() === "filed").length;
  const pending = returns.filter((r) => String(r.status).toLowerCase() === "pending").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="TDS Returns"
        subtitle="Quarterly vendor TDS deduction register, by section and quarter, with CSV export."
        back="/finance"
      />
      <StatGrid>
        <StatCard icon="📑" iconBg="#e7edfd" label="Total Returns" value={returns.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Filed" value={filed} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Quarters" value={new Set(returns.map((r) => String(r.quarter ?? ""))).size} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside TDSReturnsTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <Card title="TDS Returns">
        <TDSReturnsTable returns={returns} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
