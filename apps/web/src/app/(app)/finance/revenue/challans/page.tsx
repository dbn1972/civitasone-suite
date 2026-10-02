import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceChallans } from "@/app/_data/loaders";
import { challanStatusCounts } from "@/lib/finance/challanRegister";
import { ChallansTable } from "./ChallansTable";

export default async function ChallansPage() {
  const { data: challans, source } = await getFinanceChallans();
  // GAP-FINANCE-REVENUE-CHALLANS-03: count the real statuses (pending |
  // deposited | reconciled); anything else is "Other", so the cards sum to Total.
  const counts = challanStatusCounts(challans);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* GAP-FINANCE-REVENUE-CHALLANS-05: the subtitle states only what the table shows. */}
      <PageHeader title="Challan Register" subtitle="Government challans and deposit status." back="/finance" />
      <StatGrid>
        <StatCard icon="📄" iconBg="#e7edfd" label="Total Challans" value={counts.total} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={counts.pending} />
        <StatCard icon="🏦" iconBg="#eff6ff" label="Deposited" value={counts.deposited} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Reconciled" value={counts.reconciled} />
        {counts.other > 0 ? <StatCard icon="❔" iconBg="#f2f4f7" label="Other" value={counts.other} /> : null}
        {/* treasury.finance_challans has no "bank" column — "depositor" is the closest real field. */}
        <StatCard icon="👤" iconBg="#eff6ff" label="Depositors" value={new Set(challans.map((c) => c.depositor)).size} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside ChallansTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <Card title="Challans"><ChallansTable challans={challans} source={source === "error" ? "error" : "api"} /></Card>
    </div>
  );
}
