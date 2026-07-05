import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceFundAccounting } from "@/app/_data/loaders";
import { FundAccountingTable } from "./FundAccountingTable";

export default async function FundAccountingPage() {
  const { data: funds, source } = await getFinanceFundAccounting();
  const active = funds.filter((f) => String(f.status).toLowerCase() === "active").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fund Accounting"
        subtitle="Fund-wise receipts, expenditure, and balance."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="💰" iconBg="#e7edfd" label="Total Funds" value={funds.length} />
        <StatCard icon="📈" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="📋" iconBg="#fffaeb" label="Dormant" value={funds.length - active} />
        <StatCard icon="🏦" iconBg="#eff6ff" label="Sources" value={new Set(funds.map((f) => String(f.source ?? ""))).size} />
      </StatGrid>
      <Card title="Fund Register">
        <FundAccountingTable funds={funds} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
