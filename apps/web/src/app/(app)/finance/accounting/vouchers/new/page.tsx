import { PageHeader, Card, LoadErrorState } from "../../../../../_components/ds";
import { getChartOfAccounts } from "../../../../../_data/loaders";
import { JournalEntryForm } from "../../../journal-entry/JournalEntryForm";
import { getPeriods } from "../../../period-close/periodsLoader";

/**
 * New Journal Voucher — consolidated onto the single balanced-guarded
 * JournalEntryForm (account dropdowns + maker-checker confirm). The previous
 * free-text, unbalanced-allowed form has been retired so both entry points
 * post identical, validated, balanced journals.
 */
export default async function NewVoucherPage() {
  const [result, periodsResult] = await Promise.all([getChartOfAccounts(), getPeriods()]);
  const { data: accounts, source } = result;
  // GAP-FINANCE-JOURNAL-ENTRY-03: null = periods failed to load (shown as unverified).
  const periods = periodsResult.source === "error" ? null : periodsResult.data.map((p) => ({ period: p.period, status: p.status }));

  return (
    <>
      <PageHeader
        title="New Journal Voucher"
        subtitle="Create a balanced double-entry voucher — debit must equal credit."
        back="/finance/accounting/general-ledger"
      />

      {/* GAP-FINANCE-VOUCHERS-NEW-01: when the chart of accounts could not be
          loaded the form is NOT rendered -- no free-text account codes. */}
      {source === "error" ? (
        <LoadErrorState result={result} area="chart of accounts" backHref="/finance/accounting/general-ledger" />
      ) : (
        <Card title="Voucher entry" padding>
          <JournalEntryForm accounts={accounts} redirectTo="/finance/accounting/general-ledger" periods={periods} />
        </Card>
      )}
    </>
  );
}
