import { PageHeader, StatGrid, StatCard, Term } from "../../../_components/ds";
import { getChartOfAccounts } from "../../../_data/loaders";
import { AccountsTable } from "./AccountsTable";

export default async function ChartOfAccountsPage() {
  const { data: accounts, source } = await getChartOfAccounts();

  const majorHeads = accounts.filter((a) => a.type === "asset" || a.type === "liability").length;
  const activeCount = accounts.filter((a) => a.status === "active").length;

  return (
    <>
      <PageHeader
        title={<>Chart of Accounts (<Term name="LMMHA" />)</>}
        subtitle={<>Standard government head-of-account structure synced with <Term name="CGA" />.</>}
        help="finance"
        actions={
          <>
            {/* "Import LMMHA" used to point at the same href as "+ Add Head" —
                there is no bulk-import feature behind it (that page is a
                single-head manual create form), so the duplicate button is
                removed rather than left as a dead second link to the same
                form. */}
            <a href="/finance/chart-of-accounts/new" className="btn primary">+ Add Head</a>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🧱" iconBg="#e7edfd" label="Heads of Account" value={accounts.length} />
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Asset / Liability" value={majorHeads} />
        <StatCard icon="🔢" iconBg="#ecfdf3" label="Income / Expense" value={accounts.length - majorHeads} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Active" value={activeCount} delta="CGA" up={true} />
      </StatGrid>

      {/* UX-012: the data-source badge now lives inside AccountsTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <AccountsTable accounts={accounts} source={source} />
    </>
  );
}
