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
      />
      <StatGrid>
        <StatCard icon="🛡️" iconBg="#e7edfd" label="Total Guarantees" value={guarantees.length} />
        <StatCard icon="📈" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Released" value={released} />
        <StatCard icon="⚠️" iconBg="#fce7ee" label="Expiring Soon" value={guarantees.length - active - released} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside GuaranteesTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <Card title="Guarantees & Securities">
        <GuaranteesTable guarantees={guarantees} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
