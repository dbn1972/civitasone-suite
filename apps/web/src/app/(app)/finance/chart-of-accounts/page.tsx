import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { getChartOfAccounts } from "../../../_data/loaders";
import { AccountsTable } from "./AccountsTable";

export default async function ChartOfAccountsPage() {
  const { data: accounts, source } = await getChartOfAccounts();

  const majorHeads = accounts.filter((a) => a.type === "asset" || a.type === "liability").length;
  const activeCount = accounts.filter((a) => a.status === "active").length;

  return (
    <>
      <PageHeader
        title="Chart of Accounts (LMMHA)"
        subtitle="Standard government head-of-account structure synced with CGA."
        actions={
          <>
            <button className="btn ghost">Import LMMHA</button>
            <button className="btn primary">+ Add Head</button>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🧱" iconBg="#e7edfd" label="Heads of Account" value={accounts.length} />
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Asset / Liability" value={majorHeads} />
        <StatCard icon="🔢" iconBg="#ecfdf3" label="Income / Expense" value={accounts.length - majorHeads} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Active" value={activeCount} delta="CGA" up={true} />
      </StatGrid>

      <AccountsTable accounts={accounts} source={source} />
    </>
  );
}
