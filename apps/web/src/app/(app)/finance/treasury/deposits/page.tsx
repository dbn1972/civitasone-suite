import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getFinanceDeposits, getFinanceDepositsSummary } from "@/app/_data/loaders";
import { DepositsTable } from "./DepositsTable";

export default async function DepositsPage() {
  const [{ data: deposits, source }, summaryResult] = await Promise.all([
    getFinanceDeposits(),
    // GAP2-FINANCE-TREASURY-DEPOSITS-TOTALS-06: counts and the active-balance
    // total come from a server-side aggregate over ALL deposits, not the
    // (default-50-capped) register page.
    getFinanceDepositsSummary(),
  ]);
  const stats = summaryResult.data;
  // A failed load must not show zeros that look like real figures.
  const failed = summaryResult.source === "error";

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Deposits Register"
        subtitle="Personal deposits (PD), earnest money (EMD), security deposits (SD) and FDRs held by the treasury, with administrator and balance."
        back="/finance"
      />
      <StatGrid>
        <StatCard icon="🏧" tone="info" label="Total Deposits" value={failed ? null : stats.total} />
        <StatCard icon="📈" tone="good" label="Active" value={failed ? null : stats.active} />
        <StatCard icon="✅" tone="warn" label="Refunded" value={failed ? null : stats.refunded} />
        <StatCard icon="⚠️" tone="bad" label="Forfeited" value={failed ? null : stats.forfeited} />
        <StatCard icon="💰" tone="info" label="Active Balance" value={failed ? null : formatMoney(stats.activeBalanceMinor)} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside DepositsTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <Card title="Deposits">
        <DepositsTable deposits={deposits} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
