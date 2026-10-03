import { PageHeader, Card, LoadErrorState } from "../../../_components/ds";
import { getChartOfAccounts } from "../../../_data/loaders";
import { JournalEntryForm } from "./JournalEntryForm";
import { getPeriods } from "../period-close/periodsLoader";

export default async function JournalEntryPage() {
  const [result, periodsResult] = await Promise.all([getChartOfAccounts(), getPeriods()]);
  const { data: accounts, source } = result;
  // GAP-FINANCE-JOURNAL-ENTRY-03: null = periods failed to load (shown as unverified).
  const periods = periodsResult.source === "error" ? null : periodsResult.data.map((p) => ({ period: p.period, status: p.status }));

  return (
    <>
      <PageHeader
        title="Journal Entry"
        subtitle="Create balanced accounting entries with voucher context."
        back="/finance/accounting/general-ledger"
      />

      {/* GAP-FINANCE-JOURNAL-ENTRY-01: no form (and no free-text account
          codes) when the chart of accounts failed to load. */}
      {source === "error" ? (
        <LoadErrorState result={result} area="chart of accounts" backHref="/finance" />
      ) : (
        <Card title="Post journal entry" padding>
          <JournalEntryForm accounts={accounts} periods={periods} />
        </Card>
      )}
    </>
  );
}
