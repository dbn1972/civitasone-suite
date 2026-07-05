import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceGuarantees } from "@/app/_data/loaders";
import { GuaranteesTable } from "./GuaranteesTable";

export default async function GuaranteesPage() {
  const { data: guarantees, source } = await getFinanceGuarantees();
  const active = guarantees.filter((g) => String(g.status).toLowerCase() === "active").length;
  const released = guarantees.filter((g) => String(g.status).toLowerCase() === "released").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Bank Guarantees & EMDs"
        subtitle="Bank guarantees, performance securities, and earnest money deposits."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🛡️" iconBg="#e7edfd" label="Total Guarantees" value={guarantees.length} />
        <StatCard icon="📈" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Released" value={released} />
        <StatCard icon="⚠️" iconBg="#fce7ee" label="Expiring Soon" value={guarantees.length - active - released} />
      </StatGrid>
      <Card title="Guarantees & Securities">
        <GuaranteesTable guarantees={guarantees} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
