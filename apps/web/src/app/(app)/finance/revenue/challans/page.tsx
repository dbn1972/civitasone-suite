import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceChallans } from "@/app/_data/loaders";
import { ChallansTable } from "./ChallansTable";

export default async function ChallansPage() {
  const { data: challans, source } = await getFinanceChallans();
  const verified = challans.filter((c) => String(c.status).toLowerCase() === "verified").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Challan Register" subtitle="Government challans with deposit verification and bank reconciliation." back="/finance" />
      <StatGrid>
        <StatCard icon="📄" iconBg="#e7edfd" label="Total Challans" value={challans.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Verified" value={verified} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={challans.length - verified} />
        {/* treasury.finance_challans has no "bank" column — "depositor" is the closest real field. */}
        <StatCard icon="🏦" iconBg="#eff6ff" label="Depositors" value={new Set(challans.map((c) => c.depositor)).size} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside ChallansTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <Card title="Challans"><ChallansTable challans={challans} source={source === "error" ? "error" : "api"} /></Card>
    </div>
  );
}
